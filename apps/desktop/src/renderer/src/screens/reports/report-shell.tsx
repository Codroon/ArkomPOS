/**
 * The shape every report shares — handoff/reports.md §2.
 *
 * Back · title · window · Exportar in the header; a summary strip that never
 * scrolls with the table; the estimated-cost caption directly under it; the
 * table below.
 *
 * **Exportar is not the blue element.** Exporting is not what anybody came to
 * these screens to do, and a read-only screen is allowed to have no primary
 * action at all — foundations says *at most* one blue thing per surface, not at
 * least one.
 */
import { useState, type ReactNode } from "react";
import { formatCents, type CostEstimate } from "@arkom/core";
import { GhostButton, SectionLabel, cn, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";

export type ReportKey = "sales" | "repairsOpen" | "repairsClosed" | "used" | "valuation" | "deadStock";

export function ReportShell({
  title,
  window: windowLabel,
  onBack,
  exportOf,
  filters,
  summary,
  caption,
  children,
}: {
  title: string;
  window: string;
  onBack: () => void;
  /** which report the Exportar button re-runs server-side, with `filters` */
  exportOf: ReportKey;
  filters: Record<string, unknown>;
  summary?: ReactNode;
  caption?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await window.arkom.invoke("reports:export", { report: exportOf, filters });
      if (res.kind === "saved") {
        setToast(t("rep2.exported", { file: res.path.split(/[\\/]/).pop() ?? res.path }));
      }
    } catch (err) {
      setToast(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <GhostButton onClick={onBack}>{t("rep2.back")}</GhostButton>
        <div className="text-[15px] font-bold">{title}</div>
        <div className="text-[11px] text-subtle">{windowLabel}</div>
        <div className="flex-1" />
        {toast ? <div className="text-[11px] text-muted">{toast}</div> : null}
        <GhostButton disabled={busy} onClick={() => void doExport()}>
          {busy ? t("rep2.exporting") : t("rep2.export")}
        </GhostButton>
      </div>

      {children}
    </div>
  );
}

/** One figure in the strip: a label above the number, never beside it. */
export function Figure({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warning" | "muted";
  wide?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", wide && "min-w-[160px]")}>
      <SectionLabel>{label}</SectionLabel>
      <div
        className={cn(
          "font-mono text-[15px] font-bold tabular-nums",
          tone === "danger" ? "text-danger-ink" : tone === "warning" ? "text-warning-ink" : tone === "muted" ? "text-muted" : "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function SummaryStrip({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-none flex-wrap items-start gap-6 border-b border-line bg-surface-2 px-4 py-2">
      {children}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
      {children}
    </div>
  );
}

/**
 * The estimated-cost caption.
 *
 * Never a tooltip and never omitted: a margin that is part guess must say so
 * where it is read (ADR-0016 §2).
 */
export function EstimateCaption({ estimate }: { estimate: CostEstimate | null }) {
  const t = useT();
  if (!estimate || estimate.estimatedLines === 0) return null;
  return (
    <div className="flex-none bg-warning-bg px-4 py-1.5 text-[11px] leading-snug text-warning-ink">
      ⚠ {t("rep2.estimated", { n: estimate.estimatedLines, total: estimate.estimatedLines + estimate.exactLines })}
    </div>
  );
}

/** A centred line that names the filter which emptied the table. */
export function EmptyReport({ message }: { message: string }) {
  return <div className="px-4 py-12 text-center text-[12px] text-muted">{message}</div>;
}

/** Segmented control shared by the presets and the group-by. */
export function Segments<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-[3px] border border-line-strong">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "border-r border-line px-2.5 py-1 text-[11px] last:border-r-0",
            value === opt.value ? "bg-ink font-semibold text-inverse-ink" : "bg-card text-ink-2 hover:bg-hover",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "—" : formatCents(cents);

export function dayStamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
