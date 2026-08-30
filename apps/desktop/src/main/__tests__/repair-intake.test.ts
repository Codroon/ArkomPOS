/**
 * Taking a device in, against a real database.
 *
 * Three things this slice must get right, and each has its own group below:
 * the transaction (a numbered R- document, a ticket, photos, and a cash row
 * when money changed hands — all of it or none), the customer record it hangs
 * off, and the passcode, which must be storable and unprintable at the same
 * time.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import {
  AppError,
  imeiWithCheckDigit,
  opsToText,
  parseIpcError,
  renderIntakeReceipt,
  uuidv7,
  type RepairCreateRequest,
} from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { createTicket, searchCustomers, upsertCustomer } from "../repos/repair";
import { repairPhotosDir } from "../photos";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

const IMEI = imeiWithCheckDigit("35209411880318");

/* A 1×1 JPEG — small enough to keep the suite fast, real enough to be written. */
const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA" +
  "AAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-repair-intake-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  return { db, ctx: { ...ids, userId: null as string | null } };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };
let customerId: string;

const ctxOf = () => ({ ...env.ctx, userId: owner.id });

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  customerId = upsertCustomer(env.db, ctxOf(), { name: "Imran Khan", phone: "+34 632 118 044" }).id;
});

function request(over: Partial<RepairCreateRequest> = {}): RepairCreateRequest {
  return {
    customerId,
    deviceDescription: "Apple iPhone 11 64GB",
    imei: IMEI,
    reportedFault: "No carga y la pantalla parpadea",
    conditionAtIntake: "Marcas de uso en los bordes",
    damage: { screen: true, back: false, dents: true, water: false },
    damageNote: null,
    accessories: "funda",
    devicePasscode: null,
    photos: [],
    promisedDate: null,
    promisedHalf: null,
    depositCents: 0,
    authorizedCapCents: null,
    assignedUserId: null,
    ...over,
  };
}

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.ipc.code;
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

/* ------------------------------------------------------------- customers */

describe("the customer record", () => {
  it("finds someone by the phone as typed, however it was stored", () => {
    // stored with spaces and a country code, searched as bare digits
    expect(searchCustomers(env.db, ctxOf(), "632118044")).toHaveLength(1);
    expect(searchCustomers(env.db, ctxOf(), "+34 632 118 044")).toHaveLength(1);
    expect(searchCustomers(env.db, ctxOf(), "imran")).toHaveLength(1);
    expect(searchCustomers(env.db, ctxOf(), "648000111")).toHaveLength(0);
  });

  it("does not create a second row for a phone the shop already has", () => {
    const again = upsertCustomer(env.db, ctxOf(), { name: "I. Khan", phone: "0034632118044" });
    expect(again.id).toBe(customerId);
    expect(env.db.select().from(s.customers).all()).toHaveLength(1);
    // the existing record wins: a typo at the counter must not rename someone
    expect(again.name).toBe("Imran Khan");
  });

  it("refuses a phone number that is not one", async () => {
    expect(await codeOf(async () => upsertCustomer(env.db, ctxOf(), { name: "X", phone: "12" }))).toBe("VALIDATION");
  });

  it("counts the repairs a customer has left with the shop", async () => {
    await createTicket(env.db, ctxOf(), request());
    expect(searchCustomers(env.db, ctxOf(), "632118044")[0]!.repairCount).toBe(1);
  });
});

/* ---------------------------------------------------------------- intake */

describe("taking a device in", () => {
  it("writes the numbered document and the ticket together", async () => {
    const result = await createTicket(env.db, ctxOf(), request());

    const documents = env.db.select().from(s.documents).all();
    expect(documents).toHaveLength(1);
    expect(documents[0]!.docType).toBe("repair");
    expect(documents[0]!.docNumber).toBe("R-000001");
    /* a record of custody, not of money: the revenue appears on the T1-
       collection document or nowhere at all (ADR-0014 §4) */
    expect(documents[0]!.totalCents).toBe(0);

    const tickets = env.db.select().from(s.repairTickets).all();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.imei).toBe(IMEI);
    expect(tickets[0]!.documentId).toBe(documents[0]!.id);
    expect(tickets[0]!.damageScreen).toBe(true);
    expect(tickets[0]!.damageWater).toBe(false);
    expect(result.docNumber).toBe("R-000001");
    expect(result.customerName).toBe("Imran Khan");
  });

  it("starts at Recibido, computed rather than assumed", async () => {
    const { ticketId } = await createTicket(env.db, ctxOf(), request());
    const row = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticketId)).all()[0]!;
    expect(row.status).toBe("received");
  });

  it("numbers R- tickets in their own gap-free series", async () => {
    await createTicket(env.db, ctxOf(), request());
    await createTicket(env.db, ctxOf(), request({ imei: null }));
    expect(env.db.select().from(s.documents).all().map((d) => d.docNumber)).toEqual(["R-000001", "R-000002"]);
  });

  it("snapshots the warranty and the diagnosis fee onto the ticket", async () => {
    const { ticketId } = await createTicket(env.db, ctxOf(), request());
    const row = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticketId)).all()[0]!;
    // the settings' values today, frozen — changing the setting tomorrow must
    // not reach back into a ticket taken in today (ADR-0014 §8)
    expect(row.warrantyMonths).toBe(3);
    expect(row.diagnosisFeeCents).toBe(0);
  });

  it("refuses an IMEI that fails its check digit, and accepts none at all", async () => {
    expect(await codeOf(() => createTicket(env.db, ctxOf(), request({ imei: "353916100000000" })))).toBe("VALIDATION");
    // plenty of devices needing repair have no readable IMEI
    expect(await codeOf(() => createTicket(env.db, ctxOf(), request({ imei: null })))).toBe("OK");
  });

  it("refuses a customer that does not exist", async () => {
    expect(await codeOf(() => createTicket(env.db, ctxOf(), request({ customerId: uuidv7() })))).toBe("VALIDATION");
  });

  it("writes the photos to disk and their paths to rows", async () => {
    const { ticketId } = await createTicket(
      env.db,
      ctxOf(),
      request({
        photos: [
          { kind: "front", dataUrl: JPEG_1PX },
          { kind: "back", dataUrl: JPEG_1PX },
        ],
      }),
    );

    const rows = env.db.select().from(s.repairPhotos).all();
    expect(rows).toHaveLength(2);
    // paths in rows, files on disk — never blobs (ADR-0013 §3)
    for (const row of rows) expect(row.path.startsWith("repairs/")).toBe(true);
    expect(readdirSync(repairPhotosDir(ticketId)).sort()).toEqual(["back.jpg", "front.jpg"]);
  });

  it("leaves no photos behind when the transaction fails", async () => {
    // a bad IMEI is rejected before any file is written; a bad customer is
    // rejected after the id exists, which is the case worth pinning
    const before = env.db.select().from(s.repairPhotos).all().length;
    await codeOf(() =>
      createTicket(env.db, ctxOf(), request({ customerId: uuidv7(), photos: [{ kind: "front", dataUrl: JPEG_1PX }] })),
    );
    expect(env.db.select().from(s.repairPhotos).all()).toHaveLength(before);
  });
});

