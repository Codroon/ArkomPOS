/**
 * Ajustes-lite — the two things Phase 1 must be able to configure: where the
 * ticket prints, and what the shop legally is.
 *
 * Everything else behind nav 11 stays locked. Fields save on blur rather than
 * behind a Save button: there is nothing to validate across fields, and a till
 * that quietly keeps a half-typed NIF because nobody pressed Guardar is worse
 * than one that writes each field as it is left.
 *
 * Brand: the screen's single blue element is "Imprimir prueba" — the only
 * action here that does anything to the world.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  centsToInput,
  parseMoneyInput,
  SettingsSchema,
  PrintPrintersResponseSchema,
  PrintTicketResponseSchema,
  DemoStatusResponseSchema,
  DemoRemoveResponseSchema,
  type DemoStatus,
  type PrinterInfo,
  type Settings,
} from "@arkom/core";
import {
  AccentButton,
  ConfirmDialog,
  Field,
  GhostButton,
  SectionLabel,
  ScanInput,
  type TKey,
  SelectInput,
  Segmented,
  Switch,
  TextInput,
  Toast,
  useT,
} from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { fileNameOf } from "../../lib/use-ticket-print";
import { BackupPanel } from "./backup-panel";

/** Shown beneath any field the seed left as a placeholder. */

