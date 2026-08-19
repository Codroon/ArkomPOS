/**
 * Editor panel (380px, bg-panel) — handoff 02 "Editor panel". Doubles for
 * create/edit; Guardar disabled until dirty ∧ valid; Eliminar rendered locked
 * (P1: deactivation via the Activo switch is the only path).
 */
import { centsToInput, formatCents, generateInternalEan13, marginCents, marginPct, parseMoneyInput, type EntityRef } from "@arkom/core";
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
} from "@arkom/ui";
import type { Draft, DraftErrors } from "./model";

const TYPE_OPTIONS = [
  { value: "stocked" as const, label: "Stock" },
  { value: "serialized" as const, label: "Serializado" },
  { value: "used_device" as const, label: "Usado", disabled: true },
  { value: "service" as const, label: "Servicio", disabled: true },
  { value: "repair" as const, label: "Reparación", disabled: true },
  { value: "agency" as const, label: "Agencia", disabled: true },
];

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
  if (!draft) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center text-[12px] text-muted">
          Selecciona un artículo
          <div className="mt-1 text-[11px] text-faint">o crea uno con “+ Nuevo artículo”.</div>
        </div>
      </div>
    );
  }

  const cost = parseMoneyInput(draft.costInput);
  const price = parseMoneyInput(draft.priceInput);
  const margin = cost !== null && price !== null ? marginCents(price, cost) : null;
  const marginRatio = cost !== null && price !== null ? marginPct(price, cost) : null;

  const reformatOnBlur = (key: "costInput" | "priceInput") => () => {
    const cents = parseMoneyInput(draft[key]);
    if (cents !== null) onPatch({ [key]: centsToInput(cents) } as Partial<Draft>);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-[13px] font-bold">{draft.id ? "Editar artículo" : "Nuevo artículo"}</div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <Field label="Nombre" required error={errors.name}>
          <TextInput
            key={draft.id ?? "new"}
            requiredStyle
            autoFocus={draft.id === null}
            value={draft.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="Nombre del artículo"
          />
        </Field>

        <Field label="Código de barras" error={errors.barcode} hint={draft.barcode ? null : "Vacío = se genera al guardar."}>
          <div className="flex gap-1.5">
            <TextInput
              mono
              value={draft.barcode}
              onChange={(e) => onPatch({ barcode: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault(); // scanner Enter must not submit
              }}
              placeholder="Escanear o escribir"
            />
            {draft.barcode.trim() === "" ? (
              <GhostButton onClick={() => onPatch({ barcode: generateInternalEan13() })}>Generar</GhostButton>
            ) : null}
          </div>
        </Field>

        <Field label="Grupo" required error={errors.groupId}>
          <SelectInput
            requiredStyle
            value={draft.groupId}
            onChange={(e) => onPatch({ groupId: e.target.value })}
          >
            <option value="">— Selecciona —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Coste" required error={errors.costCents}>
            <TextInput
              mono
              requiredStyle
              value={draft.costInput}
              onChange={(e) => onPatch({ costInput: e.target.value })}
              onBlur={reformatOnBlur("costInput")}
              placeholder="0,00"
            />
          </Field>
          <Field label="PVP" required error={errors.priceCents}>
            <TextInput
              mono
              requiredStyle
              value={draft.priceInput}
              onChange={(e) => onPatch({ priceInput: e.target.value })}
              onBlur={reformatOnBlur("priceInput")}
              placeholder="0,00"
            />
          </Field>
          <Field label="IVA" required error={errors.taxRegime}>
            <SelectInput
              requiredStyle
              value={draft.taxRegime}
              onChange={(e) => onPatch({ taxRegime: e.target.value === "IVA21" ? "IVA21" : "" })}
            >
              {draft.taxRegime === "" ? <option value="">—</option> : null}
              <option value="IVA21">21%</option>
              <option disabled>10% — próximamente</option>
              <option disabled>4% — próximamente</option>
              <option disabled>REBU — próximamente</option>
              <option disabled>Exento — próximamente</option>
            </SelectInput>
          </Field>
        </div>

        <div className="text-[11px] text-muted">
          Margen calculado:{" "}
          {margin !== null ? (
            <span className="font-mono tabular-nums">
              {formatCents(margin)}
              {marginRatio !== null ? ` · ${String(marginRatio).replace(".", ",")}%` : ""}
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <SectionLabel>Tipo de artículo</SectionLabel>
          <Segmented
            options={TYPE_OPTIONS}
            value={draft.itemType}
            onChange={(v) => {
              if (v === "stocked" || v === "serialized") onPatch({ itemType: v });
            }}
          />
          {errors.itemType ? (
            <div className="text-[11px] leading-snug text-ink-2">{errors.itemType}</div>
          ) : draft.itemType === "serialized" ? (
            <div className="text-[11px] leading-snug text-faint">Requiere IMEI por unidad en la venta.</div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Punto de pedido" error={errors.reorderPoint}>
            <TextInput
              mono
              inputMode="numeric"
              value={draft.reorderInput}
              onChange={(e) => onPatch({ reorderInput: e.target.value })}
            />
          </Field>
          <Field label="Umbral bajo stock" error={errors.lowStockThreshold}>
            <TextInput
              mono
              inputMode="numeric"
              value={draft.lowStockInput}
              onChange={(e) => onPatch({ lowStockInput: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <SectionLabel>Activo</SectionLabel>
          <Switch
            checked={draft.active}
            onChange={(v) => onPatch({ active: v })}
            label={draft.active ? "Sí" : "No"}
          />
        </div>
        {!draft.active ? (
          <div className="text-[11px] leading-snug text-faint">
            Un artículo inactivo no se puede vender ni recibir stock; conserva su historial.
          </div>
        ) : null}
      </div>

      <div className="border-t border-border-strong bg-panel-2 px-4 py-2.5">
        {generalError ? <div className="mb-2 text-[11px] text-ink-2">{generalError}</div> : null}
        <div className="flex items-center gap-2">
          <PrimaryButton onClick={onSave} disabled={!canSave || saving}>
            {saving ? "Guardando…" : "Guardar"}
          </PrimaryButton>
          <GhostButton onClick={onCancel}>Cancelar</GhostButton>
          <div className="flex-1" />
          <LockedButton title="Los artículos con movimientos no se eliminan; desactívalo con «Activo».">
            Eliminar
          </LockedButton>
        </div>
      </div>
    </div>
  );
}
