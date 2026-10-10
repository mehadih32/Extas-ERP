import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Team, Roles and Company settings screens decide which buttons to show from
 * flags the server sends with each member and role. These tests open the screens'
 * data as different people and then try every action through the same Server
 * Actions the buttons call: each must work exactly when the screen offers it.
 * Next.js' request helpers are replaced as in screens.test.ts.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`Redirected to ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
      redirectedTo: url,
    });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import SettingsPage from "@/app/(app)/settings/page";
import { visibleSettingsTabs } from "@/components/settings/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import { login } from "@/modules/auth/auth.service";
import { createSession } from "@/modules/auth/session.service";
import type { Team, TeamMember } from "@/modules/rbac/member.service";
import type { PermissionKey } from "@/modules/rbac/permissions";
import type { RoleSummary } from "@/modules/rbac/role.service";
import {
  getCompanyDetailsAction,
  updateCompanyProfileAction,
} from "@/server/actions/company.actions";
import {
  addMemberAction,
  changeMemberRoleAction,
  createRoleAction,
  deleteRoleAction,
  getRolesAction,
  getTeamAction,
  resetMemberPasswordAction,
  setMemberActiveAction,
  updateRoleAction,
} from "@/server/actions/rbac.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { PASSWORD, addToCompany, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** Opens the company as this person, as the browser does after they sign in. */
async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** Where the screen sent the person (it must have redirected). */
async function redirectOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const to = (error as { redirectedTo?: string }).redirectedTo;
    if (to) return to;
    throw error;
  }
  throw new Error("Expected a redirect");
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(["FORBIDDEN", "CONFLICT"], `${label}: ${result.error.message}`).toContain(
    result.error.code,
  );
}

async function customRole(companyId: string, name: string, keys: PermissionKey[]) {
  const permissions = await prisma.permission.findMany({ where: { key: { in: keys } } });
  return prisma.role.create({
    data: {
      companyId,
      name,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
}

async function member(
  email: string,
  companyId: string,
  roleId: string,
  opts: { isActive?: boolean; isPlatformOwner?: boolean; invited?: boolean } = {},
) {
  const user = await makeUser(email, { isSuperAdmin: opts.isPlatformOwner });
  if (opts.invited) {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "INVITED", mustChangePassword: true },
    });
  }
  const membership = await prisma.companyMembership.create({
    data: { userId: user.id, companyId, roleId, isActive: opts.isActive ?? true },
  });
  return { user, membership };
}

/**
 * Extras with two Super Admins (one of them the platform owner), people in
 * custom roles that hold one settings permission each, someone who also works
 * in Fabric Apparel, a new person who has not signed in yet and two deactivated
 * members.
 */
async function extrasTeam() {
  const { company, roles } = await makeCompany("Extras");
  const fabric = await makeCompany("Fabric Apparel");
  const hrManager = await customRole(company.id, "HR Manager", [
    "dashboard.view",
    "company.members.manage",
  ]);
  const roleKeeper = await customRole(company.id, "Role Keeper", ["company.roles.manage"]);
  const officeManager = await customRole(company.id, "Office Manager", ["company.settings"]);
  const seasonal = await customRole(company.id, "Seasonal", ["inventory.view"]);
  const unused = await customRole(company.id, "Unused", []);

  const owner = await member("owner@extras.test", company.id, roles.SUPER_ADMIN, {
    isPlatformOwner: true,
  });
  const admin = await member("admin@extras.test", company.id, roles.SUPER_ADMIN);
  const hr = await member("hr@extras.test", company.id, hrManager.id);
  const keeper = await member("keeper@extras.test", company.id, roleKeeper.id);
  const office = await member("office@extras.test", company.id, officeManager.id);
  const accounts = await member("accounts@extras.test", company.id, roles.ACCOUNTS);
  const shared = await member("shared@extras.test", company.id, roles.EMPLOYEE);
  await addToCompany(shared.user.id, fabric.company.id, fabric.roles.ACCOUNTS);
  await member("sales@extras.test", company.id, roles.SALES_EXECUTIVE);
  await member("invited@extras.test", company.id, roles.EMPLOYEE, { invited: true });
  await member("old-admin@extras.test", company.id, roles.SUPER_ADMIN, { isActive: false });
  await member("left@extras.test", company.id, seasonal.id, { isActive: false });

  return {
    company,
    fabric,
    roles: { ...roles, hrManager, roleKeeper, officeManager, seasonal, unused },
    people: { owner, admin, hr, keeper, office, accounts, shared },
  };
}

