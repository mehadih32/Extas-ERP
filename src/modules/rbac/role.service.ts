import { SystemRole } from "@prisma/client";
import { z } from "zod";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type PermissionKey,
  SYSTEM_ROLE_NAMES,
  isPermissionKey,
} from "@/modules/rbac/permissions";
import { assertAllowed, canDeleteRole, canEditRole, canRenameRole } from "@/modules/rbac/rules";

const permissionKeysSchema = z
  .array(z.string())
  .max(PERMISSIONS.length)
  .refine((keys) => keys.every(isPermissionKey), { message: "Unknown permission" })
  .transform((keys) => [...new Set(keys)]);

const roleName = z
  .string()
  .trim()
  .min(2, "Give the role a name of at least 2 characters")
  .max(60, "Use at most 60 characters");
const roleDescription = z.string().trim().max(300, "Use at most 300 characters");

export const createRoleSchema = z.object({
  name: roleName,
  description: roleDescription.optional(),
  permissions: permissionKeysSchema,
});

export const updateRoleSchema = z.object({
  name: roleName.optional(),
  description: roleDescription.nullable().optional(),
  permissions: permissionKeysSchema.optional(),
});

/** Upserts the code permission catalogue into the Permission table and drops removed keys. */
export async function syncPermissionCatalog(db: Db = prisma): Promise<void> {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, module: p.module, description: p.description },
      update: { module: p.module, description: p.description },
    });
  }
  await db.permission.deleteMany({ where: { key: { notIn: PERMISSIONS.map((p) => p.key) } } });
}

/**
 * Makes sure a company has the built-in roles (the five from the blueprint plus
 * Accounts). New roles get the default grants; existing roles keep whatever an
 * admin configured.
 */
export async function ensureSystemRoles(companyId: string, db: Db = prisma) {
  const permissionIds = new Map(
    (await db.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
  );
  const roles: Record<SystemRole, string> = {} as Record<SystemRole, string>;

  for (const systemRole of Object.values(SystemRole)) {
    const existing = await db.role.findFirst({ where: { companyId, systemRole } });
    if (existing) {
      roles[systemRole] = existing.id;
      continue;
    }
    // A custom role with the same name (e.g. an "Accounts" role made by hand before
    // it became built-in) is adopted as it is, keeping its permissions.
    const sameName = await db.role.findFirst({
      where: { companyId, name: SYSTEM_ROLE_NAMES[systemRole], systemRole: null },
    });
    if (sameName) {
      await db.role.update({ where: { id: sameName.id }, data: { systemRole, isSystem: true } });
      roles[systemRole] = sameName.id;
      continue;
    }
    const created = await db.role.create({
      data: {
        companyId,
        name: SYSTEM_ROLE_NAMES[systemRole],
        systemRole,
        isSystem: true,
        permissions: {
          create: DEFAULT_ROLE_PERMISSIONS[systemRole]
            .map((key) => permissionIds.get(key))
            .filter((id): id is string => Boolean(id))
            .map((permissionId) => ({ permissionId })),
        },
      },
    });
    roles[systemRole] = created.id;
  }
  return roles;
}

/**
 * Roles of the active company with their permission keys, their active members
 * (memberCount) and all their members including deactivated ones (membershipCount,
 * which keeps a role from being deleted).
 */
export async function listRoles(ctx: CompanyContext) {
  const roles = await ctx.db.role.findMany({
    include: {
      permissions: { select: { permission: { select: { key: true } } } },
      memberships: { select: { isActive: true } },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    systemRole: r.systemRole,
    isSystem: r.isSystem,
    memberCount: r.memberships.filter((m) => m.isActive).length,
    membershipCount: r.memberships.length,
    permissions:
      r.systemRole === "SUPER_ADMIN"
        ? PERMISSIONS.map((p) => p.key)
        : r.permissions.map((rp) => rp.permission.key as PermissionKey),
  }));
}

export type RoleSummary = Awaited<ReturnType<typeof listRoles>>[number] & {
  /** What the person looking may do to the role (nothing without company.roles.manage). */
  can: { edit: boolean; rename: boolean; delete: boolean };
};

/**
 * The Roles screen: every role with what the person looking may do to it, by the
 * same rules updateRole and deleteRole enforce. Changing roles needs
 * company.roles.manage (`canManage`); people who only manage members see the
 * roles to know what each one gives.
 */
export async function getRolesScreen(
  ctx: CompanyContext,
): Promise<{ roles: RoleSummary[]; canManage: boolean }> {
  const canManage = ctx.can("company.roles.manage");
  const roles = (await listRoles(ctx)).map((role) => {
    const edit = canManage && canEditRole(role).ok;
    return {
      ...role,
      can: {
        edit,
        rename: edit && canRenameRole(role).ok,
        delete: canManage && canDeleteRole(role, role.membershipCount).ok,
      },
    };
  });
  return { roles, canManage };
}

/** The permission catalogue grouped for a role editor. */
export function listPermissionCatalog() {
  return PERMISSIONS.map((p) => ({ ...p }));
}

async function permissionIdsFor(keys: string[], db: Db) {
  const rows = await db.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  if (rows.length !== keys.length) {
    throw new AppError("VALIDATION", "Permissions are out of date. Run the database seed.");
  }
  return rows.map((r) => r.id);
}

export async function createRole(ctx: CompanyContext, rawInput: unknown, meta: RequestMeta = {}) {
  const input = createRoleSchema.parse(rawInput);
  const duplicate = await ctx.db.role.findFirst({ where: { name: input.name } });
  if (duplicate) throw new AppError("CONFLICT", "A role with this name already exists.");

  const ids = await permissionIdsFor(input.permissions, prisma);
  const role = await ctx.db.role.create({
    data: {
      name: input.name,
      description: input.description,
      company: { connect: { id: ctx.company.id } },
      permissions: { create: ids.map((permissionId) => ({ permissionId })) },
    },
  });
  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "CREATE",
    entityType: "Role",
    entityId: role.id,
    summary: `Created role "${role.name}"`,
    after: { name: role.name, permissions: input.permissions },
    meta,
  });
  return role;
}

