import { describe, expect, it } from "vitest";

import { companyProfileSchema, isKnownTimeZone } from "@/modules/companies/company.service";
import {
  type Actor,
  canChangeRole,
  canDeactivate,
  canDeleteRole,
  canEditRole,
  canGrantRole,
  canReactivate,
  canRenameRole,
  canResetPassword,
  isPrivileged,
  LAST_SUPER_ADMIN,
} from "@/modules/rbac/rules";

/*
 * The member and role rules the services enforce and the Team and Roles
 * screens follow (rbac/rules.ts).
 */

// The platform owner opening a company they are not a member of.
const platformOwner: Actor = { userId: "u-owner", systemRole: null, isPlatformOwner: true };
const superAdmin: Actor = { userId: "u-admin", systemRole: "SUPER_ADMIN", isPlatformOwner: false };
// A custom "HR Manager" role holding company.members.manage.
const hrManager: Actor = { userId: "u-hr", systemRole: null, isPlatformOwner: false };

const SUPER_ADMIN = { systemRole: "SUPER_ADMIN" as const };
const SALES = { systemRole: "SALES_EXECUTIVE" as const };
const CUSTOM = { systemRole: null };

const member = (
  userId: string,
  role: { systemRole: typeof SUPER_ADMIN.systemRole | typeof SALES.systemRole | null },
  extra: { isPlatformOwner?: boolean; worksElsewhere?: boolean } = {},
) => ({
  userId,
  systemRole: role.systemRole,
  isPlatformOwner: extra.isPlatformOwner ?? false,
  worksElsewhere: extra.worksElsewhere ?? false,
});

const allowed = { ok: true };
const refused = (code: "FORBIDDEN" | "CONFLICT", message: string) => ({ ok: false, code, message });

describe("who may touch Super Admins", () => {
  it("is the company's Super Admins and the platform owner", () => {
    expect(isPrivileged(platformOwner)).toBe(true);
    expect(isPrivileged(superAdmin)).toBe(true);
    expect(isPrivileged(hrManager)).toBe(false);
  });

  it("keeps the Super Admin role out of other people's hands when adding someone", () => {
    expect(canGrantRole(hrManager, SUPER_ADMIN)).toEqual(
      refused("FORBIDDEN", "Only a Super Admin can grant the Super Admin role."),
    );
    expect(canGrantRole(hrManager, SALES)).toEqual(allowed);
    expect(canGrantRole(hrManager, CUSTOM)).toEqual(allowed);
    expect(canGrantRole(superAdmin, SUPER_ADMIN)).toEqual(allowed);
    expect(canGrantRole(platformOwner, SUPER_ADMIN)).toEqual(allowed);
  });
});

describe("changing someone's role", () => {
  const forbidden = refused(
    "FORBIDDEN",
    "Only a Super Admin can grant or remove the Super Admin role.",
  );

  it("lets a team manager move people between the other roles only", () => {
    expect(canChangeRole(hrManager, SALES, CUSTOM, 1)).toEqual(allowed);
    expect(canChangeRole(hrManager, SALES, SUPER_ADMIN, 1)).toEqual(forbidden);
    expect(canChangeRole(hrManager, SUPER_ADMIN, SALES, 1)).toEqual(forbidden);
  });

  it("never leaves the company without an active Super Admin", () => {
    expect(canChangeRole(superAdmin, SUPER_ADMIN, SALES, 0)).toEqual(
      refused("CONFLICT", LAST_SUPER_ADMIN),
    );
    expect(canChangeRole(platformOwner, SUPER_ADMIN, SALES, 0)).toEqual(
      refused("CONFLICT", LAST_SUPER_ADMIN),
    );
    expect(canChangeRole(superAdmin, SUPER_ADMIN, SALES, 1)).toEqual(allowed);
    // The count only matters when the member is a Super Admin.
    expect(canChangeRole(superAdmin, SALES, SUPER_ADMIN, 0)).toEqual(allowed);
  });
});

describe("deactivating and reactivating", () => {
  it("never lets people lock themselves out", () => {
    for (const actor of [platformOwner, superAdmin, hrManager]) {
      expect(canDeactivate(actor, { userId: actor.userId, ...SALES }, 1)).toEqual(
        refused("CONFLICT", "You cannot deactivate your own access."),
      );
    }
  });

  it("leaves Super Admins to Super Admins, keeping one active", () => {
    const admin2 = { userId: "u-admin2", ...SUPER_ADMIN };
    expect(canDeactivate(hrManager, admin2, 1)).toEqual(
      refused("FORBIDDEN", "Only a Super Admin can deactivate a Super Admin."),
    );
    expect(canDeactivate(superAdmin, admin2, 0)).toEqual(refused("CONFLICT", LAST_SUPER_ADMIN));
    expect(canDeactivate(superAdmin, admin2, 1)).toEqual(allowed);
    expect(canDeactivate(hrManager, { userId: "u-sales", ...SALES }, 0)).toEqual(allowed);
  });

  it("does not let a team manager bring a Super Admin back", () => {
    expect(canReactivate(hrManager, SUPER_ADMIN)).toEqual(
      refused("FORBIDDEN", "Only a Super Admin can reactivate a Super Admin."),
    );
    expect(canReactivate(superAdmin, SUPER_ADMIN)).toEqual(allowed);
    expect(canReactivate(hrManager, SALES)).toEqual(allowed);
  });
});

