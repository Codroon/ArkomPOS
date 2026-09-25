/**
 * The cloud's component set.
 *
 * Small on purpose, and opinionated where being opinionated prevents a class of
 * bug rather than a matter of taste:
 *
 *   · **A figure is never truncated.** `Figure` cannot be clipped by its
 *     container, because a number cut off mid-digit is not a small number, it is
 *     a wrong one. The dashboard used to render 269,00 € as "269" on a 1440px
 *     laptop — a table with `min-width` inside a grid cell with the browser's
 *     default `min-width:auto`, which lets content push a box past its column
 *     and quietly defeats the `overflow-x-auto` wrapper meant to catch it. Every
 *     box that can hold a table therefore carries `min-w-0`, and that is what
 *     the `Card`/`CardBody` pairing exists to guarantee.
 *   · **Colours come from tokens, by meaning.** `bg-accent` is the one accent
 *     and it carries `text-accent-ink` with it, so the ban on white-on-accent
 *     holds inside the button instead of being remembered at each call site.
 *   · **Figures are tabular and share a right edge**, or they are decoration.
 *
 * Layout for the phone lives here too rather than in the screens: a rule applied
 * nine times is a rule broken on the tenth.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export { cn };

/* ------------------------------------------------------------------ card -- */

/**
 * `min-w-0` is not decoration.
 *
 * A grid or flex child defaults to `min-width:auto`, which means "at least as
 * wide as my content wants to be". Put a table with a minimum width inside one
 * and the CARD grows past its column, taking the page with it — the scroll
 * container inside never gets the chance to scroll, because nothing ever
 * overflowed it. Every card is a candidate for holding a table, so every card
 * starts at zero.
 */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-card border border-line bg-card", className)}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        /* stacks on a phone so a title never gets squeezed into a third of the
           width by an action sitting beside it */
        "flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] leading-tight font-semibold text-ink">{title}</h2>
        {hint ? <p className="mt-1 text-[12.5px] leading-snug text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0 sm:pt-0.5">{action}</div> : null}
    </div>
  );
}

export const CardBody = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("min-w-0 px-4 py-4 sm:px-5", className)}>{children}</div>
);

/* ---------------------------------------------------------------- figure -- */

const FIGURE_SIZES = {
  sm: "text-[13px]",
  md: "text-[15px] font-semibold",
  lg: "text-[clamp(20px,5.5vw,28px)] leading-none font-semibold",
} as const;

/**
 * A number, at a size that cannot overflow its box.
 *
 * `lg` is a clamp rather than a fixed size because four of these sit side by
 * side, and "612,40 €" at a fixed 26px in a 95px column is how three figures end
 * up drawn on top of one another. The clamp shrinks the type before the layout
 * gives way, `tabular` keeps the digits in their columns, and nothing here ever
 * sets `overflow:hidden`.
 */
export function Figure({
  children,
  size = "md",
  className,
}: {
  children: ReactNode;
  size?: keyof typeof FIGURE_SIZES;
  className?: string;
}) {
  return (
    <span className={cn("tabular block whitespace-nowrap text-ink", FIGURE_SIZES[size], className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- kpi -- */

/**
 * Four numbers across on a laptop, two by two on a phone.
 *
 * Deliberately a GRID and not a wrapping flex row: flex children with
 * `min-width:0` shrink instead of wrapping, so four stats in 390px become four
 * 95px columns with their labels overlapping. A grid gives each cell a real
 * floor and moves to the next row when it runs out.
 */
const STAT_COLS = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
} as const;

export const StatGrid = ({
  cols = 4,
  children,
}: {
  cols?: keyof typeof STAT_COLS;
  children: ReactNode;
}) => (
  /* hairlines by gap, not by `divide-*`: a divide rule has to be re-specified
     at every breakpoint the column count changes at, and gets it wrong on the
     row that wraps. A 1px gap over the line colour is right at any arrangement. */
  <Card className={cn("grid gap-px overflow-hidden bg-line", STAT_COLS[cols])}>{children}</Card>
);

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
  const flat = delta === null || delta === undefined;
  const up = (delta ?? 0) > 0;

  return (
    <div className="min-w-0 bg-card px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="truncate text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
        {label}
      </div>
      <Figure size="lg" className="mt-1.5">
        {value}
      </Figure>
      <div className="mt-2 flex min-h-[20px] flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px]">
        {flat ? (
          /* No percentage is a fact about the data, not an empty slot: saying
             "frente al periodo anterior" under a blank space promises a
             comparison nobody made. But a figure with nothing to say says
             NOTHING — a row of em-dashes under six fiscal totals is noise
             pretending to be information. The box keeps its height either way,
             so the figures above it stay on one line. */
          sub ? <span className="text-subtle">{sub}</span> : null
        ) : (
          <>
            <span
              className={cn(
                "tabular rounded-[2px] px-1.5 py-0.5 text-[11px] font-semibold",
                delta === 0
                  ? "bg-surface-2 text-muted"
                  : up
                    ? "bg-success-bg text-success-ink"
                    : "bg-danger-bg text-danger-ink",
              )}
            >
              {delta === 0 ? "=" : up ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
            </span>
            {sub ? <span className="truncate text-muted">{sub}</span> : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bits -- */

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad" | "info";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    ok: "bg-success-bg text-success-ink",
    warn: "bg-warning-bg text-warning-ink",
    bad: "bg-danger-bg text-danger-ink",
    info: "bg-info-bg text-info-ink",
  } as const;
  return (
    <span
      className={cn(
        "inline-block rounded-[2px] px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.03em] whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const EmptyState = ({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) => (
  <div className="px-4 py-12 text-center sm:px-5">
    <p className="text-[14px] font-medium text-ink-2">{title}</p>
    {hint ? (
      <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-muted">{hint}</p>
    ) : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);

export const Field = ({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  <label className={cn("block min-w-0", className)}>
    <span className="mb-1.5 block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
      {label}
    </span>
    {children}
  </label>
);

/* Controls are 40px tall so a thumb can hit them; 44 with the label above. */
export const inputClass =
  "h-10 w-full rounded-card border border-line-strong bg-card px-3 text-[13.5px] text-ink placeholder:text-subtle focus:outline-2 focus:outline-focus focus:-outline-offset-1";

export const selectClass = `${inputClass} pr-8`;

/** The one accent element on a screen. The ink pairing is not optional. */
export const primaryClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-card bg-accent px-4 text-[13.5px] font-semibold text-accent-ink disabled:opacity-55";

export const ghostClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-card border border-line-strong bg-transparent px-3.5 text-[13.5px] text-ink-2 hover:bg-hover";

/** A quieter ghost, for a control that sits in a row of its own kind. */
export const quietClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-card px-3 text-[13px] text-muted hover:bg-hover hover:text-ink-2";

/* ----------------------------------------------------------- page header -- */

/**
 * The title of the screen and whatever acts on the whole of it.
 *
 * Above the cards rather than inside the first one: an export button belongs to
 * the page, and burying it in a card's head made it look like it exported that
 * card.
 */
export function PageHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h1 className="text-[19px] leading-tight font-semibold text-ink sm:text-[21px]">{title}</h1>
        {hint ? <p className="mt-1 text-[13px] leading-snug text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export { DataTable, type Column } from "./data-table";
