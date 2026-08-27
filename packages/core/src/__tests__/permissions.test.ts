import { describe, expect, it } from "vitest";
import {
  CASHIER_DEFAULTS,
  PERMISSIONS,
  PERMISSION_MODULES,
  ROLES,
  can,
  effectiveOverrides,
  isApprovable,
  isRole,
  isRoleDefault,
  permissionLabelEs,
  resolvePermissions,
  type PermissionKey,
} from "../permissions";

const owner = { role: "owner" };
const cashier = { role: "cashier" };

describe("registry shape", () => {
  it("has unique keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts every permission in a known module", () => {
    for (const p of PERMISSIONS) {
      expect(PERMISSION_MODULES, p.key).toContain(p.module);
    }
  });

  it("gives every permission a Spanish label", () => {
    for (const p of PERMISSIONS) {
      expect(p.labelEs.length, p.key).toBeGreaterThan(3);
      expect(permissionLabelEs(p.key)).toBe(p.labelEs);
    }
  });

  it("marks exactly the four approvable actions", () => {
    const approvable = PERMISSIONS.filter((p) => p.approvable).map((p) => p.key);
    expect(approvable.sort()).toEqual(
      ["catalog.create", "catalog.edit", "inventory.adjust", "sale.price_override"].sort(),
    );
  });

  it("never makes an admin permission approvable", () => {
    // a cashier must not be able to manage users with an owner PIN typed over
    // their shoulder — the owner signs in themselves
    for (const p of PERMISSIONS.filter((x) => x.module === "admin")) {
      expect(p.approvable, p.key).toBe(false);
    }
  });
});

describe("role defaults", () => {
  it("gives the owner everything", () => {
    for (const p of PERMISSIONS) expect(can(owner, p.key), p.key).toBe(true);
    expect(resolvePermissions(owner)).toHaveLength(PERMISSIONS.length);
  });

  it("gives the cashier exactly the documented set", () => {
    expect(resolvePermissions(cashier).sort()).toEqual([...CASHIER_DEFAULTS].sort());
  });

  it("keeps admin keys away from cashiers", () => {
    for (const key of ["users.manage", "settings.edit", "backup.manage"] as PermissionKey[]) {
      expect(can(cashier, key), key).toBe(false);
    }
  });

  it("keeps approvable keys off the cashier's defaults — that is the point", () => {
    for (const p of PERMISSIONS.filter((x) => x.approvable)) {
      expect(can(cashier, p.key), p.key).toBe(false);
      expect(isApprovable(p.key)).toBe(true);
    }
  });

  it("recognises its own roles", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    expect(isRole("technician")).toBe(false); // sketched in the ADR, not registered yet
  });
});

describe("overrides", () => {
  it("grants a permission the role does not have", () => {
    const trusted = { role: "cashier", overrides: { "catalog.edit": true } };
    expect(can(trusted, "catalog.edit")).toBe(true);
    expect(resolvePermissions(trusted)).toContain("catalog.edit");
  });

  it("revokes a permission the role does have", () => {
    const limited = { role: "cashier", overrides: { "inventory.receive": false } };
    expect(can(limited, "inventory.receive")).toBe(false);
    expect(resolvePermissions(limited)).not.toContain("inventory.receive");
  });

  it("ignores overrides for keys it does not name", () => {
    const one = { role: "cashier", overrides: { "catalog.edit": true } };
    expect(can(one, "sale.create")).toBe(true); // still a default
    expect(can(one, "catalog.create")).toBe(false); // still denied
  });

  it("CANNOT reduce the owner", () => {
    const sabotaged = {
      role: "owner",
      overrides: Object.fromEntries(PERMISSIONS.map((p) => [p.key, false])),
    };
    for (const p of PERMISSIONS) expect(can(sabotaged, p.key), p.key).toBe(true);
    expect(resolvePermissions(sabotaged)).toHaveLength(PERMISSIONS.length);
  });

  it("reports which overrides are set, for the Usuarios chips", () => {
    const mixed = { role: "cashier", overrides: { "catalog.edit": true, "sale.park": false } };
    expect(effectiveOverrides(mixed)).toEqual({ "catalog.edit": true, "sale.park": false });
  });

  it("knows what the role default was", () => {
    expect(isRoleDefault("cashier", "sale.create")).toBe(true);
    expect(isRoleDefault("cashier", "catalog.edit")).toBe(false);
    expect(isRoleDefault("owner", "users.manage")).toBe(true);
  });
});

describe("edge cases", () => {
  it("denies everything to nobody", () => {
    for (const p of PERMISSIONS) expect(can(null, p.key), p.key).toBe(false);
  });

  it("denies everything to an unknown role with no overrides", () => {
    // a role removed from the registry must fail closed, not open
    const ghost = { role: "technician" };
    for (const p of PERMISSIONS) expect(can(ghost, p.key), p.key).toBe(false);
  });

  it("accepts ctx today and ignores it", () => {
    // Rule 3 in ADR-0012: the parameter ships unused so resource rules can land
    // inside can() later without touching call sites
    expect(can(cashier, "sale.create", { assignedUserId: "someone-else" })).toBe(true);
    expect(can(cashier, "catalog.edit", { assignedUserId: "anyone" })).toBe(false);
  });
});
