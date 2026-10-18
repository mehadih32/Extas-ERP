import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * The permission matrix (Settings > Team): one person can be given more or less
 * than their role, and that is what every request then allows them, what the
 * menus show them and who reminders and petty cash count them as. Only people
 * who manage roles may tick the boxes, never for a Super Admin or themselves;
 * a new role starts from that role's permissions.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  return {
    ...real,
    requirePermission: async (...keys: string[]) => {
      const ctx = signedIn.ctx as import("@/modules/auth/context").CompanyContext;
      if (keys.some((k) => !ctx.permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx;
    },
  };
});

import { PATCH as memberRoute } from "@/app/api/members/[membershipId]/route";
import { visibleNavItems } from "@/components/shell/nav-items";
import { prisma } from "@/lib/prisma";
import { getPettyCashForm } from "@/modules/accounts/petty-cash.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  addMember,
  changeMemberRole,
  listTeam,
  setMemberAccess,
  setMemberActive,
} from "@/modules/rbac/member.service";
import { DEFAULT_ROLE_PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";
import { createRole, deleteRole, getRolesScreen, updateRole } from "@/modules/rbac/role.service";
import {
  HELD_ROLE,
  OWN_ROLE,
  SUPER_ADMIN_GRANTS_KEYS,
  SUPER_ADMIN_GRANTS_ROLE,
  SUPER_ADMIN_REACTIVATES,
} from "@/modules/rbac/rules";
import { activeMembers, membersWith } from "@/modules/reminders/audience";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const SALES = DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE;
const EMPLOYEE = DEFAULT_ROLE_PERMISSIONS.EMPLOYEE;
/** A Sales Executive who may not raise orders but may look at the licences. */
const SALES_TWEAKED: PermissionKey[] = [
  ...SALES.filter((k) => k !== "sales.order.create"),
  "compliance.view",
];

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const fabric = await makeCompany("Fabric Apparel");
  const join = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    const membership = await addToCompany(user.id, company.id, roleId);
    return { user, membership };
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const ownerCtx = await contextFor(owner.user.id, company.id);
  const peopleAdmin = await createRole(ownerCtx, {
    name: "People Admin",
    permissions: ["dashboard.view", "company.members.manage", "company.roles.manage"],
  });
  const teamKeeper = await createRole(ownerCtx, {
    name: "Team Keeper",
    permissions: ["company.members.manage"],
  });
  const admin = await join(peopleAdmin.id, "admin");
  const keeper = await join(teamKeeper.id, "keeper");
  const sales = await join(roles.SALES_EXECUTIVE, "sales");
  const store = await join(roles.WAREHOUSE_TEAM, "store");
  const staff = await join(roles.EMPLOYEE, "staff");
  const outsiderUser = await makeUser("fabric@extras.test");
  const outsider = await addToCompany(outsiderUser.id, fabric.company.id, fabric.roles.EMPLOYEE);
  return {
    company,
    roles,
    owner,
    ownerCtx,
    admin,
    adminCtx: await contextFor(admin.user.id, company.id),
    keeperCtx: await contextFor(keeper.user.id, company.id),
    sales,
    store,
    staff,
    outsider,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** "+compliance.view", "-sales.order.create": the stored changes, A to Z. */
async function changesOf(membershipId: string) {
  const rows = await prisma.memberPermission.findMany({
    where: { membershipId },
    select: { granted: true, permission: { select: { key: true } } },
  });
  return rows.map((r) => `${r.granted ? "+" : "-"}${r.permission.key}`).sort();
}

const lastAudit = () =>
  prisma.auditLog.findFirstOrThrow({
    where: { entityType: "CompanyMembership" },
    orderBy: { createdAt: "desc" },
  });

const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return { code: (error as { code?: string }).code, message: (error as Error).message };
  }
  throw new Error("Expected a refusal");
};

