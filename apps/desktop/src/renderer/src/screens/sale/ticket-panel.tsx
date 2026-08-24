/**
 * Ticket lines + totals strip — handoff 01 right column. Serialized lines get
 * the 3px ink-3 left border + SERIE chip; overrides show the MODIFICADO chip
 * and the original-PVP sub-line. Totals come from server state only.
 */
import { useState } from "react";
import { formatCents, type SaleLineRow, type SaleState } from "@arkom/core";
import { Chip, cn, MoneyText, useT } from "@arkom/ui";

function LineRow({
  line,
  flash,
  onSetQty,
  onOverride,
  onRemove,
}: {
  line: SaleLineRow;
  flash: boolean;
  onSetQty: (line: SaleLineRow, qty: number) => void;
  onOverride: (line: SaleLineRow) => void;
  onRemove: (line: SaleLineRow) => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const serialized = line.lineType === "serialized_unit";

  return (
    <div
      className={cn(
        "relative border-b border-line bg-card px-3 py-2 transition-colors duration-500",
        serialized && "border-l-[3px] border-l-muted",
        flash && "bg-surface-2",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] leading-snug">
            {line.description}
            {serialized ? <Chip className="ml-1.5">{t("chip.serie")}</Chip> : null}
            {line.priceOverridden ? (
              <Chip variant="warn" className="ml-1.5">
                {t("chip.modificado")}
              </Chip>
            ) : null}
          </div>
          <div className="font-mono text-[10px] tabular-nums text-subtle">
            {serialized ? `IMEI ${line.imei ?? "—"}` : line.barcode ?? "—"} · {line.qty} ×{" "}
            {formatCents(line.unitPriceCents)}
          </div>
          {line.priceOverridden && line.originalPriceCents != null ? (
            <div className="text-[10px] leading-snug text-muted">
              {t("sale.pvpOriginal", {
                price: formatCents(line.originalPriceCents),
                reason: line.overrideReason ?? "",
              })}
            </div>
          ) : null}
        </div>

        {/* qty stepper — serialized locked at 1 */}
        <div className="flex items-center gap-1">
          {!serialized ? (
            <button
              type="button"
              className="h-5 w-5 rounded-[2px] border border-line-strong text-[11px] leading-none text-ink-2 hover:border-muted disabled:text-subtle"
              disabled={line.qty <= 1}
              onClick={() => onSetQty(line, line.qty - 1)}
            >
              −
            </button>
          ) : null}
          <span className="w-5 text-center font-mono text-[12px] font-bold tabular-nums">{line.qty}</span>
          {!serialized ? (
            <button
              type="button"
              className="h-5 w-5 rounded-[2px] border border-line-strong text-[11px] leading-none text-ink-2 hover:border-muted"
              onClick={() => onSetQty(line, line.qty + 1)}
            >
              +
            </button>
          ) : null}
        </div>

        <MoneyText cents={line.totalCents} className="mt-0.5 w-[74px] text-right text-[12px] font-bold" />

        <button
          type="button"
          className="mt-0.5 px-0.5 text-[13px] leading-none text-muted hover:text-ink"
          onClick={() => setMenuOpen((o) => !o)}
        >
          ⋯
        </button>
      </div>

      {menuOpen ? (
        <div
          className="absolute right-2 top-7 z-20 flex flex-col rounded-[3px] border border-line-strong bg-card shadow-md"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            className="px-3 py-1.5 text-left text-[11px] text-ink-2 hover:bg-hover"
            onClick={() => {
              setMenuOpen(false);
              onOverride(line);
            }}
          >
            {t("sale.modifyPrice")}
          </button>
          <button
            type="button"
            className="border-t border-line px-3 py-1.5 text-left text-[11px] text-ink-2 hover:bg-hover"
            onClick={() => {
              setMenuOpen(false);
              onRemove(line);
            }}
          >
            {t("sale.removeLine")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TicketPanel({
  sale,
  flashLineId,
  shake,
  onSetQty,
  onOverride,
  onRemove,
}: {
  sale: SaleState | null;
  flashLineId: string | null;
  shake: boolean;
  onSetQty: (line: SaleLineRow, qty: number) => void;
  onOverride: (line: SaleLineRow) => void;
  onRemove: (line: SaleLineRow) => void;
}) {
  const t = useT();
  const lines = sale?.lines ?? [];

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", shake && "arkom-shake")}>
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
        <div className="text-[13px] font-bold">{t("sale.ticket")}</div>
        <div className="text-[11px] text-muted">
          {lines.length === 1 ? t("sale.lineCountOne") : t("sale.lineCountMany", { n: lines.length })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-muted">{t("sale.emptyTicket")}</div>
        ) : (
          lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              flash={line.id === flashLineId}
              onSetQty={onSetQty}
              onOverride={onOverride}
              onRemove={onRemove}
            />
          ))
        )}
      </div>

      {/* totals strip — always server state (handoff 01) */}
      <div className="border-t border-line-strong bg-surface-2 px-3 py-2 font-mono tabular-nums">
        <div className="flex justify-between text-[11px] text-muted">
          <span className="font-sans">{t("sale.subtotal")}</span>
          <MoneyText cents={sale?.subtotalCents ?? 0} />
        </div>
        <div className="flex justify-between text-[11px] text-muted">
          <span className="font-sans">{t("sale.iva21")}</span>
          <MoneyText cents={sale?.taxCents ?? 0} />
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="font-sans text-[12px] font-bold">{t("sale.total")}</span>
          <MoneyText cents={sale?.totalCents ?? 0} className="text-[20px] font-bold" />
        </div>
      </div>
    </div>
  );
}
