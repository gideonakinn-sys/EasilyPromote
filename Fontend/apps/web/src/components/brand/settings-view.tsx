"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link01Icon, Logout01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { Skeleton } from "../ui/skeleton";
import { useBrandGuard } from "../../hooks/use-brand-guard";
import { apiRequest, getToken } from "../../lib/api";
import { clearAuth } from "../../lib/auth";
import { uploadFile } from "@ep/ui/lib/upload";

interface BusinessProfile {
  id: string;
  companyName: string;
  industry: string | null;
  phone: string | null;
  logo: string | null;
  cac: string | null;
  verificationStatus: "pending" | "verified" | "rejected";
  website: string | null;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  avatar: string | null;
}

const VERIFICATION_STYLES: Record<string, string> = {
  verified: "bg-[#CBF5E5] text-[#176448]",
  pending: "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-600",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 placeholder-stone-400 outline-none focus:border-stone-400";
const textareaClass =
  "w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-900 placeholder-stone-400 outline-none focus:border-stone-400";

export function SettingsView() {
  useBrandGuard();
  const router = useRouter();
  const { toast } = useToast();

  const [profile, setProfile] = React.useState<BusinessProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [form, setForm] = React.useState({
    companyName: "",
    industry: "",
    phone: "",
    website: "",
    description: "",
    logo: "",
  });

  React.useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    apiRequest<BusinessProfile>("/businesses/me", { method: "GET", token })
      .then((data) => {
        setProfile(data);
        setForm({
          companyName: data.companyName || "",
          industry: data.industry || "",
          phone: data.phone || "",
          website: data.website || "",
          description: data.description || "",
          logo: data.logo || "",
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load profile"))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const token = getToken();
    if (!token) return;
    setUploading(true);
    try {
      const url = await uploadFile(file, "image", { token });
      setForm((prev) => ({ ...prev, logo: url }));
      toast("Logo uploaded", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not upload logo", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    router.push("/login");
  };

  const handleSave = async () => {
    if (!profile) return;
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const cleaned = {
        companyName: form.companyName.trim(),
        industry: form.industry.trim(),
        phone: form.phone.trim(),
        website: form.website.trim(),
        description: form.description.trim(),
        logo: form.logo,
      };
      await apiRequest(`/businesses/${profile.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify(cleaned),
      });
      toast("Profile saved", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not save profile", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="font-rethink font-semibold text-lg text-stone-900 tracking-tight">
          Settings
        </h2>
        <p className="mt-1 text-xs font-medium text-stone-500">Your company profile and workspace details.</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-stone-100 bg-white p-8 text-center">
          <p className="text-sm font-medium text-stone-900">Settings didn&apos;t load</p>
          <p className="mt-1 text-xs font-medium text-stone-500">{error}</p>
        </div>
      ) : (
        profile && (
          <>
            {/* Verification */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-white p-5">
              <div>
                <p className="text-sm font-semibold text-stone-900">Verification</p>
                <p className="mt-0.5 text-xs font-medium text-stone-500">
                  {profile.verificationStatus === "verified"
                    ? "Your business is verified."
                    : profile.verificationStatus === "rejected"
                      ? "Your business documents were rejected. Contact support."
                      : "Your business documents are under review."}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium capitalize",
                  VERIFICATION_STYLES[profile.verificationStatus] || "bg-stone-100 text-stone-600"
                )}
              >
                {profile.verificationStatus}
              </span>
            </div>

            {/* Company profile */}
            <div className="rounded-2xl border border-stone-100 bg-white p-5">
              <h3 className="mb-4 text-sm font-semibold text-stone-900">Company profile</h3>

              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-stone-100">
                  {form.logo ? (
                    <Image src={form.logo} alt="Company logo" width={56} height={56} className="h-full w-full object-cover" unoptimized />
                  ) : (
                    <span className="text-lg font-semibold text-stone-400">
                      {(form.companyName || "C")[0]?.toUpperCase()}
                    </span>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-semibold text-stone-900 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : form.logo ? "Change logo" : "Upload logo"}
                </button>
              </div>

              <div className="space-y-4">
                <Field label="Company name">
                  <input className={inputClass} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Industry">
                    <input className={inputClass} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="e.g. Fintech" />
                  </Field>
                  <Field label="Phone">
                    <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234 …" />
                  </Field>
                </div>
                <Field label="Website">
                  <input className={inputClass} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" />
                </Field>
                <Field label="Description">
                  <textarea
                    className={textareaClass}
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="What does your company do?"
                  />
                </Field>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || !form.companyName.trim()}
                className="mt-6 rounded-full bg-[#FEB604] px-6 py-2.5 text-sm font-semibold text-[#1C1917] border border-stone-100 disabled:bg-stone-200 disabled:text-stone-400"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-white p-5">
              <div className="flex items-center gap-3">
                <HugeiconsIcon icon={Link01Icon} size={18} className="text-stone-400" />
                <div>
                  <p className="text-sm font-semibold text-stone-900">Referral tracking</p>
                  <p className="mt-0.5 text-xs font-medium text-stone-500">Webhook keys and conversion settings.</p>
                </div>
              </div>
              <button
                onClick={() => router.push("/dashboard/brand/settings/referral")}
                className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-semibold text-stone-900"
              >
                Manage
              </button>
            </div>

            <p className="text-xs font-medium text-stone-500">
              Contact: {profile.contactName || "—"} · {profile.contactEmail || "—"}
            </p>

            {/* Account */}
            <div className="rounded-2xl border border-red-100 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <HugeiconsIcon icon={Logout01Icon} size={18} className="text-red-500" />
                  <div>
                    <p className="text-sm font-semibold text-stone-900">Account</p>
                    <p className="mt-0.5 text-xs font-medium text-stone-500">Sign out of your brand workspace.</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600"
                >
                  Log out
                </button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}