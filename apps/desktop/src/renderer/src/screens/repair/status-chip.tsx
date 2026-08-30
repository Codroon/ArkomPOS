/**
 * One status vocabulary for the whole module — handoff/repairs.md §0.
 *
 * The list, the board, the ficha and the print all say the same seven words in
 * the same seven colours. **Nothing here is a control.** Every status in this
 * app is derived from the ticket's facts (ADR-0014 §1), so a chip is a read-out;
 * where a status would change, the UI offers the action that records the fact.
 */
import type { RepairStatus } from "@arkom/core";
import { Chip, cn, useT, type ChipVariant, type TKey } from "@arkom/ui";

export const STATUS_KEYS: Record<RepairStatus, TKey> = {
  received: "repStatus.received",
  quoted: "repStatus.quoted",
  waiting_part: "repStatus.waiting_part",
  in_repair: "repStatus.in_repair",
  ready: "repStatus.ready",
  collected: "repStatus.collected",
  not_repaired: "repStatus.not_repaired",
};

const STATUS_VARIANT: Record<RepairStatus, ChipVariant> = {
  received: "neutral",
  quoted: "info",
  waiting_part: "warning",
  // the working state: neutral, because most of the board lives here and a
  // board where everything shouts is a board nobody reads
  in_repair: "neutral",
  ready: "success",
  collected: "neutral",
  not_repaired: "danger",
};

export function StatusChip({ status, className }: { status: RepairStatus; className?: string }) {
  const t = useT();
  return (
    <Chip variant={STATUS_VARIANT[status]} className={cn("uppercase", className)}>
      {t(STATUS_KEYS[status])}
    </Chip>
  );
}

/** Promised in the past and still open — a fact about a date, shown beside it. */
export function OverdueChip() {
  const t = useT();
  return <Chip variant="warning">{t("rep.list.overdue")}</Chip>;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** dd/mm/yyyy regardless of locale (handoff 00), plus the half-day when set. */
export function formatPromised(
  ms: number | null,
  half: "morning" | "afternoon" | null,
  t: (k: TKey) => string,
): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const date = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (!half) return date;
  return `${date} ${half === "morning" ? t("rep.agreement.morning") : t("rep.agreement.afternoon")}`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatDate(ms)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
