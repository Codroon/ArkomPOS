/**
 * Editor panel (380px, bg-panel) — handoff 02 "Editor panel". Doubles for
 * create/edit; Guardar disabled until dirty ∧ valid; Eliminar rendered locked
 * (P1: deactivation via the Activo switch is the only path). Strings via
 * useT() (ADR-0011).
 */
import {
  centsToInput,
  formatCents,
  generateInternalEan13,
  marginCents,
  marginPct,
  parseMoneyInput,
  type EntityRef,
} from "@arkom/core";
import {
  Field,
  GhostButton,
  LockedButton,
  PrimaryButton,
  SectionLabel,
  Segmented,
  SelectInput,
  Switch,
  TextInput,
  useT,
  type SegmentOption,
} from "@arkom/ui";
import { resolveErrorText, type Draft, type DraftErrors } from "./model";

export function CatalogEditor({
  draft,
  errors,
  groups,
  canSave,
  saving,
  generalError,
  onPatch,
  onSave,
  onCancel,
}: {
  draft: Draft | null;
  errors: DraftErrors;
  groups: EntityRef[];
  canSave: boolean; // dirty ∧ valid (handoff: Guardar disabled otherwise)
  saving: boolean;
  generalError: string | null;
  onPatch: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();

  if (!draft) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center text-[12px] text-muted">
          {t("editor.emptyTitle")}
          <div className="mt-1 text-[11px] text-faint">{t("editor.emptyHint")}</div>
        </div>
      </div>
    );
  }

  const typeOptions: SegmentOption<Draft["itemType"] | "used_device" | "service" | "repair" | "agency">[] = [
    { value: "stocked", label: t("editor.type.stocked") },
    { value: "serialized", label: t("editor.type.serialized") },
    { value: "used_device", label: t("editor.type.used"), disabled: true },
    { value: "service", label: t("editor.type.service"), disabled: true },
    { value: "repair", label: t("editor.type.repair"), disabled: true },
    { value: "agency", label: t("editor.type.agency"), disabled: true },
  ];

  const cost = parseMoneyInput(draft.costInput);
  const price = parseMoneyInput(draft.priceInput);
  const margin = cost !== null && price !== null ? marginCents(price, cost) : null;
  const marginRatio = cost !== null && price !== null ? marginPct(price, cost) : null;

  const reformatOnBlur = (key: "costInput" | "priceInput") => () => {
    const cents = parseMoneyInput(draft[key]);
    if (cents !== null) onPatch({ [key]: centsToInput(cents) } as Partial<Draft>);
  };

  const err = (field: keyof DraftErrors) => resolveErrorText(t, errors[field]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-[13px] font-bold">{draft.id ? t("editor.editTitle") : t("editor.newTitle")}</div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <Field label={t("editor.name")} required error={err("name")}>
          <TextInput
            key={draft.id ?? "new"}
            requiredStyle
            autoFocus={draft.id === null}
            value={draft.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder={t("editor.namePlaceholder")}
          />
        </Field>

        <Field
          label={t("editor.barcode")}
          error={err("barcode")}
          hint={draft.barcode ? null : t("editor.barcodeHint")}
        >
          <div className="flex gap-1.5">
            <TextInput
              mono
              value={draft.barcode}
              onChange={(e) => onPatch({ barcode: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault(); // scanner Enter must not submit
              }}
              placeholder={t("editor.barcodePlaceholder")}
            />
            {draft.barcode.trim() === "" ? (
              <GhostButton onClick={() => onPatch({ barcode: generateInternalEan13() })}>
                {t("editor.generate")}
              </GhostButton>
            ) : null}
          </div>
        </Field>

        <Field label={t("editor.group")} required error={err("groupId")}>
          <SelectInput requiredStyle value={draft.groupId} onChange={(e) => onPatch({ groupId: e.target.value })}>
            <option value="">{t("editor.groupPlaceholder")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label={t("editor.cost")} required error={err("costCents")}>
            <TextInput
              mono
              requiredStyle
              value={draft.costInput}
              onChange={(e) => onPatch({ costInput: e.target.value })}
              onBlur={reformatOnBlur("costInput")}
              placeholder={t("editor.moneyPlaceholder")}
            />
          </Field>
          <Field label={t("editor.price")} required error={err("priceCents")}>
            <TextInput
              mono
              requiredStyle
              value={draft.priceInput}
              onChange={(e) => onPatch({ priceInput: e.target.value })}
              onBlur={reformatOnBlur("priceInput")}
              placeholder={t("editor.moneyPlaceholder")}
            />
          </Field>
          <Field label={t("editor.tax")} required error={err("taxRegime")}>
            <SelectInput
              requiredStyle
              value={draft.taxRegime}
              onChange={(e) => onPatch({ taxRegime: e.target.value === "IVA21" ? "IVA21" : "" })}
            >
              {draft.taxRegime === "" ? <option value="">{t("common.dash")}</option> : null}
              <option value="IVA21">{t("editor.tax21")}</option>
              <option disabled>{t("editor.tax10Soon")}</option>
              <option disabled>{t("editor.tax4Soon")}</option>
              <option disabled>{t("editor.taxRebuSoon")}</option>
              <option disabled>{t("editor.taxExemptSoon")}</option>
            </SelectInput>
          </Field>
        </div>

        <div className="text-[11px] text-muted">
          {t("editor.margin")}{" "}
          {margin !== null ? (
            <span className="font-mono tabular-nums">
              {formatCents(margin)}
              {marginRatio !== null ? ` · ${String(marginRatio).replace(".", ",")}%` : ""}
            </span>
          ) : (
            <span className="text-faint">{t("common.dash")}</span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <SectionLabel>{t("editor.itemType")}</SectionLabel>
          <Segmented
            options={typeOptions}
            value={draft.itemType}
            onChange={(v) => {
              if (v === "stocked" || v === "serialized") onPatch({ itemType: v });
            }}
          />
          {err("itemType") ? (
            <div className="text-[11px] leading-snug text-ink-2">{err("itemType")}</div>
          ) : draft.itemType === "serialized" ? (
            <div className="text-[11px] leading-snug text-faint">{t("editor.serializedHint")}</div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t("editor.reorderPoint")} error={err("reorderPoint")}>
            <TextInput
              mono
              inputMode="numeric"
              value={draft.reorderInput}
              onChange={(e) => onPatch({ reorderInput: e.target.value })}
            />
          </Field>
          <Field label={t("editor.lowStockThreshold")} error={err("lowStockThreshold")}>
            <TextInput
              mono
              inputMode="numeric"
              value={draft.lowStockInput}
              onChange={(e) => onPatch({ lowStockInput: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <SectionLabel>{t("editor.active")}</SectionLabel>
          <Switch
            checked={draft.active}
            onChange={(v) => onPatch({ active: v })}
            label={draft.active ? t("common.yes") : t("common.no")}
          />
        </div>
        {!draft.active ? (
          <div className="text-[11px] leading-snug text-faint">{t("editor.inactiveHint")}</div>
        ) : null}
      </div>

      <div className="border-t border-border-strong bg-panel-2 px-4 py-2.5">
        {generalError ? <div className="mb-2 text-[11px] text-ink-2">{generalError}</div> : null}
        <div className="flex items-center gap-2">
          <PrimaryButton onClick={onSave} disabled={!canSave || saving}>
            {saving ? t("common.saving") : t("common.save")}
          </PrimaryButton>
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
          <div className="flex-1" />
          <LockedButton title={t("editor.deleteLockedHint")}>{t("editor.delete")}</LockedButton>
        </div>
      </div>
    </div>
  );
}
