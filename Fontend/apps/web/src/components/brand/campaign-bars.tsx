"use client";

import * as React from "react";
import { useId } from "react";
import { formatCompactViews } from "../../lib/brand";
import type { BrandStatsCampaign } from "../../lib/brand";

const WIDTH = 600;
const HEIGHT = 240;
const PAD = { top: 24, right: 16, bottom: 44, left: 40 };

interface CampaignBarsProps {
  campaigns: BrandStatsCampaign[];
}

export function CampaignBars({ campaigns }: CampaignBarsProps) {
  const gradientId = useId();

  const data = campaigns || [];
  const max = Math.max(1, ...data.map((c) => c.views));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-100 bg-white p-5">
        <h3 className="text-sm font-semibold text-neutral-900">Top campaigns</h3>
        <p className="mt-4 text-center text-xs font-medium text-neutral-500">No campaign views yet.</p>
      </div>
    );
  }

  const slot = innerW / data.length;
  const barW = Math.min(44, slot * 0.55);

  return (
    <div className="rounded-2xl border border-neutral-100 bg-white p-5">
      <h3 className="text-sm font-semibold text-neutral-900">Views per campaign</h3>
      <p className="mt-0.5 text-xs font-medium text-neutral-500">Top campaigns by views delivered.</p>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Top campaigns by views delivered"
        className="mt-4 w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FEB604" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PAD.top + innerH - t * innerH;
          return (
            <g key={t}>
              <line x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} stroke="#e5e5e5" strokeWidth="1" />
              <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#a3a3a3" fontWeight="500">
                {formatCompactViews(Math.round(max * t))}
              </text>
            </g>
          );
        })}

        {data.map((c, i) => {
          const h = c.views > 0 ? Math.max((c.views / max) * innerH, 2) : 2;
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const y = PAD.top + innerH - h;
          const label = c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name;
          return (
            <g key={c.id}>
              <rect x={x} y={y} width={barW} height={h} rx={4} fill={`url(#${gradientId})`} />
              {c.views > 0 && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="10" fill="#737373" fontWeight="600">
                  {formatCompactViews(c.views)}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={HEIGHT - PAD.bottom + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#a3a3a3"
                fontWeight="500"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}