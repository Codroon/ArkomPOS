/**
 * Editor draft model + client-side validation (req 4.1 — same rules the
 * server enforces via CatalogSaveRequestSchema; messages here are the ES
 * field-level texts). Money enters as text and is parsed to cents at this
 * boundary (00-foundations).
 */
import {
  centsToInput,
  parseMoneyInput,
  type CatalogSaveRequest,
  type IpcError,
  type ProductRow,
} from "@arkom/core";

export interface Draft {
  id: string | null;
  name: string;
  barcode: string; // "" → server generates an internal EAN-13 (req 4.2)
  groupId: string; // "" = unset
  itemType: "stocked" | "serialized";
  costInput: string;
  priceInput: string;
  taxRegime: "IVA21" | ""; // "" only on migrated/seed incomplete rows
  reorderInput: string;
  lowStockInput: string;
  active: boolean;
}

export type DraftField =
  | "name"
  | "barcode"
  | "groupId"
  | "itemType"
  | "costCents"
  | "priceCents"
  | "taxRegime"
  | "reorderPoint"
  | "lowStockThreshold";

export type DraftErrors = Partial<Record<DraftField, string>>;

export function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    barcode: "",
    groupId: "",
    itemType: "stocked",
    costInput: "",
    priceInput: "",
    taxRegime: "IVA21",
    reorderInput: "0",
    lowStockInput: "0",
    active: true,
  };
}

export function draftFromRow(r: ProductRow): Draft {
  return {
    id: r.id,
    name: r.name,
    barcode: r.barcode ?? "",
    groupId: r.groupId ?? "",
    itemType: r.itemType === "serialized" ? "serialized" : "stocked",
    costInput: r.costCents == null ? "" : centsToInput(r.costCents),
    priceInput: r.priceCents == null ? "" : centsToInput(r.priceCents),
    taxRegime: r.taxRegime === "IVA21" ? "IVA21" : "",
    reorderInput: String(r.reorderPoint),
    lowStockInput: String(r.lowStockThreshold),
    active: r.active,
  };
}

function parseIntField(input: string): number | null {
  return /^\d+$/.test(input.trim()) ? Number(input.trim()) : null;
}

/** Validate the draft; a null request means at least one error. */
export function validateDraft(d: Draft): { errors: DraftErrors; request: CatalogSaveRequest | null } {
  const errors: DraftErrors = {};

  const name = d.name.trim();
  if (!name) errors.name = "El nombre es obligatorio.";

  if (!d.groupId) errors.groupId = "El grupo es obligatorio."; // 4.1

  const cost = d.costInput.trim() === "" ? undefined : parseMoneyInput(d.costInput);
  if (cost === undefined) errors.costCents = "El coste es obligatorio."; // 4.1
  else if (cost === null) errors.costCents = "Importe no válido.";

  const price = d.priceInput.trim() === "" ? undefined : parseMoneyInput(d.priceInput);
  if (price === undefined) errors.priceCents = "El PVP es obligatorio."; // 4.1
  else if (price === null) errors.priceCents = "Importe no válido.";

  if (d.taxRegime !== "IVA21") errors.taxRegime = "El IVA es obligatorio."; // 4.1 (P1: IVA21)

  const reorder = parseIntField(d.reorderInput);
  if (reorder === null) errors.reorderPoint = "Entero ≥ 0."; // 4.5
  const lowStock = parseIntField(d.lowStockInput);
  if (lowStock === null) errors.lowStockThreshold = "Entero ≥ 0."; // 4.5

  if (Object.keys(errors).length > 0) return { errors, request: null };
  return {
    errors,
    request: {
      id: d.id,
      name,
      barcode: d.barcode.trim() === "" ? null : d.barcode.trim(),
      groupId: d.groupId,
      itemType: d.itemType,
      costCents: cost as number,
      priceCents: price as number,
      taxRegime: "IVA21",
      reorderPoint: reorder as number,
      lowStockThreshold: lowStock as number,
      active: d.active,
    },
  };
}

/** Map a typed server error onto the editor field it belongs to. */
export function serverErrorToDraftErrors(err: IpcError): { field: DraftField | null; message: string } {
  const known: DraftField[] = [
    "name",
    "barcode",
    "groupId",
    "itemType",
    "costCents",
    "priceCents",
    "taxRegime",
    "reorderPoint",
    "lowStockThreshold",
  ];
  if (err.field && (known as string[]).includes(err.field)) {
    return { field: err.field as DraftField, message: err.message };
  }
  if (err.code === "DUPLICATE_NAME") return { field: "name", message: err.message };
  if (err.code === "DUPLICATE_BARCODE") return { field: "barcode", message: err.message };
  return { field: null, message: err.message };
}

export function isDirty(draft: Draft, baseline: Draft | null): boolean {
  if (!baseline) return true;
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}
