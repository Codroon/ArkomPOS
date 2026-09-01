/**
 * App frame — docs/design/handoff/00-foundations.md ("App shell") + mockup.
 * Topbar 44px: brand · spacer · shift chip (ADR-0015) · user chip · locale
 * toggle · Till chip · date. Left nav 186px: 01–03 and 11 (Ajustes)
 * enabled in Phase 1, the rest muted with a LOCK badge, non-navigable. All strings via useT()
 * (ADR-0011); the date format stays dd/mm/yyyy hh:mm regardless of locale.
 */
import { useEffect, useState } from "react";
import type { MetaContextResponse, PermissionKey } from "@arkom/core";
import { cn, LocaleToggle, LockBadge, useRoleLabel, useT, type TKey } from "@arkom/ui";
import { useCan, useSession } from "../lib/use-session";
import { registerNavigator, type ScreenId } from "../lib/screen-bus";
import { CatalogScreen } from "../screens/catalog/catalog-screen";
import { InventoryScreen } from "../screens/inventory/inventory-screen";
import { SaleScreen } from "../screens/sale/sale-screen";
import { BuyUsedScreen } from "../screens/used/buy-used-screen";
import { UsedDevicesScreen } from "../screens/used/used-devices-screen";
import { RepairsScreen } from "../screens/repair/repairs-screen";
import { WorkshopScreen } from "../screens/repair/workshop-screen";
import { CashScreen } from "../screens/cash/cash-screen";
import { ReportsScreen } from "../screens/reports/reports-screen";
import { ShiftChip } from "../screens/cash/shift-chip";
import { SettingsScreen } from "../screens/settings/settings-screen";
import { UsersScreen } from "../screens/users/users-screen";

/**
 * `needs` hides the row entirely when the session lacks it (handoff/auth.md,
 * "Shell changes"). Hiding is a convenience — the handlers refuse the call
 * regardless — but a cashier should not see doors they cannot open.
 */
const NAV_ITEMS: ReadonlyArray<{ n: string; labelKey: TKey; id?: ScreenId; needs?: PermissionKey }> = [
  { n: "01", labelKey: "nav.venta", id: "venta" },
  { n: "02", labelKey: "nav.catalogo", id: "catalogo" },
  { n: "03", labelKey: "nav.inventario", id: "inventario" },
  { n: "04", labelKey: "nav.compraUsados", id: "comprarUsados", needs: "usedDevices.create" },
  { n: "05", labelKey: "nav.unidadUsada", id: "dispositivosUsados", needs: "usedDevices.create" },
  { n: "06", labelKey: "nav.reparacion", id: "reparaciones", needs: "repair.view" },
  { n: "07", labelKey: "nav.taller", id: "taller", needs: "workshop.view" },
  { n: "08", labelKey: "nav.transferencias" },
  { n: "09", labelKey: "nav.caja", id: "caja", needs: "cash.view" },
  { n: "10", labelKey: "nav.informes", id: "informes", needs: "reports.view" },
  { n: "11", labelKey: "nav.ajustes", id: "ajustes", needs: "settings.edit" },
  { n: "12", labelKey: "usr.title", id: "usuarios", needs: "users.manage" },
];

