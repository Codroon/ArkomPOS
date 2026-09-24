"use client";

/**
 * Creating an account.
 *
 * Note what is NOT asked for: no NIF, no registered address, no series prefix.
 * The till owns the shop's fiscal identity (ADR-0021 §2), because that is what
 * prints on a document and it has to be right with the router unplugged. This
 * form collects who Codroon has a relationship with, and a name to greet them by.
 */
import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type FormResult } from "../../src/auth/actions";
import { Card, Field, inputClass, primaryClass } from "../../src/ui";
import { Wordmark } from "../../src/ui/wordmark";

export default function SignupPage() {
  const [state, action, pending] = useActionState<FormResult, FormData>(signUpAction, {});

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-5 py-10">
      <div className="mb-6 flex items-baseline gap-2">
        <Wordmark className="h-[17px] w-auto text-ink" />
        <span className="text-[12px] font-semibold tracking-[0.14em] text-muted">POS</span>
      </div>

      <Card className="px-5 py-6">
        <h1 className="text-[18px] font-semibold">Crear cuenta</h1>
        <p className="mt-1 mb-5 text-[13px] text-muted">
          Para tiendas de telefonía. La caja funciona igual sin conexión.
        </p>

        {state.error ? (
          <p className="mb-4 rounded-[3px] border border-danger-ink/25 bg-danger-bg px-3 py-2 text-[13px] text-danger-ink">
            {state.error}
          </p>
        ) : null}
        {state.notice ? (
          <p className="mb-4 rounded-[3px] border border-success-ink/25 bg-success-bg px-3 py-2 text-[13px] text-success-ink">
            {state.notice}
          </p>
        ) : null}

        {state.notice ? null : (
          <form action={action} className="space-y-3.5">
            <Field label="Nombre de la tienda">
              <input className={inputClass} name="businessName" type="text" placeholder="Telefonía García" autoFocus />
            </Field>
            <Field label="Correo">
              <input className={inputClass} name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="Contraseña">
              <input
                className={inputClass}
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <button className={`${primaryClass} w-full`} type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear cuenta"}
            </button>
          </form>
        )}

        <p className="mt-5 text-[12px] text-muted">
          ¿Ya tienes cuenta?{" "}
          <Link className="text-ink-2 underline underline-offset-2" href="/login">
            Entrar
          </Link>
        </p>
      </Card>
    </main>
  );
}
