import type { SystemRole, UserStatus } from "@prisma/client";
import { z } from "zod";

import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { emailSchema } from "@/modules/auth/schemas";
import { revokeAllUserSessions } from "@/modules/auth/session.service";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "@/modules/rbac/permissions";
import { permissionChanges } from "@/modules/rbac/resolve";
import { permissionKeysSchema } from "@/modules/rbac/role.service";
import {
  type Actor,
  assertAllowed,
  canChangeRole,
  canDeactivate,
  canEditMemberPermissions,
  canGrantRole,
  canReactivate,
  canResetPassword,
} from "@/modules/rbac/rules";

export const addMemberSchema = z.object({
  email: emailSchema,
  name: z
    .string()
    .trim()
    .min(2, "Enter their name (at least 2 characters)")
    .max(100, "Use at most 100 characters"),
  phone: z.string().trim().max(30, "Use at most 30 characters").optional(),
  roleId: z.string().min(1, "Choose a role"),
  /** What they may see and do, ticked in the permission matrix; the role's when left out. */
  permissions: permissionKeysSchema.optional(),
});

/** A new role, the permissions ticked in the matrix, or both. */
export const memberAccessSchema = z
  .object({
    roleId: z.string().min(1, "Choose a role").optional(),
    permissions: permissionKeysSchema.optional(),
  })
  .refine((v) => v.roleId !== undefined || v.permissions !== undefined, {
    message: "Choose a role or the permissions.",
  });

const memberInclude = {
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      status: true,
      lastLoginAt: true,
      isSuperAdmin: true,
    },
  },
  role: { select: { id: true, name: true, systemRole: true } },
  permissionChanges: { select: { granted: true, permission: { select: { key: true } } } },
} as const;

type Changes = { added: PermissionKey[]; removed: PermissionKey[] };
const NO_CHANGES: Changes = { added: [], removed: [] };
const AZ = [...ALL_PERMISSION_KEYS].sort();

/** A member's own changes to their role's permissions, A to Z. */
function changesOf(member: {
  permissionChanges: Array<{ granted: boolean; permission: { key: string } }>;
}): Changes {
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const c of member.permissionChanges) (c.granted ? added : removed).add(c.permission.key);
  return {
    added: AZ.filter((key) => added.has(key)),
    removed: AZ.filter((key) => removed.has(key)),
  };
}

const sameChanges = (a: Changes, b: Changes) =>
  a.added.join() === b.added.join() && a.removed.join() === b.removed.join();

const countText = (n: number) => `${n} permission${n === 1 ? "" : "s"}`;