run("the permission matrix", () => {
  let env: Env;
  let ctxOf: (userId: string) => Promise<CompanyContext>;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
    ctxOf = (userId) => contextFor(userId, env.company.id);
  }, 30_000);

  it("gives one person more or less than their role, on every request", async () => {
    const before = await ctxOf(env.sales.user.id);
    expect(before.can("sales.order.create")).toBe(true);
    expect(before.can("compliance.view")).toBe(false);
    expect(visibleNavItems([...before.permissions]).map((i) => i.href)).not.toContain(
      "/compliance",
    );

    await setMemberAccess(env.adminCtx, env.sales.membership.id, { permissions: SALES_TWEAKED });
    expect(await changesOf(env.sales.membership.id)).toEqual([
      "+compliance.view",
      "-sales.order.create",
    ]);
    const after = await ctxOf(env.sales.user.id);
    expect(after.role?.name).toBe("Sales Executive");
    expect(after.can("sales.order.create")).toBe(false);
    expect(after.can("sales.view")).toBe(true);
    expect(after.can("compliance.view")).toBe(true);
    // The menu follows: what is unticked is hidden, what is ticked shows.
    expect(visibleNavItems([...after.permissions]).map((i) => i.href)).toContain("/compliance");

    const audit = await lastAudit();
    expect(audit).toMatchObject({
      action: "PERMISSION_CHANGE",
      userId: env.admin.user.id,
      summary:
        "Changed sales@extras.test's permissions: 1 permission added and 1 taken away (Sales Executive)",
      before: { roleId: env.roles.SALES_EXECUTIVE, added: [], removed: [] },
      after: {
        roleId: env.roles.SALES_EXECUTIVE,
        added: ["compliance.view"],
        removed: ["sales.order.create"],
      },
    });

    // The same boxes again change nothing and record nothing.
    const audits = await prisma.auditLog.count();
    await setMemberAccess(env.adminCtx, env.sales.membership.id, { permissions: SALES_TWEAKED });
    expect(await prisma.auditLog.count()).toBe(audits);

    // The team screen shows the changes; each role brings its own list for the matrix.
    const team = await listTeam(env.adminCtx);
    const row = team.members.find((m) => m.email === "sales@extras.test")!;
    expect(row.permissions).toEqual({
      added: ["compliance.view"],
      removed: ["sales.order.create"],
    });
    expect(row.can.editPermissions).toBe(true);
    expect(team.canEditPermissions).toBe(true);
    expect(
      new Set(team.roles.find((r) => r.id === env.roles.SALES_EXECUTIVE)!.permissions),
    ).toEqual(new Set(SALES));
    expect(team.roles.find((r) => r.id === env.roles.SUPER_ADMIN)!.permissions).toHaveLength(
      DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN.length,
    );

    // Reminders count them by what they may do now.
    const members = await activeMembers(env.company.id);
    expect(membersWith(members, ["sales.order.create"])).not.toContain(env.sales.user.id);
    expect(membersWith(members, ["compliance.view"])).toContain(env.sales.user.id);

    // Ticking exactly the role's list clears the changes.
    await setMemberAccess(env.adminCtx, env.sales.membership.id, { permissions: [...SALES] });
    expect(await changesOf(env.sales.membership.id)).toEqual([]);
    expect((await lastAudit()).summary).toBe(
      "Gave sales@extras.test exactly the Sales Executive permissions again",
    );
    expect((await ctxOf(env.sales.user.id)).can("sales.order.create")).toBe(true);
  });

  it("moves someone with the matrix, and a new role starts from its own permissions", async () => {
    await setMemberAccess(env.adminCtx, env.store.membership.id, {
      roleId: env.roles.SALES_EXECUTIVE,
      permissions: [...SALES, "reports.export"],
    });
    const moved = await ctxOf(env.store.user.id);
    expect(moved.role?.id).toBe(env.roles.SALES_EXECUTIVE);
    expect(moved.can("reports.export")).toBe(true);
    expect(await changesOf(env.store.membership.id)).toEqual(["+reports.export"]);
    expect((await lastAudit()).summary).toBe(
      "Changed store@extras.test from Warehouse Team to Sales Executive, with 1 permission added",
    );

    // Moving with the role alone (someone who manages users but not roles may).
    await setMemberAccess(env.keeperCtx, env.store.membership.id, {
      roleId: env.roles.WAREHOUSE_TEAM,
    });
    expect(await changesOf(env.store.membership.id)).toEqual([]);
    expect((await ctxOf(env.store.user.id)).can("reports.export")).toBe(false);

    // Settings > Team's plain Change role and HR's role change start clean too.
    await setMemberAccess(env.adminCtx, env.store.membership.id, {
      permissions: [...DEFAULT_ROLE_PERMISSIONS.WAREHOUSE_TEAM, "reports.export"],
    });
    await changeMemberRole(env.keeperCtx, env.store.membership.id, env.roles.EMPLOYEE);
    expect(await changesOf(env.store.membership.id)).toEqual([]);
    expect((await lastAudit()).before).toMatchObject({ added: ["reports.export"], removed: [] });
  });

  it("keeps the boxes to people who manage roles, never for a Super Admin or oneself", async () => {
    // Managing users alone moves roles but does not tick boxes.
    expect(
      await refusal(
        setMemberAccess(env.keeperCtx, env.sales.membership.id, { permissions: SALES_TWEAKED }),
      ),
    ).toEqual({
      code: "FORBIDDEN",
      message: "Only people who manage roles can change what one person may see and do.",
    });
    // Saving the role's own list is no change, so it goes through.
    await setMemberAccess(env.keeperCtx, env.sales.membership.id, { permissions: [...SALES] });

    expect(
      await refusal(
        setMemberAccess(env.adminCtx, env.owner.membership.id, { permissions: ["dashboard.view"] }),
      ),
    ).toEqual({ code: "FORBIDDEN", message: "A Super Admin always has every permission." });
    expect(
      await refusal(
        setMemberAccess(env.adminCtx, env.admin.membership.id, {
          permissions: [
            "dashboard.view",
            "company.members.manage",
            "company.roles.manage",
            "audit.view",
          ],
        }),
      ),
    ).toEqual({
      code: "CONFLICT",
      message: "You cannot change your own permissions. Ask another admin.",
    });
    // Only a Super Admin gives the Super Admin role, with or without boxes.
    expect(
      (
        await refusal(
          setMemberAccess(env.adminCtx, env.sales.membership.id, {
            roleId: env.roles.SUPER_ADMIN,
            permissions: [...SALES],
          }),
        )
      ).code,
    ).toBe("FORBIDDEN");
    // The owner may change the admin's boxes.
    await setMemberAccess(env.ownerCtx, env.admin.membership.id, {
      permissions: [
        "dashboard.view",
        "company.members.manage",
        "company.roles.manage",
        "audit.view",
      ],
    });
    expect((await ctxOf(env.admin.user.id)).can("audit.view")).toBe(true);

    await expect(
      setMemberAccess(env.adminCtx, env.sales.membership.id, { permissions: ["sales.fly"] }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(setMemberAccess(env.adminCtx, env.sales.membership.id, {})).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(
      (await refusal(setMemberAccess(env.adminCtx, env.outsider.id, { permissions: [] }))).code,
    ).toBe("NOT_FOUND");
    expect(await changesOf(env.sales.membership.id)).toEqual([]);
  });

  it("adds a person with the boxes ticked for them", async () => {
    const wanted: PermissionKey[] = [
      ...EMPLOYEE.filter((k) => k !== "expenses.create"),
      "reports.export",
    ];
    const { membership } = await addMember(env.adminCtx, {
      email: "new@extras.test",
      name: "New Person",
      roleId: env.roles.EMPLOYEE,
      permissions: wanted,
    });
    expect(await changesOf(membership.id)).toEqual(["+reports.export", "-expenses.create"]);
    expect((await lastAudit()).summary).toBe(
      "Added new@extras.test as Employee, with 1 permission added and 1 taken away",
    );

    // Someone who only manages users adds people with the role's own boxes.
    expect(
      (
        await refusal(
          addMember(env.keeperCtx, {
            email: "other@extras.test",
            name: "Other Person",
            roleId: env.roles.EMPLOYEE,
            permissions: wanted,
          }),
        )
      ).code,
    ).toBe("FORBIDDEN");
    expect(await prisma.user.count({ where: { email: "other@extras.test" } })).toBe(0);
    const plain = await addMember(env.keeperCtx, {
      email: "other@extras.test",
      name: "Other Person",
      roleId: env.roles.EMPLOYEE,
      permissions: [...EMPLOYEE],
    });
    expect(await changesOf(plain.membership.id)).toEqual([]);
  });

  it("counts petty cash holders by what they may do now", async () => {
    const holders = async () =>
      (await getPettyCashForm(env.ownerCtx)).holders.map((h) => h.email).sort();
    expect(await holders()).toContain("staff@extras.test");
    expect(await holders()).not.toContain("store@extras.test");

    await setMemberAccess(env.adminCtx, env.staff.membership.id, {
      permissions: EMPLOYEE.filter((k) => k !== "expenses.create"),
    });
    await setMemberAccess(env.adminCtx, env.store.membership.id, {
      permissions: [...DEFAULT_ROLE_PERMISSIONS.WAREHOUSE_TEAM, "expenses.create"],
    });
    expect(await holders()).not.toContain("staff@extras.test");
    expect(await holders()).toContain("store@extras.test");
  });

  it("saves the boxes through the API for people who manage users and roles", async () => {
    const patch = (permissions: string[]) =>
      memberRoute(
        new Request(`http://localhost/api/members/${env.sales.membership.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ permissions }),
        }),
        { params: Promise.resolve({ membershipId: env.sales.membership.id }) },
      );

    signedIn.ctx = env.keeperCtx;
    expect((await patch(SALES_TWEAKED)).status).toBe(403);
    expect(await changesOf(env.sales.membership.id)).toEqual([]);

    signedIn.ctx = env.adminCtx;
    const saved = await patch(SALES_TWEAKED);
    expect(saved.status).toBe(200);
    expect(await changesOf(env.sales.membership.id)).toEqual([
      "+compliance.view",
      "-sales.order.create",
    ]);

    // A person outside both: the route refuses before anything is read.
    signedIn.ctx = await ctxOf(env.sales.user.id);
    expect((await patch([...SALES])).status).toBe(403);
  });

  it("never lets anyone change their own role, and leaves money and team rights to a Super Admin (v6.4.1)", async () => {
    const keeperMembership = await prisma.companyMembership.findFirstOrThrow({
      where: { userId: env.keeperCtx.user.id },
    });
    const own = { code: "CONFLICT", message: OWN_ROLE };
    const roleRefused = { code: "FORBIDDEN", message: SUPER_ADMIN_GRANTS_ROLE };
    const keysRefused = { code: "FORBIDDEN", message: SUPER_ADMIN_GRANTS_KEYS };

    // Someone who manages the team cannot move themselves, to Accounts or anywhere.
    for (const roleId of [env.roles.ACCOUNTS, env.roles.SALES_EXECUTIVE]) {
      expect(await refusal(changeMemberRole(env.keeperCtx, keeperMembership.id, roleId))).toEqual(
        own,
      );
      expect(
        await refusal(setMemberAccess(env.keeperCtx, keeperMembership.id, { roleId })),
      ).toEqual(own);
    }
    // Through the API too.
    signedIn.ctx = env.keeperCtx;
    const moved = await memberRoute(
      new Request(`http://localhost/api/members/${keeperMembership.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: env.roles.ACCOUNTS }),
      }),
      { params: Promise.resolve({ membershipId: keeperMembership.id }) },
    );
    expect(moved.status).toBe(409);
    const keeperNow = await ctxOf(env.keeperCtx.user.id);
    expect(keeperNow.can("accounts.receipts.record")).toBe(false);
    // The Super Admin cannot change their own role either.
    expect(
      await refusal(
        changeMemberRole(env.ownerCtx, env.owner.membership.id, env.roles.SALES_EXECUTIVE),
      ),
    ).toEqual(own);

    // Giving someone else a role that records money or manages the team or roles.
    const teamKeeper = await prisma.role.findFirstOrThrow({ where: { name: "Team Keeper" } });
    for (const roleId of [env.roles.ACCOUNTS, teamKeeper.id]) {
      expect(
        await refusal(changeMemberRole(env.keeperCtx, env.sales.membership.id, roleId)),
      ).toEqual(roleRefused);
      expect(
        await refusal(
          addMember(env.keeperCtx, { email: "new@extras.test", name: "New Person", roleId }),
        ),
      ).toEqual(roleRefused);
    }
    expect(await prisma.user.count({ where: { email: "new@extras.test" } })).toBe(0);
    // Other roles are still theirs to give.
    await changeMemberRole(env.keeperCtx, env.sales.membership.id, env.roles.WAREHOUSE_TEAM);
    // A Super Admin gives Accounts as before.
    await changeMemberRole(env.ownerCtx, env.sales.membership.id, env.roles.ACCOUNTS);
    await changeMemberRole(env.ownerCtx, env.sales.membership.id, env.roles.SALES_EXECUTIVE);

    // Ticked for one person by someone who manages roles but is not a Super Admin.
    expect(
      await refusal(
        setMemberAccess(env.adminCtx, env.sales.membership.id, {
          permissions: [...SALES, "accounts.receipts.record"],
        }),
      ),
    ).toEqual(keysRefused);
    expect(
      await refusal(
        addMember(env.adminCtx, {
          email: "new@extras.test",
          name: "New Person",
          roleId: env.roles.SALES_EXECUTIVE,
          permissions: [...SALES, "company.members.manage"],
        }),
      ),
    ).toEqual(keysRefused);
    // Given by the Super Admin, it may stay while the admin changes other boxes.
    await setMemberAccess(env.ownerCtx, env.sales.membership.id, {
      permissions: [...SALES, "accounts.receipts.record"],
    });
    await setMemberAccess(env.adminCtx, env.sales.membership.id, {
      permissions: [...SALES_TWEAKED, "accounts.receipts.record"],
    });
    expect(await changesOf(env.sales.membership.id)).toEqual([
      "+accounts.receipts.record",
      "+compliance.view",
      "-sales.order.create",
    ]);

    // Added to a role (everyone in it would get it): a Super Admin's too.
    expect(
      await refusal(
        updateRole(env.adminCtx, teamKeeper.id, {
          permissions: ["company.members.manage", "accounts.payments.record"],
        }),
      ),
    ).toEqual(keysRefused);
    expect(
      await refusal(
        createRole(env.adminCtx, { name: "Cashier", permissions: ["accounts.receipts.record"] }),
      ),
    ).toEqual(keysRefused);
    // Keys the role holds already may stay, and others may be added.
    await updateRole(env.adminCtx, teamKeeper.id, {
      permissions: ["company.members.manage", "notepad.use"],
    });
    await updateRole(env.ownerCtx, teamKeeper.id, {
      permissions: ["company.members.manage", "accounts.payments.record"],
    });

    // The screen locks exactly these boxes for people who are not Super Admins.
    expect((await listTeam(env.adminCtx)).lockedPermissions).toEqual([
      "accounts.receipts.record",
      "accounts.payments.record",
      "company.members.manage",
      "company.roles.manage",
    ]);
    expect((await listTeam(env.ownerCtx)).lockedPermissions).toEqual([]);
  });

  it("does not let anyone but a Super Admin change or delete a role they hold (v6.4.1)", async () => {
    const held = { code: "FORBIDDEN", message: HELD_ROLE };
    expect(HELD_ROLE).toBe("You cannot change a role you hold. Ask another admin.");
    const peopleAdmin = await prisma.role.findFirstOrThrow({ where: { name: "People Admin" } });
    const teamKeeper = await prisma.role.findFirstOrThrow({ where: { name: "Team Keeper" } });

    // The People Admin holds "People Admin": no new key (of any kind), name or description.
    for (const input of [
      {
        permissions: [
          "dashboard.view",
          "company.members.manage",
          "company.roles.manage",
          "sales.view",
        ],
      },
      { permissions: ["dashboard.view"] },
      { name: "People Boss" },
      { description: "Runs everything" },
    ]) {
      expect(await refusal(updateRole(env.adminCtx, peopleAdmin.id, input))).toEqual(held);
    }
    expect(await refusal(deleteRole(env.adminCtx, peopleAdmin.id))).toEqual(held);
    const unchanged = await prisma.role.findUniqueOrThrow({
      where: { id: peopleAdmin.id },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    expect(unchanged.name).toBe("People Admin");
    expect(unchanged.permissions.map((p) => p.permission.key).sort()).toEqual([
      "company.members.manage",
      "company.roles.manage",
      "dashboard.view",
    ]);
    // Through the API too.
    signedIn.ctx = env.adminCtx;
    const { PATCH: rolePatch } = await import("@/app/api/roles/[roleId]/route");
    const patched = await rolePatch(
      new Request(`http://localhost/api/roles/${peopleAdmin.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissions: ["dashboard.view", "sales.view"] }),
      }),
      { params: Promise.resolve({ roleId: peopleAdmin.id }) },
    );
    expect(patched.status).toBe(403);

    // Other roles stay theirs to change.
    await updateRole(env.adminCtx, teamKeeper.id, {
      permissions: ["company.members.manage", "sales.view"],
    });
    // A new role cannot then be given to themselves (the own-role rule).
    const made = await createRole(env.adminCtx, { name: "Self Made", permissions: ["sales.view"] });
    const adminMembership = await prisma.companyMembership.findFirstOrThrow({
      where: { userId: env.admin.user.id },
    });
    expect(await refusal(changeMemberRole(env.adminCtx, adminMembership.id, made.id))).toEqual({
      code: "CONFLICT",
      message: OWN_ROLE,
    });
    expect(
      await refusal(setMemberAccess(env.adminCtx, adminMembership.id, { roleId: made.id })),
    ).toEqual({ code: "CONFLICT", message: OWN_ROLE });

    // The Roles screen offers nothing on their own role, and says why.
    const screen = await getRolesScreen(env.adminCtx);
    const own = screen.roles.find((r) => r.id === peopleAdmin.id)!;
    expect(own).toMatchObject({
      heldByYou: true,
      can: { edit: false, rename: false, delete: false },
    });
    expect(screen.roles.find((r) => r.id === teamKeeper.id)).toMatchObject({
      heldByYou: false,
      can: { edit: true, rename: true },
    });

    // A Super Admin keeps full rights over other roles, and the Super Admin role
    // is refused as before.
    await updateRole(env.ownerCtx, peopleAdmin.id, {
      name: "People Lead",
      permissions: ["dashboard.view", "company.members.manage", "sales.view"],
    });
    expect(
      await refusal(updateRole(env.ownerCtx, env.roles.SUPER_ADMIN, { permissions: [] })),
    ).toEqual({ code: "FORBIDDEN", message: "The Super Admin role always has every permission." });
    const ownerScreen = await getRolesScreen(env.ownerCtx);
    expect(ownerScreen.roles.find((r) => r.id === peopleAdmin.id)).toMatchObject({
      heldByYou: false,
      can: { edit: true },
    });
    expect(ownerScreen.roles.find((r) => r.id === env.roles.SUPER_ADMIN)).toMatchObject({
      heldByYou: true,
      can: { edit: false, delete: false },
    });
  });

  it("leaves switching someone back on who records money or manages the team to a Super Admin (v6.4.1 review 4)", async () => {
    const refused = { code: "FORBIDDEN", message: SUPER_ADMIN_REACTIVATES };
    const join = async (roleId: string, who: string) =>
      addToCompany((await makeUser(`${who}@extras.test`)).id, env.company.id, roleId);
    const accountant = await join(env.roles.ACCOUNTS, "acct");
    const keeper2 = await join(
      (await prisma.role.findFirstOrThrow({ where: { name: "Team Keeper" } })).id,
      "keeper2",
    );
    // A Sales Executive given the right to record receipts on their own.
    await setMemberAccess(env.ownerCtx, env.sales.membership.id, {
      permissions: [...SALES, "accounts.receipts.record"],
    });
    // An accountant whose money rights were taken away is an ordinary member again.
    const trimmed = await join(env.roles.ACCOUNTS, "trimmed");
    await setMemberAccess(env.ownerCtx, trimmed.id, {
      permissions: DEFAULT_ROLE_PERMISSIONS.ACCOUNTS.filter(
        (k) => k !== "accounts.receipts.record" && k !== "accounts.payments.record",
      ),
    });
    const people = [accountant, keeper2, env.sales.membership, trimmed];
    for (const m of people) await setMemberActive(env.ownerCtx, m.id, false);

    // Adding the accountant again is refused for the team keeper; so is switching them back on.
    expect(
      await refusal(
        addMember(env.keeperCtx, {
          email: "acct@extras.test",
          name: "Acct",
          roleId: env.roles.ACCOUNTS,
        }),
      ),
    ).toEqual({ code: "FORBIDDEN", message: SUPER_ADMIN_GRANTS_ROLE });
    for (const m of [accountant, keeper2, env.sales.membership]) {
      expect(await refusal(setMemberActive(env.keeperCtx, m.id, true))).toEqual(refused);
      expect(
        (await prisma.companyMembership.findUniqueOrThrow({ where: { id: m.id } })).isActive,
      ).toBe(false);
    }
    // The Team screen does not offer it either; the trimmed accountant it does.
    const team = await listTeam(env.keeperCtx);
    const offered = (id: string) => team.members.find((m) => m.id === id)!.can.reactivate;
    expect(people.map((m) => offered(m.id))).toEqual([false, false, false, true]);
    await setMemberActive(env.keeperCtx, trimmed.id, true);
    // A Super Admin may switch them all back on.
    for (const m of [accountant, keeper2, env.sales.membership]) {
      expect((await setMemberActive(env.ownerCtx, m.id, true)).isActive).toBe(true);
    }
  });
});
