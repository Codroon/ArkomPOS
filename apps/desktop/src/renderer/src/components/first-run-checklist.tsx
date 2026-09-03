/**
 * What the till still owes, on the screen the shop lands on — v0.18.2.
 *
 * A new till boots into Venta and looks finished, which it is not: it has no
 * printer, nothing to sell and no shift open, and the shop finds each of those
 * out one refusal at a time. This card says all three at once, in the order
 * they have to happen, and each line takes you to the screen that does it.
 *
 * It reads FACTS, not a tour's progress: a tick appears because the shop did
 * the real thing somewhere else in the app, never because they clicked here. It
 * disappears for good when the work is done — or when the owner says enough,
 * which is a legitimate answer for a one-person shop that will never add staff.
 */
import { useCallback, useEffect, useState } from "react";
import { SetupChecklistResponseSchema } from "@arkom/core";
import { Chip, GhostButton, cn, useT, type TKey } from "@arkom/ui";
import { navigateTo, type ScreenId } from "../lib/screen-bus";

interface Checklist {
  printerConfigured: boolean;
  hasProducts: boolean;
  hasStaff: boolean;
  hasShift: boolean;
  dismissed: boolean;
  done: boolean;
}

const ITEMS: Array<{ key: keyof Checklist; label: TKey; hint: TKey; screen: ScreenId; optional?: boolean }> = [
  { key: "printerConfigured", label: "chk.printer", hint: "chk.printerHint", screen: "ajustes" },
  { key: "hasProducts", label: "chk.products", hint: "chk.productsHint", screen: "catalogo" },
  { key: "hasStaff", label: "chk.staff", hint: "chk.staffHint", screen: "usuarios", optional: true },
  { key: "hasShift", label: "chk.shift", hint: "chk.shiftHint", screen: "caja" },
];

/* One cache, two readers: the card, and the Sale screen — which hides its own
   "no printer" line while the card is up, so a fresh till says that once
   instead of twice (v0.18.2). Same shape as the other shared sources. */
let cache: Checklist | null = null;
const listeners = new Set<(c: Checklist | null) => void>();

async function refreshChecklist(): Promise<void> {
  try {
    cache = SetupChecklistResponseSchema.parse(await window.arkom.invoke("setup:checklist", {}));
  } catch (err) {
    console.error("setup:checklist failed", err);
    cache = cache ?? null;
  }
  for (const fn of listeners) fn(cache);
}

/** Null until asked; a screen treats that as "no card". */
export function useChecklist(): Checklist | null {
  const [state, setState] = useState<Checklist | null>(cache);
  useEffect(() => {
    listeners.add(setState);
    void refreshChecklist();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

/** True while the onboarding card is on screen and still owes something. */
export function useChecklistShowing(): boolean {
  const state = useChecklist();
  return state !== null && !state.done;
}

export function FirstRunChecklist({ tick }: { tick: number }) {
  const t = useT();
  const state = useChecklist();

  /* re-read on every nav: the tick appears because the shop did the thing, and
     coming back to Venta is when they would look for it */
  useEffect(() => {
    void refreshChecklist();
  }, [tick]);

  const dismiss = useCallback(() => {
    window.arkom
      .invoke("setup:dismissChecklist", {})
      .then((raw) => {
        cache = SetupChecklistResponseSchema.parse(raw);
        for (const fn of listeners) fn(cache);
      })
      .catch((err) => console.error("setup:dismissChecklist failed", err));
  }, []);

  if (!state || state.done) return null;

  return (
    <div className="flex flex-none flex-col gap-2 border-b border-line-strong bg-surface-2 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <div className="text-[12px] font-bold">{t("chk.title")}</div>
        <div className="text-[11px] text-muted">{t("chk.subtitle")}</div>
        <div className="flex-1" />
        <GhostButton className="h-6 px-2 text-[11px]" onClick={dismiss}>
          {t("chk.dismiss")}
        </GhostButton>
      </div>

      <div className="flex flex-wrap gap-2">
        {ITEMS.map((item) => {
          const done = state[item.key] === true;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigateTo(item.screen)}
              className={cn(
                "flex min-w-[190px] flex-1 items-start gap-2 rounded-[3px] border px-2.5 py-2 text-left",
                done ? "border-line bg-card" : "border-line-strong bg-card hover:border-ink-2",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-[1px] inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[10px] font-bold",
                  done ? "border-success-ink/25 bg-success-bg text-success-ink" : "border-line-strong text-subtle",
                )}
              >
                {done ? "✓" : ""}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[12px] font-semibold", done && "text-muted line-through")}>
                  {t(item.label)}
                  {item.optional ? <Chip className="ml-1.5">{t("chk.optional")}</Chip> : null}
                </span>
                {done ? null : <span className="block text-[11px] leading-snug text-muted">{t(item.hint)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
