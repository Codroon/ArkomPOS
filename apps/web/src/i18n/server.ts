/**
 * Reading the staff language on the server.
 *
 * Separate from `./index` because that module is imported by the top bar, which
 * is a client component — and `next/headers` in a client bundle is a build
 * error, correctly: a browser has no request to read a cookie from.
 */
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, isLocale, translatorFor, type Locale, type Translate } from "./index";

/**
 * The language a browser asks for, when nobody has chosen one yet.
 *
 * Until now a first visit was always Spanish. An English-speaking owner then
 * met a Spanish page, Chrome offered to translate it, and from then on Chrome's
 * machine translation sat on top of ours — turning "Cajas" into "Boxes", "Salir"
 * into "Go out" and our own "ES · EN" buttons into "IS · IN". It looked as if
 * our Spanish did not work, because Chrome translated it straight back.
 *
 * So a first visit opens in the browser's own language, and the page tells
 * Chrome not to translate it at all (see the root layout). Spanish stays the
 * default for anything that is neither, because the product is sold in Spain.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0]!.trim().toLowerCase();
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("en")) return "en";
  }
  return "es";
}

/** The staff language for this request: their choice, else their browser's. */
export async function getLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    const value = store.get(LOCALE_COOKIE)?.value;
    if (isLocale(value)) return value;
    return localeFromAcceptLanguage((await headers()).get("accept-language"));
  } catch {
    /* rendered outside a request (a static shell, a test): the default is a
       language, not an error */
    return "es";
  }
}

export async function getT(): Promise<{ t: Translate; locale: Locale }> {
  const locale = await getLocale();
  return { t: translatorFor(locale), locale };
}
