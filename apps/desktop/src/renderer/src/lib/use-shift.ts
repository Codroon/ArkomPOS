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
  emit();
  return current;
}

const getSnapshot = () => current;

export function useShift(): { shift: ShiftState | null; loaded: boolean; refresh: () => Promise<ShiftState | null> } {
  const shift = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!loaded) void refreshShift();
  }, []);

  const refresh = useCallback(() => refreshShift(), []);
  return { shift, loaded, refresh };
}

/** Forget what we knew — used when the session ends, so the next user re-reads. */
export function resetShift(): void {
  current = null;
  loaded = false;
  emit();
}
