/**
 * The only literal colours in the app, and the reason they are allowed.
 *
 * Everything else takes its colour from a token by meaning — `bg-card`,
 * `text-muted` — so a screen cannot reach for a shade the till has never heard
 * of. SVG cannot. Recharts sets `fill` as a presentation ATTRIBUTE, and an
 * attribute does not resolve `var(--color-ink-2)`; only a CSS declaration does.
 * So a chart has to be handed a real value.
 *
 * Which makes this file the exception, and an exception is only safe if
 * something checks it: `layout-rules.test.ts` asserts every value below appears
 * verbatim in `app/globals.css`. Change a token and the test fails here until
 * this file is changed with it — the two cannot drift, which is the whole
 * reason raw hex is banned in the first place.
 *
 * Deliberately NOT the accent. It lands on exactly one element per screen — the
 * primary action — so a chart painted in it would compete with the only thing
 * on the page that is supposed to be shouting.
 */

/** `--color-ink-2`: the single-series bar. */
export const CHART_INK = "#2a2f35";

/** `--color-line`: axes and the tooltip's border. */
export const CHART_LINE = "#dcd8cd";

/** `--color-inverse-muted`: axis labels. */
export const CHART_MUTED = "#70777d";

/** `--color-hover`: the cursor behind a hovered bar. */
export const CHART_HOVER = "#e7e4da";

/** `--color-card` and `--color-ink`: the tooltip. */
export const CHART_SURFACE = "#ffffff";
export const CHART_TEXT = "#15181b";

/**
 * The graphite ramp, for categories.
 *
 * FOUR entries, not five, because there are exactly four greys in the token set
 * between the ink and the strong border and an invented fifth would be a colour
 * nothing else in the product knows about — which is the drift this file exists
 * to prevent. A fifth category reuses the first at reduced opacity; opacity is
 * not a colour, so it cannot drift.
 */
export const CHART_RAMP = [CHART_INK, CHART_MUTED, "#9b9a92", "#c4bfb1"] as const;

/** `--color-subtle` and `--color-line-strong`, named for the test that checks them. */
export const CHART_SUBTLE = "#9b9a92";
export const CHART_LINE_STRONG = "#c4bfb1";
