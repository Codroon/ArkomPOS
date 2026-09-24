import "./globals.css";
import { Archivo_Black, IBM_Plex_Sans } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getT } from "../src/i18n/server";
import { BRAND } from "../src/brand";

/* The till's own faces, so the two halves of the product are set in the same
   type. The till packages the woff2 files for Electron; the web fetches the
   same families at build time and serves them itself. */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

const display = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-archivo",
  display: "swap",
});

/* the tab title and the description follow the staff language too */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: BRAND.productName, description: t("meta.description") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getT();
  return (
    <html lang={locale} className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
