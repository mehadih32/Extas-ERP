import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { login } from "@/modules/auth/auth.service";
import {
  addMember,
  changeMemberRole,
  resetMemberPassword,
  setMemberActive,
} from "@/modules/rbac/member.service";
import { createRole, deleteRole, listRoles, updateRole } from "@/modules/rbac/role.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function setup() {
  const extras = await makeCompany("Extras");
  const fabric = await makeCompany("Fabric Apparel");
  const admin = await makeUser("admin@extras.test");
  const adminMembership = await addToCompany(admin.id, extras.company.id, extras.roles.SUPER_ADMIN);
  const ctx = await contextFor(admin.id, extras.company.id);
  return { extras, fabric, admin, adminMembership, ctx };
}

run("tenant isolation", () => {
  beforeEach(resetDb);

  it("hides and protects another company's rows", async () => {
    const { extras, fabric } = await setup();
    const extrasDb = tenantDb(extras.company.id);
    const fabricDb = tenantDb(fabric.company.id);

    const brand = await extrasDb.brand.create({
      data: { name: "Polo Line", companyId: extras.company.id },
    });
    expect(brand.companyId).toBe(extras.company.id);

    expect(await fabricDb.brand.findUnique({ where: { id: brand.id } })).toBeNull();
    expect(await fabricDb.brand.findMany()).toHaveLength(0);
    await expect(
      fabricDb.brand.update({ where: { id: brand.id }, data: { name: "Hijacked" } }),
    ).rejects.toThrow();
    expect((await fabricDb.brand.deleteMany()).count).toBe(0);
    await expect(
      fabricDb.brand.create({ data: { name: "Sneaky", companyId: extras.company.id } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await prisma.brand.findUnique({ where: { id: brand.id } }))?.name).toBe("Polo Line");
  });
});

run("roles", () => {
  beforeEach(resetDb);

  it("lists the five built-in roles with Super Admin holding everything", async () => {
    const { ctx } = await setup();
    const roles = await listRoles(ctx);
    expect(
      roles
        .filter((r) => r.isSystem)
        .map((r) => r.systemRole)
        .sort(),
    ).toEqual([
      "EMPLOYEE",
      "PRODUCTION_MANAGER",
      "SALES_EXECUTIVE",
      "SUPER_ADMIN",
      "WAREHOUSE_TEAM",
    ]);
    expect(roles.find((r) => r.systemRole === "SUPER_ADMIN")!.permissions).toContain(
      "backups.manage",
    );
  });

  it("creates, edits and deletes a custom role, auditing permission changes", async () => {
    const { ctx } = await setup();
    const role = await createRole(ctx, { name: "Accountant", permissions: ["accounts.view"] });
    await updateRole(ctx, role.id, { permissions: ["accounts.view", "accounts.manage"] });

    const listed = (await listRoles(ctx)).find((r) => r.id === role.id)!;
    expect(listed.permissions.sort()).toEqual(["accounts.manage", "accounts.view"]);
    expect(
      await prisma.auditLog.count({ where: { action: "PERMISSION_CHANGE", entityId: role.id } }),
    ).toBe(1);

    await expect(createRole(ctx, { name: "Accountant", permissions: [] })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      createRole(ctx, { name: "Bad", permissions: ["not.a.permission"] }),
    ).rejects.toMatchObject({ name: "ZodError" });

    await deleteRole(ctx, role.id);
    expect(await prisma.role.findUnique({ where: { id: role.id } })).toBeNull();
  });

  it("protects built-in roles and other companies' roles", async () => {
    const { ctx, extras, fabric } = await setup();
    await expect(
      updateRole(ctx, extras.roles.SUPER_ADMIN, { permissions: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteRole(ctx, extras.roles.EMPLOYEE)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      updateRole(ctx, fabric.roles.EMPLOYEE, { permissions: ["backups.manage"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

run("members", () => {
  beforeEach(resetDb);

  it("invites a new user with a temporary password they must change", async () => {
    const { ctx, extras } = await setup();
    const { membership, temporaryPassword } = await addMember(ctx, {
      email: "nazrul@extras.test",
      name: "Nazrul",
      roleId: extras.roles.WAREHOUSE_TEAM,
    });
    expect(membership.role.systemRole).toBe("WAREHOUSE_TEAM");
    expect(temporaryPassword).toBeTruthy();

    const result = await login({ email: "nazrul@extras.test", password: temporaryPassword! });
    expect(result.user.mustChangePassword).toBe(true);
    expect(result.user.status).toBe("ACTIVE");
    expect(result.activeCompanyId).toBe(extras.company.id);
  });

  it("cannot assign a role from another company", async () => {
    const { ctx, fabric } = await setup();
    await expect(
      addMember(ctx, { email: "x@extras.test", name: "Xavier", roleId: fabric.roles.EMPLOYEE }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps at least one active Super Admin", async () => {
    const { ctx, extras, adminMembership } = await setup();
    await expect(
      changeMemberRole(ctx, adminMembership.id, extras.roles.EMPLOYEE),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setMemberActive(ctx, adminMembership.id, false)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("only Super Admins can grant Super Admin", async () => {
    const { extras } = await setup();
    const manager = await makeUser("hr@extras.test");
    const managerRole = await prisma.role.create({
      data: {
        companyId: extras.company.id,
        name: "HR Manager",
        permissions: {
          create: [{ permission: { connect: { key: "company.members.manage" } } }],
        },
      },
    });
    await addToCompany(manager.id, extras.company.id, managerRole.id);
    const hrCtx = await contextFor(manager.id, extras.company.id);
    expect(hrCtx.can("company.members.manage")).toBe(true);
    expect(hrCtx.can("company.roles.manage")).toBe(false);

    await expect(
      addMember(hrCtx, {
        email: "boss@extras.test",
        name: "Boss",
        roleId: extras.roles.SUPER_ADMIN,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deactivating a member removes their access immediately", async () => {
    const { ctx, extras } = await setup();
    const { membership } = await addMember(ctx, {
      email: "temp@extras.test",
      name: "Temp",
      roleId: extras.roles.EMPLOYEE,
    });
    await setMemberActive(ctx, membership.id, false);
    const { activeCompanyId } = await login({
      email: "temp@extras.test",
      password: (await resetMemberPassword(ctx, membership.id)).temporaryPassword,
    });
    expect(activeCompanyId).toBeNull();
  });

  it("company admins cannot reset users who also work in another company", async () => {
    const { ctx, extras, fabric } = await setup();
    const shared = await makeUser("shared@extras.test");
    const m = await addToCompany(shared.id, extras.company.id, extras.roles.EMPLOYEE);
    await addToCompany(shared.id, fabric.company.id, fabric.roles.EMPLOYEE);
    await expect(resetMemberPassword(ctx, m.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
