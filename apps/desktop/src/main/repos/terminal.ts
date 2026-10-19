/**
 * What this till is called — v1.4.0, ADR-0024 §1.
 *
 * A shop with two counters ended up with both called "Caja 2": the wizard
 * prefills a name, the second install accepted it, and there was no way to
 * change it afterwards. The name is the shop's word for a counter and is theirs
 * to change; the number SERIES is not, and nothing here touches it (ADR-0008).
 *
 * Written through `mutate()` like every other write. The oplog entry is what
 * carries the new name to the cloud, which shows it on the dashboard, and to
 * the shop's other tills, which show it beside a movement made here.
 */
import { eq } from "drizzle-orm";
import { appError, mutate, type MutationCtx } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";
import { resetTillContext } from "../context";

const { terminals } = schema;

export function renameTerminal(db: ArkomDb, ctx: MutationCtx, name: string): { name: string } {
  const next = name.trim();
  const current = db.select().from(terminals).where(eq(terminals.id, ctx.terminalId)).all()[0];
  if (!current) throw appError("VALIDATION", "terminal");

  /* nothing moved — no transaction, no empty oplog entry */
  if (current.name === next) return { name: next };

  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    tx.update(terminals).set({ name: next }).where(eq(terminals.id, ctx.terminalId)).run();
    log({
      entity: "terminal",
      entityId: ctx.terminalId,
      action: "rename",
      before: { name: current.name },
      after: { name: next },
    });
  });

  /* the till's identity is cached; the next screen must read the new name */
  resetTillContext();
  return { name: next };
}
