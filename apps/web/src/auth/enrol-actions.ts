"use server";

/**
 * Issuing an enrolment code from the dashboard — the other half of ADR-0020 §1.
 *
 * Until now this existed only as `pnpm cloud:code`, which meant a shop wanting
 * to link a second till had to ask us for one. That is a fine arrangement with
 * one pilot customer and an absurd one with ten, and it put a WhatsApp message
 * in the middle of a page of instructions that otherwise reads on its own.
 *
 * Three things this must get right, and the script already did:
 *
 *  1. **The account comes from the SESSION, never from the caller.** A form
 *     field naming an account would let anyone with a login mint a code that
 *     attaches a till to somebody else's shop. `requireAccount()` is the only
 *     source.
 *  2. **The database holds a digest.** The code exists in the clear exactly
 *     once, in the response to this call. If it is lost, the answer is to
 *     issue another — not to look the old one up, which is impossible by
 *     construction.
 *  3. **It expires.** Seven days, the same as the script's, because a code
 *     that is valid forever is a password that nobody rotates.
 */
import { revalidatePath } from "next/cache";
import { uuidv7 } from "@arkom/core";
import { requireAccount } from "./session";
import { db } from "../db/client";
import { enrolCodes } from "../db/schema";
import { digest, newEnrolCode, ENROL_CODE_TTL_MS } from "../lib/secrets";

/**
 * A real discriminated union, tagged on `ok`.
 *
 * The first shape here used `code?: never` on the failure case and narrowed
 * with `"code" in result`, which TypeScript does not treat as a discriminant:
 * the property is declared on BOTH members, so `in` proves nothing and the
 * value stayed `string | undefined` at the call site. A tag costs one field
 * and narrows for free.
 */
export type IssueResult =
  | { ok: true; code: string; expiresOn: string; label: string }
  | { ok: false; error: string };

/** Labels are the shop's own note to itself — "the counter one", "upstairs". */
const LABEL_MAX = 40;

export async function issueEnrolCode(_prev: IssueResult | null, form: FormData): Promise<IssueResult> {
  const account = await requireAccount();

  const raw = form.get("label");
  const label = (typeof raw === "string" ? raw : "").trim().slice(0, LABEL_MAX);

  const code = newEnrolCode();
  const expiresAt = new Date(Date.now() + ENROL_CODE_TTL_MS);

  try {
    await db().insert(enrolCodes).values({
      id: uuidv7(),
      accountId: account.id,
      codeHash: digest(code),
      label,
      expiresAt,
    });
  } catch {
    /* the only realistic failure is the database being unreachable, and the
       code has not left this function, so nothing is half-done */
    return { ok: false, error: "issue.failed" };
  }

  /* the Tills list gains nothing yet — the code buys a till when the till uses
     it — but the page re-reads so a second code does not sit behind a stale
     render */
  revalidatePath("/panel/cajas");

  return { ok: true, code, expiresOn: expiresAt.toISOString().slice(0, 10), label };
}
