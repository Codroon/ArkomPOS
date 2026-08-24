import { useCallback, useEffect, useState } from "react";
import { MetaContextResponseSchema, SetupStatusResponseSchema, type MetaContextResponse } from "@arkom/core";
import { AppShell } from "./components/app-shell";
import { FirstRunDialog } from "./screens/setup/first-run-dialog";

/**
 * Boot order matters: ask whether the till has been set up BEFORE asking who it
 * is. On a fresh client install there is no tenant yet, so meta:context would
 * fail — and a failed context is not an error there, it is the normal state of
 * a machine the installer finished five seconds ago.
 */
export function App() {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [context, setContext] = useState<MetaContextResponse | null>(null);

  const loadContext = useCallback(() => {
    window.arkom
      .invoke("meta:context")
      // Zod on both sides of the bridge (CLAUDE.md hard rule)
      .then((raw) => setContext(MetaContextResponseSchema.parse(raw)))
      .catch((err) => console.error("meta:context failed", err));
  }, []);

  useEffect(() => {
    window.arkom
      .invoke("setup:status")
      .then((raw) => {
        const { needed } = SetupStatusResponseSchema.parse(raw);
        setSetupNeeded(needed);
        if (!needed) loadContext();
      })
      .catch((err) => console.error("setup:status failed", err));
  }, [loadContext]);

  const onSetupDone = useCallback(() => {
    setSetupNeeded(false);
    loadContext();
  }, [loadContext]);

  // hold the frame back for one round-trip rather than flashing the shell and
  // then replacing it with the setup dialog
  if (setupNeeded === null) return <div className="h-full bg-canvas" />;
  if (setupNeeded) return <FirstRunDialog onDone={onSetupDone} />;

  return <AppShell context={context} />;
}
