/**
 * The reports — ADR-0016.
 *
 * Every function here is a SQL aggregate that returns rows already in the shape
 * the table renders. Nothing in this file writes, so any report can be run
 * twice; nothing in this file re-implements money, because the totals it
 * produces are asserted against the Z snapshot, the Inventario header and the
 * collection documents.
 *
 * Two rules run through all of it:
 *
 *   - **`status = 'completed'`, dated by `completed_at`.** A draft is a ticket
 *     somebody is still building and a parked sale is one nobody has paid for.
 *     `created_at` answers "when did someone start typing", which is not a
 *     question anybody asks about money.
 *   - **Cost comes from the line's own snapshot when it has one**, and falls
 *     back to the product's CURRENT cost when it does not — flagged, counted and
 *     never silent (§2).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { ArkomDb } from "@arkom/db";
import * as schema from "@arkom/db/schema";
import {
  isSerializedItem,
  daysBetween,
  marginCentsOf,
  marginPctOf,
  repairStatus,
  type CostEstimate,
  type MutationCtx,
  type SalesGroupBy,
} from "@arkom/core";

const {
  documents,
  documentLines,
  documentTenders,
  productGroups,
  products,
  productStock,
  repairLines,
  repairTickets,
  customers,
  shifts,
  storeCreditVouchers,
  units,
  usedPurchases,
  users,
} = schema;

type Reader = Pick<ArkomDb, "select">;

/**
 * The cost of one line, in cents, as SQL — **snapshotted lines only**.
 *
 * A line written before v0.14.0 carries no cost, and the report no longer
 * substitutes the product's current cost into the arithmetic. Mixing a real
 * figure with a guess produces a third thing that is neither, and a margin
 * column the shop cannot act on is worse than an empty one: it invites a
 * decision about pricing from a number that is partly about last week's
 * purchase invoice.
 *
 * So a row containing ANY unsnapshotted line reports `—` for cost, margin and
 * margin %, and contributes nothing to the totals. The caption says how many.
 */
const lineCostSql = sql<number>`
  case when ${documentLines.unitCostCents} is not null
    then ${documentLines.unitCostCents} * ${documentLines.qty}
    else 0 end
`;

