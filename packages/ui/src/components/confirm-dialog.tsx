import { useEffect } from "react";
import { GhostButton, PrimaryButton } from "./buttons";

/** Modal confirm. Esc = cancel (00-foundations: Esc closes modal/drawer). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20"
      onMouseDown={onCancel}
    >
      <div
        className="w-[360px] rounded-[3px] border border-line-strong bg-card p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[13px] font-bold text-ink">{title}</div>
        {body ? <div className="mt-1 text-[12px] text-muted">{body}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <GhostButton onClick={onCancel} autoFocus>
            {cancelLabel}
          </GhostButton>
          <PrimaryButton onClick={onConfirm}>{confirmLabel}</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
