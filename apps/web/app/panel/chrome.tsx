"use client";

/**
 * The app shell: a graphite rail down the left, a bar across the top, and the
 * page inside it.
 *
 * The rail is the inverse surface the till uses for its own chrome, so the two
 * halves of the product read as one. On a phone the rail becomes a row that
 * scrolls, because an owner checking takings from a café is the case this whole
 * dashboard exists for.
 *
 * Client-side only because it needs three things a server cannot know: which
 * link is current, what the viewport is doing, and what the person just picked
 * in the period selector. Every figure on every page is still rendered on the
 * server.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  FileText,
  LayoutDashboard,
  Receipt,
  Smartphone,
  Warehouse,
  Wrench,
} from "lucide-react";
import { cn, ghostClass } from "../../src/ui";
import { Wordmark } from "../../src/ui/wordmark";
import { LOCALE_COOKIE, type Locale } from "../../src/i18n";

export interface ChromeLabels {
  brand: string;
  signOut: string;
  language: string;
  period: string;
  nav: {
    summary: string;
    sales: string;
    catalogue: string;
    inventory: string;
    repairs: string;
    used: string;
    transfers: string;
    reports: string;
    tills: string;
  };
  ranges: { today: string; "7d": string; "30d": string; "90d": string };
}

const ICONS = {
  summary: LayoutDashboard,
  sales: Receipt,
  catalogue: Boxes,
  inventory: Warehouse,
  repairs: Wrench,
  used: Smartphone,
  transfers: ArrowLeftRight,
  reports: FileText,
  tills: BarChart3,
} as const;

const LINKS = [
  { key: "summary", href: "/panel" },
  { key: "sales", href: "/panel/ventas" },
  { key: "catalogue", href: "/panel/catalogo" },
  { key: "inventory", href: "/panel/inventario" },
  { key: "repairs", href: "/panel/reparaciones" },
  { key: "used", href: "/panel/usados" },
  { key: "transfers", href: "/panel/transferencias" },
  { key: "reports", href: "/panel/informes" },
  { key: "tills", href: "/panel/cajas" },
] as const;

const RANGES = ["today", "7d", "30d", "90d"] as const;
export type RangeKey = (typeof RANGES)[number];

export function PanelChrome({
  labels,
  locale,
  account,
  signOut,
  children,
}: {
  labels: ChromeLabels;
  locale: Locale;
  account: { name: string; email: string; licence: string };
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const range = (params.get("range") ?? "30d") as RangeKey;

  const setRange = (next: RangeKey) => {
    const query = new URLSearchParams(params.toString());
    query.set("range", next);
    startTransition(() => router.push(`${path}?${query.toString()}`));
  };

  const setLocale = (next: Locale) => {
    /* a cookie rather than a query param: the choice should survive a link
       somebody sends themselves, and it belongs to the person not the page */
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    startTransition(() => router.refresh());
  };

  const isActive = (href: string) => (href === "/panel" ? path === "/panel" : path.startsWith(href));

  return (
    <div className="min-h-screen bg-canvas lg:flex">
      {/* ---------------------------------------------------------- rail -- */}
      <aside className="bg-inverse text-inverse-ink lg:sticky lg:top-0 lg:h-screen lg:w-[216px] lg:shrink-0">
        <div className="flex items-center justify-between px-4 py-3.5 lg:block">
          {/* currentColor: the mark takes the rail's ink, no second asset */}
          <Wordmark className="h-[15px] w-auto text-inverse-ink" title={labels.brand} />
          <div className="hidden text-[11px] text-inverse-muted lg:mt-1.5 lg:block">{account.name}</div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:mt-2 lg:flex-col lg:overflow-visible lg:px-2">
          {LINKS.map((link) => {
            const Icon = ICONS[link.key];
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-[3px] px-2.5 py-2 text-[13px] whitespace-nowrap",
                  active
                    ? "bg-inverse-2 font-semibold text-inverse-ink"
                    : "text-inverse-muted hover:bg-inverse-2/60 hover:text-inverse-ink",
                )}
              >
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                {labels.nav[link.key]}
              </Link>
            );
          })}
        </nav>

        <div className="hidden px-4 py-3 text-[11px] leading-relaxed text-inverse-muted lg:block lg:mt-auto">
          <div className="truncate">{account.email}</div>
          <div className="mt-0.5">{account.licence}</div>
        </div>
      </aside>

      {/* ------------------------------------------------------- content -- */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas/95 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="flex items-center gap-1" role="group" aria-label={labels.period}>
            {RANGES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                aria-pressed={range === key}
                className={cn(
                  "rounded-[3px] px-2.5 py-1.5 text-[12px]",
                  range === key
                    ? "bg-surface-2 font-semibold text-ink"
                    : "text-muted hover:bg-hover hover:text-ink-2",
                )}
              >
                {labels.ranges[key]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5" role="group" aria-label={labels.language}>
              {(["es", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLocale(code)}
                  aria-pressed={locale === code}
                  className={cn(
                    "rounded-[3px] px-2 py-1 text-[11px] font-semibold uppercase",
                    locale === code ? "bg-surface-2 text-ink" : "text-muted hover:bg-hover",
                  )}
                >
                  {code}
                </button>
              ))}
            </div>
            <form action={signOut}>
              <button className={ghostClass} type="submit">
                {labels.signOut}
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto max-w-[1180px] px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      </div>
    </div>
  );
}