/** "2 permissions added and 1 taken away", or null for none. */
function changesText(changes: Changes): string | null {
  const parts = [
    changes.added.length > 0 && `${countText(changes.added.length)} added`,
    changes.removed.length > 0 &&
      `${changes.added.length > 0 ? changes.removed.length : countText(changes.removed.length)} taken away`,
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : null;
}

/** What a role gives: every permission for Super Admin, else its own list. */
async function roleKeysOf(
  role: { id: string; systemRole: SystemRole | null },
  db: Db = prisma,
): Promise<PermissionKey[]> {
  if (role.systemRole === "SUPER_ADMIN") return [...ALL_PERMISSION_KEYS];
  const rows = await db.rolePermission.findMany({
    where: { roleId: role.id },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((r) => r.permission.key as PermissionKey);
}

/** Replaces a member's own changes (none clears them). */
async function writeChanges(db: Db, membershipId: string, changes: Changes) {
  await db.memberPermission.deleteMany({ where: { membershipId } });
  const keys = [...changes.added, ...changes.removed];
  if (keys.length === 0) return;
  const ids = new Map(
    (
      await db.permission.findMany({
        where: { key: { in: keys } },
        select: { id: true, key: true },
      })
    ).map((p) => [p.key, p.id]),
  );
  if (ids.size !== keys.length) {
    throw new AppError("VALIDATION", "Permissions are out of date. Run the database seed.");
  }
  await db.memberPermission.createMany({
    data: [
      ...changes.added.map((key) => ({ membershipId, permissionId: ids.get(key)!, granted: true })),
      ...changes.removed.map((key) => ({
        membershipId,
        permissionId: ids.get(key)!,
        granted: false,
      })),
    ],
  });
}

/**
 * Changing one member's permissions needs company.roles.manage (it can give
 * anything a role can) and is never for a Super Admin or for oneself.
 */
function assertMayEditPermissions(
  ctx: CompanyContext,
  target: { userId: string; systemRole: SystemRole | null; isPlatformOwner: boolean },
) {
  if (!ctx.can("company.roles.manage")) {
    throw new AppError(
      "FORBIDDEN",
      "Only people who manage roles can change what one person may see and do.",
    );
  }
  assertAllowed(canEditMemberPermissions(actorOf(ctx), target));
}

export async function listMembers(ctx: CompanyContext) {
  return ctx.db.companyMembership.findMany({
    include: memberInclude,
    orderBy: [{ isActive: "desc" }, { user: { name: "asc" } }],
  });
}

/** The person acting, as the member rules (rbac/rules.ts) see them. */
export function actorOf(ctx: CompanyContext): Actor {
  return {
    userId: ctx.user.id,
    systemRole: ctx.role?.systemRole ?? null,
    isPlatformOwner: ctx.user.isSuperAdmin,
  };
}

async function getRoleInCompany(ctx: CompanyContext, roleId: string) {
  const role = await ctx.db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new AppError("NOT_FOUND", "Role not found.");
  return role;
}

async function getMembership(ctx: CompanyContext, membershipId: string) {
  const membership = await ctx.db.companyMembership.findUnique({
    where: { id: membershipId },
    include: memberInclude,
  });
  if (!membership) throw new AppError("NOT_FOUND", "User not found in this company.");
  return membership;
}

/** The company's active Super Admins other than this member (so it never loses its last one). */
export async function otherActiveSuperAdmins(ctx: CompanyContext, membershipId: string) {
  return ctx.db.companyMembership.count({
    where: { id: { not: membershipId }, isActive: true, role: { systemRole: "SUPER_ADMIN" } },
  });
}

/** Whether the user also belongs to another company (a membership there, active or not). */
async function worksElsewhere(ctx: CompanyContext, userId: string) {
  const elsewhere = await prisma.companyMembership.count({
    where: { userId, companyId: { not: ctx.company.id } },
  });
  return elsewhere > 0;
}

/**
 * Adds a user to the active company. A new email creates an invited account with a
 * one-time temporary password, returned once so the admin can hand it over
 * (until email / WhatsApp delivery is built).
 */
export async function addMember(ctx: CompanyContext, rawInput: unknown, meta: RequestMeta = {}) {
  const input = addMemberSchema.parse(rawInput);
  const role = await getRoleInCompany(ctx, input.roleId);
  assertAllowed(canGrantRole(actorOf(ctx), role));

  // Permissions ticked in the matrix: kept as changes to the role's, checked
  // before anyone's account is made.
  const changes = input.permissions
    ? permissionChanges(await roleKeysOf(role), input.permissions)
    : NO_CHANGES;
  const changed = changesText(changes);
  let user = await prisma.user.findUnique({ where: { email: input.email } });
  if (changed) {
    assertMayEditPermissions(ctx, {
      userId: user?.id ?? "",
      systemRole: role.systemRole,
      isPlatformOwner: user?.isSuperAdmin ?? false,
    });
  }

  let temporaryPassword: string | undefined;
  if (!user) {
    temporaryPassword = generateTemporaryPassword();
    user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        phone: input.phone,
        status: "INVITED",
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        lastCompanyId: ctx.company.id,
      },
    });
  }

  const existing = await ctx.db.companyMembership.findUnique({
    where: { companyId_userId: { companyId: ctx.company.id, userId: user.id } },
  });
  if (existing?.isActive) throw new AppError("CONFLICT", "This user is already in the company.");

  const userId = user.id;
  const email = user.email;
  const membership = await prisma.$transaction(async (tx) => {
    const added = existing
      ? await tx.companyMembership.update({
          where: { id: existing.id },
          data: { isActive: true, roleId: role.id },
          select: { id: true },
        })
      : await tx.companyMembership.create({
          data: { companyId: ctx.company.id, userId, roleId: role.id },
          select: { id: true },
        });
    // Someone coming back starts again from the role (and the matrix).
    if (existing || changed) await writeChanges(tx, added.id, changes);
    await recordAudit(
      {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "CREATE",
        entityType: "CompanyMembership",
        entityId: added.id,
        summary: `Added ${email} as ${role.name}${changed ? `, with ${changed}` : ""}`,
        ...(changed ? { after: { roleId: role.id, ...changes } } : {}),
        meta,
      },
      tx,
    );
    return tx.companyMembership.findUniqueOrThrow({
      where: { id: added.id },
      include: memberInclude,
    });
  });
  return { membership, temporaryPassword };
}

