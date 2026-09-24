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
    /**
     * Leave the cache UNSET, never an empty list.
     *
     * `cache = cache ?? []` looked harmless and was a day-one bug: the channel
     * throws while a till has no shop yet, which is exactly the state during
     * first-run setup. One failed fetch then wrote [] into the cache, and
     * because consumers only fetch when the cache is null, nothing ever asked
     * again — so a screen that asked before the shop existed stayed empty
     * for the life of the process. Staying null costs one retry per mount and is right.
     */
    cache = null;
    for (const fn of listeners) fn([]);
    return [];
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

/**
 * One empty option, worded for what the screen is doing.
 *
 * A filter's blank means "every technician"; an intake's blank means "nobody has
 * been given this yet". They are different sentences about the same absence, so
 * the picker says which one it is rather than making the reader work it out.
 *
 * There is deliberately no "Unassigned" CHOICE. On an intake it read as a
 * technician you could pick, which is not a thing; on a filter it was a state
 * masquerading as a person in a list of people.
 */
export function TechnicianPicker({
  value,
  onChange,
  mode,
  className,
  disabled,
}: {
  /** `""` is the empty option — every technician, or nobody yet. */
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
      <option value="">{mode === "filter" ? t("tech.all") : t("tech.select")}</option>
      {technicians.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </SelectInput>
  );
}
