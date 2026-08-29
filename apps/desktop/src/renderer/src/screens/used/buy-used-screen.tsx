/**
 * Comprar usados (nav 04) — handoff/used-devices.md §1.
 *
 * Three columns: Device and Seller stacked in the left two-thirds, the gate
 * rail on the right. The order on screen is the order at the counter — look at
 * the phone, take the seller's details, check the IMEI, agree a price, pay.
 *
 * Two things this screen deliberately does NOT do:
 *   - reserve a purchase number. The chip says the number comes on save,
 *     because ADR-0008 makes numbering gap-free by allocating inside the
 *     finalising transaction and nowhere else.
 *   - talk to anything online. The IMEI check is local plus a human's word.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  generateInternalEan13,
  isValidImei,
  parseIpcError,
  type AcquisitionChannel,
  type DeviceGrade,
  type IdDocType,
} from "@arkom/core";
import {
  AccentButton,
  Chip,
  Field,
  PrimaryButton,
  ScanInput,
  SectionLabel,
  SelectInput,
  Switch,
  TextInput,
  cn,
  useT,
  type ScanInputHandle,
} from "@arkom/ui";
import { GateRail, type GateState } from "./gate-rail";
import { PhotoSlotTile, useHasCamera } from "./photo-slots";
import {
  PHOTO_SLOTS,
  batteryInvalid,
  completeness,
  emptyDraft,
  type BuyDraft,
  type PhotoSlot,
} from "./model";

const STORAGE_OPTIONS = ["32GB", "64GB", "128GB", "256GB", "512GB", "1TB"] as const;

export function BuyUsedScreen() {
  const t = useT();
  const hasCamera = useHasCamera();
  const imeiRef = useRef<ScanInputHandle>(null);

  const [draft, setDraft] = useState<BuyDraft>(emptyDraft);
  const [gate, setGate] = useState<GateState>({ phase: "idle" });
  const [confirmed, setConfirmed] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const patch = useCallback((next: Partial<BuyDraft>) => setDraft((d) => ({ ...d, ...next })), []);

  useEffect(() => {
    setTimeout(() => imeiRef.current?.focus(), 0);
  }, []);


  /**
   * Ask main whether this device is already known.
   *
   * Format is checked here first, with the same `isValidImei` serialized stock
   * entry uses, so a half-typed IMEI never becomes a round trip. Changing the
   * IMEI clears the confirmation: the checkbox says "I checked THIS device",
   * and leaving it ticked while the number underneath changes would make it a
   * lie the till told on the cashier's behalf.
   */
  const runGate = useCallback(async (imei: string) => {
    const trimmed = imei.trim();
    setConfirmed(false);
    if (trimmed === "") {
      setGate({ phase: "idle" });
      return;
    }
    if (!isValidImei(trimmed)) {
      setGate({ phase: "result", result: { ok: false, rejection: "format", existing: null } });
      return;
    }
    setGate({ phase: "checking" });
    try {
      const result = await window.arkom.invoke("used:checkImei", { imei: trimmed });
      setGate({ phase: "result", result });
    } catch (err) {
      console.error("used:checkImei failed", err);
      const ipc = parseIpcError(err);
      setNotice(ipc?.message ?? String(err));
      setGate({ phase: "idle" });
    }
  }, []);

  /**
   * The gate runs off the VALUE, not off focus.
   *
   * Blur was the obvious trigger and the wrong one twice over: a keyboard-wedge
   * scanner fills the field and submits within a tick, before the render that
   * would refresh anything a handler captured — and taking over ScanInput's
   * onBlur would have silently disabled its auto-refocus, which is the property
   * that makes the field scanner-first in the first place.
   *
   * Debounced so typing 15 digits by hand is one lookup, not fifteen.
   */
  useEffect(() => {
    setGate({ phase: "idle" });
    setConfirmed(false);
    const imei = draft.imei.trim();
    if (imei === "") return;
    const timer = setTimeout(() => void runGate(imei), 250);
    return () => clearTimeout(timer);
  }, [draft.imei, runGate]);

  /** Generate an internal EAN-13 and make sure nothing already owns it. */
  const generateBarcode = useCallback(async () => {
    setBarcodeError(null);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateInternalEan13();
      try {
        const found = await window.arkom.invoke("scan:resolve", { code });
        if (found.kind === "none" && !found.unavailableUnit) {
          patch({ barcode: code });
          return;
        }
      } catch (err) {
        console.error("scan:resolve failed", err);
        patch({ barcode: code }); // a lookup failure is not a reason to block
        return;
      }
    }
    setBarcodeError(t("used.barcode.taken"));
  }, [patch, t]);

  const done = completeness(draft);
  const gatePassed = gate.phase === "result" && gate.result.ok && confirmed;
  const canLog = gatePassed && done.all;

  const missing = !done.device
    ? t("used.missing.device")
    : !done.seller
      ? t("used.missing.seller")
      : !done.price
        ? t("used.missing.price")
        : t("used.ready");

  const photoLabel = (slot: PhotoSlot): string =>
    slot === "front"
      ? t("used.photos.front")
      : slot === "back"
        ? t("used.photos.back")
        : slot === "seller_id"
          ? t("used.photos.sellerId")
          : t("used.photos.extra");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("used.buy.title")}</div>
        <Chip>{t("used.buy.provisional")}</Chip>
        <div className="text-[11px] text-subtle">{t("used.buy.provisionalHint")}</div>
        <div className="flex-1" />
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3">
        {/* left: device + photos + seller */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* device */}
          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("used.device.section")}</SectionLabel>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label={t("used.device.brand")} required>
                <TextInput
                  requiredStyle
                  list="arkom-used-brands"
                  value={draft.brand}
                  onChange={(e) => patch({ brand: e.target.value })}
                />
                <datalist id="arkom-used-brands">
                  {["Apple", "Samsung", "Xiaomi", "Motorola", "Google", "Oppo", "Realme"].map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </Field>
              <Field label={t("used.device.model")} required>
                <TextInput
                  requiredStyle
                  value={draft.model}
                  onChange={(e) => patch({ model: e.target.value })}
                />
              </Field>
              <Field label={t("used.device.storage")}>
                <SelectInput value={draft.storage} onChange={(e) => patch({ storage: e.target.value })}>
                  <option value="">{t("used.device.storageNone")}</option>
                  {STORAGE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="Otro">{t("used.device.storageOther")}</option>
                </SelectInput>
              </Field>
              <Field label={t("used.device.color")}>
                <TextInput value={draft.color} onChange={(e) => patch({ color: e.target.value })} />
              </Field>

              <Field
                label={t("used.device.grade")}
                /* the legend sits under the control: "B" means nothing to a
                   cashier on their first week */
                hint={
                  draft.grade === "A"
                    ? t("used.device.gradeHintA")
                    : draft.grade === "B"
                      ? t("used.device.gradeHintB")
                      : t("used.device.gradeHintC")
                }
              >
                <div className="flex overflow-hidden rounded-[3px] border border-line-strong">
                  {(
                    [
                      ["A", t("used.device.gradeA")],
                      ["B", t("used.device.gradeB")],
                      ["C", t("used.device.gradeC")],
                    ] as ReadonlyArray<[DeviceGrade, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => patch({ grade: value })}
                      className={cn(
                        "flex-1 border-r border-line px-1 py-1 text-[11px] last:border-r-0",
                        draft.grade === value
                          ? "bg-ink font-semibold text-inverse-ink"
                          : "bg-card text-ink-2 hover:bg-hover",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label={t("used.device.battery")}
                error={batteryInvalid(draft.batteryPct) ? t("used.device.batteryHint") : null}
                hint={t("used.device.batteryHint")}
              >
                <div className="flex items-center gap-1.5">
                  <TextInput
                    mono
                    inputMode="numeric"
                    maxLength={3}
                    value={draft.batteryPct}
                    onChange={(e) => patch({ batteryPct: e.target.value })}
                  />
                  <span className="font-mono text-[12px] text-muted">%</span>
                </div>
              </Field>
            </div>

            {/* IMEI — scanner-first, and the field the whole rail waits on */}
            <Field className="mt-2" label={t("used.device.imei")} required>
              <ScanInput
                ref={imeiRef}
                value={draft.imei}
                maxLength={15}
                placeholder={t("used.device.imeiPlaceholder")}
                onChange={(e) => patch({ imei: e.target.value })}
                onScan={(code) => patch({ imei: code })}
              />
            </Field>

            <div className="mt-2">
              <SectionLabel>{t("used.device.accessories")}</SectionLabel>
              <div className="mt-1 flex flex-wrap gap-4">
                {(
                  [
                    ["charger", t("used.device.charger")],
                    ["box", t("used.device.box")],
                    ["cable", t("used.device.cable")],
                    ["case", t("used.device.case")],
                  ] as ReadonlyArray<[keyof BuyDraft["accessories"], string]>
                ).map(([key, label]) => (
                  <Switch
                    key={key}
                    label={label}
                    checked={draft.accessories[key]}
                    onChange={(next) => patch({ accessories: { ...draft.accessories, [key]: next } })}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* photos */}
          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("used.photos.section")}</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {PHOTO_SLOTS.map((slot) => (
                <PhotoSlotTile
                  key={slot}
                  slot={slot}
                  label={photoLabel(slot)}
                  photo={draft.photos[slot]}
                  hasCamera={hasCamera}
                  onSet={(photo) => setDraft((d) => ({ ...d, photos: { ...d.photos, [slot]: photo } }))}
                  onClear={() =>
                    setDraft((d) => {
                      const photos = { ...d.photos };
                      delete photos[slot];
                      return { ...d, photos };
                    })
                  }
                />
              ))}
            </div>
            {!hasCamera ? (
              <div className="mt-1.5 text-[10px] text-subtle">{t("used.photos.noCamera")}</div>
            ) : null}
          </section>

          {/* seller */}
          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("used.seller.section")}</SectionLabel>
            <div className="mt-1 rounded-[2px] border border-warning-ink/25 bg-warning-bg px-2 py-1.5 text-[10px] text-warning-ink">
              {t("used.seller.privacy")}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label={t("used.seller.name")} required>
                <TextInput
                  requiredStyle
                  value={draft.sellerName}
                  onChange={(e) => patch({ sellerName: e.target.value })}
                />
              </Field>
              <Field label={t("used.seller.phone")}>
                <TextInput
                  mono
                  value={draft.sellerPhone}
                  onChange={(e) => patch({ sellerPhone: e.target.value })}
                />
              </Field>
              <Field label={t("used.seller.idType")}>
                <SelectInput
                  value={draft.sellerIdType}
                  onChange={(e) => patch({ sellerIdType: e.target.value as IdDocType })}
                >
                  <option value="DNI">DNI</option>
                  <option value="NIE">NIE</option>
                  <option value="PASAPORTE">PASAPORTE</option>
                </SelectInput>
              </Field>
              <Field label={t("used.seller.idNumber")} required>
                <TextInput
                  mono
                  requiredStyle
                  value={draft.sellerIdNumber}
                  onChange={(e) => patch({ sellerIdNumber: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t("used.seller.channel")}>
                <SelectInput
                  value={draft.channel}
                  onChange={(e) => patch({ channel: e.target.value as AcquisitionChannel })}
                >
                  <option value="private_individual">{t("used.seller.channelPrivate")}</option>
                  <option value="business">{t("used.seller.channelBusiness")}</option>
                </SelectInput>
              </Field>
            </div>
            <div className="mt-2 text-[10px] text-subtle">{t("used.seller.noSignature")}</div>
          </section>
        </div>

        {/* right: the gate rail and the two ways out */}
        <div className="flex flex-none flex-col gap-3">
          <GateRail
            draft={draft}
            gate={gate}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
            onPatch={patch}
            onGenerateBarcode={() => void generateBarcode()}
            barcodeError={barcodeError}
          />

          <div className="w-[340px] rounded-[3px] border border-line-strong bg-surface-2 px-3 py-2.5">
            <div className="mb-2 text-[11px] text-muted">{canLog ? t("used.ready") : missing}</div>
            <div className="flex gap-2">
              <PrimaryButton className="h-9 flex-1" disabled={!canLog} onClick={() => setNotice(t("used.action.pending"))}>
                {t("used.action.hold")}
              </PrimaryButton>
              {/* the screen's one blue element */}
              <AccentButton className="h-9 flex-1" disabled={!canLog} onClick={() => setNotice(t("used.action.pending"))}>
                {t("used.action.toInventory")}
              </AccentButton>
            </div>
            {notice ? <div className="mt-2 text-[11px] text-ink-2">{notice}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
