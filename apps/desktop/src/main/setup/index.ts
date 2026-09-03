/**
 * First run.
 *
 * A dev machine gets its database from `pnpm db:seed`. A client install has no
 * seed step and no terminal — the app opens onto an empty file and has to ask
 * the shop who it is. That conversation happens exactly once, and everything it
 * produces (tenant, location, terminal, ticket series, shop profile, optional
 * demo rows) lands in ONE transaction: a half-configured till is worse than an
 * unconfigured one, because it looks ready.
 *
 * "Load demo data" exists so the owner can see a full catalogue at the counter
 * before committing to their own. Those rows are tagged, and Ajustes can remove
 * them cleanly — until real selling starts, at which point removal is refused
 * rather than allowed to tear documents off their products.
 */
import { eq } from "drizzle-orm";
import {
  appError,
  mutate,
  toOplogJson,
  uuidv7,
  STARTER_GROUPS,
  STARTER_CASH_CONCEPTS,
  type LogFn,
  type MutationCtx,
  type SetupLocale,
} from "@arkom/core";
import { schema as s, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";
import { insertDemoData } from "./demo-data";


export { insertDemoData } from "./demo-data";

export interface ShopIdentity {
  tenantName: string;
  locationName: string;
  terminalName: string;
  seriesPrefix: string;
}

/**
 * Create the shop's own rows. Shared by first-run setup and `pnpm db:seed`, so
 * the dev database and a real install are structurally identical.
 */
export function createShop(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  log: LogFn,
  identity: ShopIdentity,
  ids: { tenantId: string; locationId: string; terminalId: string },
  now: Date,
): void {
  const logCreate = (entity: string, entityId: string, after: Record<string, unknown>) => {
    log({ entity, entityId, action: "create", before: null, after: toOplogJson(after) });
  };
  const { tenantId, locationId, terminalId } = ids;

  const tenant = { id: tenantId, name: identity.tenantName, createdAt: now };
  tx.insert(s.tenants).values(tenant).run();
  logCreate("tenant", tenant.id, tenant);

  const location = { id: locationId, tenantId, name: identity.locationName, createdAt: now };
  tx.insert(s.locations).values(location).run();
  logCreate("location", location.id, location);

  const terminal = { id: terminalId, tenantId, locationId, name: identity.terminalName, createdAt: now };
  tx.insert(s.terminals).values(terminal).run();
  logCreate("terminal", terminal.id, terminal);

  // ADR-0008: numbering is per till and gap-free, so the series is created with
  // the terminal rather than lazily at the first sale
  const series = {
    id: uuidv7(),
    tenantId,
    locationId,
    terminalId,
    docType: "ticket" as const,
    prefix: identity.seriesPrefix,
    nextNumber: 1,
  };
  tx.insert(s.numberSeries).values(series).run();
  logCreate("number_series", series.id, series);
}

/** Written into settings so the dialog is asked once and never again. */
export const SETUP_DONE_KEY = "setupComplete";

export function isSetupNeeded(db: ArkomDb): boolean {
  return db.select({ id: s.tenants.id }).from(s.tenants).limit(1).all().length === 0;
}

/**
 * The five groups every fresh install starts with — ADR-0017.
 *
 * They are `is_demo = false` on purpose. A shop that loads the demo dataset and
 * later clears it keeps its shelves; before v0.14.1 the groups went with the
 * demo products, and since a product cannot be saved without one, clearing the
 * demo left a catalog nobody could add to.
 *
 * Returned by key so the demo dataset can find them without matching on a name
 * that depends on the setup language.
 */
export function seedStarterGroups(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  log: LogFn,
  tenantId: string,
  locale: SetupLocale,
  now: Date,
): Map<string, string> {
  const byKey = new Map<string, string>();
  STARTER_GROUPS.forEach((spec, i) => {
    /* BOTH names, so the toggle works on day one whichever language the shop
       was set up in. `name` is the canonical Spanish one (ADR-0017). */
    const group = {
      id: uuidv7(),
      tenantId,
      name: spec.es,
      nameEn: spec.en,
      sortOrder: i,
      isDemo: false,
      createdAt: now,
    };
    tx.insert(s.productGroups).values(group).run();
    log({ entity: "product_group", entityId: group.id, action: "create", before: null, after: toOplogJson(group) });
    byKey.set(spec.key, group.id);
  });
  return byKey;
}

export interface FirstRunInput {
  shopLegalName: string;
  shopNif: string;
  shopAddress: string;
  ticketFooter: string;
  terminalName: string;
  seriesPrefix: string;
  shopCity?: string;
  shopPostalCode?: string;
  shopPhone?: string;
  loadDemo: boolean;
  /** decides the starter group names, and nothing else */
  locale?: SetupLocale;
}

export interface FirstRunResult {
  tenantId: string;
  demoProducts: number;
  demoUnits: number;
}

/**
 * The whole of first run, in one transaction. Rejects if the database already
 * has a tenant — running this twice would give the shop a second identity.
 */
export function completeFirstRun(db: ArkomDb, input: FirstRunInput): FirstRunResult {
  if (!isSetupNeeded(db)) {
    throw appError("VALIDATION", "Esta caja ya está configurada.");
  }

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  const ctx: MutationCtx = { ...ids, userId: null };

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    createShop(
      tx,
      log,
      {
        // the legal name IS the shop's name — there is no second thing to ask for
        tenantName: input.shopLegalName,
        locationName: "Tienda",
        terminalName: input.terminalName,
        seriesPrefix: input.seriesPrefix,
      },
      ids,
      now,
    );

    // the ticket's legal block, and the printer left off until Ajustes says
    // otherwise — a first run must not depend on hardware being plugged in
    const settings: Record<string, string> = {
      printerName: "",
      paperWidthMm: "80",
      commandSet: "epson",
      shopLegalName: input.shopLegalName,
      shopNif: input.shopNif,
      shopAddress: input.shopAddress,
      shopCity: input.shopCity ?? "",
      shopPostalCode: input.shopPostalCode ?? "",
      shopPhone: input.shopPhone ?? "",
      ticketFooter: input.ticketFooter,
      // the drawer's one-tap concepts, in the language the till is set up in
      cashConcepts: JSON.stringify(STARTER_CASH_CONCEPTS[input.locale ?? "es"]),
      [SETUP_DONE_KEY]: "true",
    };
    for (const [key, value] of Object.entries(settings)) {
      tx.insert(s.settings).values({ tenantId: ids.tenantId, key, value, updatedAt: now }).run();
      log({ entity: "setting", entityId: key, action: "create", before: null, after: { key, value } });
    }

    /* before the demo data, and whether or not it comes: an empty till still
       needs somewhere to put its first product (ADR-0017) */
    const groups = seedStarterGroups(tx, log, ids.tenantId, input.locale ?? "es", now);

    const demo = input.loadDemo
      ? insertDemoData(tx, log, ids, now, groups)
      : { productCount: 0, unitCount: 0 };

    return { tenantId: ids.tenantId, demoProducts: demo.productCount, demoUnits: demo.unitCount };
  });
}

