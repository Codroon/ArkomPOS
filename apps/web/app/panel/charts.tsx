"use client";

/**
 * The charts.
 *
 * Deliberately NOT blue. Signal Blue lands on exactly one element per screen —
 * the primary action — so a chart painted in it would compete with the only
 * thing on the page that is supposed to be shouting. Graphite reads perfectly
 * well against Bone, and it keeps the accent meaning what it means.
 *
 * Figures come in already computed, in integer cents. This component chooses
 * colours and axes; it does not do arithmetic.
 *
 * There used to be a second chart here for the payment mix. It put its values
 * in a tooltip, and a tooltip needs a hover that a phone does not have, so it
 * is a `BarList` now — see `src/ui/bar-list.tsx`.
 */
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CHART_HOVER,
  CHART_INK as INK,
  CHART_LINE as LINE,
  CHART_MUTED as MUTED,
  CHART_SURFACE,
  CHART_TEXT,
} from "../../src/ui/chart-colors";

const tooltipStyle = {
  border: `1px solid ${LINE}`,
  borderRadius: 3,
  fontSize: 12,
  padding: "6px 9px",
  background: CHART_SURFACE,
  color: CHART_TEXT,
};

export function TakingsChart({
  data,
  currency,
}: {
  data: Array<{ day: string; label: string; netCents: number }>;
  currency: string;
}) {
  /* One bar per day in the window, quiet days included: a chart with the empty
     days dropped lies about the shape of a week. */
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: MUTED }}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 11, fill: MUTED }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(cents: number) => String(Math.round(cents / 100))}
            width={52}
          />
          <Tooltip
            cursor={{ fill: CHART_HOVER }}
            contentStyle={tooltipStyle}
            labelStyle={{ color: MUTED, fontSize: 11 }}
            formatter={(cents: number) => [`${(cents / 100).toFixed(2)} ${currency}`, ""]}
          />
          <Bar dataKey="netCents" fill={INK} radius={[2, 2, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
