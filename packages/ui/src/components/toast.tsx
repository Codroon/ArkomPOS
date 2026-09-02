import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * Transient message, bottom-right. Caller owns the timing.
 * A failure wears the danger pair (red tint + strong dark red); anything else
 * is graphite. Neither is blue — blue belongs to the primary action.
 *
 * `actions` carries recovery buttons for a failure the user can do something
 * about (a print that did not come out). A toast with actions should not be on
 * a timer — it is a decision, not a notification.
 *
 * **Actions STACK under the message, always.** Side by side they compete with
 * the text for the same row, and the first long label — "Recibir otro
 * dispositivo", "Guardar PDF" — pushes one over the other. Stacking cannot
 * overlap at any label length in any language, which is worth more than the
 * two lines of height it costs.
 */
export function Toast({
  message,
  tone = "neutral",
  actions,
  className,
}: {
  message: string | null;
  tone?: "neutral" | "danger";
  actions?: ReactNode;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 max-w-[min(420px,calc(100vw-2rem))] rounded-[3px] border px-3 py-2 text-[12px] font-semibold shadow-lg",
        tone === "danger"
          ? "border-danger-ink/30 bg-danger-bg text-danger-ink"
          : "border-inverse-2 bg-inverse text-inverse-ink",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <span className="leading-snug">{message}</span>
        {actions ? <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div> : null}
      </div>
    </div>
  );
}