export function SettingsScreen() {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [series, setSeries] = useState<{
    series: Array<{ docType: string; prefix: string; nextNumber: number; nextDocNumber: string }>;
    taxRegimes: Array<{ code: string; rateBp: number }>;
  } | null>(null);
  const [demoConfirm, setDemoConfirm] = useState(false);
  const [testingDrawer, setTestingDrawer] = useState(false);
  const [scanProbe, setScanProbe] = useState("");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [removingDemo, setRemovingDemo] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "neutral" | "danger" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((message: string, tone: "neutral" | "danger" = "neutral") => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    window.arkom
      .invoke("settings:get")
      .then((raw) => setSettings(SettingsSchema.parse(raw)))
      .catch((err) => console.error("settings:get failed", err));
    window.arkom
      .invoke("print:printers")
      .then((raw) => setPrinters(PrintPrintersResponseSchema.parse(raw)))
      .catch((err) => console.error("print:printers failed", err));
    window.arkom
      .invoke("demo:status")
      .then((raw) => setDemo(DemoStatusResponseSchema.parse(raw)))
      .catch((err) => console.error("demo:status failed", err));
    window.arkom
      .invoke("settings:series", {})
      .then(setSeries)
      .catch((err) => console.error("settings:series failed", err));
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  /** Persist one field. The repo skips the write when nothing actually moved. */
  const save = useCallback(
    async (patch: Partial<Settings>) => {
      try {
        const next = SettingsSchema.parse(await window.arkom.invoke("settings:save", patch));
        setSettings(next);
        say(t("set.saved"));
      } catch (err) {
        say(errorMessage(t, err), "danger");
      }
    },
    [say, t],
  );

  const testPrint = useCallback(
    async (target: "auto" | "pdf") => {
      setTesting(true);
      try {
        const res = PrintTicketResponseSchema.parse(await window.arkom.invoke("print:test", { target }));
        say(res.kind === "pdf" ? t("print.pdfSaved", { file: fileNameOf(res.path) }) : t("print.printed"));
      } catch (err) {
        say(errorMessage(t, err), "danger");
      } finally {
        setTesting(false);
      }
    },
    [say, t],
  );

  /** Hand the tickets folder to the OS file manager. */

  /** The "is it plugged in" test — a pulse with no sale behind it. */
  const testDrawer = useCallback(async () => {
    setTestingDrawer(true);
    try {
      await window.arkom.invoke("print:testDrawer", {});
      say(t("set.testDrawerOk"));
    } catch (err) {
      say(errorMessage(t, err), "danger");
    } finally {
      setTestingDrawer(false);
    }
  }, [say, t]);

  /** Remove the sample catalogue. Refused by core once any ticket exists. */
  const removeDemo = useCallback(async () => {
    setDemoConfirm(false);
    setRemovingDemo(true);
    try {
      const removed = DemoRemoveResponseSchema.parse(await window.arkom.invoke("demo:remove"));
      setDemo(DemoStatusResponseSchema.parse(await window.arkom.invoke("demo:status")));
      say(t("demo.removed", { products: String(removed.products) }));
    } catch (err) {
      say(errorMessage(t, err), "danger");
    } finally {
      setRemovingDemo(false);
    }
  }, [say, t]);

  if (!settings) return <div className="p-4 text-[12px] text-muted">…</div>;

  return (
    <>
      <div className="flex flex-none items-baseline gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">{t("set.title")}</h1>
        <span className="text-[11px] text-muted">{t("set.subtitle")}</span>
      </div>

      {/* A card grid rather than two long columns: at 1366×768 the shop should
          see what it can change without scrolling to find out. Cards balance
          because each is one subject, and `auto-rows-min` keeps a short card
          short instead of stretching it to match its neighbour. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4">
          {/* ---------------- printing ---------------- */}
          <SettingsCard title={t("set.printingSection")}>

            <Field label={t("set.printer")} hint={settings.printerName ? null : t("set.printerHint")}>
              <SelectInput
                value={settings.printerName}
                onChange={(e) => void save({ printerName: e.target.value })}
              >
                <option value="">{t("set.printerNone")}</option>
                {/* a printer configured but since removed still shows, so the
                    owner can see what the ticket is pointed at */}
                {settings.printerName && !printers.some((p) => p.name === settings.printerName) ? (
                  <option value={settings.printerName}>{settings.printerName}</option>
                ) : null}
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label={t("set.paperWidth")}>
              <Segmented
                options={[
                  { value: "80", label: t("set.paper80") },
                  { value: "58", label: t("set.paper58") },
                ]}
                value={String(settings.paperWidthMm)}
                onChange={(v) => void save({ paperWidthMm: v === "58" ? 58 : 80 })}
              />
            </Field>

            <Field label={t("set.commandSet")}>
              <SelectInput
                value={settings.commandSet}
                onChange={(e) => void save({ commandSet: e.target.value as Settings["commandSet"] })}
              >
                {(["epson", "star", "tanca", "daruma", "brother"] as const).map((c) => (
                  <option key={c} value={c}>
                    {c[0]!.toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <div className="flex items-center gap-2 pt-1">
              <AccentButton disabled={testing} onClick={() => void testPrint("auto")}>
                {testing ? t("set.testPrinting") : t("set.testPrint")}
              </AccentButton>
              <GhostButton disabled={testing} onClick={() => void testPrint("pdf")}>
                {t("set.testSavePdf")}
              </GhostButton>
            </div>
            {/* Hardware the till can actually ask a question of. There is no
                card-terminal row: we do not integrate the terminal, and a green
                badge we cannot verify would be a lie the shop would trust. */}
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">
                {t("set.hardware")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <GhostButton disabled={!settings.printerName || testingDrawer} onClick={() => void testDrawer()}>
                  {t("set.testDrawer")}
                </GhostButton>
              </div>
              <div className="text-[11px] leading-snug text-subtle">{t("set.testDrawerHint")}</div>
              <Field label={t("set.scannerTest")} hint={t("set.scannerTestHint")}>
                <ScanInput
                  value={scanProbe}
                  placeholder={t("set.scannerTestPlaceholder")}
                  onChange={(e) => setScanProbe(e.target.value)}
                  /* nothing is looked up: the question is only whether the wedge
                     sends what the label says, and a lookup would answer a
                     different one */
                  onScan={(code) => setLastScan(code)}
                />
              </Field>
              {lastScan ? (
                <div className="font-mono text-[11px] text-ink-2">
                  {t("set.scannerLast")} <span className="font-bold">{lastScan}</span>
                </div>
              ) : null}
            </div>
          </SettingsCard>

          {/* ---------------- shop ---------------- */}
          <SettingsCard title={t("set.shopSection")}>

            <ShopField
              label={t("set.shopDisplayName")}
              value={settings.shopDisplayName}
              onCommit={(v) => void save({ shopDisplayName: v })}
              hint={t("set.shopDisplayNameHint")}
            />
            <ShopField
              label={t("set.legalName")}
              value={settings.shopLegalName}
              onCommit={(v) => void save({ shopLegalName: v })}
            />
            <ShopField
              label={t("set.nif")}
              value={settings.shopNif}
              mono
              onCommit={(v) => void save({ shopNif: v })}
            />
            <ShopField
              label={t("set.address")}
              value={settings.shopAddress}
              onCommit={(v) => void save({ shopAddress: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <ShopField
                label={t("set.shopPostalCode")}
                value={settings.shopPostalCode}
                mono
                onCommit={(v) => void save({ shopPostalCode: v })}
              />
              <ShopField
                label={t("set.shopCity")}
                value={settings.shopCity}
                onCommit={(v) => void save({ shopCity: v })}
              />
            </div>
            <ShopField
              label={t("set.shopPhone")}
              value={settings.shopPhone}
              mono
              onCommit={(v) => void save({ shopPhone: v })}
            />
            <ShopField
              label={t("set.footer")}
              value={settings.ticketFooter}
              onCommit={(v) => void save({ ticketFooter: v })}
              hint={t("set.footerHint")}
            />
          </SettingsCard>

          {/* ---------------- taxes and numbering: LOOK, do not touch ------- */}
          <SettingsCard title={t("set.seriesSection")}>
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">{t("set.taxes")}</div>
              {(series?.taxRegimes ?? []).map((r) => (
                <div key={r.code} className="flex items-center justify-between text-[12px]">
                  <span>{t(TAX_LABEL[r.code] ?? "common.dash")}</span>
                  {r.code === "IVA21" ? (
                    /* the one figure that is the till's to hold: the general
                       rate, applied to lines from now on (ADR-0007 A1) */
                    <VatRateSetting rateBp={settings.vatRateBp} onCommit={(bp) => void save({ vatRateBp: bp })} />
                  ) : (
                    <span className="font-mono tabular-nums text-ink-2">{(r.rateBp / 100).toFixed(0)} %</span>
                  )}
                </div>
              ))}
              <div className="text-[11px] leading-snug text-subtle">{t("set.taxesHint")}</div>
            </div>
            <div className="flex flex-col gap-1 border-t border-line pt-3">
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">{t("set.series")}</div>
              {(series?.series ?? []).map((r) => (
                <div key={r.docType} className="flex justify-between text-[12px]">
                  <span>{t(DOC_LABEL[r.docType] ?? "common.dash")}</span>
                  <span className="font-mono tabular-nums text-ink-2">{r.nextDocNumber}</span>
                </div>
              ))}
              {/* no edit control, deliberately: a series' next number IS the
                  gap-free guarantee, and there is no path to change it
                  (ADR-0008) */}
              <div className="text-[11px] leading-snug text-subtle">{t("set.seriesHint")}</div>
            </div>
          </SettingsCard>

          {/* ---------------- the till itself ---------------- */}
          <SettingsCard title={t("set.tillSection")}>

            <Field label={t("set.idleLock")} hint={t("set.idleLockHint")}>
              <SelectInput
                value={String(settings.idleLockMinutes)}
                onChange={(e) => void save({ idleLockMinutes: Number(e.target.value) })}
              >
                <option value="0">{t("set.idleLockNever")}</option>
                {[1, 2, 5, 10, 15, 30].map((n) => (
                  <option key={n} value={n}>
                    {t("set.idleLockMinutes", { n })}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label={t("set.usedMargin")} hint={t("set.usedMarginHint")}>
              <div className="flex items-center gap-1.5">
                <SelectInput
                  value={String(settings.usedMarginPct)}
                  onChange={(e) => void save({ usedMarginPct: Number(e.target.value) })}
                >
                  {[0, 10, 15, 20, 25, 30, 35, 40, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </SelectInput>
                <span className="font-mono text-[12px] text-muted">%</span>
              </div>
            </Field>
          </SettingsCard>

          {/* ---------------- repairs (ADR-0014) ----------------
              All four land as DATA, and the first two are snapshotted onto every
              ticket at intake: changing them tomorrow must not reach back into a
              device taken in today (ADR-0014 §8). */}
          <SettingsCard title={t("set.repairSection")}>

            <Field label={t("set.repairWarranty")} hint={t("set.repairWarrantyHint")}>
              <div className="flex items-center gap-1.5">
                <SelectInput
                  value={String(settings.repairWarrantyMonths)}
                  onChange={(e) => void save({ repairWarrantyMonths: Number(e.target.value) })}
                >
                  {[0, 1, 3, 6, 12, 24].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </SelectInput>
                <span className="text-[12px] text-muted">{t("set.repairMonths")}</span>
              </div>
            </Field>

            <Field label={t("set.repairFee")} hint={t("set.repairFeeHint")}>
              <MoneySetting
                cents={settings.repairDiagnosisFeeCents}
                onCommit={(cents) => void save({ repairDiagnosisFeeCents: cents })}
              />
            </Field>

            <Field label={t("set.repairDeposit")} hint={t("set.repairDepositHint")}>
              <MoneySetting
                cents={settings.repairDepositSuggestionCents}
                onCommit={(cents) => void save({ repairDepositSuggestionCents: cents })}
              />
            </Field>

            <Field label={t("set.repairCap")} hint={t("set.repairCapHint")}>
              <Switch
                label={t("set.repairCapOn")}
                checked={settings.repairCapEnabled}
                onChange={(next) => void save({ repairCapEnabled: next })}
              />
            </Field>
          </SettingsCard>

          {/* ---------------- cash (ADR-0015) ----------------
              The client's answers about their own drawer, as data. None of
              these is snapshotted: a shift reads them at the moment it opens or
              closes, and changing one tomorrow changes tomorrow. */}
          <SettingsCard title={t("set.cashSection")}>

            <Field label={t("set.cashFloat")} hint={t("set.cashFloatHint")}>
              <MoneySetting
                cents={settings.cashDefaultFloatCents}
                onCommit={(cents) => void save({ cashDefaultFloatCents: cents })}
              />
            </Field>

            <Field label={t("set.cashTolerance")} hint={t("set.cashToleranceHint")}>
              <MoneySetting
                cents={settings.cashVarianceToleranceCents}
                onCommit={(cents) => void save({ cashVarianceToleranceCents: cents })}
              />
            </Field>

            <Field label={t("set.cashThreshold")} hint={t("set.cashThresholdHint")}>
              <MoneySetting
                cents={settings.cashMovementApprovalCents}
                onCommit={(cents) => void save({ cashMovementApprovalCents: cents })}
              />
            </Field>

            <Field label={t("set.cashConcepts")} hint={t("set.conceptsHint")}>
              <ConceptsSetting
                concepts={settings.cashConcepts}
                onCommit={(next) => void save({ cashConcepts: next })}
              />
            </Field>
          </SettingsCard>

          {/* ---------------- reports (ADR-0016) ----------------
              One knob, and it is deliberately not a filter on the Stock muerto
              screen: a threshold in the filter bar invites fishing for a number
              that looks better than the one the shop agreed on. */}
          <SettingsCard title={t("set.reportsSection")}>
            <Field label={t("set.deadStockDays")} hint={t("set.deadStockDaysHint")}>
              <div className="flex items-center gap-1.5">
                <SelectInput
                  value={String(settings.deadStockDays)}
                  onChange={(e) => void save({ deadStockDays: Number(e.target.value) })}
                >
                  {[30, 60, 90, 120, 180, 365].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </SelectInput>
                <span className="text-[12px] text-muted">{t("rep2.dead.col.days").toLowerCase()}</span>
              </div>
            </Field>
          </SettingsCard>

          <BackupPanel say={say} />

          {/* ---------------- demo data ---------------- */}
          {demo?.present ? (
            <SettingsCard title={t("demo.section")}>
              <div className="text-[12px] text-ink-2">
                {t("demo.present", {
                  products: String(demo.products),
                  groups: String(demo.groups),
                  suppliers: String(demo.suppliers),
                })}
              </div>
              {demo.blockedBySales ? (
                // not a disabled button with no explanation: the reason IS the
                // useful part, and it is permanent rather than a temporary state
                <div className="max-w-[560px] rounded-[3px] border border-warning-ink/25 bg-warning-bg px-3 py-2 text-[11px] leading-snug text-warning-ink">
                  {t("demo.blocked")}
                </div>
              ) : (
                <div>
                  <GhostButton disabled={removingDemo} onClick={() => setDemoConfirm(true)}>
                    {removingDemo ? t("demo.removing") : t("demo.remove")}
                  </GhostButton>
                </div>
              )}
            </SettingsCard>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={demoConfirm}
        title={t("demo.confirmTitle")}
        body={t("demo.confirmBody", { products: String(demo?.products ?? 0) })}
        confirmLabel={t("demo.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void removeDemo()}
        onCancel={() => setDemoConfirm(false)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  );
}

/**
 * A shop-profile field. Keeps its own draft so typing is not fought by the
 * round-trip, and commits on blur or Enter. Placeholder values from the seed
 * carry a visible reminder that the real data is still owed by the client.
 */
/**
 * One subject, one card.
 *
 * The old screen was two tall columns of labelled groups, which meant the shop
 * scrolled to find out what it could change. A card says where a subject starts
 * and stops, and the grid reflows to whatever width the till actually has.
 */
/** Regimes and document types as words, not as stored codes. */
const TAX_LABEL: Record<string, TKey> = {
  IVA21: "set.tax.iva21",
  REBU: "set.tax.rebu",
  EXEMPT: "set.tax.exempt",
};
const DOC_LABEL: Record<string, TKey> = {
  ticket: "docs.type.ticket",
  purchase: "docs.type.purchase",
  repair: "docs.type.repair",
  refund: "docs.type.refund",
  shift: "zdoc.zTitle",
};

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[3px] border border-line bg-card px-3.5 py-3">
      <SectionLabel>{title}</SectionLabel>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ShopField({
  label,
  value,
  onCommit,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  hint?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Field label={label} hint={hint ?? null}>
      <TextInput
        value={draft}
        mono={mono}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
  );
}

/**
 * The general VAT rate, in percent. Commits on blur; anything outside 0–100
 * puts the stored figure back rather than saving a typo onto every new line.
 */
function VatRateSetting({ rateBp, onCommit }: { rateBp: number; onCommit: (bp: number) => void }) {
  const [draft, setDraft] = useState(() => String(rateBp / 100));
  useEffect(() => setDraft(String(rateBp / 100)), [rateBp]);
  const commit = () => {
    const n = Number(draft.trim().replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setDraft(String(rateBp / 100));
      return;
    }
    const bp = Math.round(n * 100);
    if (bp !== rateBp) onCommit(bp);
  };
  return (
    <div className="flex items-center gap-1.5">
      <TextInput
        mono
        className="h-6 w-[56px] text-right"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <span className="font-mono text-[12px] text-muted">%</span>
    </div>
  );
}

/**
 * A money setting.
 *
 * Commits on blur, not on every keystroke: each save is a write plus an oplog
 * entry, and "1", "15", "150" on the way to 1,50 € would be three of them.
 */
function MoneySetting({ cents, onCommit }: { cents: number; onCommit: (cents: number) => void }) {
  const [draft, setDraft] = useState(() => centsToInput(cents));
  useEffect(() => setDraft(centsToInput(cents)), [cents]);

  const commit = () => {
    const parsed = parseMoneyInput(draft);
    if (parsed === null) {
      setDraft(centsToInput(cents)); // unparseable: put the stored value back
      return;
    }
    if (parsed !== cents) onCommit(parsed);
  };

  return (
    <TextInput
      mono
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/**
 * The preset concepts, one per line.
 *
 * A textarea rather than a chip editor: the shop will set this once, and a list
 * of five short strings does not need a widget with add and remove buttons.
 * Commits on blur, like the money fields, so typing does not write a row per
 * keystroke.
 */
function ConceptsSetting({ concepts, onCommit }: { concepts: string[]; onCommit: (next: string[]) => void }) {
  const [draft, setDraft] = useState(() => concepts.join("\n"));
  useEffect(() => setDraft(concepts.join("\n")), [concepts]);

  const commit = () => {
    const next = draft
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (next.join("\n") !== concepts.join("\n")) onCommit(next);
  };

  return (
    <textarea
      rows={5}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className="w-full rounded-[3px] border border-line-strong bg-card px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-focus"
    />
  );
}
