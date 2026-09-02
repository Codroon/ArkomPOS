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
import { groupDisplayName, type GroupRef } from "@arkom/core";
import { useLocale } from "@arkom/ui";

let cache: GroupRef[] | null = null;
/**
 * Bumped whenever the list changes.
 *
 * A rename reaches every DROPDOWN for free, because they read the cache. It does
 * not reach a TABLE, whose rows carry a `groupName` that came from their own
 * query — so the Catálogo and Inventario columns kept the old word while the
 * Sale chips right next to them showed the new one. Screens that hold joined
 * rows depend on this and re-read.
 */
let version = 0;
const listeners = new Set<(rows: GroupRef[]) => void>();
const versionListeners = new Set<(v: number) => void>();

function announce() {
  version += 1;
  for (const fn of listeners) fn(cache ?? []);
  for (const fn of versionListeners) fn(version);
}

/** Changes on every create and rename. Put it in a refresh effect's deps. */
export function useGroupsVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    versionListeners.add(setV);
    return () => {
      versionListeners.delete(setV);
    };
  }, []);
  return v;
}

export async function refreshGroups(): Promise<GroupRef[]> {
  try {
    cache = await window.arkom.invoke("catalog:groups");
  } catch (err) {
    console.error("catalog:groups failed", err);
    cache = cache ?? [];
  }
  announce();
  return cache;
}

export function useGroups(): GroupRef[] {
  const [rows, setRows] = useState<GroupRef[]>(cache ?? []);
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
export function noteGroup(group: GroupRef): void {
  const rest = (cache ?? []).filter((g) => g.id !== group.id);
  cache = [...rest, group];
  announce();
}

/**
 * The options, not the control.
 *
 * The filter rows and the editor's field are styled differently on purpose —
 * one is a 6px chip in a toolbar, the other a full field — so what is shared
 * here is the LIST and the labelling, which is the part that was drifting.
 */
/** The label a group shows: the shop's English name when there is one. */
export function useGroupName(): (group: GroupRef) => string {
  const [locale] = useLocale();
  return (group) => groupDisplayName(group, locale);
}

export function GroupOptions({ allLabel }: { allLabel?: string }) {
  const label = useGroupName();
  const groups = useGroups();
  return (
    <>
      {allLabel !== undefined ? <option value="">{allLabel}</option> : null}
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {label(g)}
        </option>
      ))}
    </>
  );
}
