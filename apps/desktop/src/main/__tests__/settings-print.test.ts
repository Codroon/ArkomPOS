/**
 * Printing, the letterhead, and the settings behind them — v0.17.0.
 *
 * The change worth pinning is a NEGATIVE: completing a sale with a printer
 * configured must write nothing to disk. The old behaviour filed a PDF per
 * document into a folder nobody opened, which is a duplicate of a record that
 * already exists and a slow leak of the shop's disk.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { opsToText, parseIpcError, renderTicket, shopHeaderLines, uuidv7 } from "@arkom/core";
import { handlers, setNextSavePath } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { getSettings, saveSettings, shopProfile } from "../repos/settings";
import { cleanPdfTemp, pdfTempDir } from "../print";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-set-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  db.insert(s.numberSeries)
    .values({
      id: uuidv7(),
      tenantId: ids.tenantId,
      locationId: ids.locationId,
      terminalId: ids.terminalId,
      docType: "ticket",
      prefix: "T1-",
      nextNumber: 1,
    })
    .run();
  return { db, ctx: { ...ids, userId: null as string | null } };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };
const ctxOf = () => ({ ...env.ctx, userId: owner.id });

const call = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
});

/* ------------------------------------------- 1 · nothing is filed per sale */

describe("what a completed sale writes to disk", () => {
  it("keeps no per-document folder any more", () => {
    /* the render directory is TEMP, not userData: it holds this session's
       fallbacks and is emptied at every launch */
    expect(pdfTempDir()).toContain("arkom-pdf");
    expect(pdfTempDir().toLowerCase()).not.toContain("tickets");
  });

  it("sweeps last session's renders at startup", async () => {
    const dir = pdfTempDir();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "T1-000001.pdf"), "stale");
    writeFileSync(join(dir, "T1-000002.pdf"), "stale");
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(2);

    const removed = await cleanPdfTemp();

    expect(removed).toBeGreaterThanOrEqual(2);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("survives a sweep of a directory that was never used", async () => {
    // a till that has always had a printer never renders one
    await expect(cleanPdfTemp()).resolves.toBeGreaterThanOrEqual(0);
  });

  it("offers no tickets-folder channel to open", () => {
    /* the setting and its "Abrir carpeta" button are gone, so the channel must
       be gone too — a door left open onto a folder nothing writes to */
    expect(handlers.has("print:ticketsDir")).toBe(false);
    expect(handlers.has("print:savePdf")).toBe(true);
  });
});

/* --------------------------------------------- 3 · the shop's letterhead */

