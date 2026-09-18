"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ep/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../ui/chart";
import { formatCompactViews } from "../../lib/brand";
import type { MonthPoint } from "../../lib/brand";

const chartConfig = {
  views: { label: "Views", color: "#171717" },
} satisfies ChartConfig;

interface DeliveryChartProps {
  series: MonthPoint[];
}

function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DeliveryChart({ series }: DeliveryChartProps) {
  const data = (series || []).map((d) => ({ ...d, date: monthDay(d.date) }));

  return (
    <Card data-reveal className="delivery-chart rounded-2xl border-neutral-100 bg-white shadow-none">
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .delivery-chart .recharts-area-curve {
            stroke-dasharray: 2000;
            stroke-dashoffset: 2000;
            animation: ep-line-draw 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
          }
          .delivery-chart .recharts-area-area {
            opacity: 0;
            animation: ep-area-fade 1.2s ease-out 0.15s forwards;
          }
        }
        @keyframes ep-line-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes ep-area-fade {
          to { opacity: 1; }
        }
      `}</style>
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-sm font-semibold text-neutral-900 tracking-tight">
          Views delivered
        </CardTitle>
        <CardDescription className="text-xs font-medium text-neutral-500">
          Daily view count across the selected month.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-3 pb-4">
        <ChartContainer config={chartConfig} className="h-[240px] w-full aspect-auto">
          <AreaChart data={data} accessibilityLayer>
            <defs>
              <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#171717" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#171717" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e5e5e5" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={Math.max(0, Math.ceil(data.length / 7) - 1)}
              tick={{ fontSize: 10, fill: "#a3a3a3", fontWeight: 500 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={38}
              tickMargin={8}
              tickFormatter={(value: number) => formatCompactViews(value)}
              tick={{ fontSize: 10, fill: "#a3a3a3", fontWeight: 500 }}
            />
            <ChartTooltip
              cursor={{ stroke: "#d4d4d4", strokeDasharray: "4 4" }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(label) => (typeof label === "string" ? label : String(label))}
                />
              }
            />
            <Area
              dataKey="views"
              type="monotone"
              stroke="#171717"
              strokeWidth={2}
              fill="url(#viewsFill)"
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: "#171717", stroke: "#FFFFFF", strokeWidth: 2 }}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}