/**
 * Opens the Team screen as this person, then tries every member action on every
 * member and adding someone in every role, through the Server Actions the
 * screen's buttons call. Each must work exactly when the screen offers it. A
 * change that works is undone at once, so each try starts from the same team.
 */
async function checkTeamScreen(userId: string, companyId: string, who: string): Promise<Team> {
  await signInAs(userId, companyId);
  const result = await getTeamAction();
  if (!result.ok) throw new Error(`${who} could not open the team: ${result.error.message}`);
  const team = result.data;
  const putBack = (m: TeamMember) =>
    prisma.companyMembership.update({
      where: { id: m.id },
      data: { roleId: m.role.id, isActive: m.isActive },
    });

  for (const m of team.members) {
    const label = `${who} -> ${m.email}`;

    for (const role of team.roles.filter((r) => r.id !== m.role.id)) {
      const moved = await changeMemberRoleAction(m.id, role.id);
      expect(moved.ok, `${label}: move to ${role.name}`).toBe(m.roleChoices.includes(role.id));
      expectRuleRefusal(moved, label);
      if (moved.ok) {
        expect(moved.data.roleId).toBe(role.id);
        await putBack(m);
      }
    }
    expect(m.can.changeRole, `${label}: change role`).toBe(m.roleChoices.length > 0);

    if (m.isActive) {
      expect(m.can.reactivate, `${label}: reactivate`).toBe(false);
      const deactivated = await setMemberActiveAction(m.id, false);
      expect(deactivated.ok, `${label}: deactivate`).toBe(m.can.deactivate);
      expectRuleRefusal(deactivated, label);
      if (deactivated.ok) await putBack(m);
    } else {
      expect(m.can.deactivate, `${label}: deactivate`).toBe(false);
      const reactivated = await setMemberActiveAction(m.id, true);
      expect(reactivated.ok, `${label}: reactivate`).toBe(m.can.reactivate);
      expectRuleRefusal(reactivated, label);
      if (reactivated.ok) await putBack(m);
    }

    const before = await prisma.user.findUniqueOrThrow({ where: { email: m.email } });
    const reset = await resetMemberPasswordAction(m.id);
    expect(reset.ok, `${label}: reset password`).toBe(m.can.resetPassword);
    expectRuleRefusal(reset, label);
    if (reset.ok) {
      expect(reset.data.temporaryPassword).toEqual(expect.any(String));
      await prisma.user.update({
        where: { id: before.id },
        data: {
          passwordHash: before.passwordHash,
          mustChangePassword: before.mustChangePassword,
          failedLoginCount: before.failedLoginCount,
          lockedUntil: before.lockedUntil,
        },
      });
    }
  }

  for (const [i, role] of team.roles.entries()) {
    const email = `new-${i}@extras.test`;
    const added = await addMemberAction({ email, name: "New Person", roleId: role.id });
    expect(added.ok, `${who} adds someone as ${role.name}`).toBe(
      team.grantableRoleIds.includes(role.id),
    );
    expectRuleRefusal(added, who);
    if (added.ok) {
      await prisma.companyMembership.deleteMany({ where: { user: { email } } });
      await prisma.user.delete({ where: { email } });
    }
  }
  return team;
}

