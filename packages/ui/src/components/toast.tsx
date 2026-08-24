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
        "fixed bottom-4 right-4 z-50 rounded-[3px] border px-3 py-2 text-[12px] font-semibold shadow-lg",
        tone === "danger"
          ? "border-danger-ink/30 bg-danger-bg text-danger-ink"
          : "border-inverse-2 bg-inverse text-inverse-ink",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">{message}</span>
        {actions ? <span className="flex flex-none items-center gap-1.5">{actions}</span> : null}
      </div>
    </div>
  );
}
