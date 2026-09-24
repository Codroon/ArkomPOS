"use server";

/**
 * Signing up, signing in, signing out.
 *
 * The rules about which account somebody lands in are in `account.ts` and are
 * tested without a database. What is here is the glue: talking to Supabase,
 * reading a form, and saying something a person can act on when it goes wrong.
 *
 * Error messages are Spanish, like the till's. They are also deliberately vague
 * about WHY a sign-in failed — "those details do not match" rather than "no
 * account with that address" — because the second one answers a question the
 * person asking may not be entitled to ask.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { attachAccount, normaliseEmail } from "./account";
import { supabaseServer } from "./supabase";
import { pgAccounts } from "../db/pg-accounts";

export interface FormResult {
  error?: string;
  notice?: string;
}

/** Where Supabase should send somebody back to after they confirm an email. */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const asText = (value: FormDataEntryValue | null): string => (typeof value === "string" ? value.trim() : "");

export async function signUpAction(_prev: FormResult, form: FormData): Promise<FormResult> {
  const email = normaliseEmail(asText(form.get("email")));
  const password = asText(form.get("password"));
  const businessName = asText(form.get("businessName"));

  if (!email || !password) return { error: "Escribe tu correo y una contraseña." };
  if (password.length < 8) return { error: "La contraseña necesita al menos 8 caracteres." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      /* carried through the confirmation email and read back in the callback:
         the name they typed has to survive a round trip through their inbox */
      data: { business_name: businessName },
      emailRedirectTo: `${await siteOrigin()}/auth/callback`,
    },
  });

  if (error) return { error: error.message };

  /* Deliberately the same answer whether or not that address already had an
     account: otherwise this form tells a stranger who our customers are. */
  return {
    notice:
      "Te hemos enviado un correo para confirmar la dirección. Ábrelo y sigue el enlace para entrar.",
  };
}

export async function signInAction(_prev: FormResult, form: FormData): Promise<FormResult> {
  const email = normaliseEmail(asText(form.get("email")));
  const password = asText(form.get("password"));
  if (!email || !password) return { error: "Escribe tu correo y tu contraseña." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user?.email) {
    return { error: "Esos datos no coinciden. Comprueba el correo y la contraseña." };
  }

  /* Idempotent, and here as well as in the callback because a confirmation
     link that was opened on a phone leaves an account to attach on the next
     sign-in from the till's browser. */
  const outcome = await attachAccount(pgAccounts(), {
    authUserId: data.user.id,
    email: data.user.email,
    name: String(data.user.user_metadata?.business_name ?? ""),
  });

  if (!outcome.ok) {
    await supabase.auth.signOut();
    return { error: "Esa cuenta ya pertenece a otra persona. Escríbenos y lo miramos." };
  }

  redirect("/panel");
}

export async function signOutAction(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
