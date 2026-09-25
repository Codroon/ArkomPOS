"use client";

/**
 * The app shell.
 *
 * Three jobs, and the interesting one is that they are different jobs:
 *
 *  · **Desktop** gets a graphite rail that COLLAPSES to icons — 240px to 64px,
 *    with the toggle beside the wordmark and the choice remembered in a cookie
 *    so the server renders the right width on the first paint instead of
 *    snapping after hydration. Nine flat links were a list, not a navigation, so
 *    they are grouped the way a shop thinks: today, selling, stock, workshop.
 *
 *  · **A phone** gets a bottom bar. It used to get the rail turned on its side —
 *    980px of destinations in a 390px strip, so you saw three and a half of nine
 *    and the active one could be scrolled out of sight. Five tabs put the things
 *    you check standing up under a thumb, and `Más` opens a sheet with the rest,
 *    the account and the language.
 *
 *  · **The period** only appears where it means something. It was rendered on
 *    Catálogo, where changing it changes nothing — a control that does nothing
 *    teaches people not to trust the controls.
 *
 * Client-side because it needs three things a server cannot know: which link is
 * current, whether the sheet is open, and what the person just picked. Every
 * figure on every page is still rendered on the server.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Smartphone,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";
import { cn, quietClass } from "../../src/ui";
import { BrandMark } from "../../src/ui/brand-mark";
import { LOCALE_COOKIE, type Locale } from "../../src/i18n";
import { RAIL_COOKIE } from "../../src/lib/prefs";

export interface ChromeLabels {
  brand: string;
  signOut: string;
  language: string;
  period: string;
  more: string;
  collapse: string;
  expand: string;
  close: string;
  nav: Record<NavKey, string>;
  groups: Record<GroupKey, string>;
  ranges: { today: string; "7d": string; "30d": string; "90d": string };
}

type NavKey =
  | "summary"
  | "sales"
  | "catalogue"
  | "inventory"
  | "repairs"
  | "used"
  | "transfers"
  | "reports"
  | "tills";

type GroupKey = "today" | "selling" | "stock" | "workshop" | "more";

const ICONS: Record<NavKey, typeof LayoutDashboard> = {
  summary: LayoutDashboard,
  sales: Receipt,
  catalogue: Boxes,
  inventory: Warehouse,
  repairs: Wrench,
  used: Smartphone,
  transfers: ArrowLeftRight,
  reports: FileText,
  tills: BarChart3,
};

const HREF: Record<NavKey, string> = {
  summary: "/panel",
  sales: "/panel/ventas",
  catalogue: "/panel/catalogo",
  inventory: "/panel/inventario",
  repairs: "/panel/reparaciones",
  used: "/panel/usados",
  transfers: "/panel/transferencias",
  reports: "/panel/informes",
  tills: "/panel/cajas",
};

/** The rail, grouped. Order is the order a day goes in. */
const GROUPS: { key: GroupKey; items: NavKey[] }[] = [
  { key: "today", items: ["summary"] },
  { key: "selling", items: ["sales", "tills"] },
  { key: "stock", items: ["catalogue", "inventory"] },
  { key: "workshop", items: ["repairs", "used"] },
  { key: "more", items: ["transfers", "reports"] },
];

/** The four things you check standing up, plus everything else. */
const TABS: NavKey[] = ["summary", "sales", "catalogue", "repairs"];
const IN_SHEET: NavKey[] = ["inventory", "used", "transfers", "reports", "tills"];

/**
 * Where a period means something.
 *
 * Catálogo and Inventario are the shop as it stands right now; Reparaciones and
 * Usados are what it is holding. None of them are a period. Showing the control
 * anyway made it look broken.
 */
const RANGE_SCREENS = ["/panel", "/panel/ventas", "/panel/informes"];

const RANGES = ["today", "7d", "30d", "90d"] as const;
export type RangeKey = (typeof RANGES)[number];

