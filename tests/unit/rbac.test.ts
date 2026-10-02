import { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  MONEY_PERMISSIONS,
  PERMISSIONS,
  isPermissionKey,
} from "@/modules/rbac/permissions";
import { resolvePermissions } from "@/modules/rbac/resolve";

describe("permission catalogue", () => {
  it("has unique keys", () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(PERMISSIONS.length);
  });

  it("defines defaults for every built-in role using known keys", () => {
    for (const role of Object.values(SystemRole)) {
      expect(DEFAULT_ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
      expect(DEFAULT_ROLE_PERMISSIONS[role].every(isPermissionKey)).toBe(true);
    }
  });

  it("reserves Force Override and role management for Super Admin by default", () => {
    for (const role of [
      "PRODUCTION_MANAGER",
      "SALES_EXECUTIVE",
      "WAREHOUSE_TEAM",
      "EMPLOYEE",
      "ACCOUNTS",
    ] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain("sales.force_override");
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain("company.roles.manage");
    }
  });

  it("lets only Super Admin and Accounts record money in or out by default", () => {
    for (const role of Object.values(SystemRole)) {
      const holdsMoney = MONEY_PERMISSIONS.every((p) => DEFAULT_ROLE_PERMISSIONS[role].includes(p));
      const holdsAny = MONEY_PERMISSIONS.some((p) => DEFAULT_ROLE_PERMISSIONS[role].includes(p));
      expect(holdsAny).toBe(role === "SUPER_ADMIN" || role === "ACCOUNTS");
      expect(holdsMoney).toBe(holdsAny);
    }
  });

  it("splits production work: managers run projects, the warehouse receives, Accounts writes off", () => {
    const can = (role: SystemRole, key: string) =>
      (DEFAULT_ROLE_PERMISSIONS[role] as readonly string[]).includes(key);
    expect(can("PRODUCTION_MANAGER", "production.manage")).toBe(true);
    expect(can("PRODUCTION_MANAGER", "production.stock_intake")).toBe(true);
    // The warehouse sees projects and receives deliveries, but not their costs.
    expect(can("WAREHOUSE_TEAM", "production.view")).toBe(true);
    expect(can("WAREHOUSE_TEAM", "production.stock_intake")).toBe(true);
    expect(can("WAREHOUSE_TEAM", "production.manage")).toBe(false);
    expect(can("WAREHOUSE_TEAM", "accounts.view")).toBe(false);
    // Only Super Admin and Accounts can write cost off as a loss.
    for (const role of Object.values(SystemRole)) {
      expect(can(role, "accounts.manage")).toBe(role === "SUPER_ADMIN" || role === "ACCOUNTS");
    }
  });
});

describe("resolvePermissions", () => {
  it("gives Super Admin and the platform owner everything", () => {
    const all = ALL_PERMISSION_KEYS.length;
    expect(
      resolvePermissions({
        isPlatformSuperAdmin: false,
        systemRole: "SUPER_ADMIN",
        grantedKeys: [],
      }).size,
    ).toBe(all);
    expect(
      resolvePermissions({ isPlatformSuperAdmin: true, systemRole: null, grantedKeys: [] }).size,
    ).toBe(all);
  });

  it("gives other roles only their grants and ignores unknown keys", () => {
    const perms = resolvePermissions({
      isPlatformSuperAdmin: false,
      systemRole: "EMPLOYEE",
      grantedKeys: ["portal.self", "legacy.removed"],
    });
    expect([...perms]).toEqual(["portal.self"]);
  });
});
