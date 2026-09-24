/**
 * "Who is asking, and what may they see?" — once per request.
 *
 * Every panel page starts with this, and so does the layout that wraps it. That
 * used to mean four network round trips per navigation: the layout asked
 * Supabase who the user was and looked their account up, then the page did it
 * again. At ~285ms each from a laptop to Frankfurt, that was over a second of
 * every click spent re-learning something already known.
 *
 * `cache()` dedupes within a single render pass, so the layout and the page now
 * share one answer. It is per-REQUEST, not a cache across requests: a signed-out
 * user is never served a signed-in one's account.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "./supabase";
import { accountForUser } from "../db/pg-accounts";

export interface PanelAccount {
  id: string;
  name: string;
  email: string;
  licenceState: string;
  role: string;
}

type Resolution =
  | { state: "anonymous" }
  /** signed in, but attached to no account — a signup that fell over halfway */
  | { state: "unattached" }
  | { state: "ok"; account: PanelAccount };

const resolve = cache(async (): Promise<Resolution> => {
  const user = await currentUser();
  if (!user) return { state: "anonymous" };

  const account = await accountForUser(user.id);
  if (!account) return { state: "unattached" };

  return { state: "ok", account };
});

/**
 * Redirects rather than returning null, so a caller cannot forget to check.
 *
 * The unattached case goes back through sign-in because attaching an account is
 * idempotent and usually fixes itself on the second attempt.
 */
export async function requireAccount(): Promise<PanelAccount> {
  const resolved = await resolve();
  if (resolved.state === "anonymous") redirect("/login");
  if (resolved.state === "unattached") redirect("/login?error=link");
  return resolved.account;
}
