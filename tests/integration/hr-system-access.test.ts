import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * The 360° profile: the System access card (the login linked to an employee,
 * its role, whether it is on and when it last signed in), giving a login in a
 * chosen role, moving it to another role and switching it off or on under the
 * Settings > Team rules, and the profile fields the sidebar card and My HR's
 * profile widget show (photo and time here).
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  return {
    ...real,
    requireCompany: async () => signedIn.ctx,
    requirePermission: async (...keys: string[]) => {
      const ctx = signedIn.ctx as import("@/modules/auth/context").CompanyContext;
      if (keys.some((k) => !ctx.permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx;
    },
  };
});

import { PATCH as changeLoginRoute } from "@/app/api/hr/employees/[employeeId]/portal-access/route";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";
import * as logins from "@/modules/hr/login.service";
import * as screens from "@/modules/hr/screens.service";
import * as vault from "@/modules/hr/vault.service";
import { createRole } from "@/modules/rbac/role.service";

import { png } from "../fixtures/images";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** Monday 12 Oct 2026, 10:00 in Dhaka. */
const NOW = new Date("2026-10-12T10:00:00+06:00");

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const ownerUser = await member(roles.SUPER_ADMIN, "owner");
  const owner = await contextFor(ownerUser.id, company.id);
  const hrRole = await createRole(owner, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage"],
  });
  const adminRole = await createRole(owner, {
    name: "Office Admin",
    permissions: ["hr.view", "hr.manage", "company.members.manage"],
  });
  const viewerRole = await createRole(owner, { name: "HR Viewer", permissions: ["hr.view"] });
  const hr = await contextFor((await member(hrRole.id, "hr")).id, company.id);
  const admin = await contextFor((await member(adminRole.id, "admin")).id, company.id);
  const viewer = await contextFor((await member(viewerRole.id, "viewer")).id, company.id);

  const sumonUser = await member(roles.EMPLOYEE, "sumon");
  await prisma.user.update({
    where: { id: sumonUser.id },
    data: { lastLoginAt: new Date("2026-10-11T03:15:00Z") },
  });
  const hire = (name: string, joinDate: string) =>
    employees.createEmployee(owner, {
      name,
      joinDate,
      salary: 30000,
      phone: "01712-345678",
      designation: "Cutter",
      department: "Cutting",
    });
  const sumon = await hire("Sumon Mia", "2024-07-01");
  await employees.grantPortalAccess(owner, sumon.id, { userId: sumonUser.id });
  const rina = await hire("Rina Begum", "2026-10-02");
  // The owner works on the staff list too.
  const boss = await hire("Mehadi Hasan", "2020-01-01");
  await employees.grantPortalAccess(owner, boss.id, { userId: ownerUser.id });

  return {
    company,
    roles,
    owner,
    hr,
    admin,
    viewer,
    sumonCtx: await contextFor(sumonUser.id, company.id),
    sumon,
    rina,
    boss,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

const accessOf = async (ctx: CompanyContext, employeeId: string) =>
  (await screens.getEmployeeScreen(ctx, employeeId)).systemAccess;

run("the 360° profile and system access", () => {
  let env: Env;

  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    await resetDb();
    env = await setup();
  }, 30_000);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the login, its role and last sign-in to HR and to people who manage users", async () => {
    const card = await accessOf(env.owner, env.sumon.id);
    expect(card?.login).toEqual({
      email: "sumon@extras.test",
      active: true,
      invited: false,
      role: { id: env.roles.EMPLOYEE, name: "Employee", systemRole: "EMPLOYEE" },
      lastSignIn: { day: "2026-10-11", time: "09:15" },
    });
    expect(card?.can).toEqual({
      give: false,
      chooseRole: true,
      changeRole: true,
      switchOff: true,
      switchOn: false,
      remove: true,
    });
    // The owner may give any role, Super Admin included.
    expect(card?.roles.map((r) => r.systemRole)).toContain("SUPER_ADMIN");

    // HR alone gives and removes logins but does not choose roles or switch them.
    const hrCard = await accessOf(env.hr, env.rina.id);
    expect(hrCard?.login).toBeNull();
    expect(hrCard?.roles).toEqual([]);
    expect(hrCard?.can).toEqual({
      give: true,
      chooseRole: false,
      changeRole: false,
      switchOff: false,
      switchOn: false,
      remove: false,
    });
    expect((await accessOf(env.hr, env.sumon.id))?.can).toMatchObject({
      changeRole: false,
      switchOff: false,
      remove: true,
    });

    // Someone who only looks at the staff list sees no card at all.
    expect(await accessOf(env.viewer, env.sumon.id)).toBeNull();
  });

  it("gives a login in the role chosen, only by people who manage users", async () => {
    const given = await employees.grantPortalAccess(env.admin, env.rina.id, {
      email: "rina@mail.test",
      roleId: env.roles.SALES_EXECUTIVE,
    });
    expect(given.temporaryPassword).toEqual(expect.any(String));
    const card = await accessOf(env.admin, env.rina.id);
    // Not signed in yet is not switched off.
    expect((await screens.getEmployeeScreen(env.viewer, env.rina.id)).employee.login).toEqual({
      email: "rina@mail.test",
      active: true,
    });
    expect(card?.login).toMatchObject({
      email: "rina@mail.test",
      invited: true,
      role: { systemRole: "SALES_EXECUTIVE" },
      lastSignIn: null,
    });

    // HR without user management cannot pick a role; the Employee role is the default.
    const fresh = await employees.createEmployee(env.owner, {
      name: "Karim Uddin",
      joinDate: "2025-01-01",
      salary: 20000,
    });
    await expect(
      employees.grantPortalAccess(env.hr, fresh.id, {
        email: "karim@mail.test",
        roleId: env.roles.ACCOUNTS,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await employees.grantPortalAccess(env.hr, fresh.id, { email: "karim@mail.test" });
    expect((await accessOf(env.hr, fresh.id))?.login?.role.systemRole).toBe("EMPLOYEE");

    // Only a Super Admin gives the Super Admin role.
    const another = await employees.createEmployee(env.owner, {
      name: "Jamal Hossain",
      joinDate: "2025-01-01",
      salary: 20000,
    });
    expect((await accessOf(env.admin, another.id))?.roles.map((r) => r.systemRole)).not.toContain(
      "SUPER_ADMIN",
    );
    await expect(
      employees.grantPortalAccess(env.admin, another.id, {
        email: "jamal@mail.test",
        roleId: env.roles.SUPER_ADMIN,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.user.findUnique({ where: { email: "jamal@mail.test" } })).toBeNull();
  });

  it("moves someone already in the company to the role chosen when linking them", async () => {
    const user = await makeUser("rina@extras.test");
    await addToCompany(user.id, env.company.id, env.roles.WAREHOUSE_TEAM);
    const given = await employees.grantPortalAccess(env.owner, env.rina.id, {
      email: "rina@extras.test",
      roleId: env.roles.EMPLOYEE,
    });
    expect(given.temporaryPassword).toBeUndefined();
    const membership = await prisma.companyMembership.findUniqueOrThrow({
      where: { companyId_userId: { companyId: env.company.id, userId: user.id } },
    });
    expect(membership.roleId).toBe(env.roles.EMPLOYEE);
  });

  it("changes the role and switches the login off and on, keeping a record", async () => {
    const moved = await logins.changeEmployeeLogin(env.admin, env.sumon.id, {
      roleId: env.roles.ACCOUNTS,
    });
    expect(moved).toMatchObject({ email: "sumon@extras.test", active: true });
    expect(moved.role.systemRole).toBe("ACCOUNTS");

    const off = await logins.changeEmployeeLogin(env.admin, env.sumon.id, { active: false });
    expect(off.active).toBe(false);
    const card = await accessOf(env.admin, env.sumon.id);
    expect(card?.login?.active).toBe(false);
    expect(card?.can).toMatchObject({ changeRole: false, switchOff: false, switchOn: true });
    // The Details tab says so too.
    expect((await screens.getEmployeeScreen(env.viewer, env.sumon.id)).employee.login).toEqual({
      email: "sumon@extras.test",
      active: false,
    });
    // Switched off, the login no longer opens the company and its role cannot change.
    const membership = await prisma.companyMembership.findUniqueOrThrow({
      where: { companyId_userId: { companyId: env.company.id, userId: env.sumonCtx.user.id } },
    });
    expect(membership.isActive).toBe(false);
    await expect(
      logins.changeEmployeeLogin(env.admin, env.sumon.id, { roleId: env.roles.EMPLOYEE }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const on = await logins.changeEmployeeLogin(env.admin, env.sumon.id, { active: true });
    expect(on).toMatchObject({ active: true, role: { systemRole: "ACCOUNTS" } });

    const audit = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityType: "CompanyMembership" },
      select: { summary: true },
    });
    expect(audit.map((a) => a.summary)).toEqual(
      expect.arrayContaining([expect.stringContaining("from Employee to Accounts")]),
    );
  });

  it("keeps the Settings > Team rules", async () => {
    // HR alone cannot change a login.
    await expect(
      logins.changeEmployeeLogin(env.hr, env.sumon.id, { active: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Exactly one change at a time.
    await expect(logins.changeEmployeeLogin(env.admin, env.sumon.id, {})).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      logins.changeEmployeeLogin(env.admin, env.sumon.id, {
        roleId: env.roles.ACCOUNTS,
        active: false,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    // No login yet.
    await expect(
      logins.changeEmployeeLogin(env.admin, env.rina.id, { active: false }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Only a Super Admin touches a Super Admin's login.
    const bossCard = await accessOf(env.admin, env.boss.id);
    expect(bossCard?.can).toMatchObject({ changeRole: false, switchOff: false });
    await expect(
      logins.changeEmployeeLogin(env.admin, env.boss.id, { active: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      logins.changeEmployeeLogin(env.admin, env.boss.id, { roleId: env.roles.EMPLOYEE }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Nobody switches themselves off, and the company keeps its only Super Admin.
    const ownCard = await accessOf(env.owner, env.boss.id);
    expect(ownCard?.can).toMatchObject({ changeRole: false, switchOff: false });
    await expect(
      logins.changeEmployeeLogin(env.owner, env.boss.id, { active: false }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      logins.changeEmployeeLogin(env.owner, env.boss.id, { roleId: env.roles.EMPLOYEE }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("changes a login through the API for people who manage users only", async () => {
    const patch = (ctx: CompanyContext, body: unknown) => {
      signedIn.ctx = ctx;
      return changeLoginRoute(
        new Request(`http://erp.test/api/hr/employees/${env.sumon.id}/portal-access`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ employeeId: env.sumon.id }) },
      );
    };
    expect((await patch(env.hr, { active: false })).status).toBe(403);
    const response = await patch(env.admin, { roleId: env.roles.WAREHOUSE_TEAM });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { email: "sumon@extras.test", active: true, role: { systemRole: "WAREHOUSE_TEAM" } },
    });
  });

  it("gives the profile card and My HR the photo and time here", async () => {
    const before = await screens.getEmployeeScreen(env.viewer, env.sumon.id);
    expect(before.employee).toMatchObject({
      photoId: null,
      tenure: { short: "2 yrs 3 mos", text: "2 years, 3 months and 11 days" },
    });
    const paper = await vault.addEmployeeDocument(
      env.owner,
      env.sumon.id,
      { kind: "PHOTO" },
      { fileName: "face.png", bytes: png({ width: 40, height: 40 }) },
    );
    expect((await screens.getEmployeeScreen(env.viewer, env.sumon.id)).employee.photoId).toBe(
      paper.id,
    );

    // Someone joining later has no time here yet.
    const later = await employees.createEmployee(env.owner, {
      name: "Tania Akter",
      joinDate: "2026-10-22",
      salary: 20000,
    });
    expect((await screens.getEmployeeScreen(env.viewer, later.id)).employee.tenure).toBeNull();

    // My HR: the employee's own photo, time here and full bio.
    const mine = await screens.getMyHrScreen(env.sumonCtx);
    expect(mine.photoId).toBe(paper.id);
    expect(mine.tenure).toBe("2 yrs 3 mos");
    expect(mine.profile).toMatchObject({
      code: before.employee.code,
      designation: "Cutter",
      nid: null,
      bloodGroup: null,
      emergencyContact: null,
    });
  });
});
