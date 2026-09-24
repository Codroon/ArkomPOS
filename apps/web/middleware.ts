/**
 * Keeps a signed-in session alive across requests.
 *
 * Supabase tokens are short-lived and refresh through cookies, which a Server
 * Component is not allowed to set. So the refresh happens here, where it is,
 * and every page below gets a session that is already current.
 *
 * Two things this must NOT do:
 *
 *  1. **Touch `/api/*`.** Those are the till's doors. A shop pushing its day's
 *     takings authenticates with a device token and has no cookies, no session
 *     and no business being redirected to a login page.
 *  2. **Fail closed when auth is unconfigured.** A deployment with no Supabase
 *     keys still has to ingest: before this slice existed, `/api/sync` worked,
 *     and adding a login page must not be able to take it away.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  /* getUser, not getSession: this is what actually refreshes an expiring token,
     and it asks Supabase rather than believing a cookie. */
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /* everything except the till's API, Next's own assets, and files with an
       extension — which is to say: pages a person looks at */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.[^/]*$).*)",
  ],
};
