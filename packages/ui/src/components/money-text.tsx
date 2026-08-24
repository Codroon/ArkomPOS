import { formatCents } from "@arkom/core";
import { cn } from "../cn";

/** 00-foundations: cents → "12,90 €", ui-monospace, tabular numerals. */
export function MoneyText({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("font-mono font-bold tabular-nums", className)}>{formatCents(cents)}</span>;
}
