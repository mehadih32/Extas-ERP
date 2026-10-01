import { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  isPermissionKey,
} from "@/modules/rbac/permissions";
import { resolvePermissions } from "@/modules/rbac/resolve";

describe("permission catalogue", () => {
  it("has unique keys", () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(PERMISSIONS.length);
  });

  it("defines defaults for all five blueprint roles using known keys", () => {
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
    ] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain("sales.force_override");
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain("company.roles.manage");
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
