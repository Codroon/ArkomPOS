/**
 * The two halves, joined — ADR-0020.
 *
 * Every other test in this repo exercises one side of the wire against a
 * hand-written idea of the other. This one puts the real till outbox in front of
 * the real ingest rules, with nothing between them but a `fetch` that routes by
 * path, and drives it from the IPC channels the Ajustes card calls.
 *
 * It is here for the class of bug that no unit test on either side can see: the
 * till posting to a path the route does not serve, a header spelt differently at
 * the two ends, a field the parser does not accept, an ack the till cannot read.
 * The design doc happened to describe `POST /api/sync/push` for a year and a
 * half; the code that shipped serves `/api/sync`. Exactly one of those could
 * have been discovered by a shop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { handlers, app } from "./electron-stub";
import { keyNames, leafValues } from "./leaks";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext, tillContext } from "../context";
import { resetLinkCache } from "../sync/link";
import { resetSyncState } from "../sync/push";
/* the cloud half, imported as itself — not a description of it */
import { ingest as cloudIngest } from "../../../../web/src/sync/ingest";
import { enrol as cloudEnrol } from "../../../../web/src/sync/enrol";
import { memoryStore, type MemoryStore } from "../../../../web/src/sync/__tests__/memory-store";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

const WIZARD = {
  shopLegalName: "Telefonía García S.L.",
  shopNif: "B12345674",
  shopAddress: "Calle Mayor 3",
  shopCity: "Alcalá de Henares",
  shopPostalCode: "28801",
  shopPhone: "918 000 111",
  ticketFooter: "Gracias por su visita",
  terminalName: "Caja mostrador",
  seriesPrefix: "T1-",
  loadDemo: false,
  locale: "es" as const,
};

let db: ReturnType<typeof openDb>["db"];
let cloud: MemoryStore;
let seen: string[];

const call = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;

interface CloudStatus {
  linked: boolean;
  pending: number;
  lastAckedSeq: number;
  lastError: string | null;
  shopName: string;
  accountName: string;
}

/**
 * pos.codroon.com, as far as the till can tell: the real routes' rules behind a
 * `fetch` that dispatches on the pathname. Anything the till asks for that the
 * cloud does not serve comes back 404, the same way a real deployment would.
 */
function stubCloud(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      seen.push(`${String(init?.method ?? "GET")} ${String(url)}`);
      const body = JSON.parse(String(init?.body ?? "{}")) as unknown;
      const headers = (init?.headers ?? {}) as Record<string, string>;

      const result =
        path === "/api/enrol"
          ? await cloudEnrol(cloud, body)
          : path === "/api/sync"
            ? await cloudIngest(cloud, { authorization: headers.authorization ?? null, body })
            : { status: 404, body: { error: "NOT_FOUND" } };

      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.body,
      } as Response;
    }),
  );
}

/** The wizard and the owner, exactly as the screens do it — real oplog rows. */
async function onboard(): Promise<{ tenantId: string }> {
  await call("setup:complete", WIZARD);
  const owner = await call<{ user: { id: string; name: string } }>("setup:owner", {
    name: "Ana",
    pin: "4827",
  });
  startSession({ id: owner.user.id, name: owner.user.name, role: "owner", overrides: {} });
  return { tenantId: tillContext(db).ctx.tenantId };
}

/** Send until there is nothing left, the way the timer would over a few minutes. */
async function drain(): Promise<CloudStatus> {
  let status = await call<CloudStatus>("cloud:syncNow", {});
  for (let round = 0; round < 8 && status.pending > 0 && !status.lastError; round += 1) {
    status = await call<CloudStatus>("cloud:syncNow", {});
  }
  return status;
}

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  resetLinkCache();
  resetSyncState();
  seen = [];
  cloud = memoryStore();
  const dir = mkdtempSync(join(tmpdir(), "arkom-roundtrip-"));
  (app as unknown as { getPath: () => string }).getPath = () => mkdtempSync(join(tmpdir(), "arkom-ud-"));
  db = openDb(join(dir, "till.db")).db;
  runMigrations(db, MIGRATIONS);
  registerIpcHandlers(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLinkCache();
});

