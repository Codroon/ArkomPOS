/**
 * The Postgres side of `AccountStore` — ADR-0021 §5.
 *
 * One thing here has to be atomic: creating an account and its first member.
 * An account with nobody in it is exactly the thing `attachAccount` treats as
 * adoptable, so leaving one behind after a half-failed signup would leave a
 * shop's account claimable by the next person to type that address.
 */
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "@arkom/core";
import type { AccountStore } from "../auth/account";
import { db as defaultDb, type CloudDb } from "./client";
import { accountMembers, accounts } from "./schema";

export function pgAccounts(handle?: CloudDb): AccountStore {
  const db = () => handle ?? defaultDb();

  return {
    async memberFor(authUserId) {
      const rows = await db()
        .select({
          accountId: accountMembers.accountId,
          authUserId: accountMembers.authUserId,
          role: accountMembers.role,
        })
        .from(accountMembers)
        .where(eq(accountMembers.authUserId, authUserId))
        .limit(1);
      return rows[0] ?? null;
    },

    async accountByEmail(email) {
      const rows = await db()
        .select({
          id: accounts.id,
          name: accounts.name,
          email: accounts.email,
          licenceState: accounts.licenceState,
          memberCount: sql<number>`(
            select count(*)::int from ${accountMembers}
            where ${accountMembers.accountId} = ${accounts.id}
          )`,
        })
        .from(accounts)
        .where(eq(accounts.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async createAccountWithOwner({ authUserId, email, name }) {
      const id = uuidv7();
      await db().transaction(async (tx) => {
        await tx.insert(accounts).values({ id, name, email });
        await tx.insert(accountMembers).values({ accountId: id, authUserId, role: "owner" });
      });
      return id;
    },

    async addMember({ accountId, authUserId, role }) {
      await db()
        .insert(accountMembers)
        .values({ accountId, authUserId, role })
        /* signing in twice at once, or a retried callback: the second one is a
           no-op rather than a duplicate-key page nobody can act on */
        .onConflictDoNothing({ target: [accountMembers.accountId, accountMembers.authUserId] });
    },
  };
}

/** What the panel needs to greet somebody: their account, via their identity. */
export async function accountForUser(
  authUserId: string,
  handle?: CloudDb,
): Promise<{ id: string; name: string; email: string; licenceState: string; role: string } | null> {
  const db = handle ?? defaultDb();
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      email: accounts.email,
      licenceState: accounts.licenceState,
      role: accountMembers.role,
    })
    .from(accountMembers)
    .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
    .where(and(eq(accountMembers.authUserId, authUserId)))
    .limit(1);
  return rows[0] ?? null;
}
