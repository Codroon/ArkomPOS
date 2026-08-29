/**
 * Detalle del dispositivo — handoff/used-devices.md §3.
 *
 * Gallery and data on the left, what the shop can still do about it on the
 * right. The seller block is the one part that may be absent: the handler
 * withholds those fields for anyone without `usedDevices.viewSeller`, so this
 * file renders a muted line rather than hiding populated data (ADR-0012 §5).
 *
 * Everything a device can have done to it happens while it is held. Once it is
 * in stock the actions collapse to a sentence stating when it got there and at
 * what price — the refurbishment cost is folded into a posted stock movement by
 * then, and an insert-only ledger does not let it be edited back out.
 */
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_MARGIN_PCT,
  centsToInput,
  formatCents,
  parseMoneyInput,
  type UsedDeviceDetail,
} from "@arkom/core";
import {
  AccentButton,
  Chip,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  Switch,
  TextInput,
  cn,
  useT,
  type TKey,
} from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { useCan } from "../../lib/use-session";
import { SellPriceModal } from "./sell-price-modal";

const STATE_KEYS: Record<UsedDeviceDetail["state"], TKey> = {
  held: "usedState.held",
  needs_review: "usedState.needs_review",
  in_stock: "usedState.in_stock",
  sold: "usedState.sold",
};

const VOUCHER_KEYS: Record<"issued" | "redeemed" | "void", TKey> = {
  issued: "voucher.usable",
  redeemed: "voucher.refusalUsed",
  void: "voucher.voided",
};

