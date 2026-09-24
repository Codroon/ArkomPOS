/**
 * The cloud's Postgres — ADR-0009 (shared schema, scoped by tenant), ADR-0020.
 *
 * This is a READ MODEL with one door. Nothing here is the source of truth for a
 * shop: every row arrived from a till that had already committed it, and the
 * cloud never writes back (ADR-0001). If this database burned down, the shops
 * would carry on selling and re-push from their own cursors.
 *
 * Two deliberate omissions, both from ADR-0020 §3: there is no column for a
 * device passcode and none for a photograph. They are not nullable here, not
 * "filtered on read" — they have no home in this schema at all, so no future
 * handler can accidentally give them one.
 *
 * Isolation today is explicit `tenant_id` scoping in every query, enforced by
 * the token's binding: a device may only write its own tenant's stream. ADR-0009
 * names the trigger for Postgres RLS — the second tenant — and that remains the
 * plan; RLS then becomes a second lock on a door that is already locked.
 */
import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Server clock, always with a zone: shops are in Spain, the region is Frankfurt. */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/* ------------------------------------------------------------- accounts --
 * Who pays. One account can hold several shops (a chain, or a reseller looking
 * after its customers) — the dashboard scopes by account, ingest by tenant. */
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),               // UUIDv7, issued here
  name: text("name").notNull(),
  email: text("email").notNull(),
  /**
   * The gate, not the pricing model (ADR-0021 §6). Set by hand in the admin
   * while payment is manual. It gates the DOWNLOAD and the enrolment CODE and
   * nothing else — an installed till keeps selling whatever this says, because
   * a shop that has lapsed still has a legal duty to issue receipts.
   */
  licenceState: text("licence_state").notNull().default("trial"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ux_accounts_email").on(t.email)]);

/* -------------------------------------------------------- account members --
 * Who may sign in and see an account's shops — ADR-0021 §5.
 *
 * A table from the start rather than one column on `accounts`, because one shop
 * with one login is the common case and the day a chain wants its manager to
 * see the dashboard should be a row, not a migration.
 *
 * `auth_user_id` is a Supabase `auth.users` id. There is deliberately no
 * foreign key to it: that table belongs to the auth schema and is Supabase's to
 * manage, and a dangling member row is a nuisance where a broken FK would be an
 * outage. Codroon STAFF are not members of anybody's account (ADR-0021 §4).
 */
export const accountMembers = pgTable("account_members", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  authUserId: text("auth_user_id").notNull(),
  role: text("role").notNull().default("owner"),   // "owner" | "manager"
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.accountId, t.authUserId] }),
  /* one person, one account, for now: the dashboard has nowhere to ask "which
     shop am I looking at" yet, and guessing would be worse than refusing */
  uniqueIndex("ux_members_user").on(t.authUserId),
]);

/* --------------------------------------------------------------- tenants --
 * A shop, identified by the id ITS TILL generated at first run (ADR-0020 §1).
 * The cloud records that id; it does not issue it. `name` is whatever the till
 * last called itself, so a shop that renames itself renames here too. */
export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),               // = the till's tenant_id
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
}, (t) => [index("ix_tenants_account").on(t.accountId)]);

/* --------------------------------------------------------------- devices --
 * One till. The credential lives here as a SHA-256 of the token and nothing
 * else: not the token, not a prefix of it, not a hint. A lost token is not
 * recoverable from this table — it is replaced by enrolling again, which is the
 * only safe answer anyway.
 *
 * `last_acked_seq` is the cloud's own copy of the cursor, for answering "how far
 * along is this till" on the dashboard and for acking a push with nothing in it.
 * The till's copy is the one that decides what gets sent; this one never
 * overrides it. */
export const devices = pgTable("devices", {
  id: text("id").primaryKey(),               // UUIDv7, issued here
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  terminalName: text("terminal_name").notNull(),
  tokenHash: text("token_hash").notNull(),
  appVersion: text("app_version").notNull(),
  enrolledAt: ts("enrolled_at").notNull().defaultNow(),
  /** set from the dashboard to cut a lost or stolen till off; never deletes it */
  revokedAt: ts("revoked_at"),
  lastAckedSeq: bigint("last_acked_seq", { mode: "number" }).notNull().default(0),
  lastPushAt: ts("last_push_at"),
}, (t) => [
  uniqueIndex("ux_devices_token").on(t.tokenHash),
  /* one row per till, so re-enrolling rotates the token instead of leaving the
     old one alive beside it */
  uniqueIndex("ux_devices_terminal").on(t.tenantId, t.terminalId),
  index("ix_devices_account").on(t.accountId),
]);

/* ----------------------------------------------------------- enrol codes --
 * What the owner pastes into Ajustes → Nube. Hashed like the token, single use,
 * short-lived. A code that is unknown, spent or expired produces the same
 * answer, because telling a caller which of the three it was tells them
 * something about codes they do not hold. */
export const enrolCodes = pgTable("enrol_codes", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  /** what the account called it — "caja mostrador", "la de arriba" */
  label: text("label").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  /* which till it bought, for the account to look at later. Nulled rather than
     left dangling when that till goes, so deleting a shop leaves no pointers
     to rows that no longer exist. */
  usedByDeviceId: text("used_by_device_id").references(() => devices.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("ux_enrol_codes_hash").on(t.codeHash),
  index("ix_enrol_codes_account").on(t.accountId),
]);

/* ---------------------------------------------------------- sync entries --
 * The till's oplog, as it arrived. Append-only here too: this table is the
 * cloud's evidence, and every projection the dashboard grows is derived from it
 * and rebuildable by replaying it in `seq` order.
 *
 * Keyed by (tenant, op_id) — the idempotency key of ADR-0005. Deliberately NOT
 * keyed by (tenant, terminal, seq): a till restored from a backup can legally
 * re-use a seq for a different row, and a unique constraint there would turn
 * that shop's next batch into a poison pill that never drains. `seq` is an
 * ordering, not an identity.
 *
 * `device_id` records which credential delivered the row; `terminal_id` records
 * which till the row says it came from. They are normally the same till, and are
 * stored separately on purpose so that a restore does not make the stream lie. */
export const syncEntries = pgTable("sync_entries", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  opId: text("op_id").notNull(),
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  seq: bigint("seq", { mode: "number" }).notNull(),
  locationId: text("location_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  userId: text("user_id"),
  authorizedByUserId: text("authorized_by_user_id"),
  /** the till's clock: when the shop did it */
  createdAt: ts("created_at").notNull(),
  /** ours: when we heard about it — the two differ by however long the line was down */
  receivedAt: ts("received_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.opId] }),
  index("ix_entries_stream").on(t.tenantId, t.deviceId, t.seq),
  index("ix_entries_entity").on(t.tenantId, t.entity, t.entityId),
  index("ix_entries_when").on(t.tenantId, t.createdAt),
]);

export const accountRelations = relations(accounts, ({ many }) => ({
  tenants: many(tenants),
  devices: many(devices),
  members: many(accountMembers),
}));

export const memberRelations = relations(accountMembers, ({ one }) => ({
  account: one(accounts, { fields: [accountMembers.accountId], references: [accounts.id] }),
}));

export const tenantRelations = relations(tenants, ({ one, many }) => ({
  account: one(accounts, { fields: [tenants.accountId], references: [accounts.id] }),
  devices: many(devices),
}));

export const deviceRelations = relations(devices, ({ one }) => ({
  account: one(accounts, { fields: [devices.accountId], references: [accounts.id] }),
  tenant: one(tenants, { fields: [devices.tenantId], references: [tenants.id] }),
}));
