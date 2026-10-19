/**
 * Read again when the shop's data moves under this screen — ADR-0024 §3.
 *
 * A sale at the other counter lands in this till's database within a second or
 * two; without this, the screen showing the old on-hand kept showing it until
 * somebody navigated away and back. `entities` narrows it to the kinds of row
 * the screen draws, so a repair landing does not reload the catalogue.
 *
 * Bursts are gathered: one sale is several rows, and a screen should read once.
 */
import { useEffect, useRef } from "react";

const GATHER_MS = 250;

export function useShopChanged(refresh: () => unknown, entities: readonly string[]): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  const watched = entities.join(",");

  useEffect(() => {
    const wanted = new Set(watched.split(","));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.arkom.onShopChanged?.(({ entities: changed }) => {
      if (!changed.some((e) => wanted.has(e))) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        Promise.resolve(latest.current()).catch(() => undefined);
      }, GATHER_MS);
    });
    return () => {
      off?.();
      if (timer) clearTimeout(timer);
    };
  }, [watched]);
}
