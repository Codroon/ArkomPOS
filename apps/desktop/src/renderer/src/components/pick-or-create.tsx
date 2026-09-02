/**
 * Pick from a reference list, or add one without leaving the form.
 *
 * The shop meets a new supplier mid-delivery and needs a new group mid-typing —
 * not in a settings screen — so both lists grew an inline "add one" affordance,
 * and they grew it differently. The group field put "+ Nuevo grupo…" INSIDE the
 * dropdown; the supplier field put a link underneath it.
 *
 * The in-dropdown version is the wrong one, and not just for consistency: a
 * dropdown is a list of VALUES, and an action sitting among them is something
 * you select that does not select anything. It reads as though the shop had a
 * group called "+ New group". Same category error as offering "Unassigned" as a
 * technician.
 *
 * So one component. Technicians, groups and suppliers have each drifted once
 * already; a fourth list gets this rather than a fourth opinion.
 */
import { useEffect, useRef, useState } from "react";
import { parseIpcError, type EntityRef } from "@arkom/core";
import { Field, GhostButton, SelectInput, TextInput, useDataLabel, useT, type TKey } from "@arkom/ui";
import { errorMessage } from "../lib/errors";

export interface PickOrCreateLabels {
  /** the field's own label, e.g. "Grupo" */
  field: TKey;
  /** the empty option, e.g. "— Selecciona —" */
  placeholder: TKey;
  /** the link, and the heading while creating, e.g. "Nuevo grupo" */
  create: TKey;
  /** placeholder in the name box */
  namePlaceholder: TKey;
  /** what DUPLICATE_NAME should say */
  duplicate: TKey;
}

export function PickOrCreateField({
  items,
  value,
  onChange,
  onCreate,
  labels,
  error,
  required = false,
}: {
  items: EntityRef[];
  /** `""` = nothing chosen */
  value: string;
  onChange: (id: string) => void;
  /** creates the row and returns it; the caller owns the channel and the cache */
  onCreate: (name: string) => Promise<EntityRef>;
  labels: PickOrCreateLabels;
  /** a validation message from the form around it */
  error?: string;
  required?: boolean;
}) {
  const t = useT();
  const dataLabel = useDataLabel();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const created = await onCreate(trimmed);
      // the point of creating it here: whatever is being filled in lands in it
      onChange(created.id);
      setCreating(false);
      setName("");
    } catch (err) {
      setFailure(parseIpcError(err)?.code === "DUPLICATE_NAME" ? t(labels.duplicate) : errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  /* Its own column, so the link sits under the control in a dialog grid as well
     as in a drawer's flex column rather than depending on its parent. */
  return (
    <div className="flex flex-col">
      <Field
        label={creating ? t(labels.create) : t(labels.field)}
        required={required}
        error={failure ?? error}
      >
        {creating ? (
          <div className="flex gap-1.5">
            <TextInput
              ref={inputRef}
              requiredStyle={required}
              maxLength={120}
              value={name}
              placeholder={t(labels.namePlaceholder)}
              onChange={(e) => {
                setName(e.target.value);
                setFailure(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <GhostButton disabled={!name.trim() || busy} onClick={() => void create()}>
              {t("common.save")}
            </GhostButton>
          </div>
        ) : (
          <SelectInput requiredStyle={required} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{t(labels.placeholder)}</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {dataLabel(item.name)}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      <button
        type="button"
        className="mt-1 self-start text-[10px] text-muted underline hover:text-ink"
        onClick={() => {
          setCreating((c) => !c);
          setFailure(null);
        }}
      >
        {creating ? t("common.cancel") : t(labels.create)}
      </button>
    </div>
  );
}
