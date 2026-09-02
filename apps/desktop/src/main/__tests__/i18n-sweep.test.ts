/**
 * The guard that keeps Spanish out of the components.
 *
 * ADR-0011 says every renderer string lives in the dictionary, and until
 * v0.14.1 nothing enforced it: a hardcoded label works perfectly in the language
 * it was written in, so the only way to notice one is to flip the toggle and
 * read every screen. That is not a check anybody runs.
 *
 * The rule here is deliberately narrow, because a narrow rule is one people keep
 * rather than silence. Spanish prose almost always carries one of á é í ó ú ñ ¿ ¡
 * and code never does — CSS classes, channel names and identifiers are ASCII. So:
 * no Spanish letter may appear inside a string literal in a renderer source
 * file. Comments are exempt (they quote the mockup and the handoffs, which is
 * useful), and so is the dictionary itself.
 *
 * It will not catch an unaccented label — "Total", "Cancelar" — which is why it
 * is a guard and not a proof. It would have caught the two that shipped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ERROR_KEYS } from "../../renderer/src/lib/errors";
import { ErrorCodeSchema } from "@arkom/core";
import { es } from "@arkom/ui/i18n/es";
import { en } from "@arkom/ui/i18n/en";

const REPO = join(__dirname, "../../../../..");
const ROOTS = [join(REPO, "apps/desktop/src/renderer/src"), join(REPO, "packages/ui/src")];
const SKIP = new Set(["i18n", "node_modules", "__tests__"]);

const SPANISH_LETTER = /[áéíóúÁÉÍÓÚñÑ¿¡]/;
const LITERAL = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\\n]*)`/g;

/**
 * Known and accepted. Each entry is a promise that the string is not a label a
 * customer or a cashier reads — keep it short, and prefer a key over an entry.
 */
const ALLOWED: string[] = [];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP.has(name)) out.push(...sources(path));
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

/** Strip comments, so quoting the mockup in a docblock stays free. */
function code(src: string): string[] {
  const lines: string[] = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        lines.push("");
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    // JSX comments — {/* … */} — and ordinary block comments on one line
    line = line.replace(/\/\*[\s\S]*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      line = line.slice(0, open);
      inBlock = true;
    }
    const slash = line.indexOf("//");
    if (slash !== -1 && !/https?:$/.test(line.slice(0, slash))) line = line.slice(0, slash);
    lines.push(line);
  }
  return lines;
}

describe("no hardcoded Spanish in the renderer", () => {
  it("keeps every accented string in the dictionary", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sources(root)) {
        const rel = file.slice(REPO.length + 1).replace(/\\/g, "/");
        code(readFileSync(file, "utf8")).forEach((line, i) => {
          for (const m of line.matchAll(LITERAL)) {
            const text = m[1] ?? m[2] ?? m[3] ?? "";
            if (SPANISH_LETTER.test(text) && !ALLOWED.includes(text)) {
              offenders.push(`${rel}:${i + 1}  ${text}`);
            }
          }
        });
      }
    }
    expect(offenders, `route these through useT():\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("typed errors reach the reader in their own language", () => {
  it("decides about every code in the union", () => {
    /* the Record type already makes this a compile error; the runtime check is
       here because a code could be added to the schema and the type imported
       from a stale build */
    const missing = ErrorCodeSchema.options.filter((c) => !(c in ERROR_KEYS));
    expect(missing).toEqual([]);
  });

  it("names a key that both dictionaries actually have", () => {
    const dicts: [string, Record<string, string>][] = [
      ["es", es as unknown as Record<string, string>],
      ["en", en as unknown as Record<string, string>],
    ];
    for (const [locale, dict] of dicts) {
      const missing = Object.values(ERROR_KEYS).filter((k) => k !== null && !dict[k]);
      expect(missing, `${locale} is missing: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("passes VALIDATION detail through, and nothing else", () => {
    /* the one deliberate seam (ADR-0011): a validation message names a field and
       a value, and there are ~130 of them written in the domain layer */
    const passthrough = Object.entries(ERROR_KEYS)
      .filter(([, key]) => key === null)
      .map(([code]) => code);
    expect(passthrough).toEqual(["VALIDATION"]);
  });
});
