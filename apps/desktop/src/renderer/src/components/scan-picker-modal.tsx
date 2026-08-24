/**
 * Ambiguity picker — the one modal shown wherever `scan:resolve` comes back
 * ambiguous (sale, stock entry, catalog search). A single match never reaches
 * here: the caller takes the instant path, so nothing costs an extra click.
 */
import { useEffect } from "react";
import type { ScanMatch } from "@arkom/core";
import { Chip, MoneyText, useT } from "@arkom/ui";

export function ScanPickerModal({
  code,
  matches,
  onPick,
  onClose,
}: {
  code: string;
  matches: ScanMatch[];
  onPick: (match: ScanMatch) => void;
  onClose: () => void;
}) {
  const t = useT();

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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/25" onMouseDown={onClose}>
      <div
        className="flex max-h-[70vh] w-[420px] flex-col rounded-[3px] border border-border-strong bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border-strong bg-panel-2 px-4 py-2.5">
          <div className="text-[13px] font-bold">{t("pick.scanTitle")}</div>
          <div className="text-[11px] text-muted">{t("pick.scanSubtitle", { code })}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {matches.map((match) => {
            const product = match.product;
            const isUnit = match.kind === "unit";
            return (
              <button
                key={isUnit ? match.unit.unitId : product.productId}
                type="button"
                onClick={() => onPick(match)}
                className="flex w-full items-center gap-2 border-b border-border-light px-4 py-2.5 text-left hover:bg-nav-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px]">
                    {product.name}
                    {isUnit || product.itemType === "serialized" ? (
                      <Chip className="ml-1.5">{t("chip.serie")}</Chip>
                    ) : null}
                    {!product.active ? <Chip className="ml-1.5">{t("chip.inactive")}</Chip> : null}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-faint">
                    {isUnit ? `IMEI ${match.unit.imei}` : t("pick.stock", { n: product.onHand })}
                  </div>
                </div>
                {product.priceCents != null ? (
                  <MoneyText cents={product.priceCents} className="text-[12px] font-bold" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
