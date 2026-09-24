/**
 * "Who is asking, and what may they see?" — in one call.
 *
 * Every panel page starts with this. It returns the ACCOUNT rather than the
 * user, because an account id is what every query in this app is scoped by, and
 * a page that had to look one up itself is a page that could forget to.
 */
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

/** Redirects instead of returning null: a caller cannot forget to check. */
export async function requireAccount(): Promise<PanelAccount> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const account = await accountForUser(user.id);
  /* Signed in but attached to no account — a signup that fell over between the
     identity and the account. Going back through sign-in runs the attachment
     again, which is idempotent and usually fixes it. */
  if (!account) redirect("/login?error=link");

  return account;
}
