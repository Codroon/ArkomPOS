/**
 * The one place a technician is chosen — ADR-0014 amendment.
 *
 * Five screens picked a technician from five copies of the same dropdown, each
 * fed by `auth:users`, which is the LOGIN list: it offered the owner and every
 * cashier as people to assign a repair to, and after v0.14.1 it would have
 * offered nobody, because technicians have no PIN and no longer appear there.
 *
 * One component, one channel, one definition of "who can be assigned work":
 * active users with the Technician role, and nothing else.
 */
import { useEffect, useState } from "react";
import type { TechnicianRef } from "@arkom/core";
import { SelectInput, useT } from "@arkom/ui";

/** Cached per session: a shop has three technicians and five screens ask. */
let cache: TechnicianRef[] | null = null;
const listeners = new Set<(rows: TechnicianRef[]) => void>();

export async function refreshTechnicians(): Promise<TechnicianRef[]> {
  try {
    cache = await window.arkom.invoke("users:technicians", {});
  } catch (err) {
    console.error("users:technicians failed", err);
    cache = cache ?? [];
  }
  for (const fn of listeners) fn(cache);
  return cache;
}

export function useTechnicians(): TechnicianRef[] {
  const [rows, setRows] = useState<TechnicianRef[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setRows);
    if (cache === null) void refreshTechnicians();
    else setRows(cache);
    return () => {
      listeners.delete(setRows);
    };
  }, []);
  return rows;
}

export const UNASSIGNED = "unassigned";

/**
 * @param mode `filter` adds "todos"; `assign` does not — assigning to
 * "everyone" is not a thing, and a picker that offers it invites the question.
 */
export function TechnicianPicker({
  value,
  onChange,
  mode,
  className,
  disabled,
}: {
  /**
   * Raw, so the three states stay distinguishable: `""` is no filter,
   * `UNASSIGNED` is the tickets nobody has taken, an id is a person. Collapsing
   * the first two into `null` is how a filter for "unassigned" quietly becomes
   * a filter for "everything".
   */
  value: string;
  onChange: (next: string) => void;
  mode: "filter" | "assign";
  className?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const technicians = useTechnicians();

  return (
    <SelectInput
      className={className}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {mode === "filter" ? <option value="">{t("tech.all")}</option> : null}
      <option value={UNASSIGNED}>{t("tech.unassigned")}</option>
      {technicians.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </SelectInput>
  );
}
