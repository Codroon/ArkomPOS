/** Suppliers — list + inline create (req 6.3). Writes go through mutate(). */
import { and, asc, eq, sql } from "drizzle-orm";
import { appError, mutate, toOplogJson, uuidv7, type EntityRef, type MutationCtx } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";

const { suppliers } = schema;

export function listSuppliers(db: ArkomDb, ctx: MutationCtx): EntityRef[] {
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.tenantId, ctx.tenantId))
    .orderBy(asc(suppliers.name))
    .all();
}

export function createSupplier(db: ArkomDb, ctx: MutationCtx, name: string): EntityRef {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const trimmed = name.trim();
    const clash = tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, ctx.tenantId), sql`lower(${suppliers.name}) = lower(${trimmed})`))
      .all()[0];
    if (clash) throw appError("DUPLICATE_NAME", "Ya existe un proveedor con ese nombre.", "name");
    const supplier = { id: uuidv7(), tenantId: ctx.tenantId, name: trimmed, createdAt: new Date() };
    tx.insert(suppliers).values(supplier).run();
    log({ entity: "supplier", entityId: supplier.id, action: "create", before: null, after: toOplogJson(supplier) });
    return { id: supplier.id, name: supplier.name };
  });
}
