/**
 * Recibir un dispositivo (nav 06) — handoff/repairs.md §1.
 *
 * The order on screen is the order at the counter: find the customer, describe
 * the device and the state it arrived in, agree what happens next, print the
 * paper they sign. Everything below the customer is disabled until there is
 * one, because a device with no owner is not a repair, it is a lost phone.
 *
 * Two deliberate absences:
 *   - no ticket number until save, for the reason ADR-0008 gives everywhere
 *     else: gap-free numbering means allocating inside the transaction.
 *   - no technician selector yet. Assignment needs a list of staff, and the
 *     channel that returns one is owner-only today; it arrives with the
 *     workshop board in a later slice.
 */
import { useEffect, useMemo, useState } from "react";
import {
  centsToInput,
  formatCents,
  isValidImei,
  parseMoneyInput,
  type CustomerRow,
  type RepairCreateResponse,
} from "@arkom/core";
import {
  AccentButton,
  Chip,
  Field,
  GhostButton,
  SectionLabel,
  Switch,
  TextInput,
  cn,
  useT,
} from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { PrintToast } from "../../lib/print-toast";
import { useTicketPrint } from "../../lib/use-ticket-print";
import { PhotoSlotTile, useHasCamera } from "../used/photo-slots";
import { slotKind, type DraftPhoto, type PhotoSlot } from "../used/model";
import { CustomerPicker } from "./customer-picker";

/** No seller-ID slot here: the device's owner is a customer, not a seller. */
const REPAIR_PHOTO_SLOTS = ["front", "back", "extra1", "extra2"] as const;

type Damage = { screen: boolean; back: boolean; dents: boolean; water: boolean };

interface IntakeDraft {
  deviceDescription: string;
  imei: string;
  reportedFault: string;
  conditionAtIntake: string;
  damage: Damage;
  damageNote: string;
  accessories: string;
  devicePasscode: string;
  photos: Partial<Record<PhotoSlot, DraftPhoto>>;
  promisedDate: string;
  promisedHalf: "morning" | "afternoon" | "";
  deposit: string;
  cap: string;
}

const emptyDraft = (): IntakeDraft => ({
  deviceDescription: "",
  imei: "",
  reportedFault: "",
  conditionAtIntake: "",
  damage: { screen: false, back: false, dents: false, water: false },
  damageNote: "",
  accessories: "",
  devicePasscode: "",
  photos: {},
  promisedDate: "",
  promisedHalf: "",
  deposit: "",
  cap: "",
});

