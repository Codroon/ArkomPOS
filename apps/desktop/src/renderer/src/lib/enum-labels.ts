/**
 * Domain enum → dictionary key, in one place.
 *
 * A stored enum is a token, not a word: `PASAPORTE` and `in_person` are how the
 * database says a thing, and neither is something to put in front of a person.
 * Every screen that forgot this rendered the token — the ID-type dropdown showed
 * DNI / NIE / PASAPORTE on an English till, directly above a channel dropdown
 * that got it right, because the two were written on different days.
 *
 * The values themselves never change: they are schema enums, they are what the
 * printed document carries (fixed Spanish, ADR-0011), and a label is a display
 * concern that stops at the edge.
 *
 * DNI and NIE stay DNI and NIE in English. They are the names of Spanish
 * documents, not descriptions of them — translating them would invent a
 * document that does not exist.
 */
import type { AcquisitionChannel, IdDocType, RepairNotifyMethod } from "@arkom/core";
import type { TFn, TKey } from "@arkom/ui";

const ID_DOC: Record<IdDocType, TKey> = {
  DNI: "idDoc.DNI",
  NIE: "idDoc.NIE",
  PASAPORTE: "idDoc.PASAPORTE",
};

const NOTIFY: Record<RepairNotifyMethod, TKey> = {
  phone: "rep.notify.phone",
  in_person: "rep.notify.inPerson",
  other: "rep.notify.other",
};

const CHANNEL: Record<AcquisitionChannel, TKey> = {
  private_individual: "used.seller.channelPrivate",
  business: "used.seller.channelBusiness",
};

/** Falls back to the raw token: a value added to the enum should read oddly, not vanish. */
const labeller =
  <T extends string>(map: Record<T, TKey>) =>
  (t: TFn, value: T | string): string =>
    (map as Record<string, TKey | undefined>)[value] ? t(map[value as T]) : value;

export const idDocLabel = labeller(ID_DOC);
export const notifyMethodLabel = labeller(NOTIFY);
export const channelLabel = labeller(CHANNEL);

export const ID_DOC_ORDER: IdDocType[] = ["DNI", "NIE", "PASAPORTE"];
