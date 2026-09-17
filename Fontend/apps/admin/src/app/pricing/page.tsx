"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { API_URL, apiRequest, getToken, getUser, isAuthenticated } from "../../lib/api";
import { PRICE_ROLES } from "../../lib/roles";

// The per-view price table (ticket 11): what views campaigns are quoted at, and the first tier sets a
// hybrid views bonus's rate. Changes price new quotes only; paid campaigns keep their price and a
// hybrid campaign keeps the bonus rate saved at setup.
interface Tier {
  views: number;
  price: number;
  pricePerThousand: number;
}

interface HistoryEntry {
  id: string;
  createdAt: string;
  actor: { name: string | null; role: string | null };
  note: string | null;
  version: number;
  before: Array<{ views: number; price: number }>;
  after: Array<{ views: number; price: number }>;
}

interface PriceTableData {
  tiers: Tier[];
  defaults: Tier[];
  usingDefaults: boolean;
  version: number;
  updatedAt: string | null;
  bonusViewsRate: number;
  platformFeePercent: number;
  limits: { minTiers: number; maxTiers: number };
  history: HistoryEntry[];
}

interface DraftRow {
  key: number;
  views: string;
  price: string;
}

const naira = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);
const count = (value: number) => value.toLocaleString("en-US");
const digitsOnly = (value: string) => value.replace(/\D/g, "");
const formatDateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

let rowKey = 0;
const toRows = (tiers: Array<{ views: number; price: number }>): DraftRow[] =>
  tiers.map((tier) => ({ key: ++rowKey, views: String(tier.views), price: String(tier.price) }));

// Mirrors the API's checks so problems show before saving; the API checks again.
function problemsWith(rows: DraftRow[], limits: { minTiers: number; maxTiers: number }): string[] {
  const problems: string[] = [];
  if (rows.length < limits.minTiers || rows.length > limits.maxTiers) problems.push(`The table needs between ${limits.minTiers} and ${limits.maxTiers} tiers.`);
  rows.forEach((row, i) => {
    const views = Number(row.views);
    const price = Number(row.price);
    if (!row.views || views < 1000) problems.push(`Tier ${i + 1}: views must be at least 1,000.`);
    if (!row.price || price <= 0) problems.push(`Tier ${i + 1}: set a price above ₦0.`);
    if (i > 0) {
      const prevViews = Number(rows[i - 1].views);
      const prevPrice = Number(rows[i - 1].price);
      if (views <= prevViews) problems.push(`Tier ${i + 1}: views must be more than tier ${i}'s.`);
      else if (price <= prevPrice) problems.push(`Tier ${i + 1}: the price must be more than tier ${i}'s.`);
      else if (price * prevViews > prevPrice * views) problems.push(`Tier ${i + 1}: the price per view can't be higher than tier ${i}'s.`);
    }
  });
  return problems;
}

