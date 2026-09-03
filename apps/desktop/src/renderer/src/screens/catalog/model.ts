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
import type { TFn, TKey } from "@arkom/ui";

/** Either a dictionary key (client/known-code errors) or a raw server message. */
export type ErrorText = TKey | { raw: string };

export function resolveErrorText(t: TFn, err: ErrorText | undefined): string | undefined {
  if (err === undefined) return undefined;
  return typeof err === "string" ? t(err) : err.raw;
}

/** What the editor can make. Service and agency lines stay out of Phase 1's UI. */
export type EditorItemType = "stocked" | "serialized" | "used_device" | "repair";
const EDITOR_TYPES: readonly string[] = ["stocked", "serialized", "used_device", "repair"];
export const isEditorType = (v: string): v is EditorItemType => EDITOR_TYPES.includes(v);

/**
 * The regime is a consequence of the type, not a second decision: a used
 * article sells under the margin scheme, everything else at the general rate
 * (ADR-0007 A1). The select shows the one that applies.
 */
export const expectedRegime = (itemType: EditorItemType): "IVA21" | "REBU" =>
  itemType === "used_device" ? "REBU" : "IVA21";

export interface Draft {
  id: string | null;
  name: string;
  barcode: string; // "" → server generates an internal EAN-13 (req 4.2)
  groupId: string; // "" = unset
  itemType: EditorItemType;
  costInput: string;
  priceInput: string;
  taxRegime: "IVA21" | "REBU" | ""; // "" only on migrated/seed incomplete rows
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

export type DraftErrors = Partial<Record<DraftField, ErrorText>>;

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
    itemType: isEditorType(r.itemType) ? r.itemType : "stocked",
    costInput: r.costCents == null ? "" : centsToInput(r.costCents),
    priceInput: r.priceCents == null ? "" : centsToInput(r.priceCents),
    taxRegime: r.taxRegime === "IVA21" || r.taxRegime === "REBU" ? r.taxRegime : "",
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
  if (!name) errors.name = "val.nameRequired";

  if (!d.groupId) errors.groupId = "val.groupRequired"; // 4.1

  const cost = d.costInput.trim() === "" ? undefined : parseMoneyInput(d.costInput);
  if (cost === undefined) errors.costCents = "val.costRequired"; // 4.1
  else if (cost === null) errors.costCents = "val.invalidAmount";

  const price = d.priceInput.trim() === "" ? undefined : parseMoneyInput(d.priceInput);
  if (price === undefined) errors.priceCents = "val.priceRequired"; // 4.1
  else if (price === null) errors.priceCents = "val.invalidAmount";

  const regime = expectedRegime(d.itemType);
  if (d.taxRegime !== regime) errors.taxRegime = "val.taxRequired"; // 4.1 — the regime the type calls for

  const reorder = parseIntField(d.reorderInput);
  if (reorder === null) errors.reorderPoint = "val.intGteZero"; // 4.5
  const lowStock = parseIntField(d.lowStockInput);
  if (lowStock === null) errors.lowStockThreshold = "val.intGteZero"; // 4.5

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
      taxRegime: regime,
      reorderPoint: reorder as number,
      lowStockThreshold: lowStock as number,
      active: d.active,
    },
  };
}

/**
 * Map a typed server error onto the editor field it belongs to. Known codes
 * resolve to dictionary keys (locale-aware); VALIDATION details keep the
 * server's Spanish domain message verbatim (ADR-0011: domain messages are ES).
 */
export function serverErrorToDraftErrors(err: IpcError): { field: DraftField | null; message: ErrorText } {
  if (err.code === "DUPLICATE_NAME") return { field: "name", message: "err.duplicateName" };
  if (err.code === "DUPLICATE_BARCODE") return { field: "barcode", message: "err.duplicateBarcode" };
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
    return { field: err.field as DraftField, message: { raw: err.message } };
  }
  return { field: null, message: { raw: err.message } };
}

export function isDirty(draft: Draft, baseline: Draft | null): boolean {
  if (!baseline) return true;
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}
