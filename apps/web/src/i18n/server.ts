/**
 * Reading the staff language on the server.
 *
 * Separate from `./index` because that module is imported by the top bar, which
 * is a client component — and `next/headers` in a client bundle is a build
 * error, correctly: a browser has no request to read a cookie from.
 */
import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale, translatorFor, type Locale, type Translate } from "./index";

/** The staff language for this request. Spanish unless somebody said otherwise. */
export async function getLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    const value = store.get(LOCALE_COOKIE)?.value;
    return isLocale(value) ? value : "es";
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
