import { cn } from "../cn";

/** Transient success/notice message, bottom-right. Caller owns the timing. */
export function Toast({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 rounded-[3px] border border-line-strong bg-ink-2 px-3 py-2 text-[12px] font-bold text-white shadow-lg",
        className,
      )}
    >
      {message}
    </div>
  );
}
