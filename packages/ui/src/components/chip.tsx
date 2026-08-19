import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * 00-foundations Chip: line-type/status badges — 9px, 700, bordered.
 * Monochrome by design; "warn" (FALTA / BAJO MÍNIMO) differs only in weight
 * of border and ink, never in hue.
 */
export function Chip({
  children,
  variant = "neutral",
  className,
}: {
  children: ReactNode;
  variant?: "neutral" | "warn";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border px-1 py-px align-middle font-mono text-[9px] font-bold leading-[1.4] tracking-[.06em]",
        variant === "warn"
          ? "border-border-input-required bg-panel-2 text-ink-2"
          : "border-border bg-card text-ink-3",
        className,
      )}
    >
      {children}
    </span>
  );
}
