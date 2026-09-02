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
  { key: "charging", es: "Cargadores y Cables", en: "Chargers & Cables" },
  { key: "audio", es: "Auriculares", en: "Headphones" },
  { key: "computing", es: "Memoria y Ordenador", en: "Memory & Computing" },
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