/* ------------------------------------------------------------------ cash */

describe("the deposit", () => {
  it("posts one cash movement, and only when money changed hands", async () => {
    await createTicket(env.db, ctxOf(), request());
    expect(env.db.select().from(s.cashMovements).all()).toHaveLength(0);

    const { ticketId } = await createTicket(env.db, ctxOf(), request({ depositCents: 3000 }));
    const rows = env.db.select().from(s.cashMovements).all();
    expect(rows).toHaveLength(1);
    // money IN: positive, and tied to the ticket it will later be settled against
    expect(rows[0]!.amountCents).toBe(3000);
    expect(rows[0]!.reason).toBe("repair_deposit");
    expect(rows[0]!.ticketId).toBe(ticketId);
  });

  it("records the deposit on the ticket as well as in the ledger", async () => {
    const { ticketId, depositCents } = await createTicket(env.db, ctxOf(), request({ depositCents: 3000 }));
    const row = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticketId)).all()[0]!;
    expect(row.depositCents).toBe(3000);
    expect(depositCents).toBe(3000);
  });
});

/* -------------------------------------------------------------- passcode */

const SECRET = "0451";

describe("the device passcode", () => {
  it("is stored, because the technician needs it", async () => {
    const { ticketId } = await createTicket(env.db, ctxOf(), request({ devicePasscode: SECRET }));
    const row = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticketId)).all()[0]!;
    expect(row.devicePasscode).toBe(SECRET);
  });

  it("never reaches the oplog — only the fact that one was given", async () => {
    const { ticketId } = await createTicket(env.db, ctxOf(), request({ devicePasscode: SECRET }));

    const entries = env.db.select().from(s.oplog).all();
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(SECRET);

    const ticketEntry = entries.find((e) => e.entityId === ticketId)!;
    const after = ticketEntry.after as Record<string, unknown>;
    expect(after.devicePasscode).toBeUndefined();
    // what a reader of the oplog is allowed to know
    expect(after.hasPasscode).toBe(true);
  });

  it("records hasPasscode false when none was given", async () => {
    const { ticketId } = await createTicket(env.db, ctxOf(), request());
    const entry = env.db.select().from(s.oplog).all().find((e) => e.entityId === ticketId)!;
    expect((entry.after as Record<string, unknown>).hasPasscode).toBe(false);
  });

  it("cannot be printed, because the receipt has nowhere to put it", async () => {
    const { ticketId } = await createTicket(env.db, ctxOf(), request({ devicePasscode: SECRET }));
    const ticket = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticketId)).all()[0]!;

    /* Build the receipt the way the print bridge does. The passcode is read
       from the row here and deliberately NOT passed — IntakeReceiptDoc has no
       field that would accept it (ADR-0014 §10). */
    expect(ticket.devicePasscode).toBe(SECRET);
    const ops = renderIntakeReceipt(
      {
        docNumber: "R-000001",
        receivedAtMs: Date.now(),
        terminalName: "Caja 1",
        cashierName: "Ahmer",
        isCopy: false,
        customerName: "Imran Khan",
        customerPhone: "+34 632 118 044",
        device: {
          description: ticket.deviceDescription,
          imei: ticket.imei,
          reportedFault: ticket.reportedFault,
          conditionAtIntake: ticket.conditionAtIntake,
          damage: {
            screen: ticket.damageScreen,
            back: ticket.damageBack,
            dents: ticket.damageDents,
            water: ticket.damageWater,
          },
          damageNote: ticket.damageNote,
          accessories: ticket.accessories,
        },
        depositCents: ticket.depositCents,
        authorizedCapCents: ticket.authorizedCapCents,
        diagnosisFeeCents: ticket.diagnosisFeeCents,
        warrantyMonths: ticket.warrantyMonths,
        promisedAtMs: null,
        promisedHalf: null,
      },
      { legalName: "Arkom SL", nif: "B12345678", address: "Calle Mayor 1", footerLine: "Gracias" },
    );

    expect(opsToText(ops)).not.toContain(SECRET);
    expect(JSON.stringify(ops)).not.toContain(SECRET);
  });
});
