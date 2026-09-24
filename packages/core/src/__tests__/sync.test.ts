/**
 * What may leave a shop — ADR-0020 §3.
 *
 * The redaction happens on the till, before a row is queued, because a secret
 * that reaches the wire has already left. These cases are the whole reason
 * that rule is a pure function instead of a filter in an HTTP handler.
 */
import { describe, expect, it } from "vitest";
import {
  prepareBatch,
  redactForSync,
  SYNC_BATCH_SIZE,
  SyncEnrolRequestSchema,
  SyncPushRequestSchema,
  type SyncableOplogRow,
} from "../sync";

const row = (over: Partial<SyncableOplogRow> = {}): SyncableOplogRow => ({
  seq: 1,
  opId: "01a0697a-6db1-7000-8d33-a600cef78533",
  tenantId: "t1",
  locationId: "l1",
  terminalId: "term1",
  entity: "document",
  entityId: "d1",
  action: "complete",
  before: null,
  after: { docNumber: "T1-000001", totalCents: 1290 },
  userId: "u1",
  authorizedByUserId: null,
  createdAt: new Date(Date.UTC(2026, 8, 24, 10, 0, 0)),
  ...over,
});

describe("the secrets that never leave the till", () => {
  it("strips a device passcode from a repair payload", () => {
    const after = { ticketId: "r1", devicePasscode: "1234", hasPasscode: true, device: "iPhone 11" };
    expect(redactForSync(after)).toEqual({ ticketId: "r1", hasPasscode: true, device: "iPhone 11" });
  });

  it("strips it however deep it is buried", () => {
    const nested = {
      ticket: { id: "r1", secrets: { devicePasscode: "0000" } },
      history: [{ devicePasscode: "9999", at: 1 }, { at: 2 }],
    };
    expect(redactForSync(nested)).toEqual({
      ticket: { id: "r1", secrets: {} },
      history: [{ at: 1 }, { at: 2 }],
    });
  });

  it("strips PIN material, which should never have been there in the first place", () => {
    const user = { id: "u1", name: "Ana", pinHash: "deadbeef", pinSalt: "cafe", recoveryCodeHash: "x" };
    expect(redactForSync(user)).toEqual({ id: "u1", name: "Ana" });
  });

  it("leaves the shop's actual data alone, including the customer's name", () => {
    /* ADR-0020 §3: the rows go, names and all — a dashboard that cannot name
       the customer whose repair is late is not worth hosting */
    const purchase = {
      seller: { name: "Imran Khan", idNumber: "Y2841170F", phone: "+34 600 000 000" },
      photos: ["photos/purchases/p1/dni.jpg"],
      buyPriceCents: 8000,
    };
    expect(redactForSync(purchase)).toEqual(purchase);
  });

  it("keeps a photograph's PATH while the file itself stays on the till", () => {
    // the path is meaningless without the file, and the cloud should be able to
    // say "four photographs were taken"
    const after = { purchaseId: "p1", photos: ["photos/purchases/p1/front.jpg"] };
    expect(redactForSync(after)).toEqual(after);
  });

  it("survives nulls, arrays and primitives without inventing an object", () => {
    expect(redactForSync(null)).toBeNull();
    expect(redactForSync(42)).toBe(42);
    expect(redactForSync("T1-000001")).toBe("T1-000001");
    expect(redactForSync([1, "a", null])).toEqual([1, "a", null]);
  });
});

describe("the batch a till sends", () => {
  it("is ordered by the till's own seq, whatever order the rows arrived in", () => {
    const batch = prepareBatch([row({ seq: 3 }), row({ seq: 1 }), row({ seq: 2 })]);
    expect(batch.map((o) => o.seq)).toEqual([1, 2, 3]);
  });

  it("never exceeds one push, so a dropped line is cheap to retry", () => {
    const many = Array.from({ length: SYNC_BATCH_SIZE + 50 }, (_, i) => row({ seq: i + 1 }));
    const batch = prepareBatch(many);
    expect(batch).toHaveLength(SYNC_BATCH_SIZE);
    expect(batch[batch.length - 1]!.seq).toBe(SYNC_BATCH_SIZE); // the oldest first, never the newest
  });

  it("redacts on the way out, not at the far end", () => {
    const [op] = prepareBatch([row({ after: { ticketId: "r1", devicePasscode: "4321" } })]);
    expect(op!.after).toEqual({ ticketId: "r1" });
  });

  it("carries the row's own timestamp as epoch millis", () => {
    const [op] = prepareBatch([row()]);
    expect(op!.createdAtMs).toBe(Date.UTC(2026, 8, 24, 10, 0, 0));
    expect(SyncPushRequestSchema.safeParse({
      tenantId: "t1",
      terminalId: "term1",
      appVersion: "1.1.0",
      ops: [op],
    }).success).toBe(true);
  });

  it("produces a batch the ingest route's own schema accepts", () => {
    /* the point of the shared file: if this ever fails, the two halves have
       drifted and one of them is about to reject the other in production */
    const batch = prepareBatch([row({ seq: 1 }), row({ seq: 2, action: "create" })]);
    const parsed = SyncPushRequestSchema.safeParse({
      tenantId: "t1",
      terminalId: "term1",
      appVersion: "1.1.0",
      ops: batch,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe("the code the owner pastes to link a till", () => {
  const base = {
    tenantId: "t1",
    locationId: "l1",
    terminalId: "term1",
    terminalName: "Caja 1",
    shopName: "Telefonía García S.L.",
    appVersion: "1.1.0",
  };

  it("reads the way it is printed, whatever the case or spacing", () => {
    const parsed = SyncEnrolRequestSchema.parse({ ...base, code: "  ab12-cd34-ef56  " });
    expect(parsed.code).toBe("AB12-CD34-EF56");
  });

  it("refuses anything that is not a code", () => {
    for (const bad of ["", "AB12CD34EF56", "AB12-CD34", "AB12-CD34-EF5!", "nope"]) {
      expect(SyncEnrolRequestSchema.safeParse({ ...base, code: bad }).success, bad).toBe(false);
    }
  });
});
