/**
 * The one place a supplier is chosen, and the one place the list lives.
 *
 * Receiving a delivery already had this: a dropdown, and a "new supplier" link
 * that turns it into a name box. Ordering a part for a repair had a free-text
 * field instead, so the same shop typed "TecnoImport" on one screen and picked
 * it on another, and neither knew about the other's spelling.
 *
 * This is the third list to drift this way after technicians and groups, so it
 * gets the same shape: one cache, one refresh, one component. What is shared is
 * the LIST and the creation flow — the two screens size the control differently
 * and that is fine.
 */
import { useEffect, useRef, useState } from "react";
import { parseIpcError, type EntityRef } from "@arkom/core";
import { Field, GhostButton, SelectInput, TextInput, useDataLabel, useT } from "@arkom/ui";
import { errorMessage } from "../lib/errors";

let cache: EntityRef[] | null = null;
const listeners = new Set<(rows: EntityRef[]) => void>();

const byName = (rows: EntityRef[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name, "es"));

export async function refreshSuppliers(): Promise<EntityRef[]> {
  try {
    cache = byName(await window.arkom.invoke("supplier:list"));
  } catch (err) {
    console.error("supplier:list failed", err);
    cache = cache ?? [];
  }
  for (const fn of listeners) fn(cache);
  return cache;
}

export function useSuppliers(): EntityRef[] {
  const [rows, setRows] = useState<EntityRef[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setRows);
    if (cache === null) void refreshSuppliers();
    else setRows(cache);
    return () => {
      listeners.delete(setRows);
    };
  }, []);
  return rows;
}

/** A supplier just created is in the list before any screen asks again. */
export function noteSupplier(supplier: EntityRef): void {
  cache = byName([...(cache ?? []).filter((s) => s.id !== supplier.id), supplier]);
  for (const fn of listeners) fn(cache);
}

/**
 * The field: a dropdown, and a way out of it.
 *
 * The shop meets a new supplier at the counter, mid-delivery or mid-quote — not
 * in a settings screen — so creating one happens here, and the row it creates is
 * selected straight away.
 */
export function SupplierField({
  value,
  onChange,
  label,
  required = false,
  placeholder,
}: {
  /** `""` = none chosen */
  value: string;
  onChange: (supplierId: string) => void;
  label: string;
  required?: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const suppliers = useSuppliers();

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
      const created = await window.arkom.invoke("supplier:create", { name: trimmed });
      noteSupplier(created);
      onChange(created.id);
      setCreating(false);
      setName("");
    } catch (err) {
      setFailure(parseIpcError(err)?.code === "DUPLICATE_NAME" ? t("entry.supplierDuplicate") : errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  /* Self-contained: the link is INSIDE the component's own column, so the field
     works in a dialog grid as well as in the receiving drawer's flex column. It
     used to be a sibling pulled up with a negative margin, which only lined up
     in the one layout it was written for. */
  return (
    <div className="flex flex-col">
      <Field label={creating ? t("entry.newSupplier") : label} required={required} error={failure ?? undefined}>
        {creating ? (
          <div className="flex gap-1.5">
            <TextInput
              ref={inputRef}
              requiredStyle={required}
              maxLength={120}
              value={name}
              placeholder={t("entry.newSupplierPlaceholder")}
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
            <option value="">{placeholder ?? t("entry.supplierPlaceholder")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {dataLabel(s.name)}
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
        {creating ? t("common.cancel") : t("entry.newSupplier")}
      </button>
    </div>
  );
}
