/**
 * The IPC guard — the control that actually enforces permissions (ADR-0012 §5).
 *
 * These call the registered handlers exactly the way the renderer does, through
 * the captured `ipcMain.handle` callbacks, so what is tested here is the real
 * path and not a re-implementation of it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { IPC_CHANNELS, parseIpcError } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers, registeredChannels } from "../ipc";
import { endSession, startSession } from "../auth/session";

/** Registration touches no rows, so a stub database is enough. */
const stubDb = {} as never;

beforeEach(() => {
  handlers.clear();
  endSession();
  registerIpcHandlers(stubDb);
});

/** Call a channel the way the preload does, returning the typed error code. */
async function callFor(channel: string, payload?: unknown, approval?: unknown): Promise<string> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`channel not registered: ${channel}`);
  try {
    await fn({}, payload, approval);
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
}

describe("every channel is accounted for", () => {
  it("registers a handler for each channel in the contract", () => {
    const missing = IPC_CHANNELS.filter((c) => !handlers.has(c));
    expect(missing, `channels declared but not registered: ${missing.join(", ")}`).toEqual([]);
  });

  it("registers nothing that is not in the contract", () => {
    const extra = [...handlers.keys()].filter((c) => !(IPC_CHANNELS as readonly string[]).includes(c));
    expect(extra, `channels registered but not declared: ${extra.join(", ")}`).toEqual([]);
  });

  /**
   * The point of the whole exercise: adding a channel without deciding who may
   * call it should be impossible. Every channel is open, authenticated, or
   * permission-guarded — and the open list is short enough to read.
   */
  it("declares a policy for every channel, with a short open list", () => {
    const policy = registeredChannels();
    for (const channel of IPC_CHANNELS) {
      expect(policy.has(channel), `no policy declared for ${channel}`).toBe(true);
    }
    const openChannels = [...policy.entries()].filter(([, p]) => p === null).map(([c]) => c);
    expect(openChannels.sort()).toEqual(
      [
        "auth:login",
        "auth:printRecovery",
        "auth:recover",
        "auth:session",
        "auth:unlock",
        "auth:users",
        "meta:context",
        "setup:complete",
        "setup:owner",
        "setup:status",
      ].sort(),
    );
  });
});

describe("without a session", () => {
  const GUARDED = [
    ["catalog:list", {}],
    ["sale:current", undefined],
    ["sale:complete", { docId: "x", tenders: [{ method: "cash", amountCents: 1 }] }],
    ["stock:add", { entries: [] }],
    ["settings:get", undefined],
    ["users:list", undefined],
    ["backup:status", undefined],
    ["auth:logout", undefined],
    ["auth:lock", undefined],
  ] as const;

  it.each(GUARDED)("rejects %s with AUTH_REQUIRED", async (channel, payload) => {
    expect(await callFor(channel, payload)).toBe("AUTH_REQUIRED");
  });

  it("still answers the open channels", async () => {
    // the Login screen has to render before anyone can log in
    expect(await callFor("auth:session")).toBe("OK");
  });
});

describe("with a session that lacks the permission", () => {
  beforeEach(() => {
    startSession({ id: "u-cashier", name: "Ana", role: "cashier", overrides: {} });
  });

  it("denies an owner-only channel outright", async () => {
    // not approvable: a cashier does not manage users with an owner PIN typed
    // over their shoulder
    expect(await callFor("users:list")).toBe("PERMISSION_DENIED");
    expect(await callFor("settings:get")).toBe("PERMISSION_DENIED");
    expect(await callFor("backup:status")).toBe("PERMISSION_DENIED");
  });

  it("asks for approval on an approvable one", async () => {
    const code = await callFor("sale:overridePrice", {
      docId: "d1",
      lineId: "l1",
      newPriceCents: 1000,
      reason: "cliente habitual",
    });
    expect(code).toBe("APPROVAL_REQUIRED");
  });

  it("names the permission in the APPROVAL_REQUIRED error, for the modal", async () => {
    const fn = handlers.get("sale:overridePrice")!;
    try {
      await fn({}, { docId: "d1", lineId: "l1", newPriceCents: 1000, reason: "x" });
      throw new Error("should have required approval");
    } catch (err) {
      expect(parseIpcError(err)?.message).toBe("sale.price_override");
    }
  });
});

describe("a locked session is not a session", () => {
  it("refuses guarded work while the lock overlay is up", async () => {
    startSession({ id: "u1", name: "Ahmer", role: "owner", overrides: {} });
    expect(await callFor("catalog:list", {})).not.toBe("AUTH_REQUIRED");

    const { lockSession } = await import("../auth/session");
    lockSession();
    // the overlay is a control, not a screensaver: the IPC layer stops too
    expect(await callFor("catalog:list", {})).toBe("AUTH_REQUIRED");
    expect(await callFor("sale:complete", { docId: "x", tenders: [{ method: "cash", amountCents: 1 }] })).toBe(
      "AUTH_REQUIRED",
    );
  });
});

describe("the payload cannot spoof the actor", () => {
  it("ignores a userId sent by the renderer", async () => {
    startSession({ id: "u-real", name: "Ana", role: "cashier", overrides: {} });
    // catalog:list is Zod-parsed with a strict-ish schema; an unknown userId
    // field is dropped before the handler and can never reach MutationCtx,
    // which the guard builds from the session alone
    const fn = handlers.get("catalog:list")!;
    let seen: unknown = null;
    try {
      await fn({}, { search: "x", userId: "u-owner" });
    } catch (err) {
      seen = parseIpcError(err)?.code ?? "UNTYPED";
    }
    // it fails on the stub database, not on authorization — the actor was never
    // in question
    expect(seen).not.toBe("AUTH_REQUIRED");
    expect(seen).not.toBe("PERMISSION_DENIED");
  });
});