export async function changeMemberRole(
  ctx: CompanyContext,
  membershipId: string,
  roleId: string,
  meta: RequestMeta = {},
) {
  const membership = await getMembership(ctx, membershipId);
  const role = await getRoleInCompany(ctx, roleId);
  if (membership.roleId === role.id) return membership;

  const others =
    membership.role.systemRole === "SUPER_ADMIN"
      ? await otherActiveSuperAdmins(ctx, membership.id)
      : 0;
  assertAllowed(canChangeRole(actorOf(ctx), membership.role, role, others));

  // Their own changes were to the old role's permissions: the new role starts clean.
  const before = changesOf(membership);
  return prisma.$transaction(async (tx) => {
    if (changesText(before)) await writeChanges(tx, membership.id, NO_CHANGES);
    const updated = await tx.companyMembership.update({
      where: { id: membership.id },
      data: { roleId: role.id },
      include: memberInclude,
    });
    await recordAudit(
      {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "PERMISSION_CHANGE",
        entityType: "CompanyMembership",
        entityId: membership.id,
        summary: `Changed ${membership.user.email} from ${membership.role.name} to ${role.name}`,
        before: { roleId: membership.roleId, ...(changesText(before) ? before : {}) },
        after: { roleId: role.id },
        meta,
      },
      tx,
    );
    return updated;
  });
}

/**
 * The permission matrix: moves a member to a role, sets what they may see and
 * do beyond (or short of) it, or both at once. The ticked permissions are kept
 * as changes to the role's; ticking exactly the role's clears them. Moving
 * without permissions starts them on the new role's, as changeMemberRole does.
 */
