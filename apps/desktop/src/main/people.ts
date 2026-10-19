/**
 * Who someone is, and what a till is called, when the row was written at the
 * shop's OTHER till — ADR-0024 §2.
 *
 * A stock movement, a repair's technician, an approval or a customer call can
 * arrive from a sibling till carrying a user id this till's `users` table has
 * never held — staff are per-till, and must be, because a user row here is a
 * PIN that signs in here. So this till's own people are asked first, and the
 * names the cloud handed over with the last pull second. A name found only in
 * the second place is a label and nothing else: it grants no login, and it is
 * never written to a table.
 */
import { eq } from "drizzle-orm";
import { schema, type ArkomDb } from "@arkom/db";
import { readLink } from "./sync/link";

/** A person's name, from this till's own staff or the shop's list; NULL when nobody knows. */
export function personName(db: Pick<ArkomDb, "select">, userId: string | null | undefined): string | null {
  if (!userId) return null;
  const own = db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).all()[0];
  return own?.name ?? staffName(userId);
}

/** Only the shop's list — for a query that already joined this till's own `users`. */
export function staffName(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return readLink()?.directory.staff.find((p) => p.userId === userId)?.name ?? null;
}

/** What a sibling till is called, as it was last named; NULL when it is not known yet. */
export function tillName(terminalId: string | null | undefined): string | null {
  if (!terminalId) return null;
  return readLink()?.directory.tills.find((t) => t.terminalId === terminalId)?.name ?? null;
}
