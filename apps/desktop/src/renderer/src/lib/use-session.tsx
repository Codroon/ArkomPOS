/**
 * The session, from the renderer's side.
 *
 * Read-only by construction: main pushes `SessionInfo` on every change and this
 * hook holds the latest one. Nothing here decides anything — `useCan()` exists
 * so the UI can hide a button the user cannot use, and hiding a button is a
 * convenience. The control is the guard in main (ADR-0012 §5).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SessionInfoSchema, type PermissionKey, type SessionInfo } from "@arkom/core";

interface SessionState {
  session: SessionInfo | null;
  /** false only during the first round-trip at boot */
  ready: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  session: null,
  ready: false,
  refresh: async () => {},
});

/** How often activity is reported to main, at most. */
const ACTIVITY_THROTTLE_MS = 15_000;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const raw = await window.arkom.invoke("auth:session");
      setSession(SessionInfoSchema.nullable().parse(raw));
    } catch (err) {
      console.error("auth:session failed", err);
      setSession(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // main pushes; the renderer never polls for who is logged in
    return window.arkom.onSessionChanged((raw) => {
      setSession(SessionInfoSchema.nullable().parse(raw));
      setReady(true);
    });
  }, [refresh]);

  const value = useMemo(() => ({ session, ready, refresh }), [session, ready, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/**
 * Does the current user hold this permission?
 *
 * Returns a predicate rather than a boolean so a screen can ask about several
 * keys without a hook per key.
 */
export function useCan(): (key: PermissionKey) => boolean {
  const { session } = useSession();
  return useCallback(
    (key: PermissionKey) => session?.permissions.includes(key) ?? false,
    [session],
  );
}

/**
 * Hide (or replace) UI the user cannot act on.
 *
 * Approvable actions are deliberately NOT hidden: a cashier pressing
 * "Modificar precio" and getting the owner's keypad is the designed flow. Only
 * owner-only surfaces disappear (handoff/auth.md, "Shell changes").
 */
export function Guarded({
  permission,
  fallback = null,
  children,
}: {
  permission: PermissionKey;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const can = useCan();
  return <>{can(permission) ? children : fallback}</>;
}

/**
 * Report that a human is here, so the idle lock knows not to fire.
 *
 * Throttled hard: the signal main needs is "someone touched this in the last
 * 15 seconds", and forwarding every mousemove would be thousands of IPC calls
 * an hour for a boolean.
 */
export function useActivityReporter(active: boolean): void {
  const lastSent = useRef(0);

  useEffect(() => {
    if (!active) return;
    const ping = () => {
      const now = Date.now();
      if (now - lastSent.current < ACTIVITY_THROTTLE_MS) return;
      lastSent.current = now;
      void window.arkom.invoke("auth:activity").catch(() => {
        // a missed ping costs at most one lock; never surface it
      });
    };
    // pointerdown and keydown cover the scanner too — it is a keyboard wedge
    const events: (keyof WindowEventMap)[] = ["pointerdown", "pointermove", "keydown", "wheel"];
    for (const e of events) window.addEventListener(e, ping, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, ping);
    };
  }, [active]);
}
