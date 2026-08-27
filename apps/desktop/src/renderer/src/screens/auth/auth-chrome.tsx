/**
 * Small pieces the auth surfaces share: the brand plate, a live lockout
 * countdown, and the hook behind it.
 */
import { useEffect, useState } from "react";
import { useT } from "@arkom/ui";

/** The same Graphite bar the shell wears, so Login looks like the app. */
export function BrandPlate() {
  const t = useT();
  return (
    <header className="relative flex h-11 flex-none items-center bg-inverse px-3.5 text-inverse-ink">
      <span className="font-display text-[15px] leading-none tracking-[.06em]">{t("shell.brand")}</span>
      <span className="ml-2 font-mono text-[9px] font-medium tracking-[.16em] text-inverse-muted">
        {t("shell.brandSuffix")}
      </span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-accent" />
    </header>
  );
}

/**
 * Milliseconds left until `until`, ticking down and settling on 0.
 *
 * Re-renders once a second only while something is actually locked, so an idle
 * Login screen is not repainting forever.
 */
export function useCountdown(until: number | null): number {
  const [remaining, setRemaining] = useState(() => (until ? Math.max(0, until - Date.now()) : 0));

  useEffect(() => {
    if (!until) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, until - Date.now()));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [until]);

  return remaining;
}

/** "Bloqueado · 4:58" on a tile, counting itself down without a reload. */
export function CountdownChip({ until }: { until: number }) {
  const t = useT();
  const remaining = useCountdown(until);
  if (remaining <= 0) return null;
  const total = Math.ceil(remaining / 1000);
  const time = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  return (
    <span className="inline-block rounded-[2px] border border-warning-ink/30 bg-warning-bg px-1.5 py-px font-mono text-[9px] font-bold text-warning-ink">
      {t("auth.lockedFor", { time })}
    </span>
  );
}
