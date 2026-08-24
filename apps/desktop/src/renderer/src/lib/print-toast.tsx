/**
 * The print toast, in one place.
 *
 * It has two shapes and both carry actions, which is why it is a component
 * rather than a message string:
 *
 *   failed  — Reintentar · Guardar PDF, bound to the ticket that failed;
 *   saved   — Abrir · Ver carpeta, bound to the file just written.
 *
 * The saved shape matters more than it looks. Tickets land under userData,
 * which on Windows is inside a hidden AppData tree with the app's package name
 * in the path — printing that path at someone is not the same as them being
 * able to open it. These two buttons are the actual route to the file.
 *
 * Neither shape auto-dismisses: a toast whose buttons are the point should not
 * take them away while you are reading it.
 */
import { Toast, useT } from "@arkom/ui";
import type { useTicketPrint } from "./use-ticket-print";

type Printer = ReturnType<typeof useTicketPrint>;

function ToastButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[2px] border border-current/40 px-1.5 py-0.5 text-[11px] font-bold hover:bg-current/10"
    >
      {children}
    </button>
  );
}

export function PrintToast({ printer, className }: { printer: Printer; className?: string }) {
  const t = useT();
  const { failedDocId, savedPath, message, tone } = printer.state;
  const hasActions = failedDocId !== null || savedPath !== null;

  return (
    <Toast
      message={message}
      tone={tone}
      className={className}
      actions={
        hasActions ? (
          <>
            {failedDocId ? (
              <>
                <ToastButton onClick={printer.retry}>{t("print.retry")}</ToastButton>
                <ToastButton onClick={printer.savePdfForFailed}>{t("print.savePdf")}</ToastButton>
              </>
            ) : null}
            {savedPath ? (
              <>
                <ToastButton onClick={() => printer.reveal("open")}>{t("print.openPdf")}</ToastButton>
                <ToastButton onClick={() => printer.reveal("folder")}>{t("print.showFolder")}</ToastButton>
              </>
            ) : null}
            <button
              type="button"
              onClick={printer.dismiss}
              aria-label={t("peek.close")}
              className="px-1 text-[12px] font-bold opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </>
        ) : null
      }
    />
  );
}
