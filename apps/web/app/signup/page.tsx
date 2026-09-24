"use client";

/**
 * Creating an account.
 *
 * Three fields, and note what is NOT asked for: no NIF, no registered address,
 * no series prefix. The till owns the shop's fiscal identity (ADR-0021 §2),
 * because that is what prints on a document and it has to be right with the
 * router unplugged. What this form collects is who Codroon has a relationship
 * with, and a name to greet them by.
 */
import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type FormResult } from "../../src/auth/actions";

export default function SignupPage() {
  const [state, action, pending] = useActionState<FormResult, FormData>(signUpAction, {});

  return (
    <div className="wrap">
      <div className="brand">CODROON POS</div>
      <div className="card">
        <h1>Crear cuenta</h1>
        <p className="lede">Para tiendas de telefonía. La caja funciona igual sin conexión.</p>

        {state.error ? <div className="error">{state.error}</div> : null}
        {state.notice ? <div className="notice">{state.notice}</div> : null}

        {state.notice ? null : (
          <form action={action}>
            <label>
              <span className="label">Nombre de la tienda</span>
              <input name="businessName" type="text" placeholder="Telefonía García" autoFocus />
            </label>
            <label>
              <span className="label">Correo</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              <span className="label">Contraseña</span>
              <input name="password" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <button className="primary" type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear cuenta"}
            </button>
          </form>
        )}

        <p className="hint">
          ¿Ya tienes cuenta? <Link href="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