const PAYOUT_KEYS: Record<UsedDeviceDetail["payout"], TKey> = {
  cash: "used.payout.cash",
  transfer: "used.payout.transfer",
  store_credit: "used.payout.credit",
};

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function UsedDeviceDetailPane({
  purchaseId,
  onClose,
}: {
  purchaseId: string;
  onClose: () => void;
}) {
  const t = useT();
  const can = useCan();
  const [device, setDevice] = useState<UsedDeviceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refurbInput, setRefurbInput] = useState<string | null>(null);
  const [priceModal, setPriceModal] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [marginPct, setMarginPct] = useState(DEFAULT_MARGIN_PCT);

  const load = useCallback(async () => {
    try {
      setDevice(await window.arkom.invoke("used:get", { purchaseId }));
      setError(null);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }, [purchaseId, t]);

  useEffect(() => {
    void load();
    window.arkom
      .invoke("settings:get")
      .then((settings) => setMarginPct(settings.usedMarginPct))
      .catch((err) => console.error("settings:get failed", err));
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoom) setZoom(null);
      else if (!priceModal && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoom, priceModal, busy]);

  /** Every action returns the fresh detail, so the pane never guesses. */
  const act = async (run: () => Promise<UsedDeviceDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setDevice(await run());
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const reprint = async (what: "document" | "label") => {
    setError(null);
    try {
      const result = await window.arkom.invoke("used:print", { purchaseId, what, copy: true });
      setNotice(result.kind === "pdf" ? t("used.logged.pdfSaved") : t("used.logged.printed"));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const shelve = async (sellPriceCents: number) => {
    setBusy(true);
    setError(null);
    try {
      await window.arkom.invoke("used:sendToInventory", { purchaseId, sellPriceCents });
      setPriceModal(false);
      await load();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (!device) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Header onClose={onClose} title={t("usedList.title")} />
        <div className="px-4 py-6 text-[12px] text-subtle">{error ?? t("usedList.loading")}</div>
      </div>
    );
  }

  const name = [device.brand, device.model].join(" ");
  const attrs = [device.storage, device.color].filter(Boolean).join(" · ");
  const accessories = (
    [
      ["charger", "used.device.charger"],
      ["box", "used.device.box"],
      ["cable", "used.device.cable"],
      ["case", "used.device.case"],
    ] as ReadonlyArray<[keyof UsedDeviceDetail["accessories"], TKey]>
  )
    .filter(([key]) => device.accessories[key])
    .map(([, label]) => t(label));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header onClose={onClose} title={name} subtitle={attrs} state={device.state} doc={device.docNumber} />

      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3">
        {/* left: what it is */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Card title={t("usedDetail.photos")}>
            {device.photos.length === 0 ? (
              <div className="text-[11px] text-subtle">{t("usedDetail.noPhotos")}</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {device.photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setZoom(photo.dataUrl)}
                    className="h-[104px] w-[104px] overflow-hidden rounded-[3px] border border-line-strong"
                  >
                    <img src={photo.dataUrl} alt={photo.kind} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title={t("usedDetail.device")}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              <Row label={t("usedDetail.brand")} value={device.brand} />
              <Row label={t("usedDetail.model")} value={device.model} />
              <Row label={t("usedDetail.storage")} value={device.storage ?? t("common.dash")} />
              <Row label={t("usedDetail.color")} value={device.color ?? t("common.dash")} />
              <Row label={t("usedDetail.grade")} value={device.grade} />
              <Row
                label={t("usedDetail.battery")}
                value={device.batteryPct === null ? t("common.dash") : `${device.batteryPct}%`}
              />
              <Row label={t("usedDetail.imei")} value={device.imei} mono />
              <Row label={t("usedDetail.barcode")} value={device.barcode ?? t("common.dash")} mono />
              <Row
                label={t("usedDetail.accessories")}
                value={accessories.length > 0 ? accessories.join(", ") : t("usedDetail.noAccessories")}
              />
            </dl>
          </Card>

          <Card title={t("usedDetail.seller")}>
            {device.seller ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
                <Row label={t("usedDetail.sellerName")} value={device.seller.name} />
                <Row label={t("usedDetail.sellerPhone")} value={device.seller.phone ?? t("common.dash")} mono />
                <Row
                  label={t("usedDetail.sellerDoc")}
                  value={`${device.seller.idType} ${device.seller.idNumber}`}
                  mono
                />
                <Row
                  label={t("usedDetail.sellerChannel")}
                  value={t(
                    device.seller.channel === "business"
                      ? "used.seller.channelBusiness"
                      : "used.seller.channelPrivate",
                  )}
                />
              </dl>
            ) : (
              // the fields are absent from the payload, not hidden here
              <div className="text-[11px] text-subtle">{t("usedDetail.sellerHidden")}</div>
            )}
          </Card>

          <Card title={t("usedDetail.history")}>
            <ul className="flex flex-col gap-1">
              {device.timeline.map((entry, i) => (
                <li key={`${entry.atMs}-${i}`} className="flex items-baseline gap-2 text-[11px]">
                  <span className="w-[104px] flex-none font-mono tabular-nums text-subtle">
                    {formatDateTime(entry.atMs)}
                  </span>
                  <span className="text-ink-2">{actionLabel(t, entry.entity, entry.action)}</span>
                  {entry.actorName ? (
                    <span className="text-subtle">{t("usedDetail.by", { name: entry.actorName })}</span>
                  ) : null}
                  {entry.approverName ? (
                    <span className="text-subtle">
                      · {t("usedDetail.approvedBy", { name: entry.approverName })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* right: what it cost and what can still be done */}
        <div className="flex w-[340px] flex-none flex-col gap-3">
          <Card title={t("usedDetail.purchase")}>
            <dl className="flex flex-col gap-1">
              <Money label={t("usedDetail.buyPrice")} cents={device.buyPriceCents} />
              <Row label={t("usedDetail.payout")} value={t(PAYOUT_KEYS[device.payout])} />
              {device.payoutReference ? (
                <Row label={t("used.payout.reference")} value={device.payoutReference} mono />
              ) : null}
              {device.voucher ? (
                <div className="flex items-baseline justify-between gap-3 py-px">
                  <SectionLabel>{t("usedDetail.voucher")}</SectionLabel>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-ink-2">
                      {formatCents(device.voucher.amountCents)}
                    </span>
                    <Chip variant={device.voucher.status === "issued" ? "success" : "neutral"}>
                      {t(VOUCHER_KEYS[device.voucher.status])}
                    </Chip>
                    {device.voucher.status === "issued" && can("usedDevices.voidCredit") ? (
                      <button
                        type="button"
                        className="text-[10px] text-muted underline hover:text-danger-ink"
                        onClick={() => setVoidOpen(true)}
                      >
                        {t("voucher.void")}
                      </button>
                    ) : null}
                  </span>
                </div>
              ) : null}

              {/* refurbishment: editable while held, frozen and explained after */}
              {refurbInput === null ? (
                <div className="flex items-baseline justify-between py-px">
                  <SectionLabel>{t("usedDetail.refurb")}</SectionLabel>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-ink-2">
                      {formatCents(device.refurbCostCents)}
                    </span>
                    {device.editable && can("usedDevices.editRefurbCost") ? (
                      <button
                        type="button"
                        className="text-[10px] text-muted underline hover:text-ink"
                        onClick={() => setRefurbInput(centsToInput(device.refurbCostCents))}
                      >
                        {t("usedDetail.refurbEdit")}
                      </button>
                    ) : null}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 py-1">
                  <TextInput
                    mono
                    autoFocus
                    className="h-7"
                    value={refurbInput}
                    onChange={(e) => setRefurbInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRefurbInput(null);
                    }}
                  />
                  <GhostButton
                    disabled={busy || parseMoneyInput(refurbInput) === null}
                    onClick={() => {
                      const cents = parseMoneyInput(refurbInput);
                      if (cents === null) return;
                      void act(async () => {
                        const next = await window.arkom.invoke("used:setRefurbCost", {
                          purchaseId,
                          refurbCostCents: cents,
                        });
                        setRefurbInput(null);
                        return next;
                      });
                    }}
                  >
                    {t("common.save")}
                  </GhostButton>
                </div>
              )}
              {!device.editable ? (
                <div className="text-[10px] leading-snug text-subtle">{t("usedDetail.refurbFrozen")}</div>
              ) : null}

              <Money label={t("usedDetail.totalCost")} cents={device.unitCostCents} bold />
              <Row label={t("usedDetail.purchasedAt")} value={formatDateTime(device.purchasedAtMs)} />
              {device.sellPriceCents !== null ? (
                <Money label={t("usedDetail.sellPrice")} cents={device.sellPriceCents} bold />
              ) : null}
              {device.soldDocNumber ? (
                <div className="pt-1 text-[11px] text-subtle">
                  {t("usedDetail.soldOn", { doc: device.soldDocNumber })}
                </div>
              ) : null}
            </dl>
          </Card>

          <Card title={t("usedDetail.actions")}>
            {device.editable ? (
              <div className="flex flex-col gap-2.5">
                <Switch
                  label={t("usedDetail.needsReview")}
                  checked={device.needsReview}
                  onChange={(next) =>
                    void act(() => window.arkom.invoke("used:setReview", { purchaseId, needsReview: next }))
                  }
                />
                {can("usedDevices.sendToInventory") ? (
                  // the pane's one blue element
                  <AccentButton className="h-9" disabled={busy} onClick={() => setPriceModal(true)}>
                    {t("usedDetail.toInventory")}
                  </AccentButton>
                ) : null}
              </div>
            ) : (
              <div className="text-[11px] leading-snug text-ink-2">
                {device.sellPriceCents !== null
                  ? t("usedDetail.inStockSince", {
                      date: formatDateTime(device.purchasedAtMs),
                      price: formatCents(device.sellPriceCents),
                    })
                  : t(STATE_KEYS[device.state])}
              </div>
            )}

            <div className="mt-3 flex flex-col gap-1.5">
              {device.canViewSeller ? (
                <GhostButton onClick={() => void reprint("document")}>{t("usedDetail.reprint")}</GhostButton>
              ) : (
                // a reprint is a way to read the seller off a till that will not
                // show them on screen, so it is gated with the data it reveals
                <div className="text-[10px] leading-snug text-subtle">{t("usedDetail.reprintHidden")}</div>
              )}
              <GhostButton onClick={() => void reprint("label")}>{t("usedDetail.reprintLabel")}</GhostButton>
            </div>

            {error ? <div className="mt-2 text-[11px] text-danger-ink">{error}</div> : null}
            {notice ? <div className="mt-2 text-[11px] text-ink-2">{notice}</div> : null}
          </Card>
        </div>
      </div>

      {priceModal ? (
        <SellPriceModal
          buyPriceCents={device.buyPriceCents}
          refurbCostCents={device.refurbCostCents}
          marginPct={marginPct}
          busy={busy}
          onCancel={() => setPriceModal(false)}
          onConfirm={(cents) => void shelve(cents)}
        />
      ) : null}

      {voidOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
          <div className="w-[380px] rounded-[3px] border border-line-strong bg-card shadow-lg">
            <div className="border-b border-line-strong bg-surface-2 px-4 py-2.5 text-[13px] font-bold">
              {t("voucher.voidTitle")}
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] leading-snug text-ink-2">{t("voucher.voidBody")}</div>
              <div className="mt-2">
                <SectionLabel>{t("voucher.voidReason")}</SectionLabel>
                <TextInput
                  autoFocus
                  className="mt-1"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <GhostButton onClick={() => setVoidOpen(false)}>{t("common.cancel")}</GhostButton>
              <PrimaryButton
                disabled={busy || voidReason.trim() === ""}
                onClick={() =>
                  void act(async () => {
                    await window.arkom.invoke("used:voidVoucher", {
                      voucherId: device.voucher!.id,
                      reason: voidReason.trim(),
                    });
                    setVoidOpen(false);
                    setVoidReason("");
                    return window.arkom.invoke("used:get", { purchaseId });
                  })
                }
              >
                {t("voucher.void")}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}

      {zoom ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70"
          onClick={() => setZoom(null)}
        >
          <img src={zoom} alt="" className="max-h-[90%] max-w-[90%] object-contain" />
        </button>
      ) : null}
    </div>
  );
}

function Header({
  onClose,
  title,
  subtitle,
  state,
  doc,
}: {
  onClose: () => void;
  title: string;
  subtitle?: string;
  state?: UsedDeviceDetail["state"];
  doc?: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
      <button type="button" className="text-[11px] text-muted underline hover:text-ink" onClick={onClose}>
        ← {t("usedDetail.back")}
      </button>
      <div className="text-[15px] font-bold">{title}</div>
      {subtitle ? <div className="text-[12px] text-muted">{subtitle}</div> : null}
      {doc ? <span className="font-mono text-[11px] tabular-nums text-subtle">{doc}</span> : null}
      {state ? <Chip variant={state === "needs_review" ? "warning" : "neutral"}>{t(STATE_KEYS[state])}</Chip> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-px">
      <SectionLabel>{label}</SectionLabel>
      <span className={cn("text-[12px] text-ink", mono && "font-mono text-[11px] tabular-nums")}>{value}</span>
    </div>
  );
}

function Money({ label, cents, bold }: { label: string; cents: number; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-px">
      <SectionLabel>{label}</SectionLabel>
      <span
        className={cn("font-mono tabular-nums", bold ? "text-[13px] font-bold text-ink" : "text-[11px] text-ink-2")}
      >
        {formatCents(cents)}
      </span>
    </div>
  );
}

/**
 * A timeline line in words.
 *
 * Falls back to the raw action rather than inventing one: a new action added
 * later should read oddly in the history, not silently as something else.
 */
function actionLabel(
  t: (key: TKey, vars?: Record<string, string | number>) => string,
  entity: string,
  action: string,
): string {
  /* entity-qualified first: a purchase and the unit it created both log
     "create", and rendering both as "purchase logged" turns two facts into one
     sentence repeated twice */
  for (const key of [`usedAction.${entity}.${action}`, `usedAction.${action}`] as TKey[]) {
    const label = t(key);
    if (label !== key) return label;
  }
  return `${entity} · ${action}`;
}
