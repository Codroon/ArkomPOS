/**
 * Where a confirmation email lands.
 *
 * Supabase sends one of two shapes depending on how the project's email
 * template is written — a PKCE `code`, or a `token_hash` with a `type`. Both
 * are handled, because which one arrives is a setting in a dashboard rather
 * than anything this code controls, and a customer clicking a link in their
 * inbox is the worst possible moment to discover the difference.
 *
 * The account is attached HERE, on the first confirmed sign-in, because this is
 * the first moment the address is proven to belong to them — which is the whole
 * basis on which an existing account may be adopted (ADR-0021 §5).
 */
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { attachAccount } from "../../../src/auth/account";
import { supabaseServer } from "../../../src/auth/supabase";
import { pgAccounts } from "../../../src/db/pg-accounts";

const back = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path, request.url));

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  const supabase = await supabaseServer();

  const { data, error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { data: { user: null }, error: new Error("no credential in the link") };

  if (error || !data.user?.email) return back(request, "/login?error=link");

  const outcome = await attachAccount(pgAccounts(), {
    authUserId: data.user.id,
    email: data.user.email,
    name: String(data.user.user_metadata?.business_name ?? ""),
  });

  if (!outcome.ok) {
    await supabase.auth.signOut();
    return back(request, "/login?error=claimed");
  }

  return back(request, "/panel");
}
