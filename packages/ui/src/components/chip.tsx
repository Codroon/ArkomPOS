import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * Status badge — 9px, 700, Plex Mono, bordered (00-foundations).
 *
 * Semantics carry the colour, never decoration:
 *   neutral  → identity, not a state: SERIE, VENTA, INACTIVO, STOCK
 *   warning  → needs attention: BAJO MÍNIMO, FALTA, AJUSTE
 *   success  → stock arrived: ENTRADA
 *   info     → a deliberate deviation: MODIFICADO
 *   danger   → something failed
 * Each functional variant is a tint with strong dark ink on top, so it stays
 * readable across the counter and never competes with the one blue action.
 */
export type ChipVariant = "neutral" | "warning" | "success" | "info" | "danger";

const VARIANTS: Record<ChipVariant, string> = {
  neutral: "border-line-strong bg-card text-ink-2",
  warning: "border-warning-ink/25 bg-warning-bg text-warning-ink",
  success: "border-success-ink/25 bg-success-bg text-success-ink",
  info: "border-info-ink/25 bg-info-bg text-info-ink",
  danger: "border-danger-ink/25 bg-danger-bg text-danger-ink",
};

export function Chip({
  children,
  variant = "neutral",
  className,
}: {
  children: ReactNode;
  variant?: ChipVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border px-1 py-px align-middle font-mono text-[9px] font-bold leading-[1.4] tracking-[.06em]",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
