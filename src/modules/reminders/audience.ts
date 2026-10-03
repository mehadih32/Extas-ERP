import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import type { PermissionKey } from "@/modules/rbac/permissions";
import { resolvePermissions } from "@/modules/rbac/resolve";

/*
 * Who can be told in the app: the active members of a company (a user who can
 * sign in, with an active membership) and what their role lets them do. Staff
 * are reached through the login linked to their employee profile; staff without
 * one are kept as recipients for WhatsApp and email, which come later.
 */

export type Member = { userId: string; name: string; permissions: Set<PermissionKey> };

export async function activeMembers(companyId: string, db: Db = prisma): Promise<Member[]> {
  const memberships = await db.companyMembership.findMany({
    where: { companyId, isActive: true, user: { status: { not: "SUSPENDED" } } },
    select: {
      user: { select: { id: true, name: true, isSuperAdmin: true } },
      role: {
        select: {
          systemRole: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });
  return memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    permissions: resolvePermissions({
      isPlatformSuperAdmin: m.user.isSuperAdmin,
      systemRole: m.role.systemRole,
      grantedKeys: m.role.permissions.map((p) => p.permission.key),
    }),
  }));
}

/** Members holding any of the permissions. */
export function membersWith(members: Member[], permissions: readonly PermissionKey[]): string[] {
  return members.filter((m) => permissions.some((p) => m.permissions.has(p))).map((m) => m.userId);
}

/** Current employees and the logins linked to them (null when they have none). */
export async function staffLogins(
  companyId: string,
  employeeIds: readonly string[],
  db: Db = prisma,
): Promise<Map<string, { name: string; userId: string | null }>> {
  if (employeeIds.length === 0) return new Map();
  const staff = await db.employee.findMany({
    where: { companyId, id: { in: [...employeeIds] }, status: { in: ["ACTIVE", "ON_LEAVE"] } },
    select: { id: true, name: true, userId: true },
  });
  return new Map(staff.map((e) => [e.id, { name: e.name, userId: e.userId }]));
}

/**
 * The in-app recipients for a set of users and staff: each user once, members of
 * the company only. A staff member's login gets the message with their employee id.
 */
export function inAppRecipients(
  members: Member[],
  userIds: Iterable<string>,
  staff: Iterable<{ employeeId: string; userId: string | null }>,
): Array<{ userId: string; employeeId: string | null }> {
  const active = new Set(members.map((m) => m.userId));
  const result = new Map<string, string | null>();
  for (const s of staff) {
    if (s.userId && active.has(s.userId)) result.set(s.userId, s.employeeId);
  }
  for (const userId of userIds) {
    if (active.has(userId) && !result.has(userId)) result.set(userId, null);
  }
  return [...result].map(([userId, employeeId]) => ({ userId, employeeId }));
}

/** Whether a user is an active member who can sign in to the company. */
export async function isActiveMember(
  companyId: string,
  userId: string,
  db: Db = prisma,
): Promise<boolean> {
  const membership = await db.companyMembership.findFirst({
    where: { companyId, userId, isActive: true, user: { status: { not: "SUSPENDED" } } },
    select: { id: true },
  });
  return membership !== null;
}
