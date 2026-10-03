import { describe, expect, it } from "vitest";

import { currencyChoices, timeZoneChoices } from "@/components/settings/company/company-options";
import {
  isMoneyPermission,
  PERMISSION_GROUPS,
  roleSummary,
  warnsAboutMoney,
} from "@/components/settings/roles/role-labels";
import { visibleSettingsTabs } from "@/components/settings/tabs";
import {
  firstName,
  matchesSearch,
  memberStanding,
  signInDetails,
} from "@/components/settings/team/member-labels";
import { visibleNavItems } from "@/components/shell/nav-items";
import { MONEY_PERMISSIONS, PERMISSIONS } from "@/modules/rbac/permissions";

const tabs = (permissions: string[]) => visibleSettingsTabs(permissions).map((t) => t.label);

describe("the settings area", () => {
  it("is in the menu for people who manage the team, the roles or the company", () => {
    const hasSettings = (permissions: string[]) =>
      visibleNavItems(permissions).some((item) => item.href === "/settings");
    expect(hasSettings(["company.members.manage"])).toBe(true);
    expect(hasSettings(["company.roles.manage"])).toBe(true);
    expect(hasSettings(["company.settings"])).toBe(true);
    expect(hasSettings(["sales.view", "accounts.view", "audit.view"])).toBe(false);
  });

  it("shows each tab to the people its Server Actions let in", () => {
    expect(tabs(["company.members.manage"])).toEqual(["Team", "Roles", "Company"]);
    expect(tabs(["company.roles.manage"])).toEqual(["Roles", "Company"]);
    expect(tabs(["company.settings"])).toEqual(["Company"]);
    // The company details can be read by everyone in the company (GET /api/company).
    expect(tabs([])).toEqual(["Company"]);
    expect(tabs(PERMISSIONS.map((p) => p.key))).toEqual(["Team", "Roles", "Company"]);
  });
});

describe("the role editor's groups", () => {
  it("hold every permission exactly once", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
    expect([...listed].sort()).toEqual(PERMISSIONS.map((p) => p.key).sort());
  });

  it("mark the permissions that record money", () => {
    const money = PERMISSION_GROUPS.flatMap((g) => g.permissions.filter((p) => p.money));
    expect(money.map((p) => p.key).sort()).toEqual([...MONEY_PERMISSIONS].sort());
    expect(isMoneyPermission("accounts.view")).toBe(false);
  });

  it("warns when a role other than Accounts or Super Admin gets money permissions", () => {
    expect(warnsAboutMoney(null, ["accounts.payments.record"])).toBe(true);
    expect(warnsAboutMoney({ systemRole: "SALES_EXECUTIVE" }, ["accounts.receipts.record"])).toBe(
      true,
    );
    expect(warnsAboutMoney({ systemRole: "ACCOUNTS" }, MONEY_PERMISSIONS)).toBe(false);
    expect(warnsAboutMoney({ systemRole: "SUPER_ADMIN" }, MONEY_PERMISSIONS)).toBe(false);
    expect(warnsAboutMoney({ systemRole: null }, ["accounts.view", "sales.view"])).toBe(false);
  });

  it("describe a role by its own words, or what a built-in role is for", () => {
    expect(roleSummary({ description: "Our cutters", systemRole: "WAREHOUSE_TEAM" })).toBe(
      "Our cutters",
    );
    expect(roleSummary({ description: null, systemRole: "SALES_EXECUTIVE" })).toMatch(
      /do not record money/,
    );
    expect(roleSummary({ description: null, systemRole: null })).toBeNull();
  });
});

describe("the team list", () => {
  it("says where each member stands", () => {
    expect(memberStanding({ isActive: false, status: "ACTIVE" }).label).toBe("Deactivated");
    expect(memberStanding({ isActive: false, status: "INVITED" }).label).toBe("Deactivated");
    expect(memberStanding({ isActive: true, status: "SUSPENDED" }).label).toBe("Suspended");
    expect(memberStanding({ isActive: true, status: "INVITED" }).label).toBe("Invited");
    expect(memberStanding({ isActive: true, status: "ACTIVE" }).tone).toBe("active");
  });

  it("finds people by any part of their name, email, phone or role", () => {
    const rafiq = {
      name: "Rafiq Islam",
      email: "sales@extras.test",
      phone: "+880 1711-000222",
      role: { name: "Sales Executive" },
    };
    expect(matchesSearch(rafiq, "")).toBe(true);
    expect(matchesSearch(rafiq, "  RAFIQ  ")).toBe(true);
    expect(matchesSearch(rafiq, "rafiq executive")).toBe(true);
    expect(matchesSearch(rafiq, "1711")).toBe(true);
    expect(matchesSearch(rafiq, "rafiq accounts")).toBe(false);
    expect(matchesSearch({ ...rafiq, phone: null }, "1711")).toBe(false);
  });

  it("writes the sign-in details an admin hands over", () => {
    expect(firstName("  Hasina Akter ")).toBe("Hasina");
    expect(
      signInDetails({
        name: "Hasina Akter",
        email: "hr@extras.test",
        temporaryPassword: "AbCd-EfGh-JkMn",
        signInAddress: "https://erp.example.com/sign-in",
        companyName: "Extras",
      }),
    ).toBe(
      [
        "Extras: sign-in details for Hasina Akter",
        "Address: https://erp.example.com/sign-in",
        "Email: hr@extras.test",
        "Temporary password: AbCd-EfGh-JkMn",
        "You will be asked to choose your own password after signing in.",
      ].join("\n"),
    );
  });
});

describe("company setting choices", () => {
  it("keep the company's own currency and time zone even when uncommon", () => {
    expect(currencyChoices("BDT")[0]).toEqual(["BDT", "Bangladeshi taka (BDT)"]);
    expect(currencyChoices("XAF")[0]).toEqual(["XAF", "XAF"]);
    expect(timeZoneChoices("Asia/Dhaka")).toContain("Asia/Dhaka");
    expect(timeZoneChoices("UTC")[0]).toBe("UTC");
  });
});