export async function updateRole(
  ctx: CompanyContext,
  roleId: string,
  rawInput: unknown,
  meta: RequestMeta = {},
) {
  const input = updateRoleSchema.parse(rawInput);
  const role = await ctx.db.role.findUnique({
    where: { id: roleId },
    include: { permissions: { select: { permission: { select: { key: true } } } } },
  });
  if (!role) throw new AppError("NOT_FOUND", "Role not found.");
  assertAllowed(canEditRole(role));
  if (input.name && input.name !== role.name) {
    assertAllowed(canRenameRole(role));
    const duplicate = await ctx.db.role.findFirst({
      where: { name: input.name, id: { not: role.id } },
    });
    if (duplicate) throw new AppError("CONFLICT", "A role with this name already exists.");
  }

  const beforeKeys = role.permissions.map((rp) => rp.permission.key).sort();
  await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id: role.id },
      data: { name: input.name, description: input.description },
    });
    if (input.permissions) {
      const ids = await permissionIdsFor(input.permissions, tx);
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
    await recordAudit(
      {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: input.permissions ? "PERMISSION_CHANGE" : "UPDATE",
        entityType: "Role",
        entityId: role.id,
        summary: `Updated role "${input.name ?? role.name}"`,
        before: { name: role.name, permissions: beforeKeys },
        after: {
          name: input.name ?? role.name,
          permissions: input.permissions?.sort() ?? beforeKeys,
        },
        meta,
      },
      tx,
    );
  });
}

export async function deleteRole(ctx: CompanyContext, roleId: string, meta: RequestMeta = {}) {
  const role = await ctx.db.role.findUnique({
    where: { id: roleId },
    include: { _count: { select: { memberships: true } } },
  });
  if (!role) throw new AppError("NOT_FOUND", "Role not found.");
  assertAllowed(canDeleteRole(role, role._count.memberships));
  await ctx.db.role.delete({ where: { id: role.id } });
  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "DELETE",
    entityType: "Role",
    entityId: role.id,
    summary: `Deleted role "${role.name}"`,
    meta,
  });
}
