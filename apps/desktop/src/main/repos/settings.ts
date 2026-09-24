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
import {
  appError,
  mutate,
  STARTER_CASH_CONCEPTS,
  type MutationCtx,
  type Settings,
  type ShopProfile,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";

const { settings } = schema;

/**
 * Defaults a till can work from, and blanks where only the shop knows.
 *
 * The letterhead ships EMPTY (v0.18.0): first run asks for it, Ajustes shows
 * what is missing as an empty field, and a blank line simply does not print.
 * Until v0.18.0 these three said "PENDIENTE", which was meant to shout — but a
 * placeholder that can reach a customer's ticket is a worse failure than a
 * blank one, and the wizard now makes the fields required anyway.
 */
export const DEFAULT_SETTINGS: Settings = {
  printerName: "", // no printer — a legitimate configuration, PDF handles it
  paperWidthMm: 80,
  commandSet: "epson",
  /* The letterhead ships EMPTY (v0.18.0). A first run asks for it and Ajustes
     shows what is missing as a blank field; a placeholder the shop could print
     by accident is not a safer default than nothing. */
  shopLegalName: "",
  shopNif: "",
  shopAddress: "",
  shopDisplayName: "",
  shopTagline: "",
  shopCity: "",
  shopPostalCode: "",
  shopPhone: "",
  ticketFooter: "Precios claros. Sin letra pequeña.",
  backupSecondaryPath: "", // local backups only until someone points it at a stick
  backupLastAtMs: 0,
  backupLastStatus: "",
  idleLockMinutes: 5,
  usedMarginPct: 25,
  repairWarrantyMonths: 3,
  repairDiagnosisFeeCents: 0,
  repairDepositSuggestionCents: 0,
  repairCapEnabled: true,
  /* how long "no sale" has to last before a product is dead (ADR-0016) */
  deadStockDays: 90,
  /* the general rate, 21 % — the figure the law gives today, as DATA so that a
     change reaches new lines through Ajustes and not through a release */
  vatRateBp: 2100,
  /* the client's answers, landing as data (ADR-0015 §11) */
  cashDefaultFloatCents: 20000, // 200,00 €
  cashVarianceToleranceCents: 300, // 3,00 €
  cashMovementApprovalCents: 10000, // 100,00 €
  // a till that predates the per-language seed keeps the Spanish list it had
  cashConcepts: [...STARTER_CASH_CONCEPTS.es],
};

type SettingKey = keyof Settings;

/** Values live as strings; these two put the non-string fields back together. */
function decode(key: SettingKey, raw: string): Settings[SettingKey] {
  if (key === "paperWidthMm") return Number(raw) === 58 ? 58 : 80;
  /* v0.18.1 dropped tanca/daruma/brother. A till that stored one reads back as
     epson rather than as an invalid value the screen would have to explain. */
  if (key === "commandSet") return raw === "star" ? "star" : "epson";
  if (key === "backupLastAtMs") return Number(raw) || 0;
  // 0 is a real answer here ("never lock"), so it must survive the ?? fallback
  if (key === "idleLockMinutes") return Number.isFinite(Number(raw)) ? Number(raw) : 5;
  if (key === "usedMarginPct") return Number.isFinite(Number(raw)) ? Number(raw) : 25;
  if (key === "repairWarrantyMonths") return Number.isFinite(Number(raw)) ? Number(raw) : 3;
  if (key === "repairDiagnosisFeeCents") return Number.isFinite(Number(raw)) ? Number(raw) : 0;
  if (key === "repairDepositSuggestionCents") return Number.isFinite(Number(raw)) ? Number(raw) : 0;
  if (key === "repairCapEnabled") return raw !== "false";
  if (key === "deadStockDays") return Number.isFinite(Number(raw)) ? Number(raw) : 90;
  if (key === "vatRateBp") return Number.isFinite(Number(raw)) ? Number(raw) : 2100;
  if (key === "cashDefaultFloatCents") return Number.isFinite(Number(raw)) ? Number(raw) : 20000;
  if (key === "cashVarianceToleranceCents") return Number.isFinite(Number(raw)) ? Number(raw) : 300;
  if (key === "cashMovementApprovalCents") return Number.isFinite(Number(raw)) ? Number(raw) : 10000;
  /* a list, so it rides as JSON rather than as a delimiter nobody can type */
  if (key === "cashConcepts") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : DEFAULT_SETTINGS.cashConcepts;
    } catch {
      return DEFAULT_SETTINGS.cashConcepts;
    }
  }
  return raw;
}
function encode(value: Settings[SettingKey]): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
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
    displayName: s.shopDisplayName,
    tagline: s.shopTagline,
    city: s.shopCity,
    postalCode: s.shopPostalCode,
    phone: s.shopPhone,
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

/**
 * The gate in front of the acts that hand a customer paper — v0.18.1.
 *
 * A shop with a thermal printer on the counter has one configured; a till with
 * an empty `printerName` is one nobody finished setting up. Taking money in
 * that state produces a sale with no ticket, which is exactly the argument the
 * paper exists to prevent — so the charge is refused and says where to fix it.
 *
 * This is about CONFIGURATION, not about hardware behaving. A printer that is
 * configured and then jams, runs out of paper or gets unplugged raises
 * PRINT_FAILED after the sale is already complete: the money is taken, the
 * document exists, and the paper is a separate act with its own retry. Stopping
 * a paid sale because a cable fell out would close the shop mid-queue.
 */
export function requireConfiguredPrinter(db: ArkomDb, ctx: MutationCtx): string {
  const { printerName } = getSettings(db, ctx);
  if (!printerName.trim()) {
    throw appError("PRINTER_REQUIRED", "No hay impresora configurada. Configúrala en Ajustes antes de cobrar.");
  }
  return printerName;
}
