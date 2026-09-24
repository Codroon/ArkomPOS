/**
 * Who ends up inside an account — ADR-0021 §5.
 *
 * The interesting case is not the happy one. It is the account Codroon created
 * before the customer had ever heard of a password: the customer signs up, the
 * address matches, and they should land in the account that already holds their
 * shop and their 56 rows rather than in an empty new one beside it.
 *
 * And the case that must never work: somebody signing up with an address that
 * belongs to an account somebody else already signs in to.
 */
import { describe, expect, it } from "vitest";
import { attachAccount, type AccountRow, type AccountStore, type MemberRow } from "../account";

function memoryAccounts(seed: { accounts?: AccountRow[]; members?: MemberRow[] } = {}) {
  const accounts = new Map<string, AccountRow>((seed.accounts ?? []).map((a) => [a.id, a]));
  const members: MemberRow[] = [...(seed.members ?? [])];
  let next = 1;

  const store: AccountStore & { accounts: typeof accounts; members: typeof members } = {
    accounts,
    members,
    async memberFor(authUserId) {
      return members.find((m) => m.authUserId === authUserId) ?? null;
    },
    async accountByEmail(email) {
      const found = [...accounts.values()].find((a) => a.email === email);
      if (!found) return null;
      return { ...found, memberCount: members.filter((m) => m.accountId === found.id).length };
    },
    async createAccountWithOwner({ authUserId, email, name }) {
      const id = `acc-${next++}`;
      accounts.set(id, { id, name, email, licenceState: "trial", memberCount: 0 });
      members.push({ accountId: id, authUserId, role: "owner" });
      return id;
    },
    async addMember({ accountId, authUserId, role }) {
      members.push({ accountId, authUserId, role });
    },
  };
  return store;
}

const account = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: "acc-codroon",
  name: "Codroon",
  email: "ana@tienda.es",
  licenceState: "trial",
  memberCount: 0,
  ...over,
});

describe("a brand new customer", () => {
  it("gets an account named after their business", async () => {
    const store = memoryAccounts();

    const out = await attachAccount(store, {
      authUserId: "user-1",
      email: "ana@tienda.es",
      name: "Telefonía García",
    });

    expect(out).toMatchObject({ ok: true, how: "created" });
    expect(store.accounts.size).toBe(1);
    expect([...store.accounts.values()][0]).toMatchObject({
      name: "Telefonía García",
      email: "ana@tienda.es",
      licenceState: "trial",
    });
  });

  it("falls back to the address when they leave the business name blank", async () => {
    const store = memoryAccounts();
    await attachAccount(store, { authUserId: "user-1", email: "ana@tienda.es", name: "   " });
    expect([...store.accounts.values()][0]?.name).toBe("ana@tienda.es");
  });

  it("is recognised by the address however they typed it", async () => {
    const store = memoryAccounts({ accounts: [account()] });

    const out = await attachAccount(store, {
      authUserId: "user-1",
      email: "  Ana@Tienda.ES ",
      name: "whatever",
    });

    expect(out).toMatchObject({ ok: true, how: "adopted", accountId: "acc-codroon" });
  });
});

describe("the account Codroon made before they had a password", () => {
  it("is adopted, so their shop and its history are already there", async () => {
    /* this is the real sequence: `cloud:code` creates the account and issues a
       code, the till links and pushes a year of rows, and only THEN does the
       owner get round to signing up */
    const store = memoryAccounts({ accounts: [account()] });

    const out = await attachAccount(store, {
      authUserId: "user-1",
      email: "ana@tienda.es",
      name: "Telefonía García",
    });

    expect(out).toEqual({ ok: true, accountId: "acc-codroon", how: "adopted" });
    expect(store.accounts.size).toBe(1); // NOT a second account beside it
    expect(store.members).toEqual([{ accountId: "acc-codroon", authUserId: "user-1", role: "owner" }]);
  });

  it("does not take the name from the signup form once it exists", async () => {
    /* the account's name is Codroon's record of the relationship, and the shop
       name that matters is the till's anyway (ADR-0021 §2) */
    const store = memoryAccounts({ accounts: [account({ name: "Codroon" })] });
    await attachAccount(store, { authUserId: "user-1", email: "ana@tienda.es", name: "Otra cosa" });
    expect(store.accounts.get("acc-codroon")?.name).toBe("Codroon");
  });
});

describe("an account somebody already signs in to", () => {
  it("is never adopted by a second signup on the same address", async () => {
    const store = memoryAccounts({
      accounts: [account()],
      members: [{ accountId: "acc-codroon", authUserId: "the-owner", role: "owner" }],
    });

    const out = await attachAccount(store, {
      authUserId: "an-impostor",
      email: "ana@tienda.es",
      name: "Telefonía García",
    });

    expect(out).toEqual({ ok: false, reason: "claimed" });
    expect(store.members).toHaveLength(1);
    expect(store.accounts.size).toBe(1);
  });
});

describe("signing in again", () => {
  it("returns the account they are already in, and makes nothing", async () => {
    const store = memoryAccounts({
      accounts: [account()],
      members: [{ accountId: "acc-codroon", authUserId: "user-1", role: "owner" }],
    });

    const out = await attachAccount(store, {
      authUserId: "user-1",
      email: "ana@tienda.es",
      name: "Telefonía García",
    });

    expect(out).toEqual({ ok: true, accountId: "acc-codroon", how: "existing" });
    expect(store.members).toHaveLength(1);
  });

  it("keeps them where they are even if they sign up with a different address", async () => {
    /* changing an email address in Supabase must not silently move somebody
       into another account, or out of their own */
    const store = memoryAccounts({
      accounts: [account(), account({ id: "acc-other", email: "otro@tienda.es" })],
      members: [{ accountId: "acc-codroon", authUserId: "user-1", role: "owner" }],
    });

    const out = await attachAccount(store, {
      authUserId: "user-1",
      email: "otro@tienda.es",
      name: "x",
    });

    expect(out).toMatchObject({ accountId: "acc-codroon", how: "existing" });
  });
});