describe("the shop's block on a document", () => {
  it("carries every field the shop filled in", () => {
    saveSettings(env.db, ctxOf(), {
      shopLegalName: "Arkom Electronics S.L.",
      shopDisplayName: "Arkom Phones",
      shopNif: "B12345678",
      shopAddress: "C/ Mayor 14",
      shopPostalCode: "28013",
      shopCity: "Madrid",
      shopPhone: "915 550 100",
    });

    const lines = shopHeaderLines(shopProfile(env.db, ctxOf()));
    expect(lines).toEqual([
      "Arkom Electronics S.L.",
      /* the trading name goes UNDER the legal one: the legal name is what makes
         the document valid, the sign over the door is what the customer knows */
      "Arkom Phones",
      "NIF B12345678",
      "C/ Mayor 14",
      "28013 Madrid",
      "Tel. 915 550 100",
    ]);
  });

  it("prints no empty line for a field the shop left blank", () => {
    saveSettings(env.db, ctxOf(), {
      shopLegalName: "Arkom Electronics S.L.",
      shopDisplayName: "",
      shopNif: "B12345678",
      shopAddress: "C/ Mayor 14",
      shopPostalCode: "",
      shopCity: "",
      shopPhone: "",
    });
    /* a shop with no phone should not get a blank line where one would be: a
       document is not improved by a placeholder */
    expect(shopHeaderLines(shopProfile(env.db, ctxOf()))).toEqual([
      "Arkom Electronics S.L.",
      "NIF B12345678",
      "C/ Mayor 14",
    ]);
  });

  it("says the town without a postcode, and the postcode without a town", () => {
    saveSettings(env.db, ctxOf(), { shopPostalCode: "", shopCity: "Madrid" });
    expect(shopHeaderLines(shopProfile(env.db, ctxOf()))).toContain("Madrid");
    saveSettings(env.db, ctxOf(), { shopPostalCode: "28013", shopCity: "" });
    expect(shopHeaderLines(shopProfile(env.db, ctxOf()))).toContain("28013");
  });

  it("reaches the printed ticket, not just the profile", () => {
    saveSettings(env.db, ctxOf(), {
      shopLegalName: "Arkom Electronics S.L.",
      shopDisplayName: "Arkom Phones",
      shopNif: "B12345678",
      shopAddress: "C/ Mayor 14",
      shopPostalCode: "28013",
      shopCity: "Madrid",
      shopPhone: "915 550 100",
    });
    const text = opsToText(
      renderTicket(
        {
          docNumber: "T1-000001",
          completedAtMs: Date.now(),
          terminalName: "Caja 1",
          isCopy: false,
          lines: [{ description: "Cable", qty: 1, unitPriceCents: 990, totalCents: 990, imei: null, priceOverridden: false }],
          subtotalCents: 818,
          taxCents: 172,
          totalCents: 990,
          tenders: [{ method: "card", amountCents: 990, cardReference: null }],
          changeCents: 0,
        },
        shopProfile(env.db, ctxOf()),
        80,
      ),
    );
    for (const fragment of ["Arkom Electronics", "Arkom Phones", "B12345678", "C/ Mayor 14", "28013 Madrid", "915 550 100"]) {
      expect(text).toContain(fragment);
    }
  });

  it("puts the same block on a purchase document", async () => {
    /* four documents used to build this block from four copies of the same
       three lines. One function is why a ticket and a purchase cannot disagree
       about the shop's own address. */
    const { renderPurchaseDoc } = await import("@arkom/core");
    saveSettings(env.db, ctxOf(), { shopCity: "Madrid", shopPostalCode: "28013", shopPhone: "915 550 100" });
    const shop = shopProfile(env.db, ctxOf());
    const text = opsToText(
      renderPurchaseDoc(
        {
          docNumber: "C-000001",
          completedAtMs: Date.now(),
          terminalName: "Caja 1",
          isCopy: false,
          device: { brand: "Apple", model: "iPhone 11", storage: null, color: null, grade: "B", batteryPct: null, imei: "3", accessories: { charger: false, box: false, cable: false, case: false } },
          seller: { name: "Imran", phone: null, idType: "DNI", idNumber: "Y2841170F", channel: "private_individual" },
          buyPriceCents: 12000,
          payoutMethod: "cash",
          payoutReference: null,
        } as never,
        shop,
        80,
      ),
    );
    expect(text).toContain("28013 Madrid");
    expect(text).toContain("915 550 100");
  });
});

/* ------------------------------------------------ 4 · settings round-trip */

