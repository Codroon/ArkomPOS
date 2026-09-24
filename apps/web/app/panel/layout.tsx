/**
 * The shell every panel page sits in: who is signed in, where they can go, and
 * the way out.
 *
 * The guard is here rather than repeated on each page — a page added later
 * inherits it instead of having to remember it. `currentUser()` answers
 * "nobody" when Supabase is unreachable, so an outage looks signed-out rather
 * than throwing on every route.
 */
import type { ReactNode } from "react";
import { requireAccount } from "../../src/auth/session";
import { signOutAction } from "../../src/auth/actions";
import { PanelNav } from "./nav";

export const dynamic = "force-dynamic";

const LICENCE: Record<string, string> = {
  trial: "De prueba",
  active: "Activa",
  suspended: "Suspendida",
};

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();

  return (
    <div className="wrap wide">
      <div className="topbar">
        <div>
          <div className="brand" style={{ marginBottom: 6 }}>CODROON POS</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {account.name} · {account.email} · {LICENCE[account.licenceState] ?? account.licenceState}
          </div>
        </div>
        <form action={signOutAction}>
          <button className="ghost" type="submit">Salir</button>
        </form>
      </div>

      <PanelNav />

      {children}
    </div>
  );
}
