/**
 * Printing, from the renderer's side.
 *
 * The contract this hook exists to honour: **the sale is already done.** By the
 * time anything here runs the money is taken and the number allocated, so a
 * failure is never fatal — it becomes a sticky toast offering Reintentar and
 * Guardar PDF, both bound to the ticket that failed. That binding is why the
 * toast can outlive the completed panel: four seconds later the till has moved
 * on to the next customer, and the owner can still recover the ticket.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PrintTicketResponseSchema } from "@arkom/core";
import { useT } from "@arkom/ui";
import { errorMessage } from "./errors";

export interface PrintState {
  busy: boolean;
  /** null when nothing to say */
  message: string | null;
  tone: "neutral" | "danger";
  /** the ticket a failed attempt was for — what Reintentar retries */
  failedDocId: string | null;
  failedCopy: boolean;
  /** the PDF a successful save produced — what Abrir opens */
  savedPath: string | null;
}

const IDLE: PrintState = {
  busy: false,
  message: null,
  tone: "neutral",
  failedDocId: null,
  failedCopy: false,
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
    async (docId: string, copy: boolean, target: "auto" | "pdf") => {
      clearTimer();
      setState({ ...IDLE, busy: true, message: t("print.printing") });
      try {
        const res = PrintTicketResponseSchema.parse(await window.arkom.invoke("print:ticket", { docId, copy, target }));
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
          failedDocId: docId,
          failedCopy: copy,
        });
      }
    },
    [t],
  );

  const print = useCallback((docId: string, copy = false) => void run(docId, copy, "auto"), [run]);
  const savePdf = useCallback((docId: string, copy = false) => void run(docId, copy, "pdf"), [run]);
  const retry = useCallback(() => {
    if (state.failedDocId) void run(state.failedDocId, state.failedCopy, "auto");
  }, [run, state.failedDocId, state.failedCopy]);
  const savePdfForFailed = useCallback(() => {
    if (state.failedDocId) void run(state.failedDocId, state.failedCopy, "pdf");
  }, [run, state.failedDocId, state.failedCopy]);

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

  return { state, print, savePdf, retry, savePdfForFailed, reveal, dismiss };
}