export async function setMemberAccess(
  ctx: CompanyContext,
  membershipId: string,
  rawInput: unknown,
  meta: RequestMeta = {},
) {
  const input = memberAccessSchema.parse(rawInput);
  const membership = await getMembership(ctx, membershipId);
  const role = input.roleId ? await getRoleInCompany(ctx, input.roleId) : membership.role;
  const moving = role.id !== membership.roleId;
  if (moving) {
    const others =
      membership.role.systemRole === "SUPER_ADMIN"
        ? await otherActiveSuperAdmins(ctx, membership.id)
        : 0;
    assertAllowed(canChangeRole(actorOf(ctx), membership.role, role, others));
  }

  const before = changesOf(membership);
  const after = input.permissions
    ? permissionChanges(await roleKeysOf(role), input.permissions)
    : NO_CHANGES;
  const changed = !sameChanges(before, after);
  if (!moving && !changed) return membership;
  // Ticking anything other than the new role's own list is one person's change.
  if (changesText(after) || (!moving && changed)) {
    assertMayEditPermissions(ctx, {
      userId: membership.userId,
      systemRole: role.systemRole,
      isPlatformOwner: membership.user.isSuperAdmin,
    });
  }

  const email = membership.user.email;
  const afterText = changesText(after);
  const summary = moving
    ? `Changed ${email} from ${membership.role.name} to ${role.name}${afterText ? `, with ${afterText}` : ""}`
    : afterText
      ? `Changed ${email}'s permissions: ${afterText} (${role.name})`
      : `Gave ${email} exactly the ${role.name} permissions again`;
  return prisma.$transaction(async (tx) => {
    if (moving) {
      await tx.companyMembership.update({
        where: { id: membership.id },
        data: { roleId: role.id },
      });
    }
    if (changed) await writeChanges(tx, membership.id, after);
    await recordAudit(
      {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "PERMISSION_CHANGE",
        entityType: "CompanyMembership",
        entityId: membership.id,
        summary,
        before: { roleId: membership.roleId, ...before },
        after: { roleId: role.id, ...after },
        meta,
      },
      tx,
    );
    return tx.companyMembership.findUniqueOrThrow({
      where: { id: membership.id },
      include: memberInclude,
    });
  });
}

/**
 * Deactivating removes access to this company immediately (checked on every
 * request); reactivating gives it back in the role the member had.
 */
export async function setMemberActive(
  ctx: CompanyContext,
  membershipId: string,
  isActive: boolean,
  meta: RequestMeta = {},
) {
  const membership = await getMembership(ctx, membershipId);
  if (membership.isActive === isActive) return membership;
  const actor = actorOf(ctx);
  if (isActive) {
    assertAllowed(canReactivate(actor, membership.role));
  } else {
    const others =
      membership.role.systemRole === "SUPER_ADMIN"
        ? await otherActiveSuperAdmins(ctx, membership.id)
        : 0;
    assertAllowed(
      canDeactivate(
        actor,
        { userId: membership.userId, systemRole: membership.role.systemRole },
        others,
      ),
    );
  }

  const updated = await ctx.db.companyMembership.update({
    where: { id: membership.id },
    data: { isActive },
    include: memberInclude,
  });
  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "STATUS_CHANGE",
    entityType: "CompanyMembership",
    entityId: membership.id,
    summary: `${isActive ? "Reactivated" : "Deactivated"} ${membership.user.email}`,
    meta,
  });
  return updated;
}

/**
 * Issues a new temporary password and signs the user out everywhere. A company
 * admin may only reset users who belong to no other company; resetting shared
 * users is reserved for the platform owner, and a Super Admin's password for
 * Super Admins.
 */
export async function resetMemberPassword(
  ctx: CompanyContext,
  membershipId: string,
  meta: RequestMeta = {},
) {
  const membership = await getMembership(ctx, membershipId);
  assertAllowed(
    canResetPassword(actorOf(ctx), {
      userId: membership.userId,
      systemRole: membership.role.systemRole,
      isPlatformOwner: membership.user.isSuperAdmin,
      worksElsewhere: await worksElsewhere(ctx, membership.userId),
    }),
  );

  const temporaryPassword = generateTemporaryPassword();
  await prisma.user.update({
    where: { id: membership.userId },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllUserSessions(membership.userId);
  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "PASSWORD_CHANGE",
    entityType: "User",
    entityId: membership.userId,
    summary: `Reset password for ${membership.user.email}`,
    meta,
  });
  return { temporaryPassword };
}

// --- The Team screen -----------------------------------------------------------

export type TeamRole = {
  id: string;
  name: string;
  description: string | null;
  systemRole: SystemRole | null;
  isSystem: boolean;
  /** What the role gives (every permission for Super Admin), for the permission matrix. */
  permissions: PermissionKey[];
};

