/**
 * The one place a group is chosen, and the one place the list lives — ADR-0017.
 *
 * Five screens fetched `catalog:groups` into five pieces of local state. That
 * was survivable while groups were a fixed seed nobody could change; the moment
 * a shop can create one from the editor, four of those five lists are stale
 * until their screen is remounted, and the shop's answer to "my new group isn't
 * there" is to distrust the feature.
 *
 * So: one cache, one refresh, and every consumer re-renders when it changes.
 * Same shape as the technician picker, for the same reason.
 */
import { useEffect, useState } from "react";
import type { EntityRef } from "@arkom/core";
import { useDataLabel } from "@arkom/ui";

let cache: EntityRef[] | null = null;
const listeners = new Set<(rows: EntityRef[]) => void>();

export async function refreshGroups(): Promise<EntityRef[]> {
  try {
    cache = await window.arkom.invoke("catalog:groups");
  } catch (err) {
    console.error("catalog:groups failed", err);
    cache = cache ?? [];
  }
  for (const fn of listeners) fn(cache);
  return cache;
}

export function useGroups(): EntityRef[] {
  const [rows, setRows] = useState<EntityRef[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setRows);
    if (cache === null) void refreshGroups();
    else setRows(cache);
    return () => {
      listeners.delete(setRows);
    };
  }, []);
  return rows;
}

/** A group the shop just made is in the list before its screen asks again. */
export function noteGroup(group: EntityRef): void {
  const rest = (cache ?? []).filter((g) => g.id !== group.id);
  cache = [...rest, group];
  for (const fn of listeners) fn(cache);
}

/**
 * The options, not the control.
 *
 * The filter rows and the editor's field are styled differently on purpose —
 * one is a 6px chip in a toolbar, the other a full field — so what is shared
 * here is the LIST and the labelling, which is the part that was drifting.
 */
export function GroupOptions({ allLabel }: { allLabel?: string }) {
  const dataLabel = useDataLabel();
  const groups = useGroups();
  return (
    <>
      {allLabel !== undefined ? <option value="">{allLabel}</option> : null}
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {dataLabel(g.name)}
        </option>
      ))}
    </>
  );
}