describe("a shop links its till and its history goes up", () => {
  it("enrols, replays everything it has, and agrees with the cloud about where it is", async () => {
    const { tenantId } = await onboard();
    const accountId = cloud.addAccount("Codroon");
    const code = cloud.addCode(accountId);
    stubCloud();

    const linked = await call<CloudStatus>("cloud:enrol", { url: "https://pos.codroon.com", code });
    expect(linked).toMatchObject({ linked: true, accountName: "Codroon", lastError: null });
    expect(linked.shopName).toBe(WIZARD.shopLegalName);

    const status = await drain();

    // the two halves agree, and neither is guessing
    const rows = db.select().from(s.oplog).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(status).toMatchObject({ pending: 0, lastError: null });
    expect(status.lastAckedSeq).toBe(Math.max(...rows.map((r) => r.seq)));
    expect(cloud.entriesFor(tenantId)).toHaveLength(rows.length);
    expect(cloud.entriesFor(tenantId).map((e) => e.seq)).toEqual(rows.map((r) => r.seq));
  });

  it("posts to the paths the cloud actually serves", async () => {
    await onboard();
    const code = cloud.addCode(cloud.addAccount("Codroon"));
    stubCloud();

    await call("cloud:enrol", { url: "https://pos.codroon.com", code });
    await drain();

    expect(seen[0]).toBe("POST https://pos.codroon.com/api/enrol");
    expect(seen.slice(1).every((c) => c === "POST https://pos.codroon.com/api/sync")).toBe(true);
  });

  it("carries the shop's own rows, so a dashboard would have something to show", async () => {
    const { tenantId } = await onboard();
    const code = cloud.addCode(cloud.addAccount("Codroon"));
    stubCloud();

    await call("cloud:enrol", { url: "https://pos.codroon.com", code });
    await drain();

    const entities = new Set(cloud.entriesFor(tenantId).map((e) => e.entity));
    expect(entities.has("setting")).toBe(true);
    expect(entities.has("user")).toBe(true);
  });

  it("sends no PIN material, whatever the wizard wrote", async () => {
    /* the owner's PIN was hashed into the users table one statement before this
       push. Core's tests pin the redaction; this pins that the whole path from
       a real mutation to a real ingest honours it */
    const { tenantId } = await onboard();
    const code = cloud.addCode(cloud.addAccount("Codroon"));
    stubCloud();

    await call("cloud:enrol", { url: "https://pos.codroon.com", code });
    await drain();

    /* first: something arrived. A dump of nothing contains no PIN either, and
       that is not the same statement */
    const entries = cloud.entriesFor(tenantId);
    expect(entries.filter((e) => e.entity === "user")).not.toHaveLength(0);

    /* the PIN is compared as a leaf VALUE, not as a substring of the dump: a
       UUIDv7 contains four digits often enough to fail a test by coincidence */
    expect(leafValues(entries)).not.toContain("4827");
    for (const key of ["pinHash", "pinSalt", "recoveryCodeHash", "devicePasscode"]) {
      expect(keyNames(entries)).not.toContain(key);
    }
    // a hash is long and distinctive, so a substring search is honest here
    const dump = JSON.stringify(entries);
    expect(dump).not.toContain("argon2");
    expect(dump).not.toContain("scrypt");
  });
});

describe("a till the account has not admitted", () => {
  it("refuses a code the cloud never issued, and stays unlinked", async () => {
    await onboard();
    stubCloud();

    await expect(
      call("cloud:enrol", { url: "https://pos.codroon.com", code: "ABCD-EFGH-JKLM" }),
    ).rejects.toThrow();

    expect(await call<CloudStatus>("cloud:status", {})).toMatchObject({ linked: false });
    expect(cloud.devices.size).toBe(0);
  });

  it("stops pushing once its token is revoked, and keeps every row it has", async () => {
    const { tenantId } = await onboard();
    const code = cloud.addCode(cloud.addAccount("Codroon"));
    stubCloud();
    await call("cloud:enrol", { url: "https://pos.codroon.com", code });
    await drain();
    const delivered = cloud.entriesFor(tenantId).length;

    // the account cuts this till off from a browser
    for (const device of cloud.devices.values()) device.revokedAt = new Date();

    // and the shop carries on working, which is the whole point
    await call("settings:save", { shopPhone: "918 000 222" });
    expect((await call<CloudStatus>("cloud:status", {})).pending).toBeGreaterThan(0);

    const after = await call<CloudStatus>("cloud:syncNow", {});

    expect(after.lastError).toContain("403");
    // the row stays queued rather than being lost, and nothing new reached the cloud
    expect(after.pending).toBeGreaterThan(0);
    expect(db.select().from(s.oplog).all().length).toBeGreaterThan(delivered);
    expect(cloud.entriesFor(tenantId)).toHaveLength(delivered);
  });
});
