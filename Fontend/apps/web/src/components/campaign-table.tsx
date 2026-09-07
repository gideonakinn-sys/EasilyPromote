"use client";

import type { CampaignItem } from "./types";

interface CampaignTableProps {
  campaigns: CampaignItem[];
}

export function CampaignTable({ campaigns }: CampaignTableProps) {
  return (
    <div className="w-full max-w-4xl bg-white border border-stone-200 rounded-3xl p-8 shadow-sm text-left animate-in fade-in slide-in-from-bottom-2 duration-200">
      <h2 className="text-xl font-bold mb-4">My Claimed Campaign Placements</h2>
      <p className="text-sm text-stone-500 mb-6 font-medium">
        Here you can track details of all the campaign placements you&apos;ve reserved and submitted content for.
      </p>

      <div className="border border-stone-200 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs font-semibold">
          <thead className="bg-stone-50 border-b border-stone-200 text-stone-500">
            <tr>
              <th className="px-6 py-3">Campaign</th>
              <th className="px-6 py-3">Niche</th>
              <th className="px-6 py-3">Reward</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-stone-900">
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td className="px-6 py-4 font-bold">{c.title}</td>
                <td className="px-6 py-4">{c.category}</td>
                <td className="px-6 py-4">₦{c.reward.toLocaleString()}</td>
                <td className="px-6 py-4">
                  <span className="capitalize">{c.status.replace("_", " ")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
