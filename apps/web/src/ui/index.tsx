/**
 * The cloud's component set.
 *
 * Small on purpose. Every colour comes from a token that Tailwind generated
 * from the `@theme` block, so a screen cannot reach for a hex that the till has
 * never heard of, and the brand rules hold by construction:
 *
 *   · `bg-accent` is the one blue, and it carries `text-accent-ink` with it —
 *     white on blue is banned, so the pairing lives inside the button rather
 *     than being remembered at each call site.
 *   · figures get `tabular` wherever they sit in a column.
 */
import type { ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/* ------------------------------------------------------------------ card -- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-[3px] border border-line bg-card", className)}>{children}</section>
  );
}

export function CardHead({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export const CardBody = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("px-4 py-4 sm:px-5", className)}>{children}</div>
);

/* ------------------------------------------------------------------- kpi -- */

export function Stat({
  label,
  value,
  delta,
  sub,
}: {
  label: string;
  value: string;
  /** percentage against the previous period; null when there is nothing to compare */
  delta?: number | null;
  sub?: string;
}) {
  const up = (delta ?? 0) > 0;
  const flat = delta === 0 || delta === null || delta === undefined;

  return (
    <div className="min-w-0 flex-1 px-4 py-4 sm:px-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="tabular mt-1 text-[26px] leading-none font-semibold text-ink">{value}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
        {flat ? (
          <span className="text-subtle">{sub ?? "—"}</span>
        ) : (
          <>
            {/* a tint surface with dark ink on it — never coloured body text */}
            <span
              className={cn(
                "tabular rounded-[2px] px-1.5 py-0.5 text-[11px] font-semibold",
                up ? "bg-success-bg text-success-ink" : "bg-danger-bg text-danger-ink",
              )}
            >
              {up ? "▲" : "▼"} {Math.abs(delta ?? 0).toFixed(0)}%
            </span>
            {sub ? <span className="text-muted">{sub}</span> : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- table -- */

export const Table = ({ children }: { children: ReactNode }) => (
  /* the wrapper is what makes a wide table survive a phone */
  <div className="-mx-4 overflow-x-auto sm:mx-0">
    <table className="w-full min-w-[560px] border-collapse text-[13px]">{children}</table>
  </div>
);

export const TH = ({
  children,
  right,
  className,
}: {
  children?: ReactNode;
  right?: boolean;
  className?: string;
}) => (
  <th
    className={cn(
      "border-b border-line px-3 pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted",
      right && "text-right",
      className,
    )}
  >
    {children}
  </th>
);

export const TD = ({
  children,
  right,
  className,
}: {
  children?: ReactNode;
  right?: boolean;
  className?: string;
}) => (
  <td className={cn("border-b border-line px-3 py-2.5 align-top", right && "tabular text-right", className)}>
    {children}
  </td>
);

export const TR = ({ children }: { children: ReactNode }) => (
  <tr className="hover:bg-hover/60">{children}</tr>
);

/* ------------------------------------------------------------------ bits -- */

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    ok: "bg-success-bg text-success-ink",
    warn: "bg-warning-bg text-warning-ink",
    bad: "bg-danger-bg text-danger-ink",
  } as const;
  return (
    <span
      className={cn(
        "inline-block rounded-[2px] px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.04em]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="px-4 py-10 text-center sm:px-5">
    <p className="text-[14px] font-medium text-ink-2">{title}</p>
    {hint ? <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-muted">{hint}</p> : null}
  </div>
);

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
      {label}
    </span>
    {children}
  </label>
);

export const inputClass =
  "w-full rounded-[3px] border border-line-strong bg-card px-2.5 py-2 text-[13px] text-ink placeholder:text-subtle focus:outline-2 focus:outline-focus focus:-outline-offset-1";

/** The one blue element on a screen. The ink pairing is not optional. */
export const primaryClass =
  "inline-flex items-center justify-center gap-2 rounded-[3px] bg-accent px-3.5 py-2 text-[13px] font-semibold text-accent-ink disabled:opacity-55";

export const ghostClass =
  "inline-flex items-center justify-center gap-2 rounded-[3px] border border-line-strong bg-transparent px-3 py-1.5 text-[13px] text-ink-2 hover:bg-hover";
