"use client";

/**
 * Signing in.
 *
 * The error text never distinguishes "no such address" from "wrong password": a
 * login form that confirms which addresses have accounts enumerates our
 * customers for anybody who asks it politely.
 */
import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInAction, type FormResult } from "../../src/auth/actions";
import { Card, Field, inputClass, primaryClass } from "../../src/ui";
import { BrandLockup } from "../../src/ui/brand-mark";

const LINK_PROBLEMS: Record<string, string> = {
  link: "Ese enlace ya no vale. Vuelve a entrar con tu correo y tu contraseña.",
  claimed: "Esa cuenta ya pertenece a otra persona. Escríbenos y lo miramos.",
};

function LoginForm() {
  const [state, action, pending] = useActionState<FormResult, FormData>(signInAction, {});
  const fromLink = LINK_PROBLEMS[useSearchParams().get("error") ?? ""];
  const problem = state.error ?? fromLink;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-5 py-10">
      <BrandLockup className="mb-6" />

      <Card className="px-5 py-6">
        <h1 className="text-[18px] font-semibold">Entrar</h1>
        <p className="mt-1 mb-5 text-[13px] text-muted">
          Para ver tus cajas desde cualquier sitio.
        </p>

        {problem ? (
          <p className="mb-4 rounded-[3px] border border-danger-ink/25 bg-danger-bg px-3 py-2 text-[13px] text-danger-ink">
            {problem}
          </p>
        ) : null}

        <form action={action} className="space-y-3.5">
          <Field label="Correo">
            <input className={inputClass} name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Field label="Contraseña">
            <input
              className={inputClass}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {/* the one blue element on the screen */}
          <button className={`${primaryClass} w-full`} type="submit" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-5 text-[12px] text-muted">
          ¿Todavía no tienes cuenta?{" "}
          <Link className="text-ink-2 underline underline-offset-2" href="/signup">
            Crear una
          </Link>
        </p>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
