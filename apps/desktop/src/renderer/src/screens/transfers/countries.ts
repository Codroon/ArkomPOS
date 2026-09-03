/**
 * Where the money goes, and where it comes from.
 *
 * The corridors a Spanish phone shop's WU counter actually sees, then the rest
 * of the EU and the common ones after that. Names are Spanish because a country
 * name is a proper noun on a document, not UI copy — the same rule the printed
 * ticket follows (ADR-0011).
 */
export interface Country {
  code: string;
  name: string;
}

export const COUNTRIES: ReadonlyArray<Country> = [
  { code: "MA", name: "Marruecos" },
  { code: "PK", name: "Pakistán" },
  { code: "SN", name: "Senegal" },
  { code: "CO", name: "Colombia" },
  { code: "EC", name: "Ecuador" },
  { code: "PE", name: "Perú" },
  { code: "BO", name: "Bolivia" },
  { code: "DO", name: "República Dominicana" },
  { code: "VE", name: "Venezuela" },
  { code: "BR", name: "Brasil" },
  { code: "AR", name: "Argentina" },
  { code: "PY", name: "Paraguay" },
  { code: "HN", name: "Honduras" },
  { code: "NI", name: "Nicaragua" },
  { code: "CU", name: "Cuba" },
  { code: "NG", name: "Nigeria" },
  { code: "GH", name: "Ghana" },
  { code: "GM", name: "Gambia" },
  { code: "ML", name: "Malí" },
  { code: "CI", name: "Costa de Marfil" },
  { code: "GN", name: "Guinea" },
  { code: "DZ", name: "Argelia" },
  { code: "IN", name: "India" },
  { code: "BD", name: "Bangladés" },
  { code: "NP", name: "Nepal" },
  { code: "PH", name: "Filipinas" },
  { code: "CN", name: "China" },
  { code: "UA", name: "Ucrania" },
  { code: "RO", name: "Rumanía" },
  { code: "BG", name: "Bulgaria" },
  { code: "PL", name: "Polonia" },
  { code: "PT", name: "Portugal" },
  { code: "FR", name: "Francia" },
  { code: "IT", name: "Italia" },
  { code: "DE", name: "Alemania" },
  { code: "GB", name: "Reino Unido" },
  { code: "US", name: "Estados Unidos" },
  { code: "ES", name: "España" },
];
