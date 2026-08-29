/**
 * The Comprar-usados draft — what the screen holds before anything is written.
 *
 * It lives in the renderer only. Nothing here is a row: a purchase exists once
 * it is logged, which is also when its number is allocated (ADR-0008 forbids
 * reserving one early) and when the photos are written to disk.
 *
 * **Photos are held in memory as data URLs** until then. The alternative —
 * staging files under a temp folder as they are taken — leaks images for every
 * intake a cashier starts and abandons, and those are photographs of somebody's
 * ID document. Carrying a few megabytes in a React state for the two minutes
 * the form is open is the cheaper mistake.
 */
import {
  parseMoneyInput,
  type AcquisitionChannel,
  type DeviceGrade,
  type IdDocType,
  type PayoutMethod,
  type PhotoKind,
} from "@arkom/core";

export interface DraftPhoto {
  /** slot identity: front | back | extra1 | extra2 | seller_id */
  slot: PhotoSlot;
  kind: PhotoKind;
  /** JPEG data URL, longest edge ≤ MAX_EDGE_PX */
  dataUrl: string;
}

export const PHOTO_SLOTS = ["front", "back", "extra1", "extra2", "seller_id"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export function slotKind(slot: PhotoSlot): PhotoKind {
  if (slot === "front") return "front";
  if (slot === "back") return "back";
  if (slot === "seller_id") return "seller_id";
  return "extra";
}

/** W6: JPEG, longest edge ≤1600px. A phone photo is otherwise 4MB of counter. */
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.82;

export interface BuyDraft {
  brand: string;
  model: string;
  storage: string;
  color: string;
  grade: DeviceGrade;
  batteryPct: string;
  imei: string;
  accessories: { charger: boolean; box: boolean; cable: boolean; case: boolean };

  sellerName: string;
  sellerPhone: string;
  sellerIdType: IdDocType;
  sellerIdNumber: string;
  channel: AcquisitionChannel;

  buyPriceInput: string;
  payout: PayoutMethod;
  payoutReference: string;
  barcode: string;

  photos: Partial<Record<PhotoSlot, DraftPhoto>>;
}

export function emptyDraft(): BuyDraft {
  return {
    brand: "",
    model: "",
    storage: "",
    color: "",
    grade: "B", // the middle grade: most counter phones, and never an accident
    batteryPct: "",
    imei: "",
    accessories: { charger: false, box: false, cable: false, case: false },
    sellerName: "",
    sellerPhone: "",
    sellerIdType: "DNI",
    sellerIdNumber: "",
    channel: "private_individual",
    buyPriceInput: "",
    payout: "cash",
    payoutReference: "",
    barcode: "",
    photos: {},
  };
}

/** The battery field, or null when it is empty or nonsense. */
export function batteryValue(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 0 && n <= 100 ? n : null;
}

export function batteryInvalid(input: string): boolean {
  return input.trim() !== "" && batteryValue(input) === null;
}

export interface DraftCompleteness {
  device: boolean;
  seller: boolean;
  price: boolean;
  /** everything the log actions need, gate aside */
  all: boolean;
}

/**
 * What is still missing.
 *
 * The device needs a make and a model because the catalogue product is named
 * from them; the seller needs a name and a document number because the
 * second-hand register is the reason this screen exists. Everything else —
 * colour, storage, phone, photos — is worth having and not worth blocking on.
 */
export function completeness(draft: BuyDraft): DraftCompleteness {
  const device =
    draft.brand.trim() !== "" && draft.model.trim() !== "" && !batteryInvalid(draft.batteryPct);
  const seller = draft.sellerName.trim() !== "" && draft.sellerIdNumber.trim() !== "";
  const priceCents = parseMoneyInput(draft.buyPriceInput);
  const price =
    priceCents !== null &&
    priceCents > 0 &&
    (draft.payout !== "transfer" || draft.payoutReference.trim() !== "");
  return { device, seller, price, all: device && seller && price };
}

export function buyPriceCents(draft: BuyDraft): number | null {
  const cents = parseMoneyInput(draft.buyPriceInput);
  return cents !== null && cents > 0 ? cents : null;
}
