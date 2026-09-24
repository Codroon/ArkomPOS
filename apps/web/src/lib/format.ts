/**
 * Formatting, at the edge and nowhere else.
 *
 * Money is integer cents everywhere it is reasoned about — in the till, on the
 * wire, in Postgres and in every query in this app. It becomes a string with a
 * comma in it here, on its way to a screen, and never travels back.
 */

const EUROS = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export const euros = (cents: number): string => EUROS.format(cents / 100);

const two = (n: number) => String(n).padStart(2, "0");

export const dateTime = (value: Date | null): string =>
  value ? `${two(value.getDate())}/${two(value.getMonth() + 1)}/${value.getFullYear()} ${two(value.getHours())}:${two(value.getMinutes())}` : "—";

export const time = (value: Date | null): string =>
  value ? `${two(value.getHours())}:${two(value.getMinutes())}` : "—";

/** "2026-09-24" → "24/09/2026", without inventing a timezone on the way. */
export const dayLabel = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

/** What the till calls each kind of document, in the language the paper uses. */
export const DOC_TYPES: Record<string, string> = {
  ticket: "Ticket",
  refund: "Devolución",
  repair: "Reparación",
  used_purchase: "Compra usado",
  invoice: "Factura",
};

export const TENDER_METHODS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  store_credit: "Vale",
  deposit: "Señal",
};
