/**
 * Sale modals — unit pick (serialized), price override (req 2.4), park label.
 * All trap Esc to cancel (never mid-completion; completion never opens these).
 */
import { useEffect, useMemo, useState } from "react";
import { centsToInput, formatCents, parseMoneyInput, type SaleLineRow } from "@arkom/core";
import { Field, GhostButton, MoneyText, PrimaryButton, SearchInput, TextInput, useT } from "@arkom/ui";

function ModalShell({ children, onClose, width = 380 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25" onMouseDown={onClose}>
      <div
        style={{ width }}
        className="rounded-[3px] border border-border-strong bg-card p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export interface UnitPickState {
  productId: string;
  productName: string;
  units: { unitId: string; imei: string; createdAtMs: number }[];
}

export function UnitPickModal({
  pick,
  onPick,
  onClose,
}: {
  pick: UnitPickState;
  onPick: (unitId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const visible = useMemo(
    () => pick.units.filter((u) => u.imei.includes(filter.trim())),
    [pick.units, filter],
  );
  const formatDay = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="mb-2 text-[13px] font-bold">{t("pick.title", { name: pick.productName })}</div>
      <SearchInput
        autoFocus
        placeholder={t("pick.filterPlaceholder")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && visible.length === 1) onPick(visible[0]!.unitId);
        }}
      />
      <div className="mt-2 max-h-[300px] overflow-y-auto">
        {visible.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-muted">{t("pick.empty")}</div>
        ) : (
          visible.map((unit) => (
            <button
              key={unit.unitId}
              type="button"
              onClick={() => onPick(unit.unitId)}
              className="flex w-full items-baseline justify-between border-b border-border-light px-2 py-2 text-left hover:bg-nav-hover"
            >
              <span className="font-mono text-[12px] tabular-nums">{unit.imei}</span>
              <span className="text-[10px] text-faint">
                {t("pick.inSince")} <span className="font-mono tabular-nums">{formatDay(unit.createdAtMs)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </ModalShell>
  );
}

export function OverrideModal({
  line,
  onApply,
  onClose,
}: {
  line: SaleLineRow;
  onApply: (newPriceCents: number, reason: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [priceInput, setPriceInput] = useState(centsToInput(line.unitPriceCents));
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const cents = parseMoneyInput(priceInput);

  const apply = () => {
    setAttempted(true);
    if (cents === null || reason.trim() === "") return;
    onApply(cents, reason.trim());
  };

  return (
    <ModalShell onClose={onClose} width={340}>
      <div className="mb-1 text-[13px] font-bold">{t("ovr.title")}</div>
      <div className="mb-2 text-[11px] text-muted">
        {line.description} · {formatCents(line.unitPriceCents)}
      </div>
      <Field label={t("ovr.newPrice")} required error={attempted && cents === null ? t("val.invalidAmount") : null}>
        <TextInput
          mono
          requiredStyle
          autoFocus
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
      </Field>
      <Field
        label={t("ovr.reason")}
        required
        className="mt-2"
        error={attempted && reason.trim() === "" ? t("ovr.reasonRequired") : null}
      >
        <TextInput
          requiredStyle
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
      </Field>
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onClose}>{t("common.cancel")}</GhostButton>
        <PrimaryButton onClick={apply}>{t("ovr.apply")}</PrimaryButton>
      </div>
    </ModalShell>
  );
}

export function ParkModal({ onPark, onClose }: { onPark: (label: string) => void; onClose: () => void }) {
  const t = useT();
  const [label, setLabel] = useState("");
  return (
    <ModalShell onClose={onClose} width={320}>
      <div className="mb-2 text-[13px] font-bold">{t("park.title")}</div>
      <TextInput
        autoFocus
        placeholder={t("park.labelPlaceholder")}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onPark(label.trim());
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onClose}>{t("common.cancel")}</GhostButton>
        <PrimaryButton onClick={() => onPark(label.trim())}>{t("park.confirm")}</PrimaryButton>
      </div>
    </ModalShell>
  );
}

export function ParkedPopover({
  parked,
  onResume,
  onClose,
}: {
  parked: { docId: string; label: string; lineCount: number; totalCents: number }[];
  onResume: (docId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="absolute right-3 top-9 z-40 w-[300px] rounded-[3px] border border-border-strong bg-card shadow-lg" onMouseLeave={onClose}>
      <div className="border-b border-border bg-panel-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-muted">
        {t("park.popoverTitle")}
      </div>
      {parked.length === 0 ? (
        <div className="p-3 text-center text-[11px] text-muted">{t("park.empty")}</div>
      ) : (
        parked.map((p) => (
          <div key={p.docId} className="flex items-center gap-2 border-b border-border-light px-3 py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px]">{p.label}</div>
              <div className="text-[10px] text-faint">
                {p.lineCount === 1 ? t("sale.lineCountOne") : t("sale.lineCountMany", { n: p.lineCount })} ·{" "}
                <MoneyText cents={p.totalCents} />
              </div>
            </div>
            <GhostButton className="h-6 px-2 text-[11px]" onClick={() => onResume(p.docId)}>
              {t("park.resume")}
            </GhostButton>
          </div>
        ))
      )}
    </div>
  );
}
