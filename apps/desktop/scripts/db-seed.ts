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
import { createShop, insertDemoData, seedStarterGroups, SETUP_DONE_KEY } from "../src/main/setup";
import { createUser } from "../src/main/auth/users";

/** Ajustes defaults for a dev database: printer off, a sample letterhead. */
const DEV_SETTINGS: Record<string, string> = {
  printerName: "",
  paperWidthMm: "80",
  commandSet: "epson",
  shopLegalName: "Arkom Electrónica S.L.",
  shopNif: "B00000000",
  shopAddress: "Calle Ejemplo 1",
  shopCity: "Madrid",
  shopPostalCode: "28001",
  ticketFooter: "Precios claros. Sin letra pequeña.",
  // a seeded dev database is already "set up" — no first-run dialog on `pnpm dev`
  [SETUP_DONE_KEY]: "true",
};

/**
 * Whether this code is running out of an installed build. The bundle a client
 * runs lives inside `app.asar`; a checkout never does.
 */
export function isPackagedRuntime(): boolean {
  return __dirname.includes("app.asar") || process.env.ARKOM_PACKAGED === "1";
}

export function seed(db: ArkomDb, opts: { packaged?: boolean } = {}): { seeded: boolean; message: string } {
  /* A client install never seeds: first launch asks the shop who it is, and the
     demo dataset is not offered to an installed till (v0.18.0). The refusal
     sits in the function and not only in the absence of a terminal to run it
     from, so the answer does not depend on how the script was reached. */
  if (opts.packaged ?? isPackagedRuntime()) {
    throw new Error("db:seed is a development step. An installed till is set up on its first launch.");
  }
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

    /* same path first run takes: the shop's shelves, then the demo rows on
       them (ADR-0017) */
    const groups = seedStarterGroups(tx, log, ids.tenantId, "es", now);
    return insertDemoData(tx, log, ids, now, groups);
  });

  /* DEV USERS — never in a client build.
     A client install has no seed step at all; it creates its owner through the
     first-run step and sets a PIN nobody else knows. These two exist so
     `pnpm dev` lands on Login with something to type, and their PINs are in
     TESTING.md precisely because they are worthless outside a dev machine. */
  createUser(db, ctx, { name: "Ahmer", role: "owner", pin: "8317" });
  createUser(db, ctx, { name: "Ana", role: "cashier", pin: "5162" });

  return {
    seeded: true,
    message:
      `Seeded: Arkom Demo / Tienda / Till 1 (T1-), ${counts.productCount} products, ` +
      `${counts.unitCount} IMEI units, opening stock, Ajustes placeholders + oplog. ` +
      `All catalogue rows tagged is_demo. Dev users: Ahmer/8317 (responsable), Ana/5162 (cajero).`,
  };
}