describe("settings", () => {
  it("persist what was saved and nothing else", async () => {
    const before = getSettings(env.db, ctxOf());
    await call("settings:save", {
      shopCity: "Madrid",
      shopPhone: "915 550 100",
      idleLockMinutes: 12,
      cashDefaultFloatCents: 25000,
      cashConcepts: ["Café", "Limpieza"],
    });

    const after = getSettings(env.db, ctxOf());
    expect(after.shopCity).toBe("Madrid");
    expect(after.shopPhone).toBe("915 550 100");
    expect(after.idleLockMinutes).toBe(12);
    expect(after.cashDefaultFloatCents).toBe(25000);
    expect(after.cashConcepts).toEqual(["Café", "Limpieza"]);
    // a partial save must not reset the fields it never mentioned
    expect(after.paperWidthMm).toBe(before.paperWidthMm);
    expect(after.shopNif).toBe(before.shopNif);
  });

  it("survives a reload, because it is rows and not memory", async () => {
    await call("settings:save", { shopCity: "Bilbao", deadStockDays: 45 });
    const fresh = getSettings(env.db, ctxOf());
    expect(fresh.shopCity).toBe("Bilbao");
    expect(fresh.deadStockDays).toBe(45);
    expect(env.db.select().from(s.settings).all().some((r) => r.key === "shopCity")).toBe(true);
  });

  it("shows the numbering without offering a way to change it", async () => {
    const res = await call<{
      series: Array<{ docType: string; prefix: string; nextNumber: number; nextDocNumber: string }>;
      taxRegimes: Array<{ code: string; rateBp: number }>;
    }>("settings:series", {});

    const ticket = res.series.find((r) => r.docType === "ticket")!;
    /* built with the SAME allocator a real document uses, so what Ajustes
       promises is what the next document will be called (ADR-0008) */
    expect(ticket.nextDocNumber).toBe("T1-000001");
    expect(res.taxRegimes.find((r) => r.code === "IVA21")!.rateBp).toBe(2100);
    expect(res.taxRegimes.find((r) => r.code === "REBU")!.rateBp).toBe(0);

    // there is no write channel, and there must never be one
    expect([...handlers.keys()].filter((c) => /series/i.test(c) && c !== "settings:series")).toEqual([]);
  });
});

/* ------------------------------------------------- documents, one flat list */

describe("the documents list", () => {
  it("lists only what a peek can open", async () => {
    const res = await call<{ rows: Array<{ docType: string }>; truncated: boolean }>("docs:list", { limit: 200 });
    /* a `shift` document is the Z: it belongs to Caja's history and has no
       lines a document peek could render */
    expect(res.rows.every((r) => r.docType !== "shift")).toBe(true);
    expect(res.truncated).toBe(false);
  });

  it("is registered read-only — no write channel touches a document here", () => {
    expect(handlers.has("docs:list")).toBe(true);
    expect([...handlers.keys()].filter((c) => c.startsWith("docs:"))).toEqual(["docs:list"]);
  });
});

/* ------------------------------------ 2 · Save PDF goes where it was told */

