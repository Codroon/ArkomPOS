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
  useDataLabel,
  useT,
  type SegmentOption,
} from "@arkom/ui";
import { useCallback, useEffect, useState } from "react";
import type { ProductCode } from "@arkom/core";
import { ConfirmDialog } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { resolveErrorText, type Draft, type DraftErrors } from "./model";

/**
 * Additional codes: every other code this item answers to. Attaching one that
 * other products already use warns first (they stay attached to both — sibling
 * variants legitimately share a box EAN). Codes are attached immediately, so
 * the item must exist first.
 */
function ExtraCodesField({ productId, productName }: { productId: string | null; productName: string }) {
  const t = useT();
  const [codes, setCodes] = useState<ProductCode[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ code: string; names: string[] } | null>(null);
  const [removing, setRemoving] = useState<ProductCode | null>(null);

  const refresh = useCallback(() => {
    if (!productId) {
      setCodes([]);
      return;
    }
    window.arkom
      .invoke("catalog:codes", { productId })
      .then(setCodes)
      .catch((err) => console.error("catalog:codes failed", err));
  }, [productId]);

  useEffect(refresh, [refresh]);

  const attach = (confirmed: boolean) => {
    const code = input.trim();
    if (!productId || code === "") return;
    setError(null);
    window.arkom
      .invoke("catalog:addCode", { productId, code, confirmed })
      .then((result) => {
        if (result.kind === "sharedWarning") {
          setConflicts({ code: result.code, names: result.conflicts.map((c) => c.name) });
          return;
        }
        setCodes(result.codes);
        setInput("");
      })
      .catch((err) => setError(errorMessage(t, err)));
  };

  const remove = (code: ProductCode) => {
    if (!productId) return;
    window.arkom
      .invoke("catalog:removeCode", { productId, codeId: code.id })
      .then(setCodes)
      .catch((err) => setError(errorMessage(t, err)))
      .finally(() => setRemoving(null));
  };

  return (
    <Field label={t("editor.extraCodes")} error={error} hint={productId ? t("editor.extraCodesHint") : t("editor.saveFirstForCodes")}>
      <div className="flex gap-1.5">
        <TextInput
          mono
          disabled={!productId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              attach(false);
            }
          }}
          placeholder={t("editor.extraCodePlaceholder")}
        />
        <GhostButton disabled={!productId || input.trim() === ""} onClick={() => attach(false)}>
          {t("editor.addCode")}
        </GhostButton>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {codes.length === 0 ? (
          <span className="text-[10px] text-faint">{t("editor.noExtraCodes")}</span>
        ) : (
          codes.map((code) => (
            <span
              key={code.id}
              className="inline-flex items-center gap-1 rounded-[2px] border border-border-input bg-card px-1 py-px font-mono text-[10px] tabular-nums"
            >
              {code.code}
              <button type="button" className="text-muted hover:text-ink" onClick={() => setRemoving(code)}>
                ✕
              </button>
            </span>
          ))
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={t("editor.removeCodeTitle")}
        body={removing ? t("editor.removeCodeBody", { code: removing.code, name: productName }) : ""}
        confirmLabel={t("editor.removeCodeConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => removing && remove(removing)}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={conflicts !== null}
        title={t("shared.title")}
        body={conflicts ? t("shared.body", { code: conflicts.code, names: conflicts.names.join(", ") }) : ""}
        confirmLabel={t("shared.attachAnyway")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          setConflicts(null);
          attach(true);
        }}
        onCancel={() => setConflicts(null)}
      />
    </Field>
  );
}

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
  const dataLabel = useDataLabel();

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

        {/* The box code is the point of this field — scanning it here is what
            makes the item findable later. Generating an internal code is the
            fallback, demoted to a text button. */}
        <Field
          label={t("editor.barcode")}
          error={err("barcode")}
          hint={draft.barcode ? null : t("editor.barcodeHelper")}
        >
          <TextInput
            mono
            value={draft.barcode}
            onChange={(e) => onPatch({ barcode: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault(); // scanner Enter must not submit
            }}
            placeholder={t("editor.barcodePlaceholder")}
          />
        </Field>
        {draft.barcode.trim() === "" ? (
          <button
            type="button"
            className="-mt-1 self-start text-[10px] text-muted underline hover:text-ink"
            onClick={() => onPatch({ barcode: generateInternalEan13() })}
          >
            {t("editor.generate")}
          </button>
        ) : null}

        <ExtraCodesField productId={draft.id} productName={draft.name} />

        <Field label={t("editor.group")} required error={err("groupId")}>
          <SelectInput requiredStyle value={draft.groupId} onChange={(e) => onPatch({ groupId: e.target.value })}>
            <option value="">{t("editor.groupPlaceholder")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {dataLabel(g.name)}
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
