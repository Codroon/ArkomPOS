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
  SettingsSchema,
  PrintPrintersResponseSchema,
  PrintTicketResponseSchema,
  type PrinterInfo,
  type Settings,
} from "@arkom/core";
import {
  AccentButton,
  Field,
  GhostButton,
  SectionLabel,
  SelectInput,
  Segmented,
  TextInput,
  Toast,
  useT,
} from "@arkom/ui";
import { errorMessage } from "../../lib/errors";

/** Shown beneath any field the seed left as a placeholder. */
const PENDING = "PENDIENTE";

export function SettingsScreen() {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [testing, setTesting] = useState(false);
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
        say(res.kind === "pdf" ? t("print.pdfSaved", { path: res.path }) : t("print.printed"));
      } catch (err) {
        say(errorMessage(t, err), "danger");
      } finally {
        setTesting(false);
      }
    },
    [say, t],
  );

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
            <div className="text-[11px] leading-snug text-subtle">{t("set.ticketsFolder")}</div>
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
        </div>
      </div>

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