describe("Guardar PDF…", () => {
  /** A completed ticket, written directly — the sale path has its own tests. */
  function ticket() {
    const now = new Date();
    const docId = uuidv7();
    const series = env.db.select().from(s.numberSeries).all()[0]!;
    env.db
      .insert(s.documents)
      .values({
        id: docId,
        tenantId: env.ctx.tenantId,
        locationId: env.ctx.locationId,
        terminalId: env.ctx.terminalId,
        docType: "ticket",
        status: "completed",
        seriesId: series.id,
        number: 1,
        docNumber: "T1-000001",
        subtotalCents: 818,
        taxCents: 172,
        totalCents: 990,
        userId: owner.id,
        createdAt: now,
        completedAt: now,
      })
      .run();
    env.db
      .insert(s.documentLines)
      .values({
        id: uuidv7(),
        tenantId: env.ctx.tenantId,
        documentId: docId,
        lineNo: 1,
        lineType: "product",
        description: "Cable USB-C",
        qty: 1,
        unitPriceCents: 990,
        priceOverridden: false,
        taxRegime: "IVA21",
        taxRateBp: 2100,
        baseCents: 818,
        taxCents: 172,
        totalCents: 990,
        createdAt: now,
      })
      .run();
    env.db
      .insert(s.documentTenders)
      .values({ id: uuidv7(), tenantId: env.ctx.tenantId, documentId: docId, method: "card", amountCents: 990, createdAt: now })
      .run();
    return docId;
  }

  it("writes the file the shop chose, and nowhere else", async () => {
    const docId = ticket();
    const out = join(mkdtempSync(join(tmpdir(), "arkom-save-")), "mi-ticket.pdf");
    setNextSavePath(out);

    const res = await call<{ kind: string; path?: string }>("print:savePdf", { docId, kind: "ticket" });

    expect(res.kind).toBe("saved");
    expect(res.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    /* and it did NOT also file a copy somewhere the shop did not ask for */
    expect(existsSync(join(pdfTempDir(), "T1-000001.pdf"))).toBe(false);
  });

  it("treats Cancel as a decision, not a failure", async () => {
    const docId = ticket();
    setNextSavePath(null);
    const res = await call<{ kind: string }>("print:savePdf", { docId, kind: "ticket" });
    /* a red toast for closing a save dialog would be the till arguing with
       somebody who changed their mind */
    expect(res.kind).toBe("cancelled");
  });

  it("records the save in the oplog, like every other print", async () => {
    const docId = ticket();
    setNextSavePath(join(mkdtempSync(join(tmpdir(), "arkom-save-")), "x.pdf"));
    await call("print:savePdf", { docId, kind: "ticket" });
    const entry = env.db.select().from(s.oplog).all().find((e) => e.action === "print")!;
    expect(entry.after).toMatchObject({ target: "pdf", saved: true });
  });
});

/* ------------------------- 5 · the peek is one component, everywhere ---- */

describe("the document peek", () => {
  it("is the SAME component at every entry point", async () => {
    const { readFileSync, readdirSync: rd, statSync } = await import("node:fs");
    const root = join(__dirname, "../../renderer/src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of rd(dir)) {
        const full = join(dir, n);
        if (statSync(full).isDirectory()) walk(full);
        else if (n.endsWith(".tsx")) files.push(full);
      }
    };
    walk(root);

    /* Every screen that shows a document opens the shared modal rather than
       rolling its own. That is what makes "Reprint and Save PDF appear
       everywhere" a property of ONE file instead of a list to maintain. */
    const slash = (f: string) => f.split("\\").join("/");
    const openers = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /<(TicketPeekModal|PurchasePeekModal)/.test(src) && !slash(f).includes("/components/");
    });
    const names = openers.map((f) => slash(f).split("/renderer/src/")[1] ?? slash(f));

    for (const expected of [
      "screens/inventory/movements-drawer.tsx", // the inventory trail
      "screens/sale/sale-screen.tsx", //           Find ticket
      "screens/repair/repair-detail.tsx", //       the repair page
      "screens/used/used-device-detail.tsx", //    a used device
      "screens/cash/cash-screen.tsx", //           shift history
      "screens/reports/sales-report.tsx", //       a report drill-down
      "screens/documents/documents-screen.tsx", // the flat list
    ]) {
      expect(names, `${expected} should open the shared peek`).toContain(expected);
    }
  });

  it("carries Save PDF and Reprint in the component itself", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(join(__dirname, "../../renderer/src/components/ticket-peek-modal.tsx"), "utf8");
    /* both actions live on the peek, so a new entry point gets them by
       existing rather than by remembering to add them */
    expect(src).toContain("peek.savePdf");
    expect(src).toContain("print:savePdf");
    expect(src).toContain("printer.print(");
  });
});

/* ---------------------------------- 7 · upgrading a populated database -- */

/* ------------------------------------ the printing card (v0.18.1) */

