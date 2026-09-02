/**
 * The permission registry and the dictionary have to agree.
 *
 * `packages/core` owns the vocabulary (keys, modules, roles) and
 * `packages/ui` owns the words. Nothing in the type system connects them: the
 * label lookup falls back to the raw key so a missing translation degrades
 * instead of crashing, which is right at runtime and useless as a guarantee.
 *
 * This test is the guarantee. It failed to exist once already — the Usuarios
 * screen shipped with Spanish permission labels hardcoded, so switching to
 * English translated the chrome around a list that stayed in Spanish.
 *
 * It lives in the desktop suite because that is the only package that imports
 * both core and ui.
 */
import { describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_MODULES, ROLES } from "@arkom/core";
import { errorFor } from "@arkom/ui";
import { es } from "@arkom/ui/i18n/es";
import { en } from "@arkom/ui/i18n/en";

const dicts: [string, Record<string, string>][] = [
  ["es", es as unknown as Record<string, string>],
  ["en", en as unknown as Record<string, string>],
];

describe.each(dicts)("%s dictionary", (_locale, dict) => {
  it("has a label for every permission key", () => {
    const missing = PERMISSIONS.map((p) => `perm.${p.key}`).filter((k) => !dict[k]);
    expect(missing, `missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a label for every permission module", () => {
    const missing = PERMISSION_MODULES.map((m) => `permMod.${m}`).filter((k) => !dict[k]);
    expect(missing, `missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a label for every role", () => {
    const missing = ROLES.map((r) => `role.${r}`).filter((k) => !dict[k]);
    expect(missing, `missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("never leaves a label empty", () => {
    const keys = [
      ...PERMISSIONS.map((p) => `perm.${p.key}`),
      ...PERMISSION_MODULES.map((m) => `permMod.${m}`),
      ...ROLES.map((r) => `role.${r}`),
    ];
    const blank = keys.filter((k) => (dict[k] ?? "").trim().length === 0);
    expect(blank, `blank: ${blank.join(", ")}`).toEqual([]);
  });
});

describe("the two dictionaries differ where they should", () => {
  it("actually translates the roles", () => {
    // the bug this file exists for: keys present, values identical, nothing
    // visibly changing when the toggle is switched
    for (const role of ROLES) {
      const key = `role.${role}`;
      expect((es as Record<string, string>)[key], key).not.toBe((en as Record<string, string>)[key]);
    }
  });

  it("actually translates the module headings", () => {
    const same = PERMISSION_MODULES.map((m) => `permMod.${m}`).filter(
      (k) => (es as Record<string, string>)[k] === (en as Record<string, string>)[k],
    );
    // "Sale"/"Venta", "Catalog"/"Catálogo" — none of these are the same word
    expect(same, `identical in both locales: ${same.join(", ")}`).toEqual([]);
  });

  it("keeps the Spanish label in step with the registry's own labelEs", () => {
    // the registry carries labelEs so the file reads as documentation; if the
    // two drift, one of them is lying
    for (const p of PERMISSIONS) {
      expect((es as Record<string, string>)[`perm.${p.key}`], p.key).toBe(p.labelEs);
    }
  });
});

/**
 * An inline error outliving its input.
 *
 * "Add a technician" shipped a refusal that stayed under the field while the
 * shop typed a perfectly good name over the one it complained about — a fixed
 * problem still looking broken. Four dialogs had the same shape, all of them
 * relying on somebody remembering `setError(null)` in an `onChange`.
 *
 * The rule replaced that with something nobody has to remember: the message
 * carries the input it was about, and rendering compares.
 */
describe("an error is about the input that caused it", () => {
  const held = { message: "Ya existe un usuario con ese nombre.", key: "Nuria" };

  it("shows while the input still is what it was refused for", () => {
    expect(errorFor(held, "Nuria")).toBe(held.message);
  });

  it("disappears the moment the input changes", () => {
    expect(errorFor(held, "Nuria S")).toBeNull();
    expect(errorFor(held, "Nur")).toBeNull();
    expect(errorFor(held, "")).toBeNull();
  });

  it("comes back if the shop types its way to the same value again", () => {
    /* the refusal is still TRUE of that name — hiding it would be a different
       lie from the one this fixes */
    expect(errorFor(held, "Nuria")).toBe(held.message);
  });

  it("shows nothing when nothing has been refused", () => {
    expect(errorFor(null, "Nuria")).toBeNull();
    expect(errorFor(null, "")).toBeNull();
  });

  it("treats a multi-field key as one question", () => {
    // a dialog joins its fields: editing either makes a standing message stale
    const both = { message: "Importe no válido.", key: "12,00|Compra de agua" };
    expect(errorFor(both, "12,00|Compra de agua")).toBe(both.message);
    expect(errorFor(both, "13,00|Compra de agua")).toBeNull();
    expect(errorFor(both, "12,00|Compra de café")).toBeNull();
  });
});
