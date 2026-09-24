/**
 * Linking a till to a Codroon account — ADR-0020 §1.
 *
 * The owner pastes a code from pos.codroon.com; the till offers the ids it
 * generated at first run and gets back a device token scoped to this terminal.
 * The till's ids never change: a shop that has been selling for a year links
 * without renumbering a single document.
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
  writeLink({
    url,
    deviceToken: body.deviceToken,
    tenantId: ctx.tenantId,
    terminalId: ctx.terminalId,
    accountName: body.accountName,
    shopName: body.shopName,
    enrolledAtMs: Date.now(),
    /* From zero, deliberately: a newly linked till sends its whole history, so
       the dashboard opens with the shop's past in it rather than with whatever
       happened after Tuesday. The cloud deduplicates by opId. */
    lastAckedSeq: 0,
    lastPushAtMs: null,
    lastError: null,
  });

  /* send everything now, so the owner sees the dashboard fill immediately — a
     shop that has been selling for a year has more than one batch of history */
  void pushAll(db, { force: true }).catch(() => undefined);
  return syncStatus(db);
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
