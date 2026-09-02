/**
 * The groups a till starts with — ADR-0017.
 *
 * Until v0.14.1 groups existed only inside the demo dataset, which made "start
 * empty" a trap: `catalog:save` requires a group, the dropdown had none, and
 * there was no way in the app to make one. A shop that chose the honest option
 * at first run could not create its first product.
 *
 * So every fresh install gets these five, `is_demo = false`, whether or not the
 * demo data comes with them. They are a starting point, not a taxonomy: the
 * shop renames them and adds its own, and nothing in the code reads a group by
 * name.
 *
 * They are seeded in the language the shop set the till up in. A group name is
 * shop DATA the moment it lands in the database — never translated afterwards,
 * because after the first rename it is their word for their thing — so the one
 * moment the app can get it right is the moment it writes it.
 */
export interface StarterGroup {
  /** stable across languages; used by the demo dataset to find its groups */
  readonly key: string;
  readonly es: string;
  readonly en: string;
}

export const STARTER_GROUPS: readonly StarterGroup[] = [
  { key: "mobiles", es: "Móviles", en: "Phones" },
  { key: "protectors", es: "Protectores", en: "Protectors" },
  { key: "cases", es: "Fundas y carcasas", en: "Cases and covers" },
  { key: "charging", es: "Cargadores y Cables", en: "Chargers & Cables" },
  { key: "powerbanks", es: "Baterías externas", en: "Power banks" },
  { key: "audio", es: "Auriculares", en: "Headphones" },
  { key: "speakers", es: "Altavoces", en: "Speakers" },
  { key: "wearables", es: "Relojes y wearables", en: "Smart watches and wearables" },
  { key: "computing", es: "Memoria y Ordenador", en: "Memory & Computing" },
  { key: "photovideo", es: "Accesorios de foto y vídeo", en: "Photo and video accessories" },
  { key: "spares", es: "Repuestos", en: "Repair parts" },
  /**
   * Where the buy screen files a second-hand device.
   *
   * It is seeded like the rest since v0.14.2 rather than appearing out of
   * nowhere on the first purchase — and because that code finds it BY NAME, a
   * shelf that exists from day one is a shelf it cannot fail to find.
   */
  { key: "used", es: "Usados", en: "Used" },
] as const;

export type SetupLocale = "es" | "en";

export function starterGroupNames(locale: SetupLocale): string[] {
  return STARTER_GROUPS.map((g) => (locale === "en" ? g.en : g.es));
}

/**
 * Normalised for the duplicate check.
 *
 * "Fundas" and "fundas " are the same group to everybody except a unique index,
 * and a shop told "that already exists" about a name it cannot see the
 * difference from is a shop that stops trusting the message. Accents are kept:
 * "Móviles" and "Moviles" ARE different words, and collapsing them would refuse
 * a legitimate name.
 */
export function groupNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-ES");
}

/* ------------------------------------------------------------- display */

/** A group as every screen receives it: both names, so the toggle can choose. */
export interface GroupRef {
  id: string;
  name: string;
  /** null = the shop has not given an English name; the Spanish one is used */
  nameEn: string | null;
}

/**
 * Which of the two names to show.
 *
 * Falls back to the Spanish name rather than leaving a blank: a shop that never
 * fills in the English column still has a working English till, with its own
 * words on the shelves. That is the common case and it must not look broken.
 */
export function groupDisplayName(group: { name: string; nameEn?: string | null }, locale: SetupLocale): string {
  if (locale !== "en") return group.name;
  const en = group.nameEn?.trim();
  return en ? en : group.name;
}

/**
 * The English name a STARTER group should have, matched from either language.
 *
 * A till upgrading from before this column has the five under whichever
 * language it was set up in, so the match runs both ways.
 */
export function starterEnglishName(name: string): string | null {
  const key = groupNameKey(name);
  const hit = STARTER_GROUPS.find((g) => groupNameKey(g.es) === key || groupNameKey(g.en) === key);
  return hit ? hit.en : null;
}
