/**
 * The purchase, read on screen — the sale peek's twin.
 *
 * Opened from the Documento link on a `tradein_in` movement, the way a sale's
 * link opens its ticket. Before this, that link showed "—": the ledger recorded
 * a phone arriving and offered no way back to the paperwork.
 *
 * It deliberately mirrors TicketPeekModal rather than reproducing the printed
 * document. Both links live in the same drawer, and one opening a screen while
 * the other opened a monospaced picture of paper was the wrong kind of
 * difference — a sale and a purchase are the same KIND of thing here: a numbered
 * document with a date, some detail, and an amount. Reimprimir is what produces
 * the paper.
 *
 * The ownership declaration and the signature rule are not shown. They exist so
 * a person can sign them, and nobody signs a screen.
 */
import { useEffect, useState } from "react";
import type { UsedPeek } from "@arkom/core";
import { Chip, GhostButton, MoneyText, SectionLabel, useT, type TKey } from "@arkom/ui";
import { PrintToast } from "../lib/print-toast";
import { useTicketPrint } from "../lib/use-ticket-print";
import { idDocLabel } from "../lib/enum-labels";
import { errorMessage } from "../lib/errors";

const PAYOUT_KEYS: Record<string, TKey> = {
  cash: "used.payout.cash",
  transfer: "used.payout.transfer",
  store_credit: "used.payout.credit",
};

const ACCESSORY_KEYS: Record<string, TKey> = {
  charger: "used.device.charger",
  box: "used.device.box",
  cable: "used.device.cable",
  case: "used.device.case",
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Label left, value right — the shape every row in the sale peek has. */
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]">
      <span className="text-muted">{label}</span>
      <span className={mono ? "font-mono font-medium tabular-nums text-ink-2" : "text-ink-2"}>{value}</span>
    </div>
  );
}

export function PurchasePeekModal({
  documentId,
  purchaseId,
  onClose,
}: {
  documentId?: string;
  purchaseId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const [peek, setPeek] = useState<UsedPeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printer = useTicketPrint();

  useEffect(() => {
    window.arkom
      .invoke("used:peek", { ...(documentId ? { documentId } : {}), ...(purchaseId ? { purchaseId } : {}) })
      .then(setPeek)
      .catch((err) => setError(errorMessage(t, err)));
  }, [documentId, purchaseId, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const device = peek?.device;
  const attrs = device ? [device.storage, device.color].filter(Boolean).join(" · ") : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/25" onMouseDown={onClose}>
      <div
        className="flex max-h-[80vh] w-[380px] flex-col rounded-[3px] border border-line-strong bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* same header as a ticket: the number, then when it happened */}
        <div className="flex items-baseline gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="font-mono text-[14px] font-bold tabular-nums">{peek?.docNumber ?? "…"}</div>
          {peek ? (
            <div className="font-mono font-medium text-[10px] tabular-nums text-muted">
              {formatDate(peek.purchasedAtMs)}
            </div>
          ) : null}
          <div className="flex-1" />
          <Chip>{t("purchasePeek.chip")}</Chip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <div className="text-[12px] text-danger-ink">{error}</div>
          ) : !peek || !device ? (
            <div className="text-[12px] text-subtle">{t("usedList.loading")}</div>
          ) : (
            <>
              {/* the device, in the shape a ticket line takes */}
              <div className="flex items-baseline gap-2 border-b border-line py-1.5 text-[12px]">
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {device.brand} {device.model}
                    {attrs ? <span className="text-muted"> · {attrs}</span> : null}
                  </div>
                  <div className="font-mono font-medium text-[10px] tabular-nums text-subtle">
                    IMEI {device.imei}
                  </div>
                </div>
                <Chip>{t("pick.grade", { grade: device.grade })}</Chip>
              </div>

              <div className="mt-2">
                <Row
                  label={t("usedDetail.battery")}
                  value={device.batteryPct === null ? t("common.dash") : `${device.batteryPct}%`}
                />
                <Row
                  label={t("usedDetail.accessories")}
                  value={
                    device.accessories.length > 0
                      ? device.accessories.map((a) => t(ACCESSORY_KEYS[a]!)).join(", ")
                      : t("usedDetail.noAccessories")
                  }
                />
              </div>

              {/* who sold it — the reason this document exists */}
              <div className="mt-3">
                <SectionLabel>{t("usedDetail.seller")}</SectionLabel>
                <Row label={t("usedDetail.sellerName")} value={peek.seller.name} />
                <Row
                  label={t("usedDetail.sellerDoc")}
                  value={`${idDocLabel(t, peek.seller.idType)} ${peek.seller.idNumber}`}
                  mono
                />
                {peek.seller.phone ? (
                  <Row label={t("usedDetail.sellerPhone")} value={peek.seller.phone} mono />
                ) : null}
              </div>

              {/* the amount, weighted like a ticket total */}
              <div className="mt-3 space-y-0.5 text-[11px]">
                <div className="flex justify-between text-[14px] font-bold">
                  <span>{t("purchasePeek.paid")}</span>
                  <MoneyText cents={peek.buyPriceCents} />
                </div>
              </div>

              <div className="mt-3">
                <SectionLabel>{t("usedDetail.payout")}</SectionLabel>
                <div className="flex justify-between py-0.5 text-[11px] text-ink-2">
                  <span>
                    {t(PAYOUT_KEYS[peek.payout] ?? "used.payout.cash")}
                    {peek.payoutReference ? (
                      <span className="ml-1 font-mono font-medium text-[10px] text-subtle">
                        {peek.payoutReference}
                      </span>
                    ) : null}
                  </span>
                  <MoneyText cents={peek.buyPriceCents} />
                </div>
                {peek.voucher ? (
                  <div className="flex justify-between py-0.5 text-[11px] text-muted">
                    <span>{t("usedDetail.voucher")}</span>
                    <span className="flex items-baseline gap-1.5">
                      <MoneyText cents={peek.voucher.remainingCents} />
                      <Chip variant={peek.voucher.status === "issued" ? "success" : "neutral"}>
                        {t(peek.voucher.status === "issued" ? "voucher.usable" : "voucher.refusalUsed")}
                      </Chip>
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="mt-3">
                <Row label={t("purchasePeek.attendedBy")} value={peek.cashierName} />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-2">
          {peek ? (
            <GhostButton
              disabled={printer.state.busy}
              onClick={() => printer.printPurchase(peek.purchaseId, "document", true)}
            >
              {printer.state.busy ? t("print.printing") : t("print.reprint")}
            </GhostButton>
          ) : null}
          {/* the same action as the ticket peek, for the same reason: a file
              only when the shop asks for one (v0.17.0) */}
          {peek ? (
            <GhostButton
              onClick={() =>
                void window.arkom
                  .invoke("print:savePdf", { docId: peek.purchaseId, kind: "purchase", copy: false })
                  .catch((err) => console.error("print:savePdf failed", err))
              }
            >
              {t("peek.savePdf")}
            </GhostButton>
          ) : null}
          <GhostButton onClick={onClose}>{t("peek.close")}</GhostButton>
        </div>
      </div>

      <PrintToast printer={printer} />
    </div>
  );
}
