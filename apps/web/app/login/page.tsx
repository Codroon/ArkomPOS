/**
 * Sign in. A Server Component, so the copy comes from the language cookie; the
 * form below it is a client component because useActionState needs one.
 */
import { getT } from "../../src/i18n/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { t } = await getT();

  return (
    <LoginForm
      labels={{
        title: t("auth.signIn"),
        lede: t("auth.signInLede"),
        email: t("auth.email"),
        password: t("auth.password"),
        submit: t("auth.signIn"),
        pending: t("auth.signingIn"),
        noAccount: t("auth.noAccount"),
        createOne: t("auth.createOne"),
        problems: { link: t("auth.err.link"), claimed: t("auth.err.claimed") },
      }}
    />
  );
}
