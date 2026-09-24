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
    /**
     * Leave the cache UNSET, never an empty list.
     *
     * `cache = cache ?? []` looked harmless and was a day-one bug: the channel
     * throws while a till has no shop yet, which is exactly the state during
     * first-run setup. One failed fetch then wrote [] into the cache, and
     * because consumers only fetch when the cache is null, nothing ever asked
     * again — so a shop finished the wizard and saw "No groups yet" until the
     * app was restarted. Staying null costs one retry per mount and is right.
     */
    cache = null;
    announce();
    return [];
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

/**
 * The label for a group that came attached to a ROW — a catalogue line, a
 * valuation total, a dead-stock item — rather than from the cache.
 *
 * Those rows are shaped by a SQL join, and until v0.18.1 the join sent one
 * string: the canonical Spanish name. So an English till showed English shelves
 * in the Sale grid (which reads the cache) and Spanish ones in the catalogue
 * table, the reports and the editor's dropdown right beside it. Main sends both
 * names now, and this is the one place that chooses between them.
 */
export function useGroupLabel(): (row: { groupName?: string | null; groupNameEn?: string | null }) => string | null {
  const [locale] = useLocale();
  return (row) => {
    const es = row.groupName?.trim();
    if (!es) return null; // no group: the READER words that (ADR-0011)
    return groupDisplayName({ name: es, nameEn: row.groupNameEn ?? null }, locale);
  };
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
