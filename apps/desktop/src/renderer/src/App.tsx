import { useCallback, useEffect, useRef, useState } from "react";
import { MetaContextResponseSchema, SetupStatusResponseSchema, type MetaContextResponse } from "@arkom/core";
import { AppShell } from "./components/app-shell";
import { FirstRunDialog } from "./screens/setup/first-run-dialog";
import { LoginScreen } from "./screens/auth/login-screen";
import { LockOverlay } from "./screens/auth/lock-overlay";
import { OwnerStep } from "./screens/auth/owner-step";
import { AuthFrame } from "./screens/auth/login-screen";
import { PrinterStep } from "./screens/setup/printer-step";
import { SessionProvider, useActivityReporter, useSession } from "./lib/use-session";

/**
 * Boot order, and it matters:
 *
 *   1. Is there a shop?      no  → first-run setup
 *   2. Is there an owner?    no  → owner creation (a v0.9.0 till that updated)
 *   3. Is someone signed in? no  → Login
 *   4. Is the session locked?    → Lock overlay over the shell
 *
 * Each question is asked of MAIN, never inferred in the renderer. A restart
 * always lands at step 3 because the session is memory-only (ADR-0012 §4).
 */
type Stage = "loading" | "setup" | "owner" | "printer" | "login" | "app";

function Boot() {
  const { session, ready } = useSession();
  const [stage, setStage] = useState<Stage>("loading");
  const [context, setContext] = useState<MetaContextResponse | null>(null);
  /** true while this launch is walking somebody through first run */
  const onboardingRef = useRef(false);

  const loadContext = useCallback(() => {
    window.arkom
      .invoke("meta:context")
      .then((raw) => setContext(MetaContextResponseSchema.parse(raw)))
      .catch((err) => console.error("meta:context failed", err));
  }, []);

  const evaluate = useCallback(async () => {
    try {
      const status = SetupStatusResponseSchema.parse(await window.arkom.invoke("setup:status"));
      if (status.needed) return setStage("setup");
      if (status.ownerNeeded) return setStage("owner");
      /* the printer is the last thing first run asks for, and only on the run
         that just set the shop up: a till that has been working for a week and
         lost its printer is Ajustes' problem, not a wizard's (v0.18.2) */
      if (onboardingRef.current) {
        onboardingRef.current = false;
        return setStage("printer");
      }
      loadContext();
      setStage("login");
    } catch (err) {
      console.error("setup:status failed", err);
    }
  }, [loadContext]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  // a live session takes precedence over whatever the boot check concluded
  useEffect(() => {
    if (ready && session) setStage("app");
    else if (ready && !session && stage === "app") setStage("login");
  }, [ready, session, stage]);

  // only report activity while someone is actually working
  useActivityReporter(stage === "app" && !!session && !session.locked);

  const switchUser = useCallback(async () => {
    try {
      await window.arkom.invoke("auth:logout");
    } catch (err) {
      console.error("auth:logout failed", err);
    }
  }, []);

  if (stage === "loading") return <div className="h-full bg-canvas" />;
  if (stage === "setup")
    return (
      <FirstRunDialog
        onDone={() => {
          onboardingRef.current = true;
          void evaluate();
        }}
      />
    );
  if (stage === "owner") return <OwnerStep upgrade={!onboardingRef.current} onDone={() => void evaluate()} />;
  if (stage === "printer")
    return (
      <AuthFrame>
        <PrinterStep onDone={() => void evaluate()} />
      </AuthFrame>
    );
  if (stage === "login" || !session) {
    return <LoginScreen onSignedIn={() => { loadContext(); setStage("app"); }} />;
  }

  return (
    <>
      <AppShell context={context} />
      {session.locked ? <LockOverlay session={session} onSwitchUser={() => void switchUser()} /> : null}
    </>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Boot />
    </SessionProvider>
  );
}