/* ------------------------------- demo data ------------------------------- */

export interface DemoStatus {
  present: boolean;
  products: number;
  groups: number;
  suppliers: number;
  /** false once the shop has started selling — see the reason below */
  removable: boolean;
  blockedBySales: boolean;
}

export function demoStatus(db: ArkomDb, ctx: MutationCtx): DemoStatus {
  const count = (rows: unknown[]) => rows.length;
  const products = count(
    db.select({ id: s.products.id }).from(s.products).where(eq(s.products.isDemo, true)).all(),
  );
  const groups = count(
    db.select({ id: s.productGroups.id }).from(s.productGroups).where(eq(s.productGroups.isDemo, true)).all(),
  );
  const suppliers = count(
    db.select({ id: s.suppliers.id }).from(s.suppliers).where(eq(s.suppliers.isDemo, true)).all(),
  );
  // any document at all, not just a completed one: a parked ticket holds unit
  // reservations and line rows that point at products
  const hasDocuments = db.select({ id: s.documents.id }).from(s.documents).limit(1).all().length > 0;

  return {
    present: products + groups + suppliers > 0,
    products,
    groups,
    suppliers,
    removable: products + groups + suppliers > 0 && !hasDocuments,
    blockedBySales: hasDocuments,
  };
}

export interface DemoRemoval {
  products: number;
  groups: number;
  suppliers: number;
  units: number;
  movements: number;
  codes: number;
}

