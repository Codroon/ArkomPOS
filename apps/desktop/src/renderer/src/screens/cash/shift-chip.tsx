/**
 * The top-bar shift chip — handoff/cash.md §1.
 *
 * Restores the slot the wireframe drew and ADR-0010 removed. The whole chip is a
 * button through to Caja, because "no shift open" is a thing to fix rather than
 * a thing to read.
 *
 * The 20-hour state is a WARNING, never a block: the shop closes when it closes,
 * and a till that refuses to sell because somebody forgot to press a button at
 * midnight is a till that gets worked around.
 */
import { cn, useT } from "@arkom/ui";
import { useCan } from "../../lib/use-session";
import { navigateTo } from "../../lib/screen-bus";
import { useShift } from "../../lib/use-shift";

const LONG_SHIFT_HOURS = 20;

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ShiftChip() {
  const t = useT();
  const can = useCan();
  const { shift } = useShift();

  // a door someone cannot open is not worth showing them
  if (!can("cash.view")) return null;

  const long = shift !== null && shift.openHours >= LONG_SHIFT_HOURS;
  const label =
    shift === null
      ? t("cash.noShift")
      : long
        ? t("cash.shiftOpenYesterday", { time: hhmm(shift.openedAtMs) })
        : t("cash.shiftOpenSince", { time: hhmm(shift.openedAtMs) });

  return (
    <button
      type="button"
      onClick={() => navigateTo("caja")}
      title={label}
      className={cn(
        "flex items-center gap-1.5 border-l border-inverse-2 px-3.5 text-[12px]",
        shift === null
          ? "bg-danger-bg text-danger-ink"
          : long
            ? "bg-warning-bg text-warning-ink"
            : "text-inverse-ink hover:bg-inverse-2",
      )}
    >
      {shift === null || long ? (
        <span aria-hidden className="text-[10px]">
          ▲
        </span>
      ) : (
        <span aria-hidden className="h-2 w-2 rounded-full bg-success-ink" />
      )}
      <span className="font-mono tabular-nums">{label}</span>
    </button>
  );
}
