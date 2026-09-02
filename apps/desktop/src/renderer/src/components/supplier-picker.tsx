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
import { useEffect, useState } from "react";
import type { EntityRef } from "@arkom/core";
import type { TKey } from "@arkom/ui";
import { PickOrCreateField } from "./pick-or-create";

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

/** The supplier half of {@link PickOrCreateField}: this list, its channel, its words. */
export function SupplierField({
  value,
  onChange,
  label,
  required = false,
}: {
  value: string;
  onChange: (supplierId: string) => void;
  label: TKey;
  required?: boolean;
}) {
  return (
    <PickOrCreateField
      items={useSuppliers()}
      value={value}
      onChange={onChange}
      onCreate={async (name) => {
        const created = await window.arkom.invoke("supplier:create", { name });
        noteSupplier(created);
        return created;
      }}
      required={required}
      labels={{
        field: label,
        placeholder: "entry.supplierPlaceholder",
        create: "entry.newSupplier",
        namePlaceholder: "entry.newSupplierPlaceholder",
        duplicate: "entry.supplierDuplicate",
      }}
    />
  );
}
