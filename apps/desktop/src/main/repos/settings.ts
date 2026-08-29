/**
 * Settings repo — the Ajustes KV store.
 *
 * Reads fill missing keys from DEFAULTS rather than failing, so a till that has
 * never opened Ajustes still boots and still sells (with no printer, everything
 * goes to PDF). Writes go through mutate() like every other write: one row per
 * changed key, one oplog entry each, so "who changed the NIF and when" is
 * answerable from the audit trail.
 */
import { eq, and } from "drizzle-orm";
import { mutate, type MutationCtx, type Settings, type ShopProfile } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";

const { settings } = schema;

/**
 * Placeholders, not guesses. The shop's real fiscal data is blocking for
 * go-live but not for build (PRD open question 1), so the till ships saying so
 * out loud — a test ticket prints "PENDIENTE" where the NIF belongs, which is
 * far harder to miss than a plausible-looking wrong address.
 */
export const DEFAULT_SETTINGS: Settings = {
  printerName: "", // no printer — a legitimate configuration, PDF handles it
  paperWidthMm: 80,
  commandSet: "epson",
  shopLegalName: "PENDIENTE — Razón social",
  shopNif: "PENDIENTE — NIF",
  shopAddress: "PENDIENTE — Dirección fiscal",
  ticketFooter: "Precios claros. Sin letra pequeña.",
  backupSecondaryPath: "", // local backups only until someone points it at a stick
  backupLastAtMs: 0,
  backupLastStatus: "",
  idleLockMinutes: 5,
  usedMarginPct: 25,
};

type SettingKey = keyof Settings;

/** Values live as strings; these two put the non-string fields back together. */
function decode(key: SettingKey, raw: string): Settings[SettingKey] {
  if (key === "paperWidthMm") return Number(raw) === 58 ? 58 : 80;
  if (key === "backupLastAtMs") return Number(raw) || 0;
  // 0 is a real answer here ("never lock"), so it must survive the ?? fallback
  if (key === "idleLockMinutes") return Number.isFinite(Number(raw)) ? Number(raw) : 5;
  if (key === "usedMarginPct") return Number.isFinite(Number(raw)) ? Number(raw) : 25;
  return raw;
}
function encode(value: Settings[SettingKey]): string {
  return String(value);
}

export function getSettings(db: ArkomDb, ctx: MutationCtx): Settings {
  const rows = db.select().from(settings).where(eq(settings.tenantId, ctx.tenantId)).all();
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in out) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[row.key] = decode(row.key as SettingKey, row.value);
    }
  }
  return out;
}

/** The four fields the ticket needs, in the shape renderTicket() asks for. */
export function shopProfile(db: ArkomDb, ctx: MutationCtx): ShopProfile {
  const s = getSettings(db, ctx);
  return {
    legalName: s.shopLegalName,
    nif: s.shopNif,
    address: s.shopAddress,
    footerLine: s.ticketFooter,
  };
}

export function saveSettings(db: ArkomDb, ctx: MutationCtx, patch: Partial<Settings>): Settings {
  const current = getSettings(db, ctx);
  const changed = (Object.keys(patch) as SettingKey[]).filter((k) => patch[k] !== undefined && patch[k] !== current[k]);

  // nothing moved — skip the transaction rather than write an empty oplog entry
  if (changed.length === 0) return current;

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    for (const key of changed) {
      const value = encode(patch[key]!);
      const existing = tx
        .select()
        .from(settings)
        .where(and(eq(settings.tenantId, ctx.tenantId), eq(settings.key, key)))
        .all()[0];

      if (existing) {
        tx
          .update(settings)
          .set({ value, updatedAt: now })
          .where(and(eq(settings.tenantId, ctx.tenantId), eq(settings.key, key)))
          .run();
      } else {
        tx.insert(settings).values({ tenantId: ctx.tenantId, key, value, updatedAt: now }).run();
      }

      log({
        entity: "setting",
        entityId: key,
        action: existing ? "update" : "create",
        before: existing ? { key, value: existing.value } : null,
        after: { key, value },
      });
    }
    return { ...current, ...patch } as Settings;
  });
}
