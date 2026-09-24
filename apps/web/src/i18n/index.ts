/**
 * The cloud's copy, in the two languages the product ships in.
 *
 * Same discipline as the till (ADR-0011): `es` is the source of truth and `en`
 * must satisfy its key map, so a missing translation is a type error rather
 * than a word in the wrong language on somebody's screen. The difference is
 * that here the dictionary is read on the SERVER — almost every panel page is a
 * Server Component, and a client bundle should not carry both languages.
 *
 * The locale is a cookie, set by the switcher in the top bar. It is staff
 * preference and nothing more: it changes no figure, no document and no rule.
 *
 * This half is PURE, so the top bar (a client component, because it has to know
 * which link is current) can import the cookie's name and the locale type
 * without dragging `next/headers` into a browser bundle. Reading the cookie
 * lives in `./server`.
 */
export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "codroon_locale";

const es = {
  "app.brand": "CODROON POS",
  "app.signOut": "Salir",
  "app.language": "Idioma",

  "nav.summary": "Resumen",
  "nav.sales": "Ventas",
  "nav.catalogue": "Catálogo",
  "nav.inventory": "Inventario",
  "nav.tills": "Cajas",

  "licence.trial": "De prueba",
  "licence.active": "Activa",
  "licence.suspended": "Suspendida",

  "range.today": "Hoy",
  "range.7d": "7 días",
  "range.30d": "30 días",
  "range.90d": "90 días",
  "range.label": "Periodo",

  "kpi.net": "Ventas netas",
  "kpi.documents": "Documentos",
  "kpi.average": "Ticket medio",
  "kpi.tax": "IVA repercutido",
  "kpi.vsPrevious": "frente al periodo anterior",

  "chart.takings": "Ventas por día",
  "chart.takingsHint": "Solo documentos completados, con la hora de la tienda.",
  "chart.payments": "Formas de cobro",
  "chart.paymentsHint": "De dónde salió el dinero, en el periodo elegido.",
  "chart.topProducts": "Lo que más se vende",
  "chart.topProductsHint": "Por importe, en el periodo elegido.",

  "sales.title": "Ventas",
  "sales.hint": "Solo documentos completados. Un borrador no es dinero.",
  "sales.search": "Buscar por número",
  "sales.allTypes": "Todos los tipos",
  "sales.export": "Exportar CSV",
  "sales.empty": "No hay documentos en este periodo.",

  "doc.number": "Número",
  "doc.type": "Tipo",
  "doc.when": "Cuándo",
  "doc.base": "Base",
  "doc.tax": "IVA",
  "doc.total": "Total",
  "doc.lines": "Líneas",
  "doc.payment": "Cobro",
  "doc.paymentHint": "Un vale o una señal es una forma de pago, nunca una línea.",
  "doc.change": "Cambio",
  "doc.qty": "Cant.",
  "doc.price": "Precio",
  "doc.concept": "Concepto",
  "doc.regime": "Impuesto",
  "doc.overridden": "precio cambiado",
  "doc.back": "Volver a ventas",
  "doc.taxBase": "Base imponible",

  "cat.title": "Catálogo",
  "cat.hint": "El stock es la suma de los movimientos, no una cifra guardada.",
  "cat.search": "Buscar artículo o código",
  "cat.lowOnly": "Solo bajo mínimo",
  "cat.item": "Artículo",
  "cat.group": "Grupo",
  "cat.code": "Código",
  "cat.cost": "Coste",
  "cat.price": "PVP",
  "cat.stock": "Stock",
  "cat.archived": "archivado",
  "cat.empty": "Todavía no hay artículos.",
  "cat.summary": "{n} artículos · {units} unidades · {value} a coste",

  "inv.title": "Movimientos de stock",
  "inv.hint": "Lo que entró y salió de la estantería.",
  "inv.reason": "Motivo",
  "inv.qty": "Cantidad",
  "inv.unitCost": "Coste unidad",

  "shift.title": "Cierres de caja",
  "shift.hint": "Un turno cerrado no se puede tocar. Esto es lo que se contó.",
  "shift.expected": "Esperado",
  "shift.counted": "Contado",
  "shift.variance": "Descuadre",

  "till.title": "Cajas",
  "till.hint": "Una fila por caja, con la versión que tiene instalada.",
  "till.name": "Caja",
  "till.shop": "Tienda",
  "till.version": "Versión",
  "till.lastPush": "Último envío",
  "till.movements": "Movimientos",
  "till.state": "Estado",
  "till.linked": "ENLAZADA",
  "till.revoked": "REVOCADA",
  "till.none": "Todavía no hay ninguna caja enlazada.",
  "till.noneHint":
    "En la caja: Ajustes → Nube, pega el código de enlace y pulsa Enlazar la caja. Lo que ya haya vendido subirá solo.",

  "empty.noData": "Nada que enseñar todavía en este periodo.",
} as const;

