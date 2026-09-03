/**
 * The last step of first run, and the only optional one — v0.18.2.
 *
 * It exists because of the order the shop actually works in: the till is set up
 * on a table, and the printer arrives, or is unpacked, or has its driver
 * installed, some time after. Asking for it here means the common case is
 * finished in one sitting; letting it be skipped means the uncommon one is not
 * stuck on a cable.
 *
 * Skipping is honest about the consequence rather than silent about it: with no
 * printer configured the counter cannot charge (v0.18.1), and the line under
 * the button says so.
 */
import { useCallback, useEffect, useState } from "react";
import { classifyPrinters, PrintPrintersResponseSchema, PrintTicketResponseSchema, type PrinterInfo } from "@arkom/core";
import { AccentButton, Chip, Field, GhostButton, SelectInput, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { refreshPrinterReady } from "../../lib/printer-ready";

export function PrinterStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [chosen, setChosen] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    window.arkom
      .invoke("print:printers")
      .then((raw) => {
        const list = PrintPrintersResponseSchema.parse(raw);
        setPrinters(list);
        // the one queue that looks like a receipt printer, preselected (v0.18.1)
        setChosen((current) => current || (classifyPrinters(list).suggestion?.name ?? ""));
      })
      .catch((err) => console.error("print:printers failed", err));
  }, []);

  const choices = classifyPrinters(printers);

  const testPrint = useCallback(async () => {
    if (!chosen) return;
    setBusy(true);
    setNote(null);
    try {
      /* saved first, then tested: the test IS the confirmation, and a printer
         you cannot test is not one the shop should walk away believing in */
      await window.arkom.invoke("settings:save", { printerName: chosen });
      await refreshPrinterReady();
      const res = PrintTicketResponseSchema.parse(await window.arkom.invoke("print:test", { target: "auto" }));
      setTested(true);
      setNote({ text: res.kind === "printed" ? t("first.printerTested") : t("print.pdfSaved", { file: "" }), ok: true });
    } catch (err) {
      setNote({ text: errorMessage(t, err), ok: false });
    } finally {
      setBusy(false);
    }
  }, [chosen, t]);

  const skip = useCallback(async () => {
    await refreshPrinterReady();
    onDone();
  }, [onDone]);

  return (
    <div className="w-full max-w-[520px]">
      <div className="text-[10px] font-bold uppercase tracking-[.12em] text-muted">{t("first.printerStep")}</div>
      <h2 className="mt-1 font-display text-[20px] leading-tight">{t("first.printerTitle")}</h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{t("first.printerBody")}</p>

      <div className="mt-4 rounded-[3px] border border-line bg-card p-4">
        <Field label={t("set.printer")} hint={choices.suggestion && !chosen ? t("set.printerSuggested") : null}>
          <SelectInput value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">{t("set.printerNone")}</option>
            {choices.physical.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName}
              </option>
            ))}
            {showAll
              ? choices.virtual.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                  </option>
                ))
              : null}
          </SelectInput>
        </Field>
        {choices.virtual.length > 0 && !showAll ? (
          <button
            type="button"
            className="mt-1 text-[11px] font-bold text-accent-ink underline underline-offset-2"
            onClick={() => setShowAll(true)}
          >
            {t("set.printerShowAll")}
          </button>
        ) : null}

        {note ? (
          <div className={`mt-3 text-[11px] leading-snug ${note.ok ? "text-ink-2" : "text-danger-ink"}`}>
            {note.text}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          {/* the screen's one blue element: printing IS the confirmation */}
          <AccentButton disabled={!chosen || busy} onClick={() => void testPrint()}>
            {busy ? t("set.testPrinting") : t("set.testPrint")}
          </AccentButton>
          {tested ? <Chip variant="success">{t("first.printerReady")}</Chip> : null}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="max-w-[300px] text-[11px] leading-snug text-subtle">{t("first.printerSkipHint")}</div>
        <div className="flex gap-2">
          <GhostButton onClick={() => void skip()}>{t("first.printerSkip")}</GhostButton>
          {tested ? <GhostButton onClick={() => void skip()}>{t("first.printerDone")}</GhostButton> : null}
        </div>
      </div>
    </div>
  );
}
