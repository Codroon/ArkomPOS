"use client";

/**
 * The charts.
 *
 * Deliberately NOT blue. Signal Blue lands on exactly one element per screen —
 * the primary action — so a chart painted in it would compete with the only
 * thing on the page that is supposed to be shouting. Graphite reads perfectly
 * well against Bone, and it keeps the accent meaning what it means.
 *
 * Figures come in already computed, in integer cents. These components choose
 * colours and axes; they do not do arithmetic.
 */
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const INK = "#2a2f35";
const LINE = "#dcd8cd";
const MUTED = "#70777d";

/** The graphite ramp, for categories. Never more than this many slices. */
const RAMP = ["#2a2f35", "#4a5159", "#70777d", "#9b9a92", "#c4bfb1"];

const tooltipStyle = {
  border: `1px solid ${LINE}`,
  borderRadius: 3,
  fontSize: 12,
  padding: "6px 9px",
  background: "#ffffff",
  color: "#15181b",
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
            cursor={{ fill: "#e7e4da" }}
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

export function MixChart({
  data,
  currency,
}: {
  data: Array<{ label: string; amountCents: number }>;
  currency: string;
}) {
  /* A horizontal bar rather than a pie: people read lengths far better than
     angles, and a shop with three payment methods does not need a doughnut. */
  return (
    <div className="h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 12, fill: MUTED }}
            tickLine={false}
            axisLine={false}
            width={96}
          />
          <Tooltip
            cursor={{ fill: "#e7e4da" }}
            contentStyle={tooltipStyle}
            formatter={(cents: number) => [`${(cents / 100).toFixed(2)} ${currency}`, ""]}
          />
          <Bar dataKey="amountCents" radius={[0, 2, 2, 0]} maxBarSize={22}>
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={RAMP[index % RAMP.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