/** "2026-09-04" → local midnight, which is what "entrega el 4" means to a shop. */
function dateToMs(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

export function RepairIntakeScreen() {
  const t = useT();
  const hasCamera = useHasCamera();
  const printer = useTicketPrint();

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [draft, setDraft] = useState<IntakeDraft>(emptyDraft);
  const [revealPasscode, setRevealPasscode] = useState(false);
  const [settings, setSettings] = useState({ warrantyMonths: 3, feeCents: 0, suggestionCents: 0, capEnabled: true });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RepairCreateResponse | null>(null);

  const patch = (next: Partial<IntakeDraft>) => setDraft((d) => ({ ...d, ...next }));

  useEffect(() => {
    window.arkom
      .invoke("settings:get")
      .then((s) =>
        setSettings({
          warrantyMonths: s.repairWarrantyMonths,
          feeCents: s.repairDiagnosisFeeCents,
          suggestionCents: s.repairDepositSuggestionCents,
          capEnabled: s.repairCapEnabled,
        }),
      )
      .catch((err) => console.error("settings:get failed", err));
  }, []);

  const imeiBad = draft.imei.trim() !== "" && !isValidImei(draft.imei.trim());
  const deviceDone = draft.deviceDescription.trim() !== "" && draft.reportedFault.trim() !== "";
  const canSubmit = customer !== null && deviceDone && !imeiBad && !submitting;

  const missing = !customer
    ? t("rep.missing.customer")
    : !deviceDone
      ? t("rep.missing.device")
      : imeiBad
        ? t("rep.missing.imei")
        : t("rep.ready");

  const depositCents = useMemo(() => parseMoneyInput(draft.deposit) ?? 0, [draft.deposit]);
  const capCents = useMemo(() => (draft.cap.trim() === "" ? null : parseMoneyInput(draft.cap)), [draft.cap]);

  const startOver = () => {
    setCreated(null);
    setCustomer(null);
    setDraft(emptyDraft());
    setRevealPasscode(false);
    setError(null);
  };

  const submit = async () => {
    if (!customer) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.arkom.invoke("repair:create", {
        customerId: customer.id,
        deviceDescription: draft.deviceDescription.trim(),
        imei: draft.imei.trim() || null,
        reportedFault: draft.reportedFault.trim(),
        conditionAtIntake: draft.conditionAtIntake.trim() || null,
        damage: draft.damage,
        damageNote: draft.damageNote.trim() || null,
        accessories: draft.accessories.trim() || null,
        devicePasscode: draft.devicePasscode.trim() || null,
        photos: Object.values(draft.photos).map((p) => ({ kind: slotKind(p.slot), dataUrl: p.dataUrl })),
        promisedDate: dateToMs(draft.promisedDate),
        promisedHalf: draft.promisedHalf || null,
        depositCents,
        authorizedCapCents: capCents,
        assignedUserId: null,
      });
      setCreated(result);
      /* The ticket exists by now; the receipt is a separate, retryable act
         driven from here so a print failure reaches the cashier as a toast
         with Reintentar rather than a console line nobody reads. */
      printer.printRepair(result.ticketId, "intake");
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const frozen = created !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("rep.newTitle")}</div>
        <Chip>{t("rep.provisional")}</Chip>
        <div className="text-[11px] text-subtle">{t("rep.provisionalHint")}</div>
        <div className="flex-1" />
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3">
        {/* left: customer, device, photos */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <CustomerPicker selected={customer} onSelect={setCustomer} frozen={frozen} />

          <section
            className={cn(
              "rounded-[3px] border border-line-strong bg-card px-3 py-2.5",
              // the whole device block waits on a customer: it is their device
              !customer && "pointer-events-none opacity-45",
            )}
          >
            <SectionLabel>{t("rep.device.section")}</SectionLabel>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field className="col-span-2" label={t("rep.device.description")} required>
                <TextInput
                  requiredStyle
                  placeholder={t("rep.device.descriptionPlaceholder")}
                  value={draft.deviceDescription}
                  onChange={(e) => patch({ deviceDescription: e.target.value })}
                />
              </Field>
              <Field
                label={t("rep.device.imei")}
                hint={t("rep.device.imeiHint")}
                error={imeiBad ? t("rep.missing.imei") : null}
              >
                <TextInput
                  mono
                  maxLength={15}
                  value={draft.imei}
                  onChange={(e) => patch({ imei: e.target.value })}
                />
              </Field>
              <Field label={t("rep.device.accessories")}>
                <TextInput
                  placeholder={t("rep.device.accessoriesPlaceholder")}
                  value={draft.accessories}
                  onChange={(e) => patch({ accessories: e.target.value })}
                />
              </Field>
              <Field className="col-span-2" label={t("rep.device.fault")} required>
                <TextInput
                  requiredStyle
                  value={draft.reportedFault}
                  onChange={(e) => patch({ reportedFault: e.target.value })}
                />
              </Field>
              <Field className="col-span-2" label={t("rep.device.condition")}>
                <TextInput
                  value={draft.conditionAtIntake}
                  onChange={(e) => patch({ conditionAtIntake: e.target.value })}
                />
              </Field>
            </div>

            {/* the marks that protect the shop when a customer says the dent
                was not there before — they print on the receipt they sign */}
            <div className="mt-2">
              <SectionLabel>{t("rep.device.damage")}</SectionLabel>
              <div className="mt-1 flex flex-wrap gap-4">
                {(
                  [
                    ["screen", t("rep.damage.screen")],
                    ["back", t("rep.damage.back")],
                    ["dents", t("rep.damage.dents")],
                    ["water", t("rep.damage.water")],
                  ] as ReadonlyArray<[keyof Damage, string]>
                ).map(([key, label]) => (
                  <Switch
                    key={key}
                    label={label}
                    checked={draft.damage[key]}
                    onChange={(next) => patch({ damage: { ...draft.damage, [key]: next } })}
                  />
                ))}
              </div>
              <div className="mt-2">
                <TextInput
                  placeholder={t("rep.device.damageNote")}
                  value={draft.damageNote}
                  onChange={(e) => patch({ damageNote: e.target.value })}
                />
              </div>
            </div>

            {/* passcode — stored for the technician, tap-to-reveal here, and
                on no printed document anywhere (ADR-0014 §10) */}
            <Field className="mt-2" label={t("rep.device.passcode")} hint={t("rep.device.passcodeHint")}>
              <div className="flex items-center gap-2">
                <TextInput
                  mono
                  type={revealPasscode ? "text" : "password"}
                  value={draft.devicePasscode}
                  onChange={(e) => patch({ devicePasscode: e.target.value })}
                />
                <GhostButton onClick={() => setRevealPasscode((v) => !v)}>
                  {revealPasscode ? t("rep.device.passcodeHide") : t("rep.device.passcodeShow")}
                </GhostButton>
              </div>
            </Field>
          </section>

          <section
            className={cn(
              "rounded-[3px] border border-line-strong bg-card px-3 py-2.5",
              !customer && "pointer-events-none opacity-45",
            )}
          >
            <SectionLabel>{t("used.photos.section")}</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {REPAIR_PHOTO_SLOTS.map((slot) => (
                <PhotoSlotTile
                  key={slot}
                  slot={slot}
                  label={
                    slot === "front" ? t("used.photos.front") : slot === "back" ? t("used.photos.back") : t("used.photos.extra")
                  }
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
            {!hasCamera ? <div className="mt-1.5 text-[10px] text-subtle">{t("used.photos.noCamera")}</div> : null}
          </section>
        </div>

        {/* right: what was agreed, and the way out */}
        <div className="flex flex-none flex-col gap-3">
          <section
            className={cn(
              "w-[340px] rounded-[3px] border border-line-strong bg-card px-3 py-2.5",
              (!customer || frozen) && "pointer-events-none opacity-45",
            )}
          >
            <SectionLabel>{t("rep.agreement.section")}</SectionLabel>

            <Field className="mt-2" label={t("rep.agreement.promised")} hint={t("rep.agreement.promisedHint")}>
              {/* stacked, not side by side: a native date control is as wide as
                  the browser wants it to be, and the pair overflowed the rail */}
              <div className="flex flex-col gap-1.5">
                <TextInput
                  mono
                  type="date"
                  value={draft.promisedDate}
                  onChange={(e) => patch({ promisedDate: e.target.value })}
                />
                <div className="flex overflow-hidden rounded-[3px] border border-line-strong">
                  {(
                    [
                      ["morning", t("rep.agreement.morning")],
                      ["afternoon", t("rep.agreement.afternoon")],
                    ] as ReadonlyArray<["morning" | "afternoon", string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => patch({ promisedHalf: draft.promisedHalf === value ? "" : value })}
                      className={cn(
                        "flex-1 border-r border-line px-2 py-1 text-[11px] last:border-r-0",
                        draft.promisedHalf === value
                          ? "bg-ink font-semibold text-inverse-ink"
                          : "bg-card text-ink-2 hover:bg-hover",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </Field>

            <Field className="mt-2" label={t("rep.agreement.deposit")} hint={t("rep.agreement.depositHint")}>
              <div className="flex items-center gap-2">
                <TextInput
                  mono
                  inputMode="decimal"
                  value={draft.deposit}
                  onChange={(e) => patch({ deposit: e.target.value })}
                />
                {/* the shop's usual deposit, one tap away — a suggestion, and
                    zero is a perfectly ordinary answer */}
                {settings.suggestionCents > 0 ? (
                  <GhostButton onClick={() => patch({ deposit: centsToInput(settings.suggestionCents) })}>
                    {formatCents(settings.suggestionCents)}
                  </GhostButton>
                ) : null}
              </div>
            </Field>

            {settings.capEnabled ? (
              <Field className="mt-2" label={t("rep.agreement.cap")} hint={t("rep.agreement.capHint")}>
                <TextInput
                  mono
                  inputMode="decimal"
                  value={draft.cap}
                  onChange={(e) => patch({ cap: e.target.value })}
                />
              </Field>
            ) : null}

            <div className="mt-2.5 border-t border-line pt-2 text-[11px] text-ink-2">
              {/* both print on the receipt, so both are shown before it does */}
              {settings.feeCents > 0 ? (
                <div className="flex justify-between">
                  <span>{t("rep.agreement.fee")}</span>
                  <span className="font-mono tabular-nums">{formatCents(settings.feeCents)}</span>
                </div>
              ) : null}
              <div className="mt-0.5 text-[10px] text-subtle">
                {t("rep.warrantyNote", { n: String(settings.warrantyMonths) })}
              </div>
            </div>
          </section>

          {created ? (
            <div className="w-[340px] rounded-[3px] border border-success-ink/30 bg-success-bg px-3 py-2.5">
              <div className="text-[12px] font-bold text-success-ink">
                {t("rep.created", { doc: created.docNumber })}
              </div>
              {created.depositCents > 0 ? (
                <div className="mt-1 text-[11px] text-success-ink">
                  {t("rep.createdDeposit", { amount: formatCents(created.depositCents) })}
                </div>
              ) : null}
              <div className="mt-2.5 flex gap-2">
                <GhostButton className="flex-1" onClick={() => printer.printRepair(created.ticketId, "intake", true)}>
                  {t("rep.printIntake")}
                </GhostButton>
                {/* the surface's one blue element once the ticket exists */}
                <AccentButton className="flex-1" onClick={startOver}>
                  {t("rep.another")}
                </AccentButton>
              </div>
            </div>
          ) : (
            <div className="w-[340px] rounded-[3px] border border-line-strong bg-surface-2 px-3 py-2.5">
              <div className="mb-2 text-[11px] text-muted">{missing}</div>
              {/* the screen's one blue element */}
              <AccentButton className="h-9 w-full" disabled={!canSubmit} onClick={() => void submit()}>
                {submitting ? t("common.saving") : t("rep.submit")}
              </AccentButton>
              {error ? <div className="mt-2 text-[11px] text-danger-ink">{error}</div> : null}
            </div>
          )}
        </div>
      </div>

      <PrintToast printer={printer} />
    </div>
  );
}
