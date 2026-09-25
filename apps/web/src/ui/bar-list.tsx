/**
 * A ranked list with proportional bars, and the numbers written on it.
 *
 * This replaced a Recharts horizontal bar chart for the payment mix, for a
 * reason worth writing down: that chart put its values in a TOOLTIP. A tooltip
 * needs a hover, a phone has no hover, and the screen this product is mostly
 * read on is a phone. So "Formas de cobro" was two grey bars of unknown length
 * meaning unknown amounts — a chart that answered its own question only on the
 * device nobody was using.
 *
 * Lengths are read far better than angles and exactly as well as a chart reads
 * them, so: the label, the bar, the amount and the share, all present without
 * touching anything. It is also a Server Component, which the chart could never
 * be — the browser is sent the answer instead of a renderer.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";
import { CHART_RAMP } from "./chart-colors";

export function BarList({
  rows,
  format,
  className,
}: {
  rows: readonly { label: string; value: number }[];
  format: (value: number) => ReactNode;
  className?: string;
}) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const largest = rows.reduce((most, row) => Math.max(most, row.value), 0);

  return (
    <ul className={cn("space-y-2.5", className)}>
      {rows.map((row, index) => {
        /* bars are scaled to the LARGEST row, not to the total: at a 90/10
           split the small one would otherwise be a line you cannot see */
        const width = largest > 0 ? Math.max(2, (row.value / largest) * 100) : 0;
        const share = total > 0 ? (row.value / total) * 100 : 0;

        return (
          <li key={row.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-ink-2">{row.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="tabular text-[13px] font-medium text-ink">{format(row.value)}</span>
                <span className="tabular w-[38px] text-right text-[11.5px] text-subtle">
                  {share.toFixed(0)}%
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-[6px] w-full overflow-hidden rounded-[2px] bg-surface-2">
              <div
                className="h-full rounded-[2px]"
                style={{
                  width: `${width}%`,
                  background: CHART_RAMP[index % CHART_RAMP.length],
                  /* a fifth category reuses the first, quieter — see chart-colors */
                  opacity: index >= CHART_RAMP.length ? 0.55 : 1,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
