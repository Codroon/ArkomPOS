/**
 * pos.codroon.com — a holding page until the landing page is built. The ingest
 * door underneath it is not a placeholder: a till that has been given a code
 * can link to this deployment today.
 */
import Link from "next/link";
import { BRAND } from "../src/brand";
import { BrandLockup } from "../src/ui/brand-mark";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[520px] flex-col justify-center px-5 text-center">
      <h1><BrandLockup className="justify-center" /></h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        El TPV para tiendas de telefonía. Vende sin conexión, y mira la tienda desde
        donde estés.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          href="/signup"
          className="inline-flex items-center rounded-[3px] bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink"
        >
          Crear cuenta
        </Link>
        <Link href="/login" className="text-[13px] text-muted underline underline-offset-2">
          Entrar
        </Link>
      </div>
      {/* the one line that stays whoever's name is on the door */}
      <p className="mt-10 text-[11px] text-subtle">{BRAND.copyright}</p>
    </main>
  );
}
