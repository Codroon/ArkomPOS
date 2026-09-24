/**
 * `POST /api/enrol` — claiming a till for an account. ADR-0020 §1.
 *
 * This is the only endpoint a till may call without a credential, so it is the
 * only place where the answer's *wording* matters: unknown code, spent code and
 * expired code all produce the same 404, because distinguishing them tells a
 * caller something about codes they do not hold. Sixty bits, single use and a
 * seven-day life do the rest.
 *
 * What comes back is a device token. It is generated here, shown once, and
 * stored as a digest — see `lib/secrets.ts`.
 */
import { SyncEnrolRequestSchema } from "@arkom/core";
import type { CloudStore } from "./store";
import type { HttpResult } from "./ingest";

export async function enrol(
  store: CloudStore,
  body: unknown,
  now: Date = new Date(),
): Promise<HttpResult> {
  const parsed = SyncEnrolRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "BAD_REQUEST",
        issues: parsed.error.issues.slice(0, 8).map((i) => ({ path: i.path.join("."), code: i.code })),
      },
    };
  }

  const outcome = await store.enrol({ ...parsed.data, now });

  if (!outcome.ok) {
    /* 409, not 404: this is not a bad code, it is a good code pointed at a shop
       that already belongs to somebody else. Silently moving the shop would
       hand one account another account's customers. */
    if (outcome.reason === "tenant") {
      return { status: 409, body: { error: "TENANT_CLAIMED" } };
    }
    return { status: 404, body: { error: "CODE_INVALID" } };
  }

  return {
    status: 200,
    body: {
      deviceToken: outcome.deviceToken,
      accountName: outcome.accountName,
      shopName: outcome.shopName,
    },
  };
}