/**
 * Delete every demo row, children first.
 *
 * Refused once any document exists. That is not caution for its own sake:
 * document_lines reference products, so removing a product a ticket sold would
 * either be refused by the foreign key or, worse, leave the books describing
 * something that no longer exists. The demo is for before the shop opens.
 */
export function removeDemoData(db: ArkomDb, ctx: MutationCtx): DemoRemoval {
  const status = demoStatus(db, ctx);
  if (status.blockedBySales) {
    throw appError(
      "VALIDATION",
      "No se pueden borrar los datos de demostración: ya hay tickets en esta caja.",
    );
  }
  if (!status.present) {
    throw appError("VALIDATION", "No hay datos de demostración que borrar.");
  }

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const demoProductIds = tx
      .select({ id: s.products.id })
      .from(s.products)
      .where(eq(s.products.isDemo, true))
      .all()
      .map((r: { id: string }) => r.id);

    const removed: DemoRemoval = {
      products: 0,
      groups: 0,
      suppliers: 0,
      units: 0,
      movements: 0,
      codes: 0,
    };

    // children first — nothing here is ON DELETE CASCADE, deliberately, so the
    // order of removal is written down rather than left to the database
    for (const productId of demoProductIds) {
      const units = tx.select().from(s.units).where(eq(s.units.productId, productId)).all();
      const movements = tx
        .select()
        .from(s.stockMovements)
        .where(eq(s.stockMovements.productId, productId))
        .all();
      const codes = tx.select().from(s.productCodes).where(eq(s.productCodes.productId, productId)).all();

      tx.delete(s.stockMovements).where(eq(s.stockMovements.productId, productId)).run();
      tx.delete(s.units).where(eq(s.units.productId, productId)).run();
      tx.delete(s.productCodes).where(eq(s.productCodes.productId, productId)).run();
      tx.delete(s.productStock).where(eq(s.productStock.productId, productId)).run();
      tx.delete(s.products).where(eq(s.products.id, productId)).run();

      removed.units += units.length;
      removed.movements += movements.length;
      removed.codes += codes.length;
      removed.products += 1;
      log({ entity: "product", entityId: productId, action: "delete", before: { isDemo: true }, after: null });
    }

    /* Groups are ADOPTED, not deleted (ADR-0017).
       On a v0.14.1 install they are already the shop's — is_demo = false — so
       this finds nothing. On a till set up before that, the five groups came in
       with the demo dataset, and deleting them here left a catalog with no
       shelf to put a product on and no way in the app to make one. Clearing the
       flag turns them into what they should always have been. */
    const adopted = tx.select().from(s.productGroups).where(eq(s.productGroups.isDemo, true)).all();
    for (const row of adopted as { id: string }[]) {
      log({
        entity: "product_group",
        entityId: row.id,
        action: "update",
        before: { isDemo: true },
        after: { isDemo: false },
      });
    }
    tx.update(s.productGroups).set({ isDemo: false }).where(eq(s.productGroups.isDemo, true)).run();

    for (const table of [{ t: s.suppliers, entity: "supplier", key: "suppliers" as const }]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = tx.select().from(table.t as any).where(eq((table.t as any).isDemo, true)).all();
      for (const row of rows as { id: string }[]) {
        log({ entity: table.entity, entityId: row.id, action: "delete", before: { isDemo: true }, after: null });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.delete(table.t as any).where(eq((table.t as any).isDemo, true)).run();
      removed[table.key] = rows.length;
    }

    return removed;
  });
}