export function PanelChrome({
  labels,
  locale,
  account,
  railCollapsed,
  signOut,
  children,
}: {
  labels: ChromeLabels;
  locale: Locale;
  account: { name: string; email: string; licence: string };
  /** what the cookie said, so the first paint is already right */
  railCollapsed: boolean;
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [collapsed, setCollapsed] = useState(railCollapsed);
  const [sheetOpen, setSheetOpen] = useState(false);

  const range = (params.get("range") ?? "30d") as RangeKey;
  const showRange = RANGE_SCREENS.includes(path);

  /* a route change closes the sheet; otherwise it covers the page you asked for */
  useEffect(() => setSheetOpen(false), [path]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheetOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const remember = (name: string, value: string) => {
    document.cookie = `${name}=${value};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  };

  const toggleRail = () => {
    const next = !collapsed;
    setCollapsed(next);
    remember(RAIL_COOKIE, next ? "1" : "0");
  };

  const setRange = (next: RangeKey) => {
    const query = new URLSearchParams(params.toString());
    query.set("range", next);
    startTransition(() => router.push(`${path}?${query.toString()}`));
  };

  const setLocale = (next: Locale) => {
    /* a cookie rather than a query param: the choice should survive a link
       somebody sends themselves, and it belongs to the person not the page */
    remember(LOCALE_COOKIE, next);
    startTransition(() => router.refresh());
  };

  const isActive = (key: NavKey) =>
    HREF[key] === "/panel" ? path === "/panel" : path.startsWith(HREF[key]);

  const current = (Object.keys(HREF) as NavKey[]).find(isActive);
  const title = current ? labels.nav[current] : labels.brand;

  return (
    <div className="min-h-screen bg-canvas lg:flex">
      {/* =========================================================== rail == */}
      <aside
        className={cn(
          "hidden bg-inverse text-inverse-ink lg:sticky lg:top-0 lg:flex lg:h-screen lg:shrink-0 lg:flex-col",
          collapsed ? "lg:w-[64px]" : "lg:w-[240px]",
        )}
      >
        <div
          className={cn(
            "flex h-[56px] shrink-0 items-center border-b border-white/5",
            collapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          {collapsed ? null : (
            <div className="min-w-0">
              {/* currentColor: the mark takes the rail's ink, no second asset */}
              <BrandMark className="h-[15px] text-inverse-ink" height={14} />
              <div className="mt-1 truncate text-[11px] text-inverse-muted">{account.name}</div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleRail}
            aria-label={collapsed ? labels.expand : labels.collapse}
            title={collapsed ? labels.expand : labels.collapse}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-inverse-muted hover:bg-inverse-2 hover:text-inverse-ink"
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {GROUPS.map((group, index) => (
            <div key={group.key} className={index > 0 ? "mt-4" : undefined}>
              {collapsed ? (
                index > 0 ? <div className="mx-2 mb-2 h-px bg-white/8" /> : null
              ) : (
                <div className="mb-1.5 px-2.5 text-[10px] font-semibold tracking-[0.1em] text-inverse-muted uppercase">
                  {labels.groups[group.key]}
                </div>
              )}

              {group.items.map((key) => {
                const Icon = ICONS[key];
                const active = isActive(key);
                return (
                  <Link
                    key={key}
                    href={HREF[key]}
                    title={collapsed ? labels.nav[key] : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-9 items-center gap-2.5 rounded-card text-[13px]",
                      collapsed ? "justify-center px-0" : "px-2.5",
                      active
                        ? "bg-inverse-2 font-semibold text-inverse-ink"
                        : "text-inverse-muted hover:bg-inverse-2/60 hover:text-inverse-ink",
                    )}
                  >
                    {/* the accent edge, not a filled block: one accent per screen */}
                    {active ? (
                      <span className="absolute top-1.5 bottom-1.5 -left-2 w-[2px] rounded-r bg-accent" />
                    ) : null}
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                    {collapsed ? <span className="sr-only">{labels.nav[key]}</span> : labels.nav[key]}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {collapsed ? null : (
          <div className="shrink-0 border-t border-white/5 px-4 py-3 text-[11px] leading-relaxed text-inverse-muted">
            <div className="truncate">{account.email}</div>
            <div className="mt-0.5">{account.licence}</div>
          </div>
        )}
      </aside>

      {/* ======================================================== content == */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* one row, always: it used to wrap to two on a phone and eat 150px
            of a 844px screen before a single figure appeared */}
        <header className="sticky top-0 z-20 flex h-[56px] shrink-0 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <BrandMark className="h-[14px] shrink-0 text-ink lg:hidden" height={13} />
            <h1 className="truncate text-[14px] font-semibold text-ink lg:text-[15px]">{title}</h1>
          </div>

          {showRange ? (
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-card bg-surface/70 p-0.5"
              role="group"
              aria-label={labels.period}
            >
              {RANGES.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRange(key)}
                  aria-pressed={range === key}
                  className={cn(
                    "h-10 rounded-[2px] px-2.5 text-[12px] whitespace-nowrap sm:px-3",
                    range === key
                      ? "bg-card font-semibold text-ink shadow-[0_1px_2px_rgba(21,24,27,0.06)]"
                      : "text-muted hover:text-ink-2",
                  )}
                >
                  {labels.ranges[key]}
                </button>
              ))}
            </div>
          ) : null}

          {/* on a phone these live in the sheet, so the bar stays one row */}
          <div className="ml-1 hidden shrink-0 items-center gap-2 border-l border-line pl-3 lg:flex">
            <LocaleToggle locale={locale} label={labels.language} onPick={setLocale} />
            <form action={signOut}>
              <button className={quietClass} type="submit">
                {labels.signOut}
              </button>
            </form>
          </div>
        </header>

        {/* pb clears the bottom bar and the home indicator under it */}
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-5 pb-[calc(72px+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 lg:pb-10">
          {children}
        </main>
      </div>

      {/* ==================================================== bottom bar == */}
      <nav
        aria-label={labels.brand}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-card/97 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {TABS.map((key) => {
          const Icon = ICONS[key];
          const active = isActive(key);
          return (
            <Link
              key={key}
              href={HREF[key]}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2",
                active ? "text-ink" : "text-muted",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2 : 1.6} aria-hidden />
              <span
                className={cn(
                  "max-w-full truncate px-1 text-[10.5px]",
                  active && "font-semibold",
                )}
              >
                {labels.nav[key]}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2",
            IN_SHEET.some(isActive) ? "text-ink" : "text-muted",
          )}
        >
          <MoreHorizontal size={19} strokeWidth={IN_SHEET.some(isActive) ? 2 : 1.6} aria-hidden />
          <span
            className={cn(
              "text-[10.5px]",
              IN_SHEET.some(isActive) && "font-semibold",
            )}
          >
            {labels.more}
          </span>
        </button>
      </nav>

      {/* ======================================================== sheet == */}
      {sheetOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={labels.close}
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-inverse/40"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[10px] border-t border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_rgba(21,24,27,0.16)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-ink">{account.name}</div>
                <div className="truncate text-[11.5px] text-muted">{account.email}</div>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label={labels.close}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-muted hover:bg-hover"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 p-2">
              {IN_SHEET.map((key) => {
                const Icon = ICONS[key];
                const active = isActive(key);
                return (
                  <Link
                    key={key}
                    href={HREF[key]}
                    className={cn(
                      "flex h-12 items-center gap-2.5 rounded-card px-3 text-[13.5px]",
                      active ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 active:bg-hover",
                    )}
                  >
                    <Icon size={17} strokeWidth={1.75} aria-hidden />
                    <span className="truncate">{labels.nav[key]}</span>
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <LocaleToggle locale={locale} label={labels.language} onPick={setLocale} />
              <form action={signOut}>
                <button className={quietClass} type="submit">
                  {labels.signOut}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LocaleToggle({
  locale,
  label,
  onPick,
}: {
  locale: Locale;
  label: string;
  onPick: (next: Locale) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-card bg-surface/70 p-0.5"
      role="group"
      aria-label={label}
    >
      {(["es", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onPick(code)}
          aria-pressed={locale === code}
          className={cn(
            "h-10 rounded-[2px] px-3 text-[11.5px] font-semibold uppercase",
            locale === code ? "bg-card text-ink" : "text-muted hover:text-ink-2",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
