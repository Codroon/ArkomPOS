/**
 * The open shift, shared by everything that needs to know about it.
 *
 * A tiny store rather than a hook per consumer: the top-bar chip, the Caja
 * screen and the Sale screen's inline open all read the same answer, and a
 * refresh in one has to be visible in the others immediately — otherwise the
 * chip still says "Sin turno" a second after somebody opened one.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ShiftState } from "@arkom/core";

let current: ShiftState | null = null;
let loaded = false;
/**
 * Bumped by every refresh.
 *
 * Anything showing a figure DERIVED from the shift — expected cash, the Z
 * figures, the movement totals — depends on this, so opening or closing a shift
 * cannot leave a stale number on screen. Counting against a figure computed
 * before the drawer changed is how a shift comes up exactly wrong.
 */
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-read from main. Called after opening, closing, and on every nav to Caja. */
export async function refreshShift(): Promise<ShiftState | null> {
  try {
    current = await window.arkom.invoke("cash:current");
  } catch (err) {
    // a read failure is not "no shift": saying so would offer to open a second one
    console.error("cash:current failed", err);
  }
  loaded = true;
  version += 1;
  emit();
  return current;
}

/* one object per version, so useSyncExternalStore sees a stable reference
   between refreshes and a new one after each */
let snapshot: { shift: ShiftState | null; version: number } = { shift: null, version: 0 };
const getSnapshot = () => {
  if (snapshot.shift !== current || snapshot.version !== version) snapshot = { shift: current, version };
  return snapshot;
};

export function useShift(): {
  shift: ShiftState | null;
  loaded: boolean;
  /** changes whenever the shift is re-read — a dependency for derived figures */
  version: number;
  refresh: () => Promise<ShiftState | null>;
} {
  const { shift, version: v } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!loaded) void refreshShift();
  }, []);

  const refresh = useCallback(() => refreshShift(), []);
  return { shift, loaded, version: v, refresh };
}

/** Forget what we knew — used when the session ends, so the next user re-reads. */
export function resetShift(): void {
  current = null;
  loaded = false;
  version += 1;
  emit();
}