export type TeamMember = {
  /** The membership: what the member actions take. */
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** INVITED until the first sign-in with the temporary password. */
  status: UserStatus;
  /** Whether they can open this company (false once deactivated). */
  isActive: boolean;
  role: { id: string; name: string; systemRole: SystemRole | null };
  /** Days in company time ("2026-10-03"). */
  joinedOn: string;
  lastSignedInOn: string | null;
  isYou: boolean;
  isPlatformOwner: boolean;
  /** Their own changes to the role's permissions (the permission matrix), A to Z. */
  permissions: { added: PermissionKey[]; removed: PermissionKey[] };
  /** What the person looking may do to this member (the services' own rules). */
  can: {
    changeRole: boolean;
    /** Tick or untick permissions for them alone (company.roles.manage). */
    editPermissions: boolean;
    deactivate: boolean;
    reactivate: boolean;
    resetPassword: boolean;
  };
  /** The roles they may move this member to. */
  roleChoices: string[];
};

export type Team = {
  members: TeamMember[];
  roles: TeamRole[];
  /** The roles they may give someone they add. */
  grantableRoleIds: string[];
  /** Whether they may tick permissions for one person (company.roles.manage). */
  canEditPermissions: boolean;
};

/**
 * Everyone in the active company with what the person looking may do to each,
 * decided by the same rules the member actions enforce.
 */
export async function listTeam(ctx: CompanyContext): Promise<Team> {
  const [memberships, roleRows] = await Promise.all([
    listMembers(ctx),
    ctx.db.role.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        systemRole: true,
        isSystem: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    }),
  ]);
  const roles: TeamRole[] = roleRows.map(({ permissions, ...role }) => ({
    ...role,
    permissions:
      role.systemRole === "SUPER_ADMIN"
        ? [...ALL_PERMISSION_KEYS]
        : permissions.map((p) => p.permission.key as PermissionKey),
  }));
  const shared = await prisma.companyMembership.findMany({
    where: {
      userId: { in: memberships.map((m) => m.userId) },
      companyId: { not: ctx.company.id },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  const sharedUsers = new Set(shared.map((m) => m.userId));
  const isActiveSuperAdmin = (m: (typeof memberships)[number]) =>
    m.isActive && m.role.systemRole === "SUPER_ADMIN";
  const activeSuperAdmins = memberships.filter(isActiveSuperAdmin).length;
  const actor = actorOf(ctx);
  const timeZone = ctx.company.timezone;
  const canEditPermissions = ctx.can("company.roles.manage");

  const members = memberships.map((m): TeamMember => {
    const others = activeSuperAdmins - (isActiveSuperAdmin(m) ? 1 : 0);
    const target = {
      userId: m.userId,
      systemRole: m.role.systemRole,
      isPlatformOwner: m.user.isSuperAdmin,
      worksElsewhere: sharedUsers.has(m.userId),
    };
    const roleChoices = roles
      .filter((r) => r.id !== m.roleId && canChangeRole(actor, m.role, r, others).ok)
      .map((r) => r.id);
    return {
      id: m.id,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      status: m.user.status,
      isActive: m.isActive,
      role: m.role,
      joinedOn: localDay(m.joinedAt, timeZone),
      lastSignedInOn: m.user.lastLoginAt ? localDay(m.user.lastLoginAt, timeZone) : null,
      isYou: m.userId === ctx.user.id,
      isPlatformOwner: m.user.isSuperAdmin,
      permissions: changesOf(m),
      can: {
        changeRole: roleChoices.length > 0,
        editPermissions: canEditPermissions && canEditMemberPermissions(actor, target).ok,
        deactivate: m.isActive && canDeactivate(actor, target, others).ok,
        reactivate: !m.isActive && canReactivate(actor, target).ok,
        resetPassword: canResetPassword(actor, target).ok,
      },
      roleChoices,
    };
  });
  members.sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );

  return {
    members,
    roles,
    grantableRoleIds: roles.filter((r) => canGrantRole(actor, r).ok).map((r) => r.id),
    canEditPermissions,
  };
}