/** How many of the lines in scope had to guess. */
function costEstimate(db: Reader, where: ReturnType<typeof and>): CostEstimate {
  const row = db
    .select({
      exact: sql<number>`coalesce(sum(case when ${documentLines.unitCostCents} is not null then 1 else 0 end), 0)`,
      estimated: sql<number>`coalesce(sum(case when ${documentLines.unitCostCents} is null then 1 else 0 end), 0)`,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .leftJoin(products, eq(products.id, documentLines.productId))
    .where(where)
    .all()[0];
  return { exactLines: row?.exact ?? 0, estimatedLines: row?.estimated ?? 0 };
}

/* ======================================================== sales ======== */

export interface SalesFilters {
  fromMs: number;
  toMs: number;
  shiftId?: string | null;
  groupBy: SalesGroupBy;
}

/** Completed sale documents inside the window (or inside one shift). */
function salesWhere(ctx: MutationCtx, f: { fromMs: number; toMs: number; shiftId?: string | null }) {
  const base = [
    eq(documents.tenantId, ctx.tenantId),
    eq(documents.status, "completed"),
    /* Tickets AND refunds. A `purchase` is money going OUT and a `repair`
       document is a record of custody with a zero total; the T1- a repair
       collection creates is a ticket, so repairs' revenue is already here
       (ADR-0016 §1).
       A refund document's lines and totals are NEGATIVE, so including it here
       is what makes every figure on every sales report net of refunds without
       a single subtraction written anywhere (ADR-0019). */
    inArray(documents.docType, ["ticket", "refund"]),
  ];
  if (f.shiftId) return and(...base, eq(documents.shiftId, f.shiftId));
  return and(...base, gte(documents.completedAt, new Date(f.fromMs)), lt(documents.completedAt, new Date(f.toMs)));
}

export interface SalesSummary {
  tickets: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
  averageTicketCents: number;
  /** margin-scheme sales, on their own line because they carry no VAT */
  usedSalesCents: number;
  /** what was handed back, POSITIVE — already netted out of the figures above */
  refundsCents: number;
  refundCount: number;
}

export function salesSummary(db: Reader, ctx: MutationCtx, f: Omit<SalesFilters, "groupBy">): SalesSummary {
  const where = salesWhere(ctx, f);
  const doc = db
    .select({
      /* tickets, not documents: a refund is not a sale, and dividing gross by a
         count that includes them would report a nonsense average */
      tickets: sql<number>`coalesce(sum(case when ${documents.docType} = 'ticket' then 1 else 0 end), 0)`,
      netCents: sql<number>`coalesce(sum(${documents.subtotalCents}), 0)`,
      taxCents: sql<number>`coalesce(sum(${documents.taxCents}), 0)`,
      grossCents: sql<number>`coalesce(sum(${documents.totalCents}), 0)`,
      refundCount: sql<number>`coalesce(sum(case when ${documents.docType} = 'refund' then 1 else 0 end), 0)`,
      refundsCents: sql<number>`coalesce(-sum(case when ${documents.docType} = 'refund' then ${documents.totalCents} else 0 end), 0)`,
    })
    .from(documents)
    .where(where)
    .all()[0]!;

  const used = db
    .select({ cents: sql<number>`coalesce(sum(${documentLines.totalCents}), 0)` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(where, eq(documentLines.taxRegime, "REBU")))
    .all()[0]!;

  return {
    tickets: doc.tickets,
    netCents: doc.netCents,
    taxCents: doc.taxCents,
    grossCents: doc.grossCents,
    averageTicketCents: doc.tickets > 0 ? Math.round(doc.grossCents / doc.tickets) : 0,
    usedSalesCents: used.cents,
    refundsCents: doc.refundsCents,
    refundCount: doc.refundCount,
  };
}

export interface SalesRow {
  key: string;
  label: string;
  count: number;
  qty: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
  /** present only with reports.costs; null when the row contains a pre-v0.14.0 line */
  estimated?: boolean;
  costCents?: number | null;
  marginCents?: number | null;
  marginPct?: number | null;
}

/** The group a repair collection's lines are filed under on this report. */
export const REPAIR_GROUP_LABEL = "Reparaciones";

export function salesRows(db: Reader, ctx: MutationCtx, f: SalesFilters, withCosts: boolean): SalesRow[] {
  const where = salesWhere(ctx, f);

  /* Day and user group the DOCUMENTS; the rest group the LINES. Grouping a
     document by product would need a product per document, which is not a thing
     a mixed ticket has. */
  if (f.groupBy === "day" || f.groupBy === "user") {
    const key =
      f.groupBy === "day"
        ? sql<string>`strftime('%Y-%m-%d', ${documents.completedAt} / 1000, 'unixepoch', 'localtime')`
        : sql<string>`coalesce(${documents.userId}, '')`;
    const rows = db
      .select({
        key,
        label: f.groupBy === "day" ? key : sql<string>`coalesce(${users.name}, '—')`,
        count: sql<number>`count(*)`,
        netCents: sql<number>`coalesce(sum(${documents.subtotalCents}), 0)`,
        taxCents: sql<number>`coalesce(sum(${documents.taxCents}), 0)`,
        grossCents: sql<number>`coalesce(sum(${documents.totalCents}), 0)`,
      })
      .from(documents)
      .leftJoin(users, eq(users.id, documents.userId))
      .where(where)
      .groupBy(key)
      .orderBy(f.groupBy === "day" ? asc(key) : desc(sql`sum(${documents.totalCents})`))
      .all();
    return rows.map((r) => ({ ...r, qty: 0 }));
  }

  if (f.groupBy === "method") {
    const rows = db
      .select({
        key: documentTenders.method,
        label: documentTenders.method,
        count: sql<number>`count(*)`,
        grossCents: sql<number>`coalesce(sum(${documentTenders.amountCents}), 0)`,
      })
      .from(documentTenders)
      .innerJoin(documents, eq(documents.id, documentTenders.documentId))
      .where(where)
      .groupBy(documentTenders.method)
      .orderBy(desc(sql`sum(${documentTenders.amountCents})`))
      .all();
    /* A tender is an amount, not a taxable base: splitting one payment across
       net and VAT would invent a breakdown the document already owns. */
    return rows.map((r) => ({ ...r, qty: 0, netCents: 0, taxCents: 0 }));
  }

  /* ---- by product, or by product group ---- */
  const byProduct = f.groupBy === "product";
  const key = byProduct
    ? sql<string>`coalesce(${documentLines.productId}, '')`
    : sql<string>`coalesce(${products.groupId}, case when ${documentLines.productId} is null then 'repair' else '' end)`;
  const label = byProduct
    ? sql<string>`${documentLines.description}`
    : sql<string>`coalesce(${productGroups.name}, ${REPAIR_GROUP_LABEL})`;
  /* the same row in the shop's other language. A product description is the
     shop's own words and has only one; a GROUP has two, and the English till
     must not print Spanish shelves (ADR-0017 A1). */
  const labelEn = byProduct ? sql<string | null>`null` : sql<string | null>`${productGroups.nameEn}`;

  const rows = db
    .select({
      key,
      label: sql<string>`min(${label})`,
      labelEn: sql<string | null>`min(${labelEn})`,
      count: sql<number>`count(distinct ${documentLines.documentId})`,
      qty: sql<number>`coalesce(sum(${documentLines.qty}), 0)`,
      netCents: sql<number>`coalesce(sum(${documentLines.baseCents}), 0)`,
      taxCents: sql<number>`coalesce(sum(${documentLines.taxCents}), 0)`,
      grossCents: sql<number>`coalesce(sum(${documentLines.totalCents}), 0)`,
      costCents: sql<number>`coalesce(sum(${lineCostSql}), 0)`,
      estimatedLines: sql<number>`coalesce(sum(case when ${documentLines.unitCostCents} is null then 1 else 0 end), 0)`,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .leftJoin(products, eq(products.id, documentLines.productId))
    .leftJoin(productGroups, eq(productGroups.id, products.groupId))
    .where(where)
    .groupBy(key)
    .orderBy(desc(sql`sum(${documentLines.totalCents})`))
    .all();

  return rows.map((r) => {
    const base = {
      key: r.key,
      label: r.label,
      labelEn: r.labelEn,
      count: r.count,
      qty: r.qty,
      netCents: r.netCents,
      taxCents: r.taxCents,
      grossCents: r.grossCents,
    };
    /* omitted, not blanked: a caller without the permission receives a row that
       has no cost field at all (ADR-0016 §7) */
    if (!withCosts) return base;
    /* one unsnapshotted line makes the whole row's cost unknowable, so it says
       so rather than reporting a figure that is part guess (ADR-0016 §2) */
    if (r.estimatedLines > 0) {
      return { ...base, estimated: true, costCents: null, marginCents: null, marginPct: null };
    }
    return {
      ...base,
      estimated: false,
      costCents: r.costCents,
      marginCents: marginCentsOf(r.grossCents, r.costCents),
      marginPct: marginPctOf(r.grossCents, r.costCents),
    };
  });
}

export function salesEstimate(db: Reader, ctx: MutationCtx, f: Omit<SalesFilters, "groupBy">): CostEstimate {
  return costEstimate(db, salesWhere(ctx, f));
}

/** The drill-down: a day's or a user's tickets, or one product's lines. */
export function salesDetail(
  db: Reader,
  ctx: MutationCtx,
  f: Omit<SalesFilters, "groupBy"> & { kind: "day" | "user" | "product"; key: string },
) {
  const where = salesWhere(ctx, f);
  if (f.kind === "product") {
    return db
      .select({
        documentId: documentLines.documentId,
        docNumber: documents.docNumber,
        atMs: sql<number>`${documents.completedAt}`,
        description: documentLines.description,
        qty: documentLines.qty,
        totalCents: documentLines.totalCents,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(where, eq(documentLines.productId, f.key)))
      .orderBy(desc(documents.completedAt))
      .limit(500)
      .all();
  }
  const scope =
    f.kind === "day"
      ? sql`strftime('%Y-%m-%d', ${documents.completedAt} / 1000, 'unixepoch', 'localtime') = ${f.key}`
      : sql`coalesce(${documents.userId}, '') = ${f.key}`;
  return db
    .select({
      documentId: documents.id,
      docNumber: documents.docNumber,
      atMs: sql<number>`${documents.completedAt}`,
      description: sql<string>`coalesce(${users.name}, '—')`,
      qty: sql<number>`0`,
      totalCents: documents.totalCents,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.userId))
    .where(and(where, scope))
    .orderBy(desc(documents.completedAt))
    .limit(500)
    .all();
}

/* ====================================================== repairs ======== */

export interface RepairOpenRow {
  ticketId: string;
  docNumber: string | null;
  customerName: string;
  device: string;
  status: string;
  daysInStatus: number;
  daysSinceIntake: number;
  technicianName: string | null;
  promisedAtMs: number | null;
  promisedHalf: string | null;
  overdue: boolean;
}

const CLOSED_STATUSES = ["collected", "not_repaired"];

export function repairsOpen(
  db: Reader,
  ctx: MutationCtx,
  f: { status?: string | null; technicianId?: string | null },
  now = Date.now(),
) {
  const conds = [eq(repairTickets.tenantId, ctx.tenantId), sql`${repairTickets.status} not in ('collected','not_repaired')`];
  if (f.status) conds.push(eq(repairTickets.status, f.status as never));
  if (f.technicianId === "unassigned") conds.push(isNull(repairTickets.assignedUserId));
  else if (f.technicianId) conds.push(eq(repairTickets.assignedUserId, f.technicianId));

  const rows = db
    .select({
      ticketId: repairTickets.id,
      docNumber: documents.docNumber,
      customerName: customers.name,
      device: repairTickets.deviceDescription,
      status: repairTickets.status,
      updatedAt: repairTickets.updatedAt,
      createdAt: repairTickets.createdAt,
      technicianName: users.name,
      promisedDate: repairTickets.promisedDate,
      promisedHalf: repairTickets.promisedHalf,
    })
    .from(repairTickets)
    .leftJoin(documents, eq(documents.id, repairTickets.documentId))
    .leftJoin(customers, eq(customers.id, repairTickets.customerId))
    .leftJoin(users, eq(users.id, repairTickets.assignedUserId))
    .where(and(...conds))
    .orderBy(asc(repairTickets.createdAt))
    .all();

  return rows.map<RepairOpenRow>((r) => ({
    ticketId: r.ticketId,
    docNumber: r.docNumber,
    customerName: r.customerName ?? "—",
    device: r.device,
    status: r.status,
    daysInStatus: daysBetween(r.updatedAt.getTime(), now),
    daysSinceIntake: daysBetween(r.createdAt.getTime(), now),
    technicianName: r.technicianName,
    promisedAtMs: r.promisedDate?.getTime() ?? null,
    promisedHalf: r.promisedHalf,
    /* the same rule the board uses: promised in the past and still in the shop */
    overdue: r.promisedDate !== null && r.promisedDate.getTime() < now,
  }));
}

export interface RepairsOpenSummary {
  open: number;
  overdue: number;
  /** quoted = the shop is waiting on the CUSTOMER, and the pile grows silently */
  waitingOnCustomer: number;
  oldest: { docNumber: string | null; days: number } | null;
}

export function repairsOpenSummary(rows: ReadonlyArray<RepairOpenRow>): RepairsOpenSummary {
  const oldest = rows.reduce<RepairOpenRow | null>(
    (best, row) => (best === null || row.daysSinceIntake > best.daysSinceIntake ? row : best),
    null,
  );
  return {
    open: rows.length,
    overdue: rows.filter((r) => r.overdue).length,
    waitingOnCustomer: rows.filter((r) => r.status === "quoted").length,
    oldest: oldest ? { docNumber: oldest.docNumber, days: oldest.daysSinceIntake } : null,
  };
}

export interface RepairClosedRow {
  ticketId: string;
  docNumber: string | null;
  collectionNumber: string | null;
  customerName: string;
  device: string;
  intakeAtMs: number;
  collectedAtMs: number | null;
  turnaroundDays: number | null;
  revenueCents: number;
  partsCostCents: number;
  laborCents: number;
  marginCents: number;
  technicianName: string | null;
}

export function repairsClosed(db: Reader, ctx: MutationCtx, f: { fromMs: number; toMs: number }) {
  const rows = db
    .select({
      ticketId: repairTickets.id,
      docNumber: documents.docNumber,
      customerName: customers.name,
      device: repairTickets.deviceDescription,
      createdAt: repairTickets.createdAt,
      technicianName: users.name,
      collectionId: repairTickets.collectionDocumentId,
    })
    .from(repairTickets)
    .leftJoin(documents, eq(documents.id, repairTickets.documentId))
    .leftJoin(customers, eq(customers.id, repairTickets.customerId))
    .leftJoin(users, eq(users.id, repairTickets.assignedUserId))
    .where(and(eq(repairTickets.tenantId, ctx.tenantId), isNotNull(repairTickets.collectionDocumentId)))
    .all();

  const collectionIds = rows.map((r) => r.collectionId!).filter(Boolean);
  const collections = collectionIds.length
    ? db
        .select({
          id: documents.id,
          docNumber: documents.docNumber,
          completedAt: documents.completedAt,
          totalCents: documents.totalCents,
        })
        .from(documents)
        .where(
          and(
            inArray(documents.id, collectionIds),
            eq(documents.status, "completed"),
            gte(documents.completedAt, new Date(f.fromMs)),
            lt(documents.completedAt, new Date(f.toMs)),
          ),
        )
        .all()
    : [];
  const byId = new Map(collections.map((c) => [c.id, c]));

  const out: RepairClosedRow[] = [];
  for (const r of rows) {
    const collection = byId.get(r.collectionId!);
    if (!collection || collection.completedAt === null) continue; // outside the period

    const lines = db
      .select({ kind: repairLines.kind, qty: repairLines.qty, unitCost: repairLines.unitCostCents, charge: repairLines.chargeCents })
      .from(repairLines)
      .where(eq(repairLines.ticketId, r.ticketId))
      .all();
    const partsCostCents = lines
      .filter((l) => l.kind !== "labor")
      .reduce((sum, l) => sum + (l.unitCost ?? 0) * l.qty, 0);
    const laborCents = lines.filter((l) => l.kind === "labor").reduce((sum, l) => sum + l.charge, 0);

    out.push({
      ticketId: r.ticketId,
      docNumber: r.docNumber,
      collectionNumber: collection.docNumber,
      customerName: r.customerName ?? "—",
      device: r.device,
      intakeAtMs: r.createdAt.getTime(),
      collectedAtMs: collection.completedAt.getTime(),
      turnaroundDays: daysBetween(r.createdAt.getTime(), collection.completedAt.getTime()),
      revenueCents: collection.totalCents,
      partsCostCents,
      laborCents,
      marginCents: marginCentsOf(collection.totalCents, partsCostCents),
      technicianName: r.technicianName,
    });
  }
  return out.sort((a, b) => (b.collectedAtMs ?? 0) - (a.collectedAtMs ?? 0));
}

export function notRepairedInPeriod(db: Reader, ctx: MutationCtx, f: { fromMs: number; toMs: number }) {
  return db
    .select({ reason: repairTickets.notRepairedReason, count: sql<number>`count(*)` })
    .from(repairTickets)
    .where(
      and(
        eq(repairTickets.tenantId, ctx.tenantId),
        isNotNull(repairTickets.notRepairedAt),
        gte(repairTickets.notRepairedAt, new Date(f.fromMs)),
        lt(repairTickets.notRepairedAt, new Date(f.toMs)),
      ),
    )
    .groupBy(repairTickets.notRepairedReason)
    .all();
}

/* ================================================ used holding ========= */

export interface UsedHoldingRow {
  purchaseId: string;
  docNumber: string | null;
  model: string;
  grade: string | null;
  state: "held" | "needs_review" | "in_stock";
  costCents: number;
  salePriceCents: number | null;
  daysHeld: number;
}

export function usedHolding(
  db: Reader,
  ctx: MutationCtx,
  f: { status?: string | null; grade?: string | null },
  now = Date.now(),
) {
  const rows = db
    .select({
      purchaseId: usedPurchases.id,
      docNumber: documents.docNumber,
      brand: usedPurchases.brand,
      model: usedPurchases.model,
      storage: usedPurchases.storage,
      grade: usedPurchases.grade,
      needsReview: usedPurchases.needsReview,
      buyPriceCents: usedPurchases.buyPriceCents,
      refurbCostCents: usedPurchases.refurbCostCents,
      purchasedAt: usedPurchases.purchasedAt,
      unitStatus: units.status,
      unitCostCents: units.costCents,
      salePriceCents: units.salePriceCents,
    })
    .from(usedPurchases)
    .leftJoin(documents, eq(documents.id, usedPurchases.documentId))
    .leftJoin(units, eq(units.purchaseId, usedPurchases.id))
    .where(and(eq(usedPurchases.tenantId, ctx.tenantId), sql`${units.status} in ('held','in_stock','reserved')`))
    .all();

  const mapped = rows.map<UsedHoldingRow>((r) => ({
    purchaseId: r.purchaseId,
    docNumber: r.docNumber,
    model: [r.brand, r.model, r.storage].filter(Boolean).join(" "),
    grade: r.grade,
    /* the same derivation the Dispositivos usados list uses: a device under
       review is still simply held, and the flag is what distinguishes it */
    state: r.unitStatus === "held" ? (r.needsReview ? "needs_review" : "held") : "in_stock",
    /* the unit's own cost when it has been shelved (buy + refurb, folded in at
       that moment), otherwise the purchase's two figures added */
    costCents: r.unitStatus === "held" ? r.buyPriceCents + r.refurbCostCents : (r.unitCostCents ?? 0),
    salePriceCents: r.salePriceCents,
    daysHeld: daysBetween(r.purchasedAt.getTime(), now),
  }));

  const filtered = mapped.filter(
    (r) => (!f.status || r.state === f.status) && (!f.grade || r.grade === f.grade),
  );
  // oldest first: the oldest held device is the question this report answers
  return filtered.sort((a, b) => b.daysHeld - a.daysHeld);
}

export function storeCreditOutstanding(db: Reader, ctx: MutationCtx) {
  const row = db
    .select({
      count: sql<number>`count(*)`,
      totalCents: sql<number>`coalesce(sum(${storeCreditVouchers.remainingCents}), 0)`,
    })
    .from(storeCreditVouchers)
    .where(and(eq(storeCreditVouchers.tenantId, ctx.tenantId), eq(storeCreditVouchers.status, "issued")))
    .all()[0]!;
  return row;
}

/* ================================================== valuation ========== */

/**
 * The Inventario screen's own expression, deliberately identical.
 *
 * Serialized products are worth the sum of their in-stock units' own costs —
 * five identical phones bought at three prices have no single unit cost, and a
 * used device in stock carries buy + refurb in exactly this column. Everything
 * else is on-hand × last cost.
 *
 * If this ever stops matching `inventory.ts`, one of the two screens is lying
 * and the shop cannot tell which. A test pins them together.
 */
const unitValuationSql = sql<number>`(
  select coalesce(sum(${units.costCents}), 0) from ${units}
  where ${units.productId} = ${products.id} and ${units.status} = 'in_stock'
)`;

const valuationSql = sql<number>`case when ${products.itemType} = 'serialized'
  then ${unitValuationSql}
  else coalesce(${productStock.onHand}, 0) * coalesce(${products.costCents}, 0) end`;

export function valuation(db: Reader, ctx: MutationCtx, f: { groupId?: string | null }) {
  const conds = [eq(products.tenantId, ctx.tenantId)];
  if (f.groupId) conds.push(eq(products.groupId, f.groupId));

  const rows = db
    .select({
      productId: products.id,
      name: products.name,
      groupId: products.groupId,
      groupName: productGroups.name,
      groupNameEn: productGroups.nameEn,
      itemType: products.itemType,
      onHand: sql<number>`coalesce(${productStock.onHand}, 0)`,
      unitCostCents: products.costCents,
      valueCents: valuationSql,
    })
    .from(products)
    .leftJoin(productGroups, eq(products.groupId, productGroups.id))
    .leftJoin(productStock, and(eq(productStock.productId, products.id), eq(productStock.locationId, ctx.locationId)))
    .where(and(...conds))
    .orderBy(asc(products.name))
    .all();

  const withStock = rows.filter((r) => r.onHand > 0 || r.valueCents > 0);
  const totalCents = withStock.reduce((sum, r) => sum + r.valueCents, 0);

  const groups = new Map<
    string,
    { groupId: string | null; groupName: string | null; groupNameEn: string | null; qty: number; valueCents: number }
  >();
  for (const r of withStock) {
    const key = r.groupId ?? "";
    const entry = groups.get(key) ?? {
      groupId: r.groupId,
      groupName: r.groupName,
      groupNameEn: r.groupNameEn,
      qty: 0,
      valueCents: 0,
    };
    entry.qty += r.onHand;
    entry.valueCents += r.valueCents;
    groups.set(key, entry);
  }

  return {
    totalCents,
    groups: [...groups.values()].sort((a, b) => b.valueCents - a.valueCents),
    products: withStock.map((r) => ({
      productId: r.productId,
      name: r.name,
      groupName: r.groupName,
      groupNameEn: r.groupNameEn,
      onHand: r.onHand,
      /* serialized rows show no single unit cost, because they have none */
      unitCostCents: isSerializedItem(r.itemType) ? null : r.unitCostCents,
      valueCents: r.valueCents,
    })),
  };
}

/* ================================================== dead stock ========= */

export interface DeadStockRow {
  productId: string;
  name: string;
  /** null = the product has no group. The reader words that, not this. */
  groupName: string | null;
  groupNameEn: string | null;
  onHand: number;
  costTiedUpCents: number;
  lastSaleAtMs: number | null;
  daysSinceSale: number | null;
}

/**
 * Products holding stock that nothing has sold in N days.
 *
 * The boundary is inclusive — a product last sold exactly N days ago is dead —
 * because "no sale in 90 days" is how the shop says it, and a strict comparison
 * would put the answer one day out from the question.
 *
 * Used devices are absent by design: the holding report covers them, and a used
 * phone unsold for 90 days is a different conversation from 40 unsold cases.
 */
export function deadStock(
  db: Reader,
  ctx: MutationCtx,
  f: { groupId?: string | null; thresholdDays: number },
  now = Date.now(),
): DeadStockRow[] {
  const cutoff = now - f.thresholdDays * 86_400_000;
  const conds = [eq(products.tenantId, ctx.tenantId)];
  if (f.groupId) conds.push(eq(products.groupId, f.groupId));

  const rows = db
    .select({
      productId: products.id,
      name: products.name,
      groupName: productGroups.name,
      groupNameEn: productGroups.nameEn,
      itemType: products.itemType,
      onHand: sql<number>`coalesce(${productStock.onHand}, 0)`,
      valueCents: valuationSql,
      lastSale: sql<number | null>`(
        select max(${documents.completedAt}) from ${documentLines}
        join ${documents} on ${documents.id} = ${documentLines.documentId}
        where ${documentLines.productId} = ${products.id} and ${documents.status} = 'completed'
      )`,
    })
    .from(products)
    .leftJoin(productGroups, eq(products.groupId, productGroups.id))
    .leftJoin(productStock, and(eq(productStock.productId, products.id), eq(productStock.locationId, ctx.locationId)))
    .where(and(...conds))
    .all();

  return rows
    .filter((r) => r.onHand > 0)
    /* keyed on the ITEM TYPE, never on the name: a shop can rename a product,
       and a report that changes its mind because somebody fixed a typo is not a
       report (ADR-0013 amendment) */
    .filter((r) => r.itemType !== "used_device")
    .filter((r) => r.lastSale === null || r.lastSale <= cutoff)
    .map<DeadStockRow>((r) => ({
      productId: r.productId,
      name: r.name,
      groupName: r.groupName,
      groupNameEn: r.groupNameEn,
      onHand: r.onHand,
      costTiedUpCents: r.valueCents,
      lastSaleAtMs: r.lastSale,
      daysSinceSale: r.lastSale === null ? null : daysBetween(r.lastSale, now),
    }))
    /* by money, not by count: 40 unsold cases at 2 € are a tidy-up, and one
       unsold laptop at 900 € is the reason this page exists */
    .sort((a, b) => b.costTiedUpCents - a.costTiedUpCents);
}

/* ======================================================== the hub ====== */

export function hub(db: Reader, ctx: MutationCtx, withCosts: boolean, thresholdDays: number, now = Date.now()) {
  const monthFrom = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const tomorrow = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1).getTime();

  const sales = salesSummary(db, ctx, { fromMs: monthFrom, toMs: tomorrow });
  const open = repairsOpen(db, ctx, {}, now);

  return {
    salesNetCents: sales.netCents,
    repairsOpen: open.length,
    repairsOverdue: open.filter((r) => r.overdue).length,
    /* the three cost-bearing headlines are null rather than zero without the
       permission: zero is a number, and a wrong one */
    usedUnits: withCosts ? usedHolding(db, ctx, {}, now).length : null,
    usedCostCents: withCosts ? usedHolding(db, ctx, {}, now).reduce((s, r) => s + r.costCents, 0) : null,
    valuationCents: withCosts ? valuation(db, ctx, {}).totalCents : null,
    deadStockCount: withCosts ? deadStock(db, ctx, { thresholdDays }, now).length : null,
  };
}

/** Closed shifts, newest first — the Sales report's shift picker. */
export function shiftOptions(db: Reader, ctx: MutationCtx) {
  return db
    .select({ id: shifts.id, zDocNumber: shifts.zDocNumber, closedAt: shifts.closedAt, openedAt: shifts.openedAt })
    .from(shifts)
    .where(and(eq(shifts.terminalId, ctx.terminalId), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.openedAt))
    .limit(60)
    .all()
    .map((r) => ({ id: r.id, zDocNumber: r.zDocNumber, atMs: (r.closedAt ?? r.openedAt).getTime() }));
}

export { repairStatus };
