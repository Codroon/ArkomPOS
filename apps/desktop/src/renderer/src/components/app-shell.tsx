/**
 * App frame — docs/design/handoff/00-foundations.md ("App shell") + mockup.
 * Topbar 44px: brand · spacer · Till chip · date (no shift/cashier chips — ADR-0010).
 * Left nav 186px: 01–03 enabled in Phase 1, the rest muted with a LOCK badge,
 * non-navigable. Main: bg-app; screens land here in later slices.
 */
import { useEffect, useState } from "react";
import type { MetaContextResponse } from "@arkom/core";
import { cn, LockBadge } from "@arkom/ui";
import { CatalogScreen } from "../screens/catalog/catalog-screen";

type ScreenId = "venta" | "catalogo" | "inventario";

const NAV_ITEMS: ReadonlyArray<{ n: string; label: string; id?: ScreenId }> = [
  { n: "01", label: "Venta", id: "venta" },
  { n: "02", label: "Catálogo", id: "catalogo" },
  { n: "03", label: "Inventario", id: "inventario" },
  { n: "04", label: "Compra usados" },
  { n: "05", label: "Unidad usada" },
  { n: "06", label: "Reparación" },
  { n: "07", label: "Taller / Agenda" },
  { n: "08", label: "Transferencias" },
  { n: "09", label: "Caja" },
  { n: "10", label: "Informes" },
  { n: "11", label: "Ajustes" },
];

const SCREEN_TITLES: Record<ScreenId, string> = {
  venta: "Venta",
  catalogo: "Catálogo",
  inventario: "Inventario",
};

function formatNow(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AppShell({ context }: { context: MetaContextResponse | null }) {
  const [screen, setScreen] = useState<ScreenId>("venta");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full min-h-[860px] flex-col bg-app text-ink">
      {/* topbar */}
      <header className="flex h-11 flex-none items-stretch border-b border-border-strong bg-panel text-[12px]">
        <div className="flex items-center gap-2 border-r border-border px-3.5 font-bold tracking-[.14em]">
          ARKOM
          <span className="text-[10px] font-normal tracking-[.08em] text-faint">POS</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center border-l border-border px-3.5 text-muted">
          {context?.terminal.name ?? "—"}
        </div>
        <div className="flex items-center border-l border-border px-3.5 font-mono text-[11px] tabular-nums text-ink-2">
          {formatNow(now)}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left nav */}
        <aside className="flex w-[186px] flex-none flex-col border-r border-border-strong bg-panel">
          <div className="px-3 pb-1 pt-2.5 text-[9px] font-bold tracking-[.12em] text-faint">MENU</div>
          {NAV_ITEMS.map((item) =>
            item.id ? (
              <button
                key={item.n}
                type="button"
                onClick={() => setScreen(item.id!)}
                className={cn(
                  "flex items-center gap-[9px] border-l-[3px] px-3 py-2 text-left",
                  screen === item.id
                    ? "border-ink-2 bg-nav-active font-bold text-ink"
                    : "border-transparent text-ink-2 hover:border-border hover:bg-nav-hover hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "w-4 text-center text-[11px] tabular-nums",
                    screen === item.id ? "text-ink-3" : "text-faint",
                  )}
                >
                  {item.n}
                </span>
                {item.label}
              </button>
            ) : (
              // out of Phase-1 scope: rendered muted + lock badge, non-navigable
              <div
                key={item.n}
                aria-disabled="true"
                className="flex cursor-default items-center gap-[9px] border-l-[3px] border-transparent px-3 py-2 text-faint"
              >
                <span className="w-4 text-center text-[11px] tabular-nums text-faint-2">{item.n}</span>
                <span className="flex-1">{item.label}</span>
                <LockBadge />
              </div>
            ),
          )}
          <div className="flex-1" />
          <div className="border-t border-border px-3 py-2.5 text-[10px] leading-normal text-faint">
            {context ? `${context.location.name} · ${context.terminal.name}` : "Sin contexto — pnpm db:seed"}
          </div>
        </aside>

        {/* main */}
        <main className="flex min-w-0 flex-1 flex-col bg-app">
          {screen === "catalogo" ? (
            <CatalogScreen />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="text-[15px] font-bold text-ink-2">{SCREEN_TITLES[screen]}</div>
                <div className="mt-1 text-[12px] text-muted">Pantalla en construcción — Fase 1</div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
