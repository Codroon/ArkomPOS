"use client";

/**
 * The sign-in form.
 *
 * A client component because `useActionState` needs one, so it cannot read the
 * language cookie — the server page above hands it the words. That is the whole
 * reason this is split: the bundle carries the copy this person is reading
 * rather than both dictionaries, and nothing on screen is stuck in one language.
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

export interface LoginLabels {
  title: string;
  lede: string;
  email: string;
  password: string;
  submit: string;
  pending: string;
  noAccount: string;
  createOne: string;
  /** keyed by the `?error=` the callback may have sent them back with */
  problems: Record<string, string>;
}

function Form({ labels }: { labels: LoginLabels }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(signInAction, {});
  const fromLink = labels.problems[useSearchParams().get("error") ?? ""];
  const problem = state.error ?? fromLink;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-5 py-10">
      <BrandLockup className="mb-6" />

      <Card className="px-5 py-6">
        <h1 className="text-[18px] font-semibold">{labels.title}</h1>
        <p className="mt-1 mb-5 text-[13px] text-muted">{labels.lede}</p>

        {problem ? (
          <p className="mb-4 rounded-[3px] border border-danger-ink/25 bg-danger-bg px-3 py-2 text-[13px] text-danger-ink">
            {problem}
          </p>
        ) : null}

        <form action={action} className="space-y-3.5">
          <Field label={labels.email}>
            <input className={inputClass} name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Field label={labels.password}>
            <input
              className={inputClass}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {/* the one accent element on the screen */}
          <button className={`${primaryClass} w-full`} type="submit" disabled={pending}>
            {pending ? labels.pending : labels.submit}
          </button>
        </form>

        <p className="mt-5 text-[12px] text-muted">
          {labels.noAccount}{" "}
          <Link className="text-ink-2 underline underline-offset-2" href="/signup">
            {labels.createOne}
          </Link>
        </p>
      </Card>
    </main>
  );
}

export function LoginForm({ labels }: { labels: LoginLabels }) {
  return (
    <Suspense>
      <Form labels={labels} />
    </Suspense>
  );
}