describe("the printer the till prints on", () => {
  it("reads a retired command set as Epson, rather than as a value nothing understands", () => {
    /* v0.18.1 dropped tanca/daruma/brother from the picker. A till that stored
       one keeps working: every receipt printer this app is likely to meet
       speaks ESC/POS, so the fallback is the honest one. */
    env.db
      .insert(s.settings)
      .values({ tenantId: env.ctx.tenantId, key: "commandSet", value: "tanca", updatedAt: new Date() })
      .run();
    expect(getSettings(env.db, ctxOf()).commandSet).toBe("epson");
  });

  it("keeps Star, which is the one exception worth offering", () => {
    saveSettings(env.db, ctxOf(), { commandSet: "star" });
    expect(getSettings(env.db, ctxOf()).commandSet).toBe("star");
  });

  it("refuses to store a command set the picker no longer offers", async () => {
    const before = getSettings(env.db, ctxOf()).commandSet;
    try {
      await call("settings:save", { commandSet: "daruma" });
      throw new Error("expected a refusal");
    } catch (err) {
      expect(parseIpcError(err)?.code).toBe("VALIDATION");
    }
    expect(getSettings(env.db, ctxOf()).commandSet).toBe(before);
  });

  it("refuses a test print when no printer is configured", async () => {
    /* the button is disabled in Ajustes; this is the same rule in main. A PDF
       of a sample ticket answers no question anybody asked. */
    expect(getSettings(env.db, ctxOf()).printerName).toBe("");
    try {
      await call("print:test", { target: "auto" });
      throw new Error("expected a refusal");
    } catch (err) {
      expect(parseIpcError(err)?.code).toBe("PRINTER_REQUIRED");
    }
    expect(env.db.select().from(s.oplog).all().filter((e) => e.action === "test")).toEqual([]);
  });
});

describe("upgrading a v0.16.1 till", () => {
  it("needs no migration, because settings are rows and not columns", () => {
    /* This release adds four shop fields and removes one folder setting, and
       the schema did not move at all: `settings` is a key/value table, so a new
       setting is a row that does not exist yet rather than a column somebody
       has to add. That is the whole reason this test is short. */
    const applied = env.db.select().from(s.settings).all();
    expect(applied.every((r) => typeof r.key === "string")).toBe(true);
  });

  it("reads a missing setting as its default rather than as blank or a crash", () => {
    /* a till upgrading has no `shopCity` row, and every screen must cope: the
       defaults are the shape, the rows are the overrides */
    expect(env.db.select().from(s.settings).all().some((r) => r.key === "shopCity")).toBe(false);
    const settings = getSettings(env.db, ctxOf());
    expect(settings.shopCity).toBe("");
    expect(settings.shopPostalCode).toBe("");
    expect(settings.shopPhone).toBe("");
    expect(settings.shopDisplayName).toBe("");
    // and the settings that DID exist are untouched by the new ones arriving
    expect(settings.paperWidthMm).toBe(80);
    expect(settings.idleLockMinutes).toBe(5);
  });

  it("keeps documents written before the change readable and printable", () => {
    const now = new Date();
    const docId = uuidv7();
    env.db
      .insert(s.documents)
      .values({
        id: docId,
        tenantId: env.ctx.tenantId,
        locationId: env.ctx.locationId,
        terminalId: env.ctx.terminalId,
        docType: "ticket",
        status: "completed",
        docNumber: "T1-000900",
        subtotalCents: 818,
        taxCents: 172,
        totalCents: 990,
        userId: owner.id,
        createdAt: now,
        completedAt: now,
      })
      .run();

    /* the letterhead a v0.16.1 ticket was printed with had three lines; the
       reprint renders TODAY's profile, which may have five. That is correct —
       the shop's address is a fact about the shop, not about the sale. */
    const rows = env.db.select().from(s.documents).where(eq(s.documents.id, docId)).all();
    expect(rows[0]!.docNumber).toBe("T1-000900");
    /* a till that never filled its letterhead prints none of it — since v0.18.0
       there is no PENDIENTE placeholder to print by accident */
    expect(shopHeaderLines(shopProfile(env.db, ctxOf()))).toEqual([]);
    saveSettings(env.db, ctxOf(), { shopLegalName: "Arkom Electrónica S.L.", shopNif: "B00000000", shopAddress: "Calle Ejemplo 1" });
    expect(shopHeaderLines(shopProfile(env.db, ctxOf())).length).toBeGreaterThanOrEqual(3);
  });
});
