/**
 * `pnpm db:seed` — fill a DEV database, so the app has something to show
 * without walking first-run setup every time.
 *
 * Since Day 10 this is a thin wrapper: the shop rows come from createShop() and
 * the sample catalogue from insertDemoData(), the same two functions a real
 * first run uses. That is the point — the dev database and a client install are
 * built by identical code, so "works on my machine" cannot mean "was built
 * differently on my machine".
 *
 * A client install never runs this. It has no terminal and no seed step; the
 * app asks the shop who it is on first launch instead.
 */
import { mutate, uuidv7, type MutationCtx } from "@arkom/core";
import { schema as s, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../src/main/mutate-runner";
import { createShop, insertDemoData, SETUP_DONE_KEY } from "../src/main/setup";

/** Ajustes defaults for a dev database: printer off, shop data still owed. */
const DEV_SETTINGS: Record<string, string> = {
  printerName: "",
  paperWidthMm: "80",
  commandSet: "epson",
  shopLegalName: "PENDIENTE — Razón social",
  shopNif: "PENDIENTE — NIF",
  shopAddress: "PENDIENTE — Dirección fiscal",
  ticketFooter: "Precios claros. Sin letra pequeña.",
  // a seeded dev database is already "set up" — no first-run dialog on `pnpm dev`
  [SETUP_DONE_KEY]: "true",
};

export function seed(db: ArkomDb): { seeded: boolean; message: string } {
  const existing = db.select({ id: s.tenants.id }).from(s.tenants).limit(1).all();
  if (existing.length > 0) {
    return { seeded: false, message: "Database already seeded (tenants table is not empty) — nothing done." };
  }

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  const ctx: MutationCtx = { ...ids, userId: null };

  const counts = mutate(makeMutateRunner(db), ctx, (tx, log) => {
    createShop(
      tx,
      log,
      { tenantName: "Arkom Demo", locationName: "Tienda", terminalName: "Till 1", seriesPrefix: "T1-" },
      ids,
      now,
    );

    for (const [key, value] of Object.entries(DEV_SETTINGS)) {
      tx.insert(s.settings).values({ tenantId: ids.tenantId, key, value, updatedAt: now }).run();
      log({ entity: "setting", entityId: key, action: "create", before: null, after: { key, value } });
    }

    return insertDemoData(tx, log, ids, now);
  });

  return {
    seeded: true,
    message:
      `Seeded: Arkom Demo / Tienda / Till 1 (T1-), ${counts.productCount} products, ` +
      `${counts.unitCount} IMEI units, opening stock, Ajustes placeholders + oplog. ` +
      `All catalogue rows tagged is_demo.`,
  };
}
