import type { SystemRole, UserStatus } from "@prisma/client";
import { z } from "zod";

import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { emailSchema } from "@/modules/auth/schemas";
import { revokeAllUserSessions } from "@/modules/auth/session.service";
import {
  type Actor,
  assertAllowed,
  canChangeRole,
  canDeactivate,
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
} as const;

export async function listMembers(ctx: CompanyContext) {
  return ctx.db.companyMembership.findMany({
    include: memberInclude,
    orderBy: [{ isActive: "desc" }, { user: { name: "asc" } }],
  });
}

/** The person acting, as the member rules (rbac/rules.ts) see them. */
function actorOf(ctx: CompanyContext): Actor {
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
async function otherActiveSuperAdmins(ctx: CompanyContext, membershipId: string) {
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

  let temporaryPassword: string | undefined;
  let user = await prisma.user.findUnique({ where: { email: input.email } });
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

  const membership = existing
    ? await ctx.db.companyMembership.update({
        where: { id: existing.id },
        data: { isActive: true, roleId: role.id },
        include: memberInclude,
      })
    : await ctx.db.companyMembership.create({
        data: { companyId: ctx.company.id, userId: user.id, roleId: role.id },
        include: memberInclude,
      });

  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "CREATE",
    entityType: "CompanyMembership",
    entityId: membership.id,
    summary: `Added ${user.email} as ${role.name}`,
    meta,
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

  const updated = await ctx.db.companyMembership.update({
    where: { id: membership.id },
    data: { roleId: role.id },
    include: memberInclude,
  });
  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "PERMISSION_CHANGE",
    entityType: "CompanyMembership",
    entityId: membership.id,
    summary: `Changed ${membership.user.email} from ${membership.role.name} to ${role.name}`,
    before: { roleId: membership.roleId },
    after: { roleId: role.id },
    meta,
  });
  return updated;
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
  /** What the person looking may do to this member (the services' own rules). */
  can: { changeRole: boolean; deactivate: boolean; reactivate: boolean; resetPassword: boolean };
  /** The roles they may move this member to. */
  roleChoices: string[];
};

export type Team = {
  members: TeamMember[];
  roles: TeamRole[];
  /** The roles they may give someone they add. */
  grantableRoleIds: string[];
};

/**
 * Everyone in the active company with what the person looking may do to each,
 * decided by the same rules the member actions enforce.
 */
export async function listTeam(ctx: CompanyContext): Promise<Team> {
  const [memberships, roles] = await Promise.all([
    listMembers(ctx),
    ctx.db.role.findMany({
      select: { id: true, name: true, description: true, systemRole: true, isSystem: true },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    }),
  ]);
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
      can: {
        changeRole: roleChoices.length > 0,
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
  };
}
