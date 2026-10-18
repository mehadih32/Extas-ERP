import type { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { companyProfileSchema, isKnownTimeZone } from "@/modules/companies/company.service";
import {
  type Actor,
  canChangeRole,
  canDeactivate,
  canChangeHeldRole,
  canDeleteRole,
  canEditMemberPermissions,
  canEditRole,
  canGrantRole,
  canReactivate,
  canRenameRole,
  canResetPassword,
  canGivePermissions,
  HELD_ROLE,
  heldKeys,
  isPrivileged,
  LAST_SUPER_ADMIN,
  OWN_ROLE,
  SUPER_ADMIN_GRANTS_KEYS,
  SUPER_ADMIN_GRANTS_ROLE,
  SUPER_ADMIN_REACTIVATES,
  SUPER_ADMIN_RESETS,
} from "@/modules/rbac/rules";
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";

/*
 * The member and role rules the services enforce and the Team and Roles
 * screens follow (rbac/rules.ts).
 */

// The platform owner opening a company they are not a member of.
const platformOwner: Actor = { userId: "u-owner", systemRole: null, isPlatformOwner: true };
const superAdmin: Actor = { userId: "u-admin", systemRole: "SUPER_ADMIN", isPlatformOwner: false };
// A custom "HR Manager" role holding company.members.manage.
const hrManager: Actor = { userId: "u-hr", systemRole: null, isPlatformOwner: false };

const SUPER_ADMIN = { systemRole: "SUPER_ADMIN" as const, permissions: ALL_PERMISSION_KEYS };
const SALES = {
  systemRole: "SALES_EXECUTIVE" as const,
  permissions: DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE,
};
const CUSTOM = { systemRole: null, permissions: ["dashboard.view"] };
const ACCOUNTS = {
  systemRole: "ACCOUNTS" as const,
  permissions: DEFAULT_ROLE_PERMISSIONS.ACCOUNTS,
};
// A custom role that may manage the team (or roles) but holds no money keys.
const TEAM_LEAD = { systemRole: null, permissions: ["company.members.manage"] };
const ROLE_EDITOR = { systemRole: null, permissions: ["company.roles.manage"] };

const member = (
  userId: string,
  role: {
    systemRole: typeof SUPER_ADMIN.systemRole | typeof SALES.systemRole | null;
    permissions?: readonly string[];
  },
  extra: { isPlatformOwner?: boolean; worksElsewhere?: boolean } = {},
) => ({
  userId,
  systemRole: role.systemRole,
  isPlatformOwner: extra.isPlatformOwner ?? false,
  worksElsewhere: extra.worksElsewhere ?? false,
  heldKeys: role.permissions ?? [],
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

  const sales = { userId: "u-sales", ...SALES };
  const admin2 = { userId: "u-admin2", ...SUPER_ADMIN };

  it("lets a team manager move people between the other roles only", () => {
    expect(canChangeRole(hrManager, sales, CUSTOM, 1)).toEqual(allowed);
    expect(canChangeRole(hrManager, sales, SUPER_ADMIN, 1)).toEqual(forbidden);
    expect(canChangeRole(hrManager, admin2, SALES, 1)).toEqual(forbidden);
  });

  it("never leaves the company without an active Super Admin", () => {
    expect(canChangeRole(superAdmin, admin2, SALES, 0)).toEqual(
      refused("CONFLICT", LAST_SUPER_ADMIN),
    );
    expect(canChangeRole(platformOwner, admin2, SALES, 0)).toEqual(
      refused("CONFLICT", LAST_SUPER_ADMIN),
    );
    expect(canChangeRole(superAdmin, admin2, SALES, 1)).toEqual(allowed);
    // The count only matters when the member is a Super Admin.
    expect(canChangeRole(superAdmin, sales, SUPER_ADMIN, 0)).toEqual(allowed);
  });

  it("never lets anyone change their own role, Super Admins included (v6.4.1)", () => {
    const own = refused("CONFLICT", OWN_ROLE);
    expect(OWN_ROLE).toBe("You cannot change your own role. Ask another admin.");
    expect(canChangeRole(hrManager, { userId: "u-hr", ...CUSTOM }, ACCOUNTS, 1)).toEqual(own);
    expect(canChangeRole(hrManager, { userId: "u-hr", ...CUSTOM }, SALES, 1)).toEqual(own);
    expect(canChangeRole(superAdmin, { userId: "u-admin", ...SUPER_ADMIN }, SALES, 1)).toEqual(own);
  });

  it("leaves roles that record money or manage users or roles to a Super Admin (v6.4.1)", () => {
    const money = refused("FORBIDDEN", SUPER_ADMIN_GRANTS_ROLE);
    for (const role of [ACCOUNTS, TEAM_LEAD, ROLE_EDITOR]) {
      expect(canChangeRole(hrManager, sales, role, 1)).toEqual(money);
      expect(canGrantRole(hrManager, role)).toEqual(money);
      expect(canChangeRole(superAdmin, sales, role, 1)).toEqual(allowed);
      expect(canChangeRole(platformOwner, sales, role, 1)).toEqual(allowed);
      expect(canGrantRole(superAdmin, role)).toEqual(allowed);
    }
    // Ticked for one person, or added to a role.
    expect(canGivePermissions(hrManager, ["accounts.payments.record"])).toEqual(
      refused("FORBIDDEN", SUPER_ADMIN_GRANTS_KEYS),
    );
    expect(canGivePermissions(hrManager, ["sales.view", "parties.view"])).toEqual(allowed);
    expect(canGivePermissions(superAdmin, ["accounts.receipts.record"])).toEqual(allowed);
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
    const back = (role: { systemRole: SystemRole | null; permissions: readonly string[] }) => ({
      systemRole: role.systemRole,
      heldKeys: role.permissions,
    });
    expect(canReactivate(hrManager, back(SUPER_ADMIN))).toEqual(
      refused("FORBIDDEN", "Only a Super Admin can reactivate a Super Admin."),
    );
    expect(canReactivate(superAdmin, back(SUPER_ADMIN))).toEqual(allowed);
    expect(canReactivate(hrManager, back(SALES))).toEqual(allowed);
  });

  it("leaves switching back on someone who records money or manages the team to a Super Admin (v6.4.1 review 4)", () => {
    const refusedBack = refused("FORBIDDEN", SUPER_ADMIN_REACTIVATES);
    expect(SUPER_ADMIN_REACTIVATES).toBe(
      "Only a Super Admin can switch this person back on, because they can record money or manage users or roles. Ask a Super Admin.",
    );
    const accountant = { systemRole: ACCOUNTS.systemRole, heldKeys: ACCOUNTS.permissions };
    expect(canReactivate(hrManager, accountant)).toEqual(refusedBack);
    for (const role of [TEAM_LEAD, ROLE_EDITOR]) {
      expect(canReactivate(hrManager, { systemRole: null, heldKeys: role.permissions })).toEqual(
        refusedBack,
      );
    }
    // Their own permissions count: a ticked money key, or Accounts with both unticked.
    const tick = (key: string, granted: boolean) => ({ granted, permission: { key } });
    const salesWithReceipts = heldKeys(SALES.permissions, [tick("accounts.receipts.record", true)]);
    expect(
      canReactivate(hrManager, { systemRole: "SALES_EXECUTIVE", heldKeys: salesWithReceipts }),
    ).toEqual(refusedBack);
    const trimmed = heldKeys(ACCOUNTS.permissions, [
      tick("accounts.receipts.record", false),
      tick("accounts.payments.record", false),
    ]);
    expect(canReactivate(hrManager, { systemRole: "ACCOUNTS", heldKeys: trimmed })).toEqual(
      allowed,
    );
    // A Super Admin and the platform owner may.
    expect(canReactivate(superAdmin, accountant)).toEqual(allowed);
    expect(canReactivate(platformOwner, accountant)).toEqual(allowed);
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

  it("leaves resetting someone who records money or manages the team to a Super Admin, like switching them back on (v6.4.2)", () => {
    const refusedReset = refused("FORBIDDEN", SUPER_ADMIN_RESETS);
    expect(SUPER_ADMIN_RESETS).toBe(
      "Only a Super Admin can reset the password of someone who can record money or manage users or roles. Ask a Super Admin.",
    );
    // A team manager could otherwise reset the accountant's password and sign in as them.
    for (const role of [ACCOUNTS, TEAM_LEAD, ROLE_EDITOR]) {
      expect(canResetPassword(hrManager, member("u-target", role))).toEqual(refusedReset);
      expect(canResetPassword(superAdmin, member("u-target", role))).toEqual(allowed);
      expect(canResetPassword(platformOwner, member("u-target", role))).toEqual(allowed);
    }
    // A key ticked for that one person counts the same as one in their role.
    const ticked = { ...member("u-target", CUSTOM), heldKeys: ["accounts.payments.record"] };
    expect(canResetPassword(hrManager, ticked)).toEqual(refusedReset);
    expect(canResetPassword(hrManager, member("u-target", CUSTOM))).toEqual(allowed);
  });
});

describe("ticking permissions for one member", () => {
  it("never for a Super Admin, the platform owner or oneself", () => {
    const always = refused("FORBIDDEN", "A Super Admin always has every permission.");
    expect(canEditMemberPermissions(superAdmin, member("u-other", SUPER_ADMIN))).toEqual(always);
    expect(
      canEditMemberPermissions(superAdmin, member("u-owner", CUSTOM, { isPlatformOwner: true })),
    ).toEqual(always);
    expect(canEditMemberPermissions(hrManager, member("u-hr", CUSTOM))).toEqual(
      refused("CONFLICT", "You cannot change your own permissions. Ask another admin."),
    );
    expect(canEditMemberPermissions(hrManager, member("u-sales", SALES))).toEqual(allowed);
    expect(canEditMemberPermissions(superAdmin, member("u-sales", SALES))).toEqual(allowed);
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

describe("a role one holds (v6.4.1)", () => {
  it("is never changed or deleted by its holder unless they are a Super Admin", () => {
    const hrInRole = { ...hrManager, roleId: "r-hr" };
    expect(canChangeHeldRole(hrInRole, { id: "r-hr" })).toEqual(refused("FORBIDDEN", HELD_ROLE));
    expect(canChangeHeldRole(hrInRole, { id: "r-sales" })).toEqual(allowed);
    expect(canChangeHeldRole({ ...superAdmin, roleId: "r-admin" }, { id: "r-admin" })).toEqual(
      allowed,
    );
    expect(canChangeHeldRole(platformOwner, { id: "r-hr" })).toEqual(allowed);
  });
});
