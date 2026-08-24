import { cn } from "../cn";

/**
 * Transient message, bottom-right. Caller owns the timing.
 * A failure wears the danger pair (red tint + strong dark red); anything else
 * is graphite. Neither is blue — blue belongs to the primary action.
 */
export function Toast({
  message,
  tone = "neutral",
  className,
}: {
  message: string | null;
  tone?: "neutral" | "danger";
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
      {message}
    </div>
  );
}
