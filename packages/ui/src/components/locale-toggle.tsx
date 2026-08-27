import { cn } from "../cn";
import { useLocale, useT } from "../i18n";

/**
 * The ES · EN switch.
 *
 * Lives here rather than inside the app shell because it is needed BEFORE the
 * shell exists: whoever sets a till up has to be able to read the setup screens,
 * and that person is not always the Spanish-speaking shopkeeper — the installer
 * may be the developer.
 *
 * **This is a staff-UI switch only.** Printed tickets render from fixed Spanish
 * constants and ignore it entirely (ADR-0011): the customer's document must not
 * change language because a developer left the toggle on English.
 *
 * Sized for the Graphite topbar it always sits on, so it reads as one control
 * whether it is on the shell, the setup wizard or the login screen.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const t = useT();
  const [locale, setLocale] = useLocale();

  return (
    <button
      type="button"
      title={t("shell.localeToggle")}
      aria-label={t("shell.localeToggle")}
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
      className={cn(
        "flex items-center gap-1 self-center rounded-[3px] border border-inverse-muted/50 px-1.5 py-0.5",
        "font-mono text-[10px] font-bold tracking-[.06em] hover:border-inverse-ink",
        className,
      )}
    >
      <span className={locale === "es" ? "text-inverse-ink" : "text-inverse-muted"}>ES</span>
      <span className="text-inverse-muted">·</span>
      <span className={locale === "en" ? "text-inverse-ink" : "text-inverse-muted"}>EN</span>
    </button>
  );
}
