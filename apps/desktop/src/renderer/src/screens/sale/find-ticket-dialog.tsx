/**
 * "Which ticket?" — ADR-0019 A1.
 *
 * The first step of a refund, and it is a question rather than a screen: the
 * customer is holding a receipt, the cashier scans or types its number, and the
 * ordinary document peek opens with Refund inside it.
 *
 * Scanning works because the ticket footer carries its own number as Code128,
 * so the whole flow is scan → peek → Refund without anybody reading digits off
 * a crumpled roll.
 */
import { useEffect, useRef, useState } from "react";
import { AccentButton, Field, GhostButton, ScanInput, useT, type ScanInputHandle } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";

export function FindTicketDialog({
  onCancel,
  onFound,
}: {
  onCancel: () => void;
  onFound: (docId: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);
  const ref = useRef<ScanInputHandle>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const find = async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setBusy(true);
    setMiss(null);
    try {
      const res = await window.arkom.invoke("sale:findTicket", { query: q });
      if (!res.docId) {
        setMiss(t("sale.findTicketMiss", { code: q }));
        return;
      }
      onFound(res.docId);
    } catch (err) {
      setMiss(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-inverse/40" onMouseDown={onCancel}>
      <div
        className="w-[420px] rounded-[3px] border border-line-strong bg-card px-4 py-3.5 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[13px] font-bold">{t("sale.findTicket")}</div>
        <Field label={t("sale.findTicketLabel")} hint={t("sale.findTicketHint")} error={miss ?? undefined}>
          <ScanInput
            ref={ref}
            value={query}
            placeholder={t("sale.findTicketPlaceholder")}
            onChange={(e) => {
              setQuery(e.target.value);
              setMiss(null);
            }}
            /* a scanner sends the whole number then Enter, so both paths are
               the same call */
            onScan={(code) => void find(code)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void find(query);
              }
            }}
          />
        </Field>
        <div className="mt-3 flex justify-end gap-2">
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
          <AccentButton disabled={query.trim() === "" || busy} onClick={() => void find(query)}>
            {t("sale.findTicketOpen")}
          </AccentButton>
        </div>
      </div>
    </div>
  );
}
