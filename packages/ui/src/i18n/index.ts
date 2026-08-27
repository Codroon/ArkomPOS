/**
 * UI locale — ADR-0011. Two independent axes:
 *   1. UI locale (this module): what the STAFF sees on screen. Toggleable,
 *      default "es", persisted in localStorage.
 *   2. Document locale: what the CUSTOMER receives. Printed tickets (Day 9)
 *      always render fixed Spanish strings — the print path must NEVER call
 *      useT()/translate(); it owns its own ES constants.
 * Number/date formats do not switch with the locale (es-ES formats are part
 * of the till's visual spec, 00-foundations).
 */
import { useCallback, useSyncExternalStore } from "react";
import { es, type TKey } from "./es";
import { en, enDataLabels } from "./en";

export type { TKey };
export type Locale = "es" | "en";

const DICTS: Record<Locale, Record<TKey, string>> = { es, en };
const STORAGE_KEY = "arkom.uiLocale";

function readStored(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return saved === "en" || saved === "es" ? saved : "es";
  } catch {
    return "es";
  }
}

let current: Locale = readStored();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable (tests) — in-memory only */
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function translate(locale: Locale, key: TKey, vars?: Record<string, string | number>): string {
  let text: string = DICTS[locale][key] ?? es[key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function useLocale(): [Locale, (next: Locale) => void] {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return [locale, setLocale];
}

export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

/** The one way UI components read strings. */
export function useT(): TFn {
  const [locale] = useLocale();
  return useCallback<TFn>((key, vars) => translate(locale, key, vars), [locale]);
}

/**
 * Display label for a DATA name (group/supplier): mapped only for the known
 * seed dataset, otherwise shown exactly as stored. Spanish = identity.
 */
export function translateData(locale: Locale, name: string): string {
  return locale === "en" ? (enDataLabels[name] ?? name) : name;
}

export type DataLabelFn = (name: string) => string;

export function useDataLabel(): DataLabelFn {
  const [locale] = useLocale();
  return useCallback<DataLabelFn>((name) => translateData(locale, name), [locale]);
}

/* ------------------------------------------------- registry-driven labels --
 * Permission keys, module names and roles live in `packages/core` as DATA —
 * core owns the vocabulary, the dictionary owns the words (ADR-0011). These
 * three resolve `perm.<key>`, `permMod.<module>` and `role.<role>` and fall
 * back to the raw value, so a key added to the registry before its translation
 * renders as itself rather than blowing up.
 *
 * `ui-labels.test.ts` fails if any registry key is missing from either
 * dictionary, which is what keeps the fallback a safety net rather than a
 * silent way to ship English-only labels into a Spanish shop. */

function dynamic(locale: Locale, key: string, fallback: string): string {
  const dict = DICTS[locale] as Record<string, string | undefined>;
  return dict[key] ?? (es as Record<string, string | undefined>)[key] ?? fallback;
}

export type LabelFn = (value: string, fallback?: string) => string;

/** "sale.price_override" → "Modificar el precio de una línea" */
export function usePermissionLabel(): LabelFn {
  const [locale] = useLocale();
  return useCallback<LabelFn>((key, fallback) => dynamic(locale, `perm.${key}`, fallback ?? key), [locale]);
}

/** "catalog" → "Catálogo" */
export function useModuleLabel(): LabelFn {
  const [locale] = useLocale();
  return useCallback<LabelFn>((mod, fallback) => dynamic(locale, `permMod.${mod}`, fallback ?? mod), [locale]);
}

/** "owner" → "Responsable" / "Owner" */
export function useRoleLabel(): LabelFn {
  const [locale] = useLocale();
  return useCallback<LabelFn>((role, fallback) => dynamic(locale, `role.${role}`, fallback ?? role), [locale]);
}
