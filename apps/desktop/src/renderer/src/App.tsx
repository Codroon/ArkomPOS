import { useEffect, useState } from "react";
import { MetaContextResponseSchema, type MetaContextResponse } from "@arkom/core";
import { AppShell } from "./components/app-shell";

export function App() {
  const [context, setContext] = useState<MetaContextResponse | null>(null);

  useEffect(() => {
    window.arkom
      .invoke("meta:context")
      // Zod on both sides of the bridge (CLAUDE.md hard rule)
      .then((raw) => setContext(MetaContextResponseSchema.parse(raw)))
      .catch((err) => console.error("meta:context failed — did you run `pnpm db:seed`?", err));
  }, []);

  return <AppShell context={context} />;
}
