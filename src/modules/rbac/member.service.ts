import { z } from "zod";

import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { emailSchema } from "@/modules/auth/schemas";
import { revokeAllUserSessions } from "@/modules/auth/session.service";

export const addMemberSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional(),
  roleId: z.string().min(1),
});

const memberInclude = {
  user: {
    select: { id: true, email: true, name: true, phone: true, status: true, lastLoginAt: true },
  },
  role: { select: { id: true, name: true, systemRole: true } },
} as const;

export async function listMembers(ctx: CompanyContext) {
  return ctx.db.companyMembership.findMany({
    include: memberInclude,
    orderBy: [{ isActive: "desc" }, { user: { name: "asc" } }],
  });
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

/** Blocks changes that would leave a company without an active Super Admin. */
async function assertNotLastSuperAdmin(ctx: CompanyContext, membershipId: string) {
  const others = await ctx.db.companyMembership.count({
    where: { id: { not: membershipId }, isActive: true, role: { systemRole: "SUPER_ADMIN" } },
  });
  if (others === 0) {
    throw new AppError("CONFLICT", "The company must keep at least one active Super Admin.");
  }
}

/**
 * Adds a user to the active company. A new email creates an invited account with a
 * one-time temporary password, returned once so the admin can hand it over
 * (until email / WhatsApp delivery is built).
 */
export async function addMember(ctx: CompanyContext, rawInput: unknown, meta: RequestMeta = {}) {
  const input = addMemberSchema.parse(rawInput);
  const role = await getRoleInCompany(ctx, input.roleId);
  if (
    role.systemRole === "SUPER_ADMIN" &&
    ctx.role?.systemRole !== "SUPER_ADMIN" &&
    !ctx.user.isSuperAdmin
  ) {
    throw new AppError("FORBIDDEN", "Only a Super Admin can grant the Super Admin role.");
  }

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

  const isPrivileged = ctx.role?.systemRole === "SUPER_ADMIN" || ctx.user.isSuperAdmin;
  if (
    (role.systemRole === "SUPER_ADMIN" || membership.role.systemRole === "SUPER_ADMIN") &&
    !isPrivileged
  ) {
    throw new AppError("FORBIDDEN", "Only a Super Admin can grant or remove the Super Admin role.");
  }
  if (membership.role.systemRole === "SUPER_ADMIN")
    await assertNotLastSuperAdmin(ctx, membership.id);

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

/** Deactivating removes access to this company immediately (checked on every request). */
export async function setMemberActive(
  ctx: CompanyContext,
  membershipId: string,
  isActive: boolean,
  meta: RequestMeta = {},
) {
  const membership = await getMembership(ctx, membershipId);
  if (membership.isActive === isActive) return membership;
  if (!isActive) {
    if (membership.userId === ctx.user.id) {
      throw new AppError("CONFLICT", "You cannot deactivate your own access.");
    }
    if (membership.role.systemRole === "SUPER_ADMIN") {
      if (ctx.role?.systemRole !== "SUPER_ADMIN" && !ctx.user.isSuperAdmin) {
        throw new AppError("FORBIDDEN", "Only a Super Admin can deactivate a Super Admin.");
      }
      await assertNotLastSuperAdmin(ctx, membership.id);
    }
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
 * Issues a new temporary password. A company admin may only reset users who belong
 * to no other company; resetting shared users is reserved for the platform owner.
 */
export async function resetMemberPassword(
  ctx: CompanyContext,
  membershipId: string,
  meta: RequestMeta = {},
) {
  const membership = await getMembership(ctx, membershipId);
  if (membership.userId === ctx.user.id) {
    throw new AppError("CONFLICT", "Use Change Password for your own account.");
  }
  if (!ctx.user.isSuperAdmin) {
    const otherCompanies = await prisma.companyMembership.count({
      where: { userId: membership.userId, companyId: { not: ctx.company.id } },
    });
    if (otherCompanies > 0) {
      throw new AppError(
        "FORBIDDEN",
        "This user also works in another company. Ask the platform owner.",
      );
    }
    const target = await prisma.user.findUnique({ where: { id: membership.userId } });
    if (target?.isSuperAdmin)
      throw new AppError("FORBIDDEN", "You cannot reset the platform owner.");
  }

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