/** Puts back a role the check deleted, with the same id, name and permissions. */
async function recreateRole(companyId: string, role: RoleSummary) {
  const permissions = await prisma.permission.findMany({
    where: { key: { in: role.permissions } },
  });
  await prisma.role.create({
    data: {
      id: role.id,
      companyId,
      name: role.name,
      description: role.description,
      systemRole: role.systemRole,
      isSystem: role.isSystem,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
}

/**
 * Opens the Roles screen as this person and tries editing, renaming and deleting
 * every role, and making a new one: each must work exactly when the screen offers it.
 */
async function checkRolesScreen(userId: string, companyId: string, who: string) {
  await signInAs(userId, companyId);
  const result = await getRolesAction();
  if (!result.ok) throw new Error(`${who} could not open the roles: ${result.error.message}`);
  const screen = result.data;

  for (const role of screen.roles) {
    const label = `${who} -> ${role.name}`;
    const edited = await updateRoleAction(role.id, {
      description: role.description,
      permissions: role.permissions,
    });
    expect(edited.ok, `${label}: edit`).toBe(role.can.edit);
    expectRuleRefusal(edited, label);

    const renamed = await updateRoleAction(role.id, { name: `${role.name} renamed` });
    expect(renamed.ok, `${label}: rename`).toBe(role.can.rename);
    expectRuleRefusal(renamed, label);
    if (renamed.ok) await prisma.role.update({ where: { id: role.id }, data: { name: role.name } });

    const deleted = await deleteRoleAction(role.id);
    expect(deleted.ok, `${label}: delete`).toBe(role.can.delete);
    expectRuleRefusal(deleted, label);
    if (deleted.ok) await recreateRole(companyId, role);
  }

  const created = await createRoleAction({ name: "Brand new", permissions: ["notepad.use"] });
  expect(created.ok, `${who}: new role`).toBe(screen.canManage);
  expectRuleRefusal(created, who);
  if (created.ok) await prisma.role.delete({ where: { id: created.data.id } });
  return screen;
}

const NOTHING = { changeRole: false, deactivate: false, reactivate: false, resetPassword: false };

const memberCalled = (team: Team, email: string) => team.members.find((m) => m.email === email)!;
const roleCalled = (roles: RoleSummary[], name: string) => roles.find((r) => r.name === name)!;

run("team and roles screens offer exactly what the server allows", () => {
  beforeEach(async () => {
    await resetDb();
    browser.cookies.clear();
    browser.headers = new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" });
  });

  it("offers each member action to the platform owner, a Super Admin and an HR manager exactly when it works", async () => {
    const { company, roles, people } = await extrasTeam();

    const asOwner = await checkTeamScreen(people.owner.user.id, company.id, "platform owner");
    // The platform owner may reset someone who also works in another company.
    expect(memberCalled(asOwner, "shared@extras.test").can.resetPassword).toBe(true);
    // Their own row: another Super Admin remains, so they may change their own role,
    // but never deactivate themselves or reset their own password.
    expect(memberCalled(asOwner, "owner@extras.test")).toMatchObject({
      isYou: true,
      isPlatformOwner: true,
      can: { changeRole: true, deactivate: false, reactivate: false, resetPassword: false },
    });

    const asAdmin = await checkTeamScreen(people.admin.user.id, company.id, "Super Admin");
    expect(memberCalled(asAdmin, "owner@extras.test").can).toEqual({
      changeRole: true,
      deactivate: true,
      reactivate: false,
      resetPassword: false, // the platform owner's password is theirs alone
    });
    expect(memberCalled(asAdmin, "shared@extras.test").can.resetPassword).toBe(false);
    expect(memberCalled(asAdmin, "old-admin@extras.test").can.reactivate).toBe(true);
    expect(asAdmin.grantableRoleIds).toContain(roles.SUPER_ADMIN);

    const asHr = await checkTeamScreen(people.hr.user.id, company.id, "HR manager");
    // Someone who only manages the team cannot touch Super Admins at all...
    for (const email of ["owner@extras.test", "admin@extras.test", "old-admin@extras.test"]) {
      expect(memberCalled(asHr, email).can, email).toEqual(NOTHING);
    }
    // ...nor grant the Super Admin role to anyone.
    expect(asHr.grantableRoleIds).not.toContain(roles.SUPER_ADMIN);
    for (const m of asHr.members) expect(m.roleChoices, m.email).not.toContain(roles.SUPER_ADMIN);
    expect(memberCalled(asHr, "sales@extras.test").can).toEqual({
      changeRole: true,
      deactivate: true,
      reactivate: false,
      resetPassword: true,
    });
    expect(memberCalled(asHr, "shared@extras.test").can.resetPassword).toBe(false);
    expect(memberCalled(asHr, "left@extras.test").can).toEqual({
      changeRole: true,
      deactivate: false,
      reactivate: true,
      resetPassword: true,
    });
    expect(memberCalled(asHr, "hr@extras.test")).toMatchObject({
      isYou: true,
      can: { deactivate: false, resetPassword: false },
    });
  }, 120_000);

  it("keeps a company's only Super Admin, even from the platform owner", async () => {
    const { company, roles } = await makeCompany("Extras");
    const fabric = await makeCompany("Fabric Apparel");
    const owner = await makeUser("owner@extras.test", { isSuperAdmin: true });
    const admin = await member("admin@extras.test", company.id, roles.SUPER_ADMIN);
    await member("old-admin@extras.test", company.id, roles.SUPER_ADMIN, { isActive: false });
    const shared = await member("shared@extras.test", company.id, roles.SALES_EXECUTIVE);
    await addToCompany(shared.user.id, fabric.company.id, fabric.roles.SALES_EXECUTIVE);

    // The platform owner opens Extras without being a member of it.
    const asOwner = await checkTeamScreen(owner.id, company.id, "platform owner");
    expect(asOwner.members.map((m) => m.email)).not.toContain("owner@extras.test");
    expect(memberCalled(asOwner, "admin@extras.test").can).toEqual({
      ...NOTHING,
      resetPassword: true,
    });
    expect(memberCalled(asOwner, "shared@extras.test").can.resetPassword).toBe(true);
    expect(asOwner.grantableRoleIds).toContain(roles.SUPER_ADMIN);

    const asAdmin = await checkTeamScreen(admin.user.id, company.id, "only Super Admin");
    expect(memberCalled(asAdmin, "admin@extras.test").can).toEqual(NOTHING);
    expect(memberCalled(asAdmin, "old-admin@extras.test").can.reactivate).toBe(true);
    expect(memberCalled(asAdmin, "shared@extras.test").can.resetPassword).toBe(false);
  }, 60_000);

  it("adds someone who already has an account without giving them a new password", async () => {
    const { company, roles } = await makeCompany("Extras");
    const fabric = await makeCompany("Fabric Apparel");
    const admin = await member("admin@extras.test", company.id, roles.SUPER_ADMIN);
    const elsewhere = await member("fabric@extras.test", fabric.company.id, fabric.roles.ACCOUNTS);
    await signInAs(admin.user.id, company.id);

    const added = await addMemberAction({
      email: "fabric@extras.test",
      name: "Someone Else",
      roleId: roles.ACCOUNTS,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    // The screen shows the temporary password only when there is one.
    expect(added.data.temporaryPassword).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: elsewhere.user.id } });
    expect(user).toMatchObject({ name: "fabric", mustChangePassword: false });
    expect((await login({ email: "fabric@extras.test", password: PASSWORD })).user.id).toBe(
      user.id,
    );

    const again = await addMemberAction({
      email: "fabric@extras.test",
      name: "Someone Else",
      roleId: roles.ACCOUNTS,
    });
    expect(again).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("offers each role change exactly when it works", async () => {
    const { company, people } = await extrasTeam();

    for (const [who, person] of [
      ["platform owner", people.owner],
      ["role keeper", people.keeper],
    ] as const) {
      const { roles, canManage } = await checkRolesScreen(person.user.id, company.id, who);
      expect(canManage, who).toBe(true);
      // Super Admin always has everything; built-in roles keep their names.
      expect(roleCalled(roles, "Super Admin").can, who).toEqual({
        edit: false,
        rename: false,
        delete: false,
      });
      expect(roleCalled(roles, "Accounts").can, who).toEqual({
        edit: true,
        rename: false,
        delete: false,
      });
      expect(roleCalled(roles, "HR Manager").can, who).toEqual({
        edit: true,
        rename: true,
        delete: false,
      });
      // A deactivated member still keeps their role from being deleted.
      expect(roleCalled(roles, "Seasonal")).toMatchObject({
        memberCount: 0,
        membershipCount: 1,
        can: { delete: false },
      });
      expect(roleCalled(roles, "Unused").can.delete, who).toBe(true);
    }

    // Managing the team lets you read the roles, not change them.
    const asHr = await checkRolesScreen(people.hr.user.id, company.id, "HR manager");
    expect(asHr.canManage).toBe(false);
    for (const role of asHr.roles) {
      expect(role.can, role.name).toEqual({ edit: false, rename: false, delete: false });
    }
  }, 60_000);

  it("shows each person the settings their permissions open, and nothing more", async () => {
    const { company, people } = await extrasTeam();
    const someone = await prisma.companyMembership.findFirstOrThrow({
      where: { user: { email: "sales@extras.test" } },
    });
    const seen: Record<string, unknown> = {};

    for (const [who, person] of Object.entries(people)) {
      await signInAs(person.user.id, company.id);
      const ctx = await requireCompanyPage();
      const team = await getTeamAction();
      const roles = await getRolesAction();
      const details = await getCompanyDetailsAction();
      if (!details.ok) throw new Error(`${who}: ${details.error.message}`);
      const { canEdit } = details.data;
      seen[who] = { team: team.ok, roles: roles.ok, canEdit };

      // The tabs are exactly the parts whose data the server hands this person;
      // everyone may read the company details and choose their own look.
      const tabs = visibleSettingsTabs(ctx.permissions);
      expect(
        tabs.map((t) => t.label),
        who,
      ).toEqual([
        ...(team.ok ? ["Team"] : []),
        ...(roles.ok ? ["Roles"] : []),
        "Company",
        "Appearance",
      ]);
      // /settings opens the first of them.
      expect(await redirectOf(SettingsPage()), who).toBe(tabs[0]!.href);
      // The menu shows Settings to people who can do something there.
      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/settings");
      expect(inMenu, who).toBe(team.ok || roles.ok || canEdit);

      // Saving the company details works exactly for those offered the form.
      const saved = await updateCompanyProfileAction({ name: details.data.details.name });
      expect(saved.ok, `${who}: save company details`).toBe(canEdit);
      expect(details.data.details.defaultAdvancePercent).toEqual(expect.any(String));

      // Without the screens, the changes behind them are refused too.
      if (!team.ok) {
        expect(team.error.code).toBe("FORBIDDEN");
        for (const attempt of [
          () =>
            addMemberAction({ email: "x@extras.test", name: "X Person", roleId: someone.roleId }),
          () => changeMemberRoleAction(someone.id, person.membership.roleId),
          () => setMemberActiveAction(someone.id, false),
          () => resetMemberPasswordAction(someone.id),
        ]) {
          const result = await attempt();
          expect(result.ok ? "allowed" : result.error.code, who).toBe("FORBIDDEN");
        }
      }
      if (!roles.ok) {
        expect(roles.error.code).toBe("FORBIDDEN");
        const created = await createRoleAction({ name: "Sneaky", permissions: [] });
        expect(created.ok, who).toBe(false);
      }
    }

    expect(seen).toEqual({
      owner: { team: true, roles: true, canEdit: true },
      admin: { team: true, roles: true, canEdit: true },
      hr: { team: true, roles: true, canEdit: false },
      keeper: { team: false, roles: true, canEdit: false },
      office: { team: false, roles: false, canEdit: true },
      accounts: { team: false, roles: false, canEdit: false },
      shared: { team: false, roles: false, canEdit: false },
    });
  }, 60_000);
});
