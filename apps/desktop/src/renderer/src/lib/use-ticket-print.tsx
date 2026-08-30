/**
 * Printing, from the renderer's side.
 *
 * The contract this hook exists to honour: **the sale is already done.** By the
 * time anything here runs the money is taken and the number allocated, so a
 * failure is never fatal — it becomes a sticky toast offering Reintentar and
 * Guardar PDF, both bound to the JOB that failed. That binding is why the
 * toast can outlive the completed panel: four seconds later the till has moved
 * on to the next customer, and the owner can still recover the document.
 *
 * "Job" rather than "ticket" since v0.11.0: a purchase document and a shelf
 * label go through the same path as a sale ticket. They have to — the first
 * version printed purchases inside the log handler and swallowed the failure in
 * a console line, so a shop with no printer configured got no document, no PDF
 * and no explanation. One print path, one toast, one recovery route.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PrintTicketResponseSchema } from "@arkom/core";
import { useT } from "@arkom/ui";
import { errorMessage } from "./errors";

/** What to print: a sale ticket, a used-device document, or a repair document. */
export type PrintJob =
  | { kind: "ticket"; docId: string; copy: boolean }
  | { kind: "purchase"; purchaseId: string; what: "document" | "label"; copy: boolean }
  | { kind: "repair"; ticketId: string; what: "intake" | "quote" | "receipt" | "return"; copy: boolean };

export interface PrintState {
  busy: boolean;
  /** null when nothing to say */
  message: string | null;
  tone: "neutral" | "danger";
  /** the job a failed attempt was for — what Reintentar retries */
  failed: PrintJob | null;
  /** the PDF a successful save produced — what Abrir opens */
  savedPath: string | null;
}

const IDLE: PrintState = {
  busy: false,
  message: null,
  tone: "neutral",
  failed: null,
  savedPath: null,
};

/** "…\tickets\T1-000042.pdf" → "T1-000042.pdf" */
export const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export function useTicketPrint() {
  const t = useT();
  const [state, setState] = useState<PrintState>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const dismiss = useCallback(() => {
    clearTimer();
    setState(IDLE);
  }, []);

  const run = useCallback(
    async (job: PrintJob, target: "auto" | "pdf") => {
      clearTimer();
      setState({ ...IDLE, busy: true, message: t("print.printing") });
      try {
        const res = PrintTicketResponseSchema.parse(
          job.kind === "ticket"
            ? await window.arkom.invoke("print:ticket", { docId: job.docId, copy: job.copy, target })
            : job.kind === "purchase"
              ? await window.arkom.invoke("used:print", {
                  purchaseId: job.purchaseId,
                  what: job.what,
                  copy: job.copy,
                  target,
                })
              : await window.arkom.invoke("repair:print", {
                  ticketId: job.ticketId,
                  what: job.what,
                  copy: job.copy,
                  target,
                }),
        );
        if (!alive.current) return;
        setState({
          ...IDLE,
          // the file NAME, not the path: the folder lives inside a hidden
          // AppData tree, so the useful thing is the Abrir button beside it
          message: res.kind === "pdf" ? t("print.pdfSaved", { file: fileNameOf(res.path) }) : t("print.printed"),
          savedPath: res.kind === "pdf" ? res.path : null,
        });
        // a plain "printed" fades; a saved PDF stays until dismissed, because
        // its buttons are the only convenient way to reach the file
        if (res.kind !== "pdf") {
          timer.current = setTimeout(() => alive.current && setState(IDLE), 6000);
        }
      } catch (err) {
        if (!alive.current) return;
        // sticky on purpose: the actions are the recovery path, and the panel
        // that triggered this may be gone by the time anyone looks up
        setState({
          ...IDLE,
          message: errorMessage(t, err),
          tone: "danger",
          failed: job,
        });
      }
    },
    [t],
  );

  const print = useCallback(
    (docId: string, copy = false) => void run({ kind: "ticket", docId, copy }, "auto"),
    [run],
  );
  const savePdf = useCallback(
    (docId: string, copy = false) => void run({ kind: "ticket", docId, copy }, "pdf"),
    [run],
  );
  /** The purchase document, or the label that goes on the box. */
  const printPurchase = useCallback(
    (purchaseId: string, what: "document" | "label", copy = false) =>
      void run({ kind: "purchase", purchaseId, what, copy }, "auto"),
    [run],
  );
  /** The intake receipt the customer signs — and, from later slices, the rest. */
  const printRepair = useCallback(
    (ticketId: string, what: "intake" | "quote" | "receipt" | "return" = "intake", copy = false) =>
      void run({ kind: "repair", ticketId, what, copy }, "auto"),
    [run],
  );
  const retry = useCallback(() => {
    if (state.failed) void run(state.failed, "auto");
  }, [run, state.failed]);
  const savePdfForFailed = useCallback(() => {
    if (state.failed) void run(state.failed, "pdf");
  }, [run, state.failed]);

  /** Hand the saved PDF to the OS — open it, or show it in the file manager. */
  const reveal = useCallback(
    (mode: "open" | "folder") => {
      const path = state.savedPath;
      if (!path) return;
      void window.arkom.invoke("print:reveal", { path, mode }).catch((err) => {
        if (alive.current) setState((prev) => ({ ...prev, message: errorMessage(t, err), tone: "danger" }));
      });
    },
    [state.savedPath, t],
  );

  return { state, print, savePdf, printPurchase, printRepair, retry, savePdfForFailed, reveal, dismiss };
}
