/**
 * Supabase Auth clients — ADR-0021 §3.
 *
 * Passwords are Supabase's problem, deliberately and permanently: this codebase
 * never sees one, never stores one and has no opinion about hashing them. What
 * it keeps is the join between an identity and an account (`src/auth/account.ts`).
 *
 * Two clients, because a session lives in cookies and a cookie is read
 * differently on each side of the wire. The server one is created per request —
 * never hoisted into a module-level singleton, which would serve one visitor's
 * session to the next.
 */
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The publishable key, under either name.
 *
 * Supabase renamed "anon public" to "publishable" partway through 2025, and a
 * project created on either side of that shows a different label. Accepting
 * both saves a confusing afternoon; neither is a secret — it is compiled into
 * the browser bundle by design, and everything it can do is bounded by policy.
 */
export function publicEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local",
    );
  }
  return { url, key };
}

/** In the browser. */
export function supabaseBrowser() {
  const { url, key } = publicEnv();
  return createBrowserClient(url, key);
}

/** On the server, for THIS request. */
export async function supabaseServer() {
  const { url, key } = publicEnv();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* A Server Component cannot set cookies. That is fine: the middleware
             refreshes the session on every request, so the only thing lost here
             is a write that has already happened somewhere it was allowed. */
        }
      },
    },
  });
}

/**
 * The signed-in user, or null.
 *
 * `getUser()` rather than `getSession()`, always: getSession reads the cookie
 * and believes it, while getUser asks Supabase whether the token is real. On a
 * page that decides what somebody may see, believing a cookie is not a decision
 * anybody should be making.
 */
export async function currentUser(): Promise<{ id: string; email: string } | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    /* Unconfigured, or Supabase is having a bad afternoon. Either way the
       honest answer for a page that guards something is "nobody is signed in",
       which sends them to the login form — where the failure will be visible
       and say what it is. A 500 on every protected page says less and looks
       worse. */
    return null;
  }
}
