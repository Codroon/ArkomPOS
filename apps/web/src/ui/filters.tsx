"use client";

/**
 * Filters: a row on a desktop, a sheet on a phone.
 *
 * The old lists put the form above the table on every screen size. On 390px
 * that is a search box, a select, a checkbox and a button stacked 200px deep —
 * a fifth of the viewport spent on controls, above the rows somebody opened the
 * screen to read. Worse, it pushed the figures below the fold on a screen whose
 * whole job is to show them.
 *
 * So on a phone it becomes one button with a count of what is currently applied,
 * and the form opens over the page when it is wanted. The FIELDS are the same
 * markup either way — passed in as children and rendered in both places — so
 * there is no second version of the form to keep in step with the first.
 *
 * Still a plain GET form in both: the state belongs in the URL, where a link
 * somebody sends themselves opens on the same rows and the back button works
 * (ADR-0016 §4).
 */
import { useEffect, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "./cn";

export function Filters({
  label,
  apply,
  close,
  /** how many filters are currently narrowing the list */
  active,
  summary,
  children,
}: {
  label: string;
  apply: string;
  close: string;
  active: number;
  /** what the list is showing, in words — the one thing worth the space */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* ------------------------------------------------ desktop: a row -- */}
      <div className="hidden border-b border-line px-4 py-3 sm:px-5 md:block">
        <form className="flex flex-wrap items-end gap-2">{children}</form>
      </div>

      {/* ---------------------------------------------- phone: a trigger -- */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="inline-flex h-10 items-center gap-2 rounded-card border border-line-strong px-3.5 text-[13px] text-ink-2"
        >
          <SlidersHorizontal size={15} aria-hidden />
          {label}
          {active > 0 ? (
            <span className="tabular grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[10.5px] font-semibold text-canvas">
              {active}
            </span>
          ) : null}
        </button>
        {summary ? (
          <span className="truncate text-right text-[11.5px] text-muted">{summary}</span>
        ) : null}
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-inverse/40"
          />
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[10px] border-t border-line bg-card",
              "pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_rgba(21,24,27,0.16)]",
            )}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[14px] font-semibold text-ink">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={close}
                className="grid h-9 w-9 place-items-center rounded-card text-muted hover:bg-hover"
              >
                <X size={18} />
              </button>
            </div>
            <form className="space-y-3 p-4">
              {children}
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center rounded-card bg-accent text-[14px] font-semibold text-accent-ink"
              >
                {apply}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
