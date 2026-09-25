/**
 * Preferences that live in a cookie, and their names.
 *
 * In a NEUTRAL module — neither `"use client"` nor server-only — because both
 * halves need the name. The rail's cookie started out exported from
 * `chrome.tsx`, which carries `"use client"`, and the layout imported it from
 * there to read on the server. That compiles, renders, and is wrong: a Server
 * Component importing from a client module gets a client REFERENCE, so the
 * constant arrived as undefined, `cookies().get(undefined)` found nothing, and
 * the rail expanded itself on every navigation while the cookie sat there
 * saying otherwise. Nothing errors; the feature just quietly does not work.
 *
 * Same reason `src/i18n/index.ts` is split from `src/i18n/server.ts`.
 */

/** Is the desktop rail collapsed to icons? "1" or absent. */
export const RAIL_COOKIE = "codroon_rail";
