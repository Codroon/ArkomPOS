/**
 * The brands this product can wear.
 *
 * Codroon POS is the product. Arkom POS is the pilot — the same software, sold
 * and supported by Codroon, wearing the shop's own name while they prove it in
 * a real shop. Odoo works exactly this way: the vendor's brand by default, the
 * customer's brand as something a partner applies, and the copyright line
 * staying with whoever wrote it in either case.
 *
 * So branding is DATA here rather than strings scattered through the source.
 * `pnpm brand <name>` applies one: it rewrites the colour tokens in both halves,
 * the product name in the Electron manifest and the main process, the wordmark
 * in the two interfaces, and the icon masters. Adding a white-label customer is
 * then a file in this folder and one command — which is what makes it something
 * you can sell rather than a fortnight of find-and-replace.
 *
 * What NEVER varies, whichever brand is applied:
 *   · `appId` — Windows identifies an install by it, so changing it turns an
 *     upgrade into a second copy of the program sitting beside the first.
 *   · The shop's own name on every printed document; a test forbids any brand
 *     name reaching a customer's receipt.
 *   · The copyright, which is Codroon's in all cases.
 */

export interface Brand {
  /** the key `pnpm brand <key>` takes */
  key: string;
  /** what Windows calls it: title bar, Start menu, Add or remove programs */
  productName: string;
  /** the wordmark on the app's brand plate, and in the cloud's rail */
  wordmark: string;
  /** the small word beside it */
  wordmarkSuffix: string;
  /** the icon masters in this folder, without the .svg */
  masters: { square: string; rounded: string; favicon: string };
  /**
   * Only the tokens that actually differ between brands. Everything else —
   * the Bone surfaces, the functional tint pairs, the type — is the product's
   * and does not move.
   */
  palette: {
    accent: string;
    "accent-ink": string;
    focus: string;
    inverse: string;
    "inverse-2": string;
    "inverse-ink": string;
    "inverse-muted": string;
    ink: string;
    "ink-2": string;
    muted: string;
    subtle: string;
  };
  /** appears in About, the installer's metadata and the web footer — never on paper */
  copyright: string;
}

/** The product. Codroon Orange on charcoal; Codroon's own brand tokens. */
export const CODROON: Brand = {
  key: "codroon",
  productName: "Codroon POS",
  wordmark: "CODROON",
  wordmarkSuffix: "POS",
  masters: {
    square: "codroon-tile-square",
    rounded: "codroon-tile-rounded",
    favicon: "codroon-favicon",
  },
  palette: {
    accent: "#e96a42",
    "accent-ink": "#232220",
    focus: "#e96a42",
    inverse: "#232220",
    "inverse-2": "#403d36",
    "inverse-ink": "#eae5e1",
    "inverse-muted": "#8a857a",
    ink: "#232220",
    "ink-2": "#403d36",
    muted: "#6b675e",
    subtle: "#8a857a",
  },
  copyright: "© Codroon",
};

/**
 * The pilot. Signal Blue on Graphite — the palette the Arkom mark was drawn
 * for, which is why it comes back with the mark rather than wearing Codroon's
 * orange under somebody else's name.
 */
export const ARKOM: Brand = {
  key: "arkom",
  productName: "Arkom POS",
  wordmark: "ARKOM",
  wordmarkSuffix: "POS",
  masters: {
    square: "arkom-tile-square",
    rounded: "arkom-tile-rounded",
    favicon: "arkom-favicon",
  },
  palette: {
    accent: "#2f9bff",
    "accent-ink": "#15181b",
    focus: "#2f9bff",
    inverse: "#15181b",
    "inverse-2": "#2a2f35",
    "inverse-ink": "#f1efe9",
    "inverse-muted": "#70777d",
    ink: "#15181b",
    "ink-2": "#2a2f35",
    /**
     * NOT the original Gray 400 (#70777d).
     *
     * Applying this palette through the brand layer ran it past the contrast
     * assertions for the first time, and Gray 400 on Bone is 3.87:1 — under the
     * 4.5 that labels and table headers need, and what the till had been
     * shipping since the beginning. This is the same gray a shade darker, at
     * 4.7:1. The identity of a brand is its accent and its chrome; a label gray
     * is a functional colour and it has to be readable across a counter.
     */
    muted: "#5f666c",
    subtle: "#9b9a92",
  },
  /* Codroon wrote it and Codroon supports it, whoever's name is on the door.
     This is the one line Odoo does not let anybody remove either. */
  copyright: "© Codroon",
};

export const BRANDS: Record<string, Brand> = { codroon: CODROON, arkom: ARKOM };
