/**
 * The recovery code, shown exactly once (handoff/auth.md §5.3).
 *
 * Not dismissible by Esc or a click outside, and the confirm button is disabled
 * for five seconds. That delay is the only thing standing between an owner and
 * clicking through a screen they will need in a year — the whole point is that
 * they stop and look at it.
 */
import { useCallback, useEffect, useState } from "react";
import { PrintTicketResponseSchema } from "@arkom/core";
import { AccentButton, GhostButton, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { usePrinterReady } from "../../lib/printer-ready";

const CONFIRM_DELAY_SECONDS = 5;

export function RecoveryCodeStep({
  code,
  ownerName,
  onDone,
}: {
  code: string;
  ownerName: string;
  onDone: () => void;
}) {
  const t = useT();
  const [countdown, setCountdown] = useState(CONFIRM_DELAY_SECONDS);
  const [printing, setPrinting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  /* On a fresh till there is usually no printer yet, and this code is the one
     thing in the app that cannot be recovered from the database. So the blue
     button is whichever act actually keeps it: printing when there is a
     printer, saving the PDF when there is not (v0.18.2). */
  const printerReady = usePrinterReady();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const print = useCallback(async () => {
    setPrinting(true);
    setNote(null);
    try {
      const res = PrintTicketResponseSchema.parse(
        await window.arkom.invoke("auth:printRecovery", { code, name: ownerName }),
      );
      // no printer yet is normal on a fresh till — the PDF still saves the code
      setNote(res.kind === "pdf" ? res.path : t("print.printed"));
      setKept(true);
    } catch (err) {
      setNote(errorMessage(t, err));
    } finally {
      setPrinting(false);
    }
  }, [code, ownerName, t]);

  return (
    <div className="w-full max-w-[520px]">
      <div className="text-[10px] font-bold uppercase tracking-[.12em] text-muted">{t("rec.title")}</div>

      <div className="mt-3 rounded-[3px] border border-warning-ink/25 bg-warning-bg px-3 py-2 text-[11px] font-semibold leading-snug text-warning-ink">
        {t("rec.warning")}
      </div>

      <div className="mt-3 rounded-[3px] border border-line-strong bg-card px-4 py-5 text-center">
        <div className="font-mono text-[22px] font-bold tracking-[.14em] text-ink">{code}</div>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">{t("rec.body")}</p>

      {note ? (
        <div className="mt-3 break-all rounded-[3px] border border-line bg-surface-2 px-3 py-2 font-mono text-[10px] text-subtle">
          {note}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-end gap-2">
        {printerReady ? (
          <>
            <GhostButton disabled={printing} onClick={() => void print()}>
              {printing ? t("rec.printing") : t("rec.print")}
            </GhostButton>
            {/* the screen's one blue element, and it waits */}
            <AccentButton disabled={countdown > 0} onClick={onDone}>
              {countdown > 0 ? t("rec.savedWait", { n: String(countdown) }) : t("rec.saved")}
            </AccentButton>
          </>
        ) : (
          <>
            <GhostButton disabled={countdown > 0 || (!kept && countdown <= 0 && false)} onClick={onDone}>
              {countdown > 0 ? t("rec.savedWait", { n: String(countdown) }) : t("rec.saved")}
            </GhostButton>
            {/* no printer: the PDF is the only copy that leaves this screen */}
            <AccentButton disabled={printing} onClick={() => void print()}>
              {printing ? t("rec.printing") : t("rec.savePdf")}
            </AccentButton>
          </>
        )}
      </div>
    </div>
  );
}
