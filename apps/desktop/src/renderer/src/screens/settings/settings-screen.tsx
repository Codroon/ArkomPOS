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
  PrintTicketsDirResponseSchema,
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
const PENDING = "PENDIENTE";

export function SettingsScreen() {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [ticketsPath, setTicketsPath] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [demoConfirm, setDemoConfirm] = useState(false);
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
      .invoke("print:ticketsDir")
      .then((raw) => setTicketsPath(PrintTicketsDirResponseSchema.parse(raw).path))
      .catch((err) => console.error("print:ticketsDir failed", err));
    window.arkom
      .invoke("demo:status")
      .then((raw) => setDemo(DemoStatusResponseSchema.parse(raw)))
      .catch((err) => console.error("demo:status failed", err));
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
  const openTicketsFolder = useCallback(() => {
    if (!ticketsPath) return;
    void window.arkom
      .invoke("print:reveal", { path: ticketsPath, mode: "folder" })
      .catch((err) => say(errorMessage(t, err), "danger"));
  }, [ticketsPath, say, t]);

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

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid max-w-[860px] grid-cols-2 gap-x-8 gap-y-5">
          {/* ---------------- printing ---------------- */}
          <section className="col-span-1 flex flex-col gap-4">
            <SectionLabel>{t("set.printingSection")}</SectionLabel>

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
            {/* the folder sits inside a hidden AppData tree, so the path is shown
                for reference and the button is how anyone actually gets there */}
            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">
                {t("set.ticketsFolder")}
              </div>
              <div className="break-all font-mono text-[10px] leading-snug text-subtle">
                {ticketsPath ?? t("common.dash")}
              </div>
              <div>
                <GhostButton disabled={!ticketsPath} onClick={openTicketsFolder}>
                  {t("set.openTicketsFolder")}
                </GhostButton>
              </div>
              <div className="text-[11px] leading-snug text-subtle">{t("set.ticketsFolderHint")}</div>
            </div>
          </section>

          {/* ---------------- shop ---------------- */}
          <section className="col-span-1 flex flex-col gap-4">
            <SectionLabel>{t("set.shopSection")}</SectionLabel>

            <ShopField
              label={t("set.legalName")}
              value={settings.shopLegalName}
              onCommit={(v) => void save({ shopLegalName: v })}
              pendingHint={t("set.pendingHint")}
            />
            <ShopField
              label={t("set.nif")}
              value={settings.shopNif}
              mono
              onCommit={(v) => void save({ shopNif: v })}
              pendingHint={t("set.pendingHint")}
            />
            <ShopField
              label={t("set.address")}
              value={settings.shopAddress}
              onCommit={(v) => void save({ shopAddress: v })}
              pendingHint={t("set.pendingHint")}
            />
            <ShopField
              label={t("set.footer")}
              value={settings.ticketFooter}
              onCommit={(v) => void save({ ticketFooter: v })}
              hint={t("set.footerHint")}
            />
          </section>

          {/* ---------------- the till itself ---------------- */}
          <section className="flex flex-col gap-2">
            <SectionLabel>{t("set.tillSection")}</SectionLabel>

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
          </section>

          {/* ---------------- repairs (ADR-0014) ----------------
              All four land as DATA, and the first two are snapshotted onto every
              ticket at intake: changing them tomorrow must not reach back into a
              device taken in today (ADR-0014 §8). */}
          <section className="flex flex-col gap-2">
            <SectionLabel>{t("set.repairSection")}</SectionLabel>

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
          </section>

          {/* ---------------- cash (ADR-0015) ----------------
              The client's answers about their own drawer, as data. None of
              these is snapshotted: a shift reads them at the moment it opens or
              closes, and changing one tomorrow changes tomorrow. */}
          <section className="flex flex-col gap-2">
            <SectionLabel>{t("set.cashSection")}</SectionLabel>

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

            <Field label={t("set.cashConcepts")} hint={t("set.cashConceptsHint")}>
              <ConceptsSetting
                concepts={settings.cashConcepts}
                onCommit={(next) => void save({ cashConcepts: next })}
              />
            </Field>
          </section>

          <BackupPanel say={say} />

          {/* ---------------- demo data ---------------- */}
          {demo?.present ? (
            <section className="col-span-2 flex flex-col gap-2 border-t border-line pt-4">
              <SectionLabel>{t("demo.section")}</SectionLabel>
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
            </section>
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
function ShopField({
  label,
  value,
  onCommit,
  hint,
  pendingHint,
  mono,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  hint?: string;
  pendingHint?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const isPending = value.startsWith(PENDING);

  return (
    <Field label={label} hint={isPending ? (pendingHint ?? null) : (hint ?? null)}>
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
