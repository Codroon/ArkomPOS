/**
 * Turning a Supabase identity into an account — ADR-0021 §1 and §5.
 *
 * Signing up creates two things that are deliberately not the same thing: an
 * **identity** (email and password, Supabase's problem, never ours) and an
 * **account** (who Codroon has a relationship with, which shops belong to it,
 * and whether it has paid). This file is the join between them, and it is pure
 * so that the one rule worth arguing about can be tested without a database:
 *
 *   **who is allowed to end up inside an existing account.**
 *
 * An account can already exist before anybody signs up — Codroon creates one
 * with `cloud:code` when it sells a till. So a signup whose email matches an
 * account with NO members adopts it. That is only safe because Supabase is
 * configured to confirm email addresses: the address has been proven to belong
 * to whoever is holding it. With confirmations off, adopting would mean anybody
 * could claim any account by typing its address, so if that setting is ever
 * turned off this rule must go with it.
 *
 * An account that already HAS a member is never adopted, ever.
 */

export interface MemberRow {
  accountId: string;
  authUserId: string;
  role: string;
}

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  licenceState: string;
  /** how many people can already sign in to it */
  memberCount: number;
}

export interface AccountStore {
  memberFor(authUserId: string): Promise<MemberRow | null>;
  accountByEmail(email: string): Promise<AccountRow | null>;
  /** creates the account and its first member together, or neither */
  createAccountWithOwner(input: { authUserId: string; email: string; name: string }): Promise<string>;
  addMember(input: { accountId: string; authUserId: string; role: string }): Promise<void>;
}

export type AttachOutcome =
  | { ok: true; accountId: string; how: "existing" | "adopted" | "created" }
  /** the address matches an account somebody else already signs in to */
  | { ok: false; reason: "claimed" };

export interface AttachInput {
  authUserId: string;
  /** the address Supabase has CONFIRMED belongs to this person */
  email: string;
  /** what they called their business on the signup form */
  name: string;
}

/** Normalised the same way everywhere, so "Ana@Tienda.ES " is one address. */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export async function attachAccount(
  store: AccountStore,
  input: AttachInput,
): Promise<AttachOutcome> {
  /* Already attached: signing in again, or a half-finished signup being
     retried. Idempotent on purpose — a second attempt must not make a second
     account, and the unique index on auth_user_id would stop it anyway. */
  const existing = await store.memberFor(input.authUserId);
  if (existing) return { ok: true, accountId: existing.accountId, how: "existing" };

  const email = normaliseEmail(input.email);
  const account = await store.accountByEmail(email);

  if (account) {
    if (account.memberCount > 0) return { ok: false, reason: "claimed" };
    /* Codroon made this account when it sold them a till, and nobody has signed
       in to it yet. The confirmed address is the proof it is theirs. */
    await store.addMember({ accountId: account.id, authUserId: input.authUserId, role: "owner" });
    return { ok: true, accountId: account.id, how: "adopted" };
  }

  const name = input.name.trim() || email;
  const accountId = await store.createAccountWithOwner({ authUserId: input.authUserId, email, name });
  return { ok: true, accountId, how: "created" };
}
