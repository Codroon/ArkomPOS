"use client";

/**
 * Signing in. One field, another field, one blue button.
 *
 * The error text never distinguishes "no such address" from "wrong password":
 * a login form that confirms which addresses have accounts is a form that
 * enumerates our customers for anybody who asks it politely.
 */
import Link from "next/link";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signInAction, type FormResult } from "../../src/auth/actions";

const LINK_PROBLEMS: Record<string, string> = {
  link: "Ese enlace ya no vale. Vuelve a entrar con tu correo y tu contraseña.",
  claimed: "Esa cuenta ya pertenece a otra persona. Escríbenos y lo miramos.",
};

function LoginForm() {
  const [state, action, pending] = useActionState<FormResult, FormData>(signInAction, {});
  const fromLink = LINK_PROBLEMS[useSearchParams().get("error") ?? ""];

  return (
    <div className="wrap">
      <div className="brand">CODROON POS</div>
      <div className="card">
        <h1>Entrar</h1>
        <p className="lede">Para ver tus cajas desde cualquier sitio.</p>

        {state.error || fromLink ? <div className="error">{state.error ?? fromLink}</div> : null}

        <form action={action}>
          <label>
            <span className="label">Correo</span>
            <input name="email" type="email" autoComplete="email" required autoFocus />
          </label>
          <label>
            <span className="label">Contraseña</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="primary" type="submit" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="hint">
          ¿Todavía no tienes cuenta? <Link href="/signup">Crear una</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
