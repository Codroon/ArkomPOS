/**
 * Linking a till to a Codroon account — ADR-0020 §1, ADR-0022 §9.
 *
 * The owner pastes a code; the till offers the ids it generated at first run
 * and gets back a device token scoped to this terminal.
 *
 * Since ADR-0022 the RESPONSE decides the keys. A shop's FIRST till keeps the
 * ids it minted and nothing below changes for it — a shop that has been selling
 * for a year links without renumbering a single document. A SECOND till is
 * handed the shop's existing tenant and location and adopts them, which is the
 * one thing that was missing when Arkom's two tills each founded a business.
 */
import { app } from "electron";
import {
  appError,
  EnrolCodeSchema,
  SyncEnrolResponseSchema,
  type MutationCtx,
} from "@arkom/core";
import type { ArkomDb } from "@arkom/db";
import { tillContext } from "../context";
import { getSettings } from "../repos/settings";
import { clearLink, readLink, writeLink } from "./link";
import { pushAll, syncStatus, type SyncStatus } from "./push";
import { adopt, describeHistory } from "./adopt";
import { pullAll } from "./receive";

const TIMEOUT_MS = 20_000;

/** Strip a trailing slash so `new URL("/api/...", base)` behaves. */
const normalise = (url: string): string => url.trim().replace(/\/+$/, "");

export async function enrol(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { url: string; code: string },
): Promise<SyncStatus> {
  const code = EnrolCodeSchema.parse(input.code);
  const url = normalise(input.url);
  if (!/^https?:\/\//i.test(url)) throw appError("VALIDATION", "La dirección de la nube no es válida.", "url");

  const { meta } = tillContext(db);
  const settings = getSettings(db, ctx);

  const controller = new AbortController();
  const cancel = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(new URL("/api/enrol", url).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        terminalName: meta.terminal.name,
        shopName: settings.shopDisplayName?.trim() || settings.shopLegalName,
        appVersion: app.getVersion(),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    /* The most common failure by far is a shop with no line, and the message
       has to say that rather than something about fetch. */
    throw appError(
      "VALIDATION",
      `No se pudo contactar con la nube: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(cancel);
  }

  if (response.status === 404 || response.status === 410) {
    throw appError("VALIDATION", "Ese código ya se ha usado o no existe.", "code");
  }
  if (!response.ok) {
    throw appError("VALIDATION", `La nube respondió ${response.status}.`);
  }

  const body = SyncEnrolResponseSchema.parse(await response.json());

  /*
   * Did we join a shop, or found one? The cloud's answer decides, not the ids
   * this till offered (ADR-0022 §9).
   */
  const joining = body.adopted || body.tenantId !== ctx.tenantId;
  let parkedAtSeq = 0;

  if (joining) {
    const moved = adopt(
      db,
      { tenantId: ctx.tenantId, locationId: ctx.locationId },
      { tenantId: body.tenantId, locationId: body.locationId, shopName: body.shopName },
    );
    parkedAtSeq = moved.parkedAtSeq;
    console.info(
      `[sync] joined shop ${moved.toTenantId}: discarded ${moved.discarded} rows of its own, ` +
        `parked the oplog at seq ${moved.parkedAtSeq}`,
    );
  }

  writeLink({
    url,
    deviceToken: body.deviceToken,
    tenantId: body.tenantId,
    locationId: body.locationId,
    terminalId: ctx.terminalId,
    accountName: body.accountName,
    shopName: body.shopName,
    tillCount: body.tillCount,
    enrolledAtMs: Date.now(),
    /*
     * A FOUNDING till starts at zero, deliberately: it sends its whole history,
     * so the dashboard opens with the shop's past in it rather than with
     * whatever happened after Tuesday. The cloud deduplicates by opId.
     *
     * A JOINING till starts PAST its own pre-join entries. Those entries are
     * true and stay in the oplog — this machine really was set up as its own
     * shop — but pushing them would hand the cloud six phantom product groups
     * and a business that never traded (ADR-0022 §9).
     */
    lastAckedSeq: parkedAtSeq,
    lastPushAtMs: null,
    lastError: null,
    /* from the start of the shop's stream: this till needs the catalogue and
       the ledger it has never seen */
    lastPulledIngestSeq: 0,
    lastPullAtMs: null,
    lastPullError: null,
  });

  /*
   * Neither of these is awaited. ADR-0001's rule holds through enrolment: the
   * owner gets the Ajustes card back now, and the data moves behind it.
   *
   * A joining till pulls FIRST — it has nothing to sell with until the shop's
   * catalogue arrives, and it has nothing to send.
   */
  settling = joining
    ? pullAll(db, { force: true })
        .then(() => pushAll(db, { force: true }))
        .then(() => undefined)
        .catch(() => undefined)
    : pushAll(db, { force: true })
        .then(() => pullAll(db, { force: true }))
        .then(() => undefined)
        .catch(() => undefined);

  return syncStatus(db);
}

/**
 * The first exchange after enrolling, as a promise nobody has to await.
 *
 * Production does not: ADR-0001's rule holds through enrolment, so the owner
 * gets the Ajustes card back while the data moves behind it. Tests do, because
 * two tills in one process share the module state that `readLink()` and the
 * till context cache live in — an unawaited push from till 2 can otherwise run
 * after a test has switched to till 1 and send till 2's rows under till 1's
 * token. That is a test artifact rather than a product bug (a real till is one
 * process with one link file), and a seam is cheaper than pretending the race
 * is not there.
 */
let settling: Promise<void> = Promise.resolve();
export const enrolSettled = (): Promise<void> => settling;

/**
 * Can this till join a shop at all?
 *
 * Exposed so Ajustes can say so BEFORE the owner pastes a code: discovering
 * that a till has too much history should not cost a code, and "this till has
 * sold things, so it cannot join another shop" is a sentence the screen can say
 * in advance (ADR-0022 §9).
 */
export function joinability(db: ArkomDb): { canJoin: boolean; history: string[] } {
  const found = describeHistory(db);
  return { canJoin: !found.has, history: found.where };
}

/**
 * Unlink. The token goes, the shop's data stays exactly where it was — on the
 * till, which is the copy that matters.
 */
export function unlink(db: ArkomDb): SyncStatus {
  clearLink();
  return syncStatus(db);
}

export { readLink };