export type MessageKey = keyof typeof es;

const en: Record<MessageKey, string> = {
  "app.brand": "CODROON POS",
  "app.signOut": "Sign out",
  "app.language": "Language",

  "nav.summary": "Overview",
  "nav.sales": "Sales",
  "nav.catalogue": "Catalogue",
  "nav.inventory": "Inventory",
  "nav.tills": "Tills",

  "licence.trial": "Trial",
  "licence.active": "Active",
  "licence.suspended": "Suspended",

  "range.today": "Today",
  "range.7d": "7 days",
  "range.30d": "30 days",
  "range.90d": "90 days",
  "range.label": "Period",

  "kpi.net": "Net sales",
  "kpi.documents": "Documents",
  "kpi.average": "Average sale",
  "kpi.tax": "VAT charged",
  "kpi.vsPrevious": "vs the period before",

  "chart.takings": "Sales by day",
  "chart.takingsHint": "Completed documents only, on the shop's clock.",
  "chart.payments": "How it was paid",
  "chart.paymentsHint": "Where the money came from, over the chosen period.",
  "chart.topProducts": "Best sellers",
  "chart.topProductsHint": "By value, over the chosen period.",

  "sales.title": "Sales",
  "sales.hint": "Completed documents only. A draft is not money.",
  "sales.search": "Search by number",
  "sales.allTypes": "All types",
  "sales.export": "Export CSV",
  "sales.empty": "No documents in this period.",

  "doc.number": "Number",
  "doc.type": "Type",
  "doc.when": "When",
  "doc.base": "Base",
  "doc.tax": "VAT",
  "doc.total": "Total",
  "doc.lines": "Lines",
  "doc.payment": "Payment",
  "doc.paymentHint": "A voucher or a deposit is a way of paying, never a line.",
  "doc.change": "Change",
  "doc.qty": "Qty",
  "doc.price": "Price",
  "doc.concept": "Item",
  "doc.regime": "Tax",
  "doc.overridden": "price changed",
  "doc.back": "Back to sales",
  "doc.taxBase": "Taxable base",

  "cat.title": "Catalogue",
  "cat.hint": "Stock is the sum of the movements, never a stored figure.",
  "cat.search": "Search name or barcode",
  "cat.lowOnly": "Low stock only",
  "cat.item": "Item",
  "cat.group": "Group",
  "cat.code": "Barcode",
  "cat.cost": "Cost",
  "cat.price": "Price",
  "cat.stock": "Stock",
  "cat.archived": "archived",
  "cat.empty": "No items yet.",
  "cat.summary": "{n} items · {units} units · {value} at cost",

  "inv.title": "Stock movements",
  "inv.hint": "What came onto the shelf and what left it.",
  "inv.reason": "Reason",
  "inv.qty": "Quantity",
  "inv.unitCost": "Unit cost",

  "shift.title": "Cash-ups",
  "shift.hint": "A closed shift cannot be touched. This is what was counted.",
  "shift.expected": "Expected",
  "shift.counted": "Counted",
  "shift.variance": "Variance",

  "till.title": "Tills",
  "till.hint": "One row per till, with the version it is running.",
  "till.name": "Till",
  "till.shop": "Shop",
  "till.version": "Version",
  "till.lastPush": "Last sent",
  "till.movements": "Movements",
  "till.state": "State",
  "till.linked": "LINKED",
  "till.revoked": "REVOKED",
  "till.none": "No till is linked yet.",
  "till.noneHint":
    "On the till: Settings → Cloud, paste the link code and press Link this till. Whatever it has already sold will come up by itself.",

  "empty.noData": "Nothing to show for this period yet.",
};

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { es, en };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function make(locale: Locale): Translate {
  const dict = DICTIONARIES[locale];
  return (key, vars) => {
    const raw = dict[key] ?? es[key];
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  };
}

/** For a component that was handed a locale rather than a cookie. */
export const translatorFor = (locale: Locale): Translate => make(locale);

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);
