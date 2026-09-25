/**
 * The shell every panel page sits in.
 *
 * The guard lives here rather than on each page, so a screen added next year
 * inherits it instead of having to remember it. Copy is resolved here too and
 * handed to the chrome as plain strings: the client bundle carries the words
 * this person is reading, not both dictionaries.
 *
 * The rail's collapsed state is read from its cookie HERE, on the server, and
 * passed down. The chrome could read it after hydration, but then the first
 * paint is 240px wide and the second is 64px, and a layout that jumps on every
 * navigation reads as broken however correct it ends up.
 */
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { requireAccount } from "../../src/auth/session";
import { signOutAction } from "../../src/auth/actions";
import { getT } from "../../src/i18n/server";
import { RAIL_COOKIE } from "../../src/lib/prefs";
import { PanelChrome, type ChromeLabels } from "./chrome";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const { t, locale } = await getT();
  const railCollapsed = (await cookies()).get(RAIL_COOKIE)?.value === "1";

  const labels: ChromeLabels = {
    brand: t("app.brand"),
    signOut: t("app.signOut"),
    language: t("app.language"),
    period: t("range.label"),
    custom: t("range.custom"),
    from: t("range.from"),
    to: t("range.to"),
    apply: t("filter.apply"),
    more: t("nav.more"),
    collapse: t("nav.collapse"),
    expand: t("nav.expand"),
    close: t("app.close"),
    nav: {
      summary: t("nav.summary"),
      sales: t("nav.sales"),
      catalogue: t("nav.catalogue"),
      inventory: t("nav.inventory"),
      repairs: t("nav.repairs"),
      used: t("nav.used"),
      transfers: t("nav.transfers"),
      reports: t("nav.reports"),
      tills: t("nav.tills"),
    },
    groups: {
      today: t("navgroup.today"),
      selling: t("navgroup.selling"),
      stock: t("navgroup.stock"),
      workshop: t("navgroup.workshop"),
      more: t("navgroup.more"),
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
        railCollapsed={railCollapsed}
        signOut={signOutAction}
      >
        {children}
      </PanelChrome>
    </Suspense>
  );
}
