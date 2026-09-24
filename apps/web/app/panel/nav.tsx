"use client";

/**
 * Where the panel can go. A client component only because it needs to know
 * which link is the current one.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/panel", label: "Resumen" },
  { href: "/panel/catalogo", label: "Catálogo" },
  { href: "/panel/documentos", label: "Documentos" },
];

export function PanelNav() {
  const path = usePathname();

  return (
    <nav style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--line)" }}>
      {TABS.map((tab) => {
        const active = tab.href === "/panel" ? path === "/panel" : path.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: "7px 12px",
              fontSize: 13,
              textDecoration: "none",
              color: active ? "var(--ink)" : "var(--muted)",
              fontWeight: active ? 600 : 400,
              borderBottom: active ? "2px solid var(--ink)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
