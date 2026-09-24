/** Create an account. Server Component for the copy; the form is a client one. */
import { getT } from "../../src/i18n/server";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const { t } = await getT();

  return (
    <SignupForm
      labels={{
        title: t("auth.signUp"),
        lede: t("auth.signUpLede"),
        shopName: t("auth.shopName"),
        shopNamePlaceholder: t("auth.shopNamePlaceholder"),
        email: t("auth.email"),
        password: t("auth.password"),
        submit: t("auth.signUp"),
        pending: t("auth.signingUp"),
        haveAccount: t("auth.haveAccount"),
        signIn: t("auth.signIn"),
      }}
    />
  );
}