export default function PriceTablePage() {
  const router = useRouter();
  const [data, setData] = useState<PriceTableData | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const table = await apiRequest<PriceTableData>("/admin/pricing/views");
      setData(table);
      setRows(toRows(table.tiers));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load the price table");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    setCanEdit(PRICE_ROLES.includes(getUser()?.role || ""));
    load();
  }, [router, load]);

  const problems = useMemo(() => (data ? problemsWith(rows, data.limits) : []), [rows, data]);
  const changed = useMemo(() => {
    if (!data) return false;
    if (rows.length !== data.tiers.length) return true;
    return rows.some((row, i) => Number(row.views) !== data.tiers[i].views || Number(row.price) !== data.tiers[i].price);
  }, [rows, data]);

  const updateRow = (key: number, patch: Partial<DraftRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const cancelEdit = () => {
    if (data) setRows(toRows(data.tiers));
    setNote("");
    setEditing(false);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setMessage(null);
    try {
      // A conflict answers 409 with a code, so the response is read directly.
      const token = getToken();
      const res = await fetch(`${API_URL}/admin/pricing/views`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          tiers: rows.map((row) => ({ views: Number(row.views), price: Number(row.price) })),
          expectedVersion: data.version,
          note: note.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as PriceTableData & { error?: string; code?: string };
      if (!res.ok) {
        setMessage({
          text: body.code === "PRICE_TABLE_CHANGED" ? "Someone changed the price table since you opened it. It has been reloaded; make your change again." : body.error || `Request failed (${res.status})`,
          failed: true,
        });
        if (body.code === "PRICE_TABLE_CHANGED") {
          setEditing(false);
          load();
        }
        return;
      }
      setData(body);
      setRows(toRows(body.tiers));
      setEditing(false);
      setNote("");
      setMessage({ text: "Price table saved. New quotes use it now; paid campaigns keep their price.", failed: false });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "That didn't go through", failed: true });
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  const previewFirst = rows[0] && Number(rows[0].views) > 0 && Number(rows[0].price) > 0 ? rows[0] : null;
  const previewBonusRate =
    previewFirst && data
      ? Math.floor((Math.round(Number(previewFirst.price) * 100 * (1 - data.platformFeePercent / 100)) * 1000) / Number(previewFirst.views)) / 100
      : null;

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-stone-200 mb-6 space-y-1">
          <h1 className="text-2xl font-medium text-stone-900 tracking-tight">Price Table</h1>
          <p className="text-sm text-stone-500 font-medium max-w-3xl">
            What brands pay for views. Views campaigns are quoted from these tiers (prices between tiers are worked out along the line), and the first
            tier sets what a hybrid views bonus pays creators. A change prices new quotes only: paid campaigns keep the price they were bought at and
            hybrid campaigns keep the bonus rate saved when they were set up.
          </p>
        </header>

        {error && <p className="mb-4 text-xs font-medium text-red-600">{error}</p>}
        {message && <p className={`mb-4 text-xs font-medium ${message.failed ? "text-red-600" : "text-green-700"}`}>{message.text}</p>}

        {loading && !data ? (
          <div className="bg-white border border-stone-200 rounded-2xl h-64 animate-pulse" />
        ) : data ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <section className="xl:col-span-2 bg-white border border-stone-200 rounded-2xl overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-stone-200">
                <div>
                  <h2 className="text-base font-medium text-stone-900">Per-View Tiers</h2>
                  <p className="text-xs font-medium text-stone-500">
                    {data.usingDefaults ? "The standard table (never changed)." : `Version ${data.version}${data.updatedAt ? `, saved ${formatDateTime(data.updatedAt)}` : ""}.`}
                  </p>
                </div>
                {!editing && (
                  <div className="flex items-center gap-3">
                    {!canEdit && <span className="text-[11px] font-medium text-stone-400">Only finance admins and super admins can change prices.</span>}
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => {
                        setMessage(null);
                        setEditing(true);
                      }}
                      className="px-4 py-2 rounded-full text-xs font-semibold bg-stone-900 text-white disabled:opacity-40"
                    >
                      Edit Prices
                    </button>
                  </div>
                )}
              </div>

              <table className="w-full text-left text-xs text-stone-700">
                <thead className="bg-stone-50 border-b border-stone-200 text-[11px] text-stone-500 font-medium">
                  <tr>
                    <th className="px-5 py-3 font-medium">Tier</th>
                    <th className="px-5 py-3 font-medium">Views</th>
                    <th className="px-5 py-3 font-medium">Brand Pays</th>
                    <th className="px-5 py-3 font-medium">Per 1,000 Views</th>
                    {editing && <th className="px-5 py-3 font-medium text-right">Remove</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((row, i) => {
                    const views = Number(row.views);
                    const price = Number(row.price);
                    const perThousand = views > 0 && price > 0 ? Math.round((price / views) * 1000 * 100) / 100 : null;
                    return (
                      <tr key={row.key}>
                        <td className="px-5 py-3 font-medium text-stone-500">{i + 1}</td>
                        <td className="px-5 py-3">
                          {editing ? (
                            <input
                              aria-label={`Tier ${i + 1} views`}
                              inputMode="numeric"
                              value={row.views}
                              onChange={(e) => updateRow(row.key, { views: digitsOnly(e.target.value) })}
                              className="w-36 px-3 py-2 rounded-xl border border-stone-200 text-xs text-stone-900 tabular-nums"
                            />
                          ) : (
                            <span className="tabular-nums">{count(views)}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {editing ? (
                            <div className="relative w-40">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">₦</span>
                              <input
                                aria-label={`Tier ${i + 1} price`}
                                inputMode="numeric"
                                value={row.price}
                                onChange={(e) => updateRow(row.key, { price: digitsOnly(e.target.value) })}
                                className="w-full pl-7 pr-3 py-2 rounded-xl border border-stone-200 text-xs text-stone-900 tabular-nums"
                              />
                            </div>
                          ) : (
                            <span className="tabular-nums font-medium text-stone-900">{naira(price)}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{perThousand === null ? "—" : naira(perThousand)}</td>
                        {editing && (
                          <td className="px-5 py-3 text-right">
                            <button
                              type="button"
                              disabled={rows.length <= data.limits.minTiers}
                              onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                              className="px-3 py-1.5 rounded-full text-[11px] font-semibold border border-stone-200 text-stone-600 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {editing && (
                <div className="px-5 py-4 border-t border-stone-200 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={rows.length >= data.limits.maxTiers}
                      onClick={() => {
                        const last = rows[rows.length - 1];
                        setRows((current) => [...current, { key: ++rowKey, views: last ? String(Number(last.views) * 2) : "100000", price: "" }]);
                      }}
                      className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-200 text-stone-700 disabled:opacity-40"
                    >
                      Add Tier
                    </button>
                    <button
                      type="button"
                      onClick={() => setRows(toRows(data.defaults))}
                      className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-200 text-stone-700"
                    >
                      Use Standard Table
                    </button>
                  </div>

                  {problems.length > 0 && (
                    <ul className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-0.5">
                      {problems.slice(0, 5).map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  )}

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-stone-700">Why are prices changing?</span>
                    <textarea
                      value={note}
                      maxLength={500}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Recorded in the activity log"
                      className="w-full px-3 py-2 rounded-xl border border-stone-200 text-xs text-stone-900"
                    />
                  </label>

                  <div className="flex gap-2">
                    <button type="button" onClick={cancelEdit} className="px-4 py-2 rounded-full text-xs font-semibold border border-stone-200 text-stone-600">
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!changed || problems.length > 0 || !note.trim()}
                      onClick={() => setConfirming(true)}
                      className="px-4 py-2 rounded-full text-xs font-semibold bg-[#FEB604] text-stone-950 disabled:opacity-40"
                    >
                      Save Prices
                    </button>
                  </div>
                </div>
              )}
            </section>

            <aside className="space-y-6">
              <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
                <h2 className="text-base font-medium text-stone-900">What This Changes</h2>
                <dl className="text-xs space-y-2">
                  <div className="flex justify-between gap-3">
                    <dt className="text-stone-500 font-medium">Hybrid views bonus, per 1,000 views</dt>
                    <dd className="text-stone-900 font-medium tabular-nums">{naira(data.bonusViewsRate)}</dd>
                  </div>
                  {editing && previewBonusRate !== null && previewBonusRate !== data.bonusViewsRate && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-stone-500 font-medium">After saving</dt>
                      <dd className="text-stone-900 font-medium tabular-nums">{naira(previewBonusRate)}</dd>
                    </div>
                  )}
                </dl>
                <p className="text-[11px] font-medium text-stone-500 leading-relaxed">
                  The creator&apos;s share ({100 - data.platformFeePercent}%) of tier 1, for hybrid campaigns set up from now on. Industry rates on{" "}
                  <Link href="/industries" className="underline underline-offset-2">
                    Industries
                  </Link>{" "}
                  are separate and aren&apos;t changed here.
                </p>
              </section>

              <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
                <h2 className="text-base font-medium text-stone-900">Changes</h2>
                {data.history.length === 0 ? (
                  <p className="text-xs font-medium text-stone-400">No changes yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.history.map((entry) => (
                      <li key={entry.id} className="text-xs border border-stone-100 rounded-xl p-3 space-y-1">
                        <p className="font-medium text-stone-900">
                          Version {entry.version} · {entry.actor.name || "Admin"}
                        </p>
                        <p className="text-[11px] text-stone-500 font-medium">{formatDateTime(entry.createdAt)}</p>
                        {entry.note && <p className="text-stone-600">{entry.note}</p>}
                        <p className="text-[11px] text-stone-500">
                          Tier 1: {entry.before[0] ? naira(entry.before[0].price) : "—"} → {entry.after[0] ? naira(entry.after[0].price) : "—"} ·{" "}
                          {entry.after.length} tiers
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        ) : null}
      </main>

      {confirming && data && (
        <div className="fixed inset-0 z-[60] bg-stone-950/60 flex items-center justify-center p-4" onClick={() => !saving && setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-prices-heading"
            className="bg-white rounded-2xl max-w-sm w-full p-6 border border-stone-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 id="save-prices-heading" className="text-lg font-medium text-stone-900 tracking-tight">
                Save New Prices?
              </h3>
              <p className="text-xs font-medium text-stone-500 leading-relaxed">
                Every new views quote uses this table straight away, and so do unpaid drafts when their views change. Paid campaigns keep their price
                and hybrid campaigns keep their saved bonus rate.
              </p>
            </div>
            <dl className="bg-stone-50 rounded-xl p-4 space-y-2 text-xs">
              {rows.slice(0, 4).map((row, i) => (
                <div key={row.key} className="flex justify-between gap-3">
                  <dt className="font-medium text-stone-500">{count(Number(row.views))} views</dt>
                  <dd className="font-medium text-stone-900 tabular-nums">
                    {data.tiers[i] && data.tiers[i].views === Number(row.views) && data.tiers[i].price !== Number(row.price)
                      ? `${naira(data.tiers[i].price)} → ${naira(Number(row.price))}`
                      : naira(Number(row.price))}
                  </dd>
                </div>
              ))}
              {rows.length > 4 && <p className="text-[11px] text-stone-400 font-medium">and {rows.length - 4} more tiers</p>}
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={saving}
                className="flex-1 py-2.5 border border-stone-200 text-stone-600 rounded-full font-semibold text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex-1 py-2.5 bg-stone-900 text-white rounded-full font-semibold text-xs disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Prices"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
