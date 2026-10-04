/**
 * `absorb()` — writing down what ANOTHER till decided. ADR-0022 §5–7.
 *
 * The sibling of `mutate()`, and the difference between them is the whole rule:
 *
 *   `mutate()` records what THIS till decided, and throws if a build writes no
 *   oplog entry, because a write that skips the audit trail is a bug (ADR-0005).
 *
 *   `absorb()` records what ANOTHER till decided, and asserts that NO oplog
 *   entry was written, because a replicated row is not a decision this till
 *   made.
 *
 * That second assertion is not tidiness. An oplog entry written here would be
 * pushed to the cloud, pulled by the till that originally wrote it, absorbed,
 * written again — an echo between two machines that never stops and grows a
 * shop's database until something falls over. It is the one mistake in this
 * design that would be both expensive and completely silent, so it is checked
 * rather than remembered.
 *
 * core stays SQL-free (system-design §2): the transaction, the row writes and
 * the oplog count are provided by the caller. What lives here is the ordering,
 * the fold, and the guarantee.
 */
import { applyRank } from "./share";
import { foldEntries, laterWins, type SyncOp } from "./sync";

/** A row of `sync_inbox`, as the applier sees it. */
export interface InboxEntry {
  opId: string;
  ingestSeq: number;
  tenantId: string;
  locationId: string;
  terminalId: string;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  userId: string | null;
  authorizedByUserId: string | null;
  createdAtMs: number;
}

/**
 * One row's worth of work: everything the batch says about a single
 * `(entity, entityId)`, reduced to what should be written.
 */
export interface AbsorbPlan {
  entity: string;
  entityId: string;
  tenantId: string;
  locationId: string;
  /** the till that wrote it — kept because some rows carry their author's terminal */
  terminalId: string;
  /** winning value per FIELD, folded by `(createdAtMs, opId)` */
  fields: Record<string, unknown>;
  /**
   * The newest `createdAt` among the folded entries.
   *
   * This is the staleness comparator. A till that was off for three days and
   * then pushes a rename it made on day one would otherwise overwrite a rename
   * another till made on day two, purely because it ARRIVED later. Where the
   * table has an `updated_at` column — products, customers and units, which are
   * the three shared tables anybody actually edits — the applier compares
   * against it and skips an entry that is older. Where it does not
   * (`product_group`, `supplier`), arrival order decides and a rename can lose,
   * which costs a label somebody retypes.
   */
  asOfMs: number;
  /** true when the latest word on this row is that it was deleted */
  deleted: boolean;
  /** every op that contributed, so they are all marked applied together */
  opIds: string[];
  /** the earliest arrival in the group — the tiebreak for apply order */
  ingestSeq: number;
}

/** What happened to one plan. A failure is a fact to record, never a throw. */
export type PlanOutcome = { applied: true } | { applied: false; reason: string };

export interface AbsorbRunner<TTx> {
  transaction<T>(fn: (tx: TTx) => T): T;
  /**
   * How many rows the oplog holds right now.
   *
   * Required, not optional: it is the only way to CHECK the rule rather than
   * trust that every future applier remembered it.
   */
  oplogCount(tx: TTx): number;
}

export interface AbsorbReport {
  applied: number;
  /** still pending — early, usually, and retried on the next pass */
  deferred: number;
  /** why each deferral happened, by opId, for the diagnostic in Ajustes */
  reasons: Record<string, string>;
}

/**
 * Group a batch into one plan per row, in the order sqlite will accept.
 *
 * Two things happen here that are easy to get wrong:
 *
 * **Grouping is by `entityId`, never by `after.id`.** The till pushes CHANGES,
 * not rows, so a payload can be `{status}` with no id in it at all. Keying on
 * the payload would collapse every partial entry into one group — the bug
 * `pnpm cloud:reconcile` caught in the cloud's read model, which would be worse
 * here because it would write them to one row.
 *
 * **A delete is decided by the LATEST entry, not by the fold.** `foldEntries()`
 * skips a null payload, so a create-then-delete pair would otherwise fold to
 * the created fields and the deletion would vanish.
 */
export function planAbsorb(entries: readonly InboxEntry[]): AbsorbPlan[] {
  const groups = new Map<string, InboxEntry[]>();
  for (const entry of entries) {
    const key = `${entry.entity}\u0000${entry.entityId}`;
    const held = groups.get(key);
    if (held) held.push(entry);
    else groups.set(key, [entry]);
  }

  const plans: AbsorbPlan[] = [];
  for (const group of groups.values()) {
    const latest = group.reduce((best, entry) =>
      laterWins({ createdAtMs: entry.createdAtMs, opId: entry.opId }, { createdAtMs: best.createdAtMs, opId: best.opId })
        ? entry
        : best,
    );

    plans.push({
      entity: latest.entity,
      entityId: latest.entityId,
      tenantId: latest.tenantId,
      locationId: latest.locationId,
      terminalId: latest.terminalId,
      fields: foldEntries(group as unknown as SyncOp[]),
      asOfMs: latest.createdAtMs,
      deleted: latest.after === null,
      opIds: group.map((e) => e.opId),
      ingestSeq: group.reduce((min, e) => (e.ingestSeq < min ? e.ingestSeq : min), Infinity),
    });
  }

  /* dependency order first (ADR-0022 §1), then arrival, so a parent row lands
     before the row that references it and a batch is otherwise applied in the
     order the shop did the work */
  return plans.sort(
    (a, b) => applyRank(a.entity) - applyRank(b.entity) || a.ingestSeq - b.ingestSeq,
  );
}

/**
 * Apply a batch, one row per transaction, and prove nothing was logged.
 *
 * **One transaction per plan, deliberately.** A batch wrapped in a single
 * transaction would mean one row that can never land — a `unit` belonging to a
 * used purchase this till does not replicate — rolling back every good row
 * beside it, forever, on every pass. Per-row, a failure costs that row and the
 * rest of the shop's catalogue arrives.
 *
 * `write` throws to defer. A foreign-key error IS the deferral: it means the
 * parent has not landed yet, which on the next pass it will have.
 */
export function absorb<TTx>(
  runner: AbsorbRunner<TTx>,
  plans: readonly AbsorbPlan[],
  write: (tx: TTx, plan: AbsorbPlan) => void,
): AbsorbReport {
  const report: AbsorbReport = { applied: 0, deferred: 0, reasons: {} };

  for (const plan of plans) {
    try {
      runner.transaction((tx) => {
        const before = runner.oplogCount(tx);
        write(tx, plan);
        const after = runner.oplogCount(tx);
        if (after !== before) {
          /* aborts the transaction. An echo would be silent and permanent, so
             this refuses to be the thing that starts one (ADR-0022 §6). */
          throw new Error(
            `absorb(): write() logged ${after - before} oplog entr${after - before === 1 ? "y" : "ies"} ` +
              `for ${plan.entity}/${plan.entityId} — a replicated row is not this till's decision (ADR-0022 §6)`,
          );
        }
      });
      report.applied += 1;
    } catch (err) {
      report.deferred += 1;
      const reason = err instanceof Error ? err.message : "unknown error";
      for (const opId of plan.opIds) report.reasons[opId] = reason;
    }
  }

  return report;
}
