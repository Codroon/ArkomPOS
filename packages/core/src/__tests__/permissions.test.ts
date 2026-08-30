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

  it("marks exactly the approvable actions", () => {
    // a pin, not a tautology: making a new key approvable means a cashier can
    // perform it with someone else's PIN, which is a decision, not a detail
    const approvable = PERMISSIONS.filter((p) => p.approvable).map((p) => p.key);
    expect(approvable.sort()).toEqual(
      [
        "catalog.create",
        "catalog.edit",
        "inventory.adjust",
        "repair.markNotRepaired",
        "repair.price_override",
        "sale.price_override",
        "usedDevices.priceOverride",
      ].sort(),
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

describe("the used-devices module", () => {
  /* Pinned because these seven decide who may hand shop money to a stranger
     and who may read a seller's ID. A change here is a policy change, and it
     should have to be made deliberately in two places. */
  it("registers exactly the seven keys the slice defined", () => {
    const keys = PERMISSIONS.filter((p) => p.module === "usedDevices").map((p) => p.key);
    expect(keys.sort()).toEqual(
      [
        "usedDevices.create",
        "usedDevices.priceOverride",
        "usedDevices.sendToInventory",
        "usedDevices.editRefurbCost",
        "usedDevices.viewSeller",
        "usedDevices.redeemCredit",
        "usedDevices.voidCredit",
      ].sort(),
    );
  });

  it("gives a cashier the counter work and nothing else", () => {
    // buying and shelving are counter work the client asked to keep at the till;
    // reading the seller and voiding money the shop owes are not
    for (const key of [
      "usedDevices.create",
      "usedDevices.sendToInventory",
      "usedDevices.editRefurbCost",
      "usedDevices.redeemCredit",
    ] as PermissionKey[]) {
      expect(can(cashier, key), key).toBe(true);
    }
    for (const key of ["usedDevices.viewSeller", "usedDevices.voidCredit"] as PermissionKey[]) {
      expect(can(cashier, key), key).toBe(false);
    }
  });

  it("lets an owner grant viewSeller to one cashier without inventing a role", () => {
    const trusted = { role: "cashier", overrides: { "usedDevices.viewSeller": true } };
    expect(can(trusted, "usedDevices.viewSeller")).toBe(true);
    expect(can(trusted, "usedDevices.voidCredit")).toBe(false);
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
    expect(isRole("manager")).toBe(false); // sketched nowhere; must fail closed
  });

  /**
   * The technician, added by the repairs slice (ADR-0014).
   *
   * What they are NOT allowed is the interesting half: they do not sell, they do
   * not receive stock, and they do not close a ticket as unrepairable — the last
   * two for the reason ADR-0012 gave itself about who may make stock and money
   * disappear.
   */
  it("gives a technician the workshop and not the till", () => {
    const tech = { role: "technician" };
    for (const key of ["repair.view", "repair.quote.set", "repair.parts.manage", "repair.markReady", "workshop.view"] as const) {
      expect(can(tech, key), key).toBe(true);
    }
    for (const key of ["sale.create", "repair.parts.receive", "repair.markNotRepaired", "repair.price_override", "users.manage"] as const) {
      expect(can(tech, key), key).toBe(false);
    }
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
    const ghost = { role: "manager" };
    for (const p of PERMISSIONS) expect(can(ghost, p.key), p.key).toBe(false);
  });

  it("accepts ctx today and ignores it", () => {
    // Rule 3 in ADR-0012: the parameter ships unused so resource rules can land
    // inside can() later without touching call sites
    expect(can(cashier, "sale.create", { assignedUserId: "someone-else" })).toBe(true);
    expect(can(cashier, "catalog.edit", { assignedUserId: "anyone" })).toBe(false);
  });
});
