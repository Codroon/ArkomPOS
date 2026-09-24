/**
 * The shell every panel page sits in.
 *
 * The guard lives here rather than on each page, so a screen added next year
 * inherits it instead of having to remember it. Copy is resolved here too and
 * handed to the chrome as plain strings: the client bundle carries the words
 * this person is reading, not both dictionaries.
 */
import { Suspense, type ReactNode } from "react";
import { requireAccount } from "../../src/auth/session";
import { signOutAction } from "../../src/auth/actions";
import { getT } from "../../src/i18n/server";
import { PanelChrome, type ChromeLabels } from "./chrome";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const { t, locale } = await getT();

  const labels: ChromeLabels = {
    brand: t("app.brand"),
    signOut: t("app.signOut"),
    language: t("app.language"),
    period: t("range.label"),
    nav: {
      summary: t("nav.summary"),
      sales: t("nav.sales"),
      catalogue: t("nav.catalogue"),
      inventory: t("nav.inventory"),
      tills: t("nav.tills"),
    },
    ranges: {
      today: t("range.today"),
      "7d": t("range.7d"),
      "30d": t("range.30d"),
      "90d": t("range.90d"),
    },
  };

  const licence =
    account.licenceState === "active"
      ? t("licence.active")
      : account.licenceState === "suspended"
        ? t("licence.suspended")
        : t("licence.trial");

  return (
    /* Suspense because the chrome reads searchParams for the period, and Next
       needs a boundary around anything that does. */
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <PanelChrome
        labels={labels}
        locale={locale}
        account={{ name: account.name, email: account.email, licence }}
        signOut={signOutAction}
      >
        {children}
      </PanelChrome>
    </Suspense>
  );
}