function formatNow(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Who is at the till, with the two ways out of it.
 *
 * "Cambiar de usuario" logs out and auto-parks an open cart, so the next
 * cashier's lines never join the last one's under a single attribution.
 */
function UserChip({ name, role }: { name: string; role: string }) {
  const t = useT();
  const roleLabel = useRoleLabel();
  const [open, setOpen] = useState(false);

  // called separately rather than through a union: window.arkom.invoke is
  // overloaded per channel, so a union of names matches none of the overloads
  const lock = async () => {
    setOpen(false);
    try {
      await window.arkom.invoke("auth:lock");
    } catch (err) {
      console.error("auth:lock failed", err);
    }
  };
  const logout = async () => {
    setOpen(false);
    try {
      await window.arkom.invoke("auth:logout");
    } catch (err) {
      console.error("auth:logout failed", err);
    }
  };

  return (
    <div className="relative flex items-center border-l border-inverse-2 px-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex flex-col items-start leading-tight hover:opacity-80"
      >
        <span className="text-[11px] font-semibold text-inverse-ink">{name}</span>
        <span className="font-mono text-[9px] tracking-[.08em] text-inverse-muted">
          {roleLabel(role)}
        </span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-2 top-11 z-50 w-[188px] rounded-[3px] border border-line-strong bg-card py-1 shadow-lg">
            <button
              type="button"
              onClick={() => void lock()}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-ink hover:bg-hover"
            >
              {t("lock.button")}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-ink hover:bg-hover"
            >
              {t("lock.switchUser")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AppShell({ context }: { context: MetaContextResponse | null }) {
  const t = useT();
  const can = useCan();
  const { session } = useSession();
  const [screen, setScreen] = useState<ScreenId>("venta");
  /* bumped on every nav click so a screen that drills into a sub-view returns
     to its root when the section is chosen again — clicking "05" while reading
     one device should land on the list, not on the same device */
  const [navTick, setNavTick] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => registerNavigator(setScreen), []);

  return (
    <div className="flex h-full min-h-[860px] flex-col bg-canvas text-ink">
      {/* topbar — the brand plate: Graphite 900 with the Bone wordmark sitting on
          a 3px Signal Blue rule, exactly as the manual draws the lockup. The blue
          here is a rule, not an action, so the one-blue-per-surface budget of each
          screen below is untouched. */}
      <header className="relative flex h-11 flex-none items-stretch bg-inverse text-[12px] text-inverse-ink">
        <div className="flex items-center gap-2 border-r border-inverse-2 px-3.5">
          <span className="font-display text-[15px] leading-none tracking-[.06em] text-inverse-ink">
            {t("shell.brand")}
          </span>
          <span className="font-mono text-[9px] font-medium tracking-[.16em] text-inverse-muted">
            {t("shell.brandSuffix")}
          </span>
        </div>
        <div className="flex-1" />
        {session ? <ShiftChip /> : null}
        {session ? <UserChip name={session.name} role={session.role} /> : null}
        <div className="flex items-center border-l border-inverse-2 px-3.5">
          <LocaleToggle />
        </div>
        <div className="flex items-center border-l border-inverse-2 px-3.5 font-mono text-[11px] font-medium tabular-nums text-inverse-ink">
          {context?.terminal.name ?? t("common.dash")}
        </div>
        <div className="flex items-center border-l border-inverse-2 px-3.5 font-mono text-[11px] font-medium tabular-nums text-inverse-muted">
          {formatNow(now)}
        </div>
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-accent" />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left nav */}
        <aside className="flex w-[186px] flex-none flex-col border-r border-line-strong bg-surface">
          <div className="px-3 pb-1 pt-2.5 text-[9px] font-bold tracking-[.12em] text-subtle">{t("shell.menu")}</div>
          {NAV_ITEMS.filter((item) => !item.needs || can(item.needs)).map((item) =>
            item.id ? (
              <button
                key={item.n}
                type="button"
                onClick={() => {
                  setScreen(item.id!);
                  setNavTick((n) => n + 1);
                }}
                className={cn(
                  "flex items-center gap-[9px] border-l-[3px] px-3 py-2 text-left",
                  screen === item.id
                    ? "border-inverse bg-inverse font-semibold text-inverse-ink"
                    : "border-transparent text-ink-2 hover:border-line hover:bg-hover hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "w-4 text-center text-[11px] tabular-nums",
                    screen === item.id ? "text-inverse-muted" : "text-subtle",
                  )}
                >
                  {item.n}
                </span>
                {t(item.labelKey)}
              </button>
            ) : (
              // out of Phase-1 scope: rendered muted + lock badge, non-navigable
              <div
                key={item.n}
                aria-disabled="true"
                className="flex cursor-default items-center gap-[9px] border-l-[3px] border-transparent px-3 py-2 text-subtle"
              >
                <span className="w-4 text-center text-[11px] tabular-nums text-subtle">{item.n}</span>
                <span className="flex-1">{t(item.labelKey)}</span>
                <LockBadge />
              </div>
            ),
          )}
          <div className="flex-1" />
          <div className="border-t border-line px-3 py-2.5 text-[10px] leading-normal text-subtle">
            {context ? `${context.location.name} · ${context.terminal.name}` : t("shell.noContext")}
          </div>
        </aside>

        {/* main */}
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          {screen === "venta" ? (
            <SaleScreen terminalName={context?.terminal.name ?? t("common.dash")} />
          ) : screen === "catalogo" ? (
            <CatalogScreen />
          ) : screen === "comprarUsados" ? (
            <BuyUsedScreen />
          ) : screen === "dispositivosUsados" ? (
            <UsedDevicesScreen key={navTick} />
          ) : screen === "reparaciones" ? (
            <RepairsScreen key={navTick} />
          ) : screen === "taller" ? (
            <WorkshopScreen key={navTick} />
          ) : screen === "caja" ? (
            <CashScreen key={navTick} />
          ) : screen === "informes" ? (
            <ReportsScreen key={navTick} />
          ) : screen === "ajustes" ? (
            <SettingsScreen />
          ) : screen === "usuarios" ? (
            <UsersScreen />
          ) : (
            <InventoryScreen />
          )}
        </main>
      </div>
    </div>
  );
}
