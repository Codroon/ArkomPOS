/**
 * One declaration, two presentations: a table on a desktop, a list of records on
 * a phone.
 *
 * A table is a desktop affordance. It works because a wide screen can show ten
 * columns at once and the eye scans down one of them. On 390px none of that is
 * true: the old tables carried `min-width:560px` and put 36–60% of themselves
 * behind a horizontal scroll, and what was hidden was always the right-hand
 * columns — price, stock, total. The figures. Someone checking a shop from a
 * café swiped sideways inside each row to find the only number they came for.
 *
 * So below `md` a row stops being a row. Each column says where it belongs on a
 * card, and the card is assembled from that:
 *
 *   title   the thing's name — the line you look for
 *   sub     what qualifies it
 *   meta    label/value pairs, wrapped, for the rest
 *   badge   a status, top right
 *   figure  money and counts, in a strip along the bottom
 *   none    desktop only
 *
 * The figure strip uses equal columns, so the third figure on one card sits
 * directly above the third figure on the next. That alignment is the point: a
 * list of cards that do not line up is a worse table, not a better list.
 *
 * Server-renderable — no client boundary — so pages stay Server Components and
 * the browser is sent rows, not a renderer.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

export interface Column<Row> {
  key: string;
  header: string;
  /** money and counts go right, on both presentations */
  align?: "left" | "right";
  /** where this column lands when the row becomes a card; defaults to `meta` */
  card?: "title" | "sub" | "meta" | "badge" | "figure" | "none";
  /** desktop hint, e.g. "w-[1%] whitespace-nowrap" */
  className?: string;
  render: (row: Row) => ReactNode;
}

interface Props<Row> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  /** index is there for lists whose rows carry no id of their own */
  rowKey: (row: Row, index: number) => string;
  /** makes the whole row — and the whole card — one target */
  rowHref?: (row: Row) => string;
  empty?: ReactNode;
  /** a footer row of totals, rendered under both presentations */
  footer?: ReactNode;
}

const roleOf = <Row,>(column: Column<Row>) => column.card ?? "meta";

export function DataTable<Row>({ rows, columns, rowKey, rowHref, empty, footer }: Props<Row>) {
  if (rows.length === 0) return <>{empty ?? null}</>;

  const titles = columns.filter((c) => roleOf(c) === "title");
  const subs = columns.filter((c) => roleOf(c) === "sub");
  const metas = columns.filter((c) => roleOf(c) === "meta");
  const badges = columns.filter((c) => roleOf(c) === "badge");
  const figures = columns.filter((c) => roleOf(c) === "figure");

  return (
    <>
      {/* ---------------------------------------------------- phone: cards -- */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((row, index) => {
          const body = (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <div className="min-w-0 flex-1">
                  {titles.map((c) => (
                    <div key={c.key} className="truncate text-[14px] font-semibold text-ink">
                      {c.render(row)}
                    </div>
                  ))}
                  {subs.map((c) => (
                    <div key={c.key} className="mt-0.5 truncate text-[12.5px] text-muted">
                      {c.render(row)}
                    </div>
                  ))}
                  {metas.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted">
                      {metas.map((c) => (
                        <span key={c.key} className="inline-flex min-w-0 items-baseline gap-1">
                          <span className="text-subtle">{c.header}</span>
                          <span className="truncate text-ink-2">{c.render(row)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {badges.map((c) => (
                    <span key={c.key}>{c.render(row)}</span>
                  ))}
                  {rowHref ? (
                    <ChevronRight size={16} className="text-subtle" aria-hidden />
                  ) : null}
                </div>
              </div>

              {figures.length > 0 ? (
                /* equal columns, so the same figure sits in the same place on
                   every card in the list */
                <div
                  className="mt-3 grid gap-2 border-t border-line/70 pt-2.5"
                  style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}
                >
                  {figures.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <div className="truncate text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase">
                        {c.header}
                      </div>
                      <div className="tabular mt-0.5 truncate text-[13.5px] font-medium text-ink">
                        {c.render(row)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          );

          return (
            <li key={rowKey(row, index)}>
              {rowHref ? (
                /* 44px minimum by construction: padding plus a title line */
                <Link href={rowHref(row)} className="block px-4 py-3.5 active:bg-hover">
                  {body}
                </Link>
              ) : (
                <div className="px-4 py-3.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ------------------------------------------------- desktop: table -- */}
      {/* 4+12 = 16, 8+12 = 20: the first cell starts where the card head's
          title starts, which is the whole of "lined up" */}
      <div className="hidden min-w-0 overflow-x-auto px-1 pb-1 sm:px-2 md:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "border-b border-line px-3 pb-2 text-left text-[11px] font-semibold tracking-[0.07em] text-muted uppercase",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
              {rowHref ? <th className="w-[1%] border-b border-line" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="group hover:bg-hover/60">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "border-b border-line px-3 py-2.5 align-middle",
                      c.align === "right" && "tabular text-right whitespace-nowrap",
                      c.className,
                    )}
                  >
                    {rowHref && c === columns[0] ? (
                      <Link href={rowHref(row)} className="block hover:underline">
                        {c.render(row)}
                      </Link>
                    ) : (
                      c.render(row)
                    )}
                  </td>
                ))}
                {rowHref ? (
                  <td className="w-[1%] border-b border-line px-2">
                    <Link
                      href={rowHref(row)}
                      className="block text-subtle group-hover:text-ink-2"
                      aria-label={rowKey(row, index)}
                    >
                      <ChevronRight size={15} aria-hidden />
                    </Link>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* one shape for both presentations — a tfoot would need a second */}
      {footer ? (
        <div className="border-t border-line bg-surface/40 px-4 py-2.5 sm:px-5">{footer}</div>
      ) : null}
    </>
  );
}