describe("resetting a password", () => {
  it("sends people to Change Password for their own", () => {
    expect(canResetPassword(superAdmin, member("u-admin", SUPER_ADMIN))).toEqual(
      refused("CONFLICT", "Use Change Password for your own account."),
    );
  });

  it("keeps a team manager away from Super Admins' passwords", () => {
    expect(canResetPassword(hrManager, member("u-admin", SUPER_ADMIN))).toEqual(
      refused("FORBIDDEN", "Only a Super Admin can reset a Super Admin's password."),
    );
    expect(canResetPassword(hrManager, member("u-sales", SALES))).toEqual(allowed);
  });

  it("leaves the platform owner and people of other companies to the platform owner", () => {
    expect(
      canResetPassword(superAdmin, member("u-owner", SUPER_ADMIN, { isPlatformOwner: true })),
    ).toEqual(refused("FORBIDDEN", "You cannot reset the platform owner."));
    expect(
      canResetPassword(superAdmin, member("u-shared", SALES, { worksElsewhere: true })),
    ).toEqual(
      refused("FORBIDDEN", "This user also works in another company. Ask the platform owner."),
    );
    expect(
      canResetPassword(platformOwner, member("u-shared", SALES, { worksElsewhere: true })),
    ).toEqual(allowed);
    expect(canResetPassword(platformOwner, member("u-admin", SUPER_ADMIN))).toEqual(allowed);
  });
});

describe("roles", () => {
  it("keeps the Super Admin role whole and the built-in roles' names", () => {
    expect(canEditRole(SUPER_ADMIN)).toEqual(
      refused("FORBIDDEN", "The Super Admin role always has every permission."),
    );
    expect(canEditRole(SALES)).toEqual(allowed);
    expect(canRenameRole({ ...SALES, isSystem: true })).toEqual(
      refused("FORBIDDEN", "Built-in roles cannot be renamed."),
    );
    expect(canRenameRole({ ...CUSTOM, isSystem: false })).toEqual(allowed);
  });

  it("deletes only custom roles nobody holds, deactivated people included", () => {
    expect(canDeleteRole({ ...SALES, isSystem: true }, 0)).toEqual(
      refused("FORBIDDEN", "Built-in roles cannot be deleted."),
    );
    expect(canDeleteRole({ ...CUSTOM, isSystem: false }, 1)).toEqual(
      refused("CONFLICT", "Move the users in this role to another role first."),
    );
    expect(canDeleteRole({ ...CUSTOM, isSystem: false }, 0)).toEqual(allowed);
  });
});

describe("company settings checks", () => {
  it("only takes time zones the server can work in, in their own spelling", () => {
    expect(isKnownTimeZone("Asia/Dhaka")).toBe(true);
    expect(isKnownTimeZone("Asia/Dhak")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
    expect(companyProfileSchema.partial().parse({ timezone: "asia/dhaka" }).timezone).toBe(
      "Asia/Dhaka",
    );
    const bad = companyProfileSchema.partial().safeParse({ timezone: "Dhaka time" });
    expect(bad.error?.issues[0]?.message).toBe(
      "Choose a time zone from the list, such as Asia/Dhaka",
    );
  });

  it("writes currency codes in capitals and refuses anything else", () => {
    expect(companyProfileSchema.partial().parse({ currency: " usd " }).currency).toBe("USD");
    expect(companyProfileSchema.partial().safeParse({ currency: "US" }).success).toBe(false);
    expect(companyProfileSchema.partial().safeParse({ currency: "U$D" }).success).toBe(false);
  });

  it("says what is wrong in plain words", () => {
    const result = companyProfileSchema.partial().safeParse({
      name: "",
      email: "nope",
      lowStockThreshold: 2.5,
      defaultAdvancePercent: 120,
      dormantAfterMonths: "six",
    });
    const messages = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]),
    );
    expect(messages).toEqual({
      name: "Enter the company name",
      email: "Enter a valid email address",
      lowStockThreshold: "Enter a whole number",
      defaultAdvancePercent: "Use a percentage from 0 to 100",
      dormantAfterMonths: "Enter a number",
    });
  });
});
