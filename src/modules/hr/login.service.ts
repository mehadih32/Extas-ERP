import type { SystemRole } from "@prisma/client";

import { localDay, localTime } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import { canGivePortalLogin, canRemovePortalLogin } from "@/modules/hr/rules";
import { loginChangeSchema } from "@/modules/hr/schemas";
import {
  actorOf,
  changeMemberRole,
  lockedPermissionsFor,
  otherActiveSuperAdmins,
  setMemberActive,
} from "@/modules/rbac/member.service";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "@/modules/rbac/permissions";
import {
  canChangeRole,
  canDeactivate,
  canEditMemberPermissions,
  canGrantRole,
  canReactivate,
} from "@/modules/rbac/rules";

/*
 * The System access card on an employee's profile: the login linked to them,
 * the role it works in, whether it is on and when it last signed in. HR
 * (hr.manage) gives and removes the login; people who manage the company's
 * users (company.members.manage) also choose its role and switch it off or on,
 * under the same rules as Settings > Team (only a Super Admin touches Super
 * Admins, the company keeps an active Super Admin, nobody switches themselves
 * off).
 */

type Subject = { id: string; name: string; userId: string | null; exitDate: string | null };

const roleSelect = { id: true, name: true, systemRole: true } as const;

async function membershipOf(ctx: CompanyContext, userId: string) {
  return ctx.db.companyMembership.findFirst({
    where: { userId },
    include: {
      user: { select: { email: true, status: true, lastLoginAt: true, isSuperAdmin: true } },
      role: { select: roleSelect },
      permissionChanges: { select: { granted: true, permission: { select: { key: true } } } },
    },
  });
}

const AZ = [...ALL_PERMISSION_KEYS].sort();

/** What the card shows and offers, or null for people who neither run HR nor manage users. */
export async function getSystemAccess(ctx: CompanyContext, employee: Subject) {
  const manageHr = ctx.can("hr.manage");
  const manageUsers = ctx.can("company.members.manage");
  if (!manageHr && !manageUsers) return null;
  const actor = actorOf(ctx);
  const [membership, roles] = await Promise.all([
    employee.userId ? membershipOf(ctx, employee.userId) : null,
    manageUsers
      ? ctx.db.role
          .findMany({
            select: {
              ...roleSelect,
              permissions: { select: { permission: { select: { key: true } } } },
            },
            orderBy: [{ isSystem: "desc" }, { name: "asc" }],
          })
          .then((rows) =>
            rows.map(({ permissions, ...r }) => ({
              ...r,
              /** What the role gives, for the permission matrix. */
              permissions:
                r.systemRole === "SUPER_ADMIN"
                  ? [...ALL_PERMISSION_KEYS]
                  : permissions.map((p) => p.permission.key as PermissionKey),
            })),
          )
      : [],
  ]);
  const others =
    membership?.role.systemRole === "SUPER_ADMIN"
      ? await otherActiveSuperAdmins(ctx, membership.id)
      : 0;
  const subject = {
    name: employee.name,
    userId: employee.userId,
    exitDate: employee.exitDate,
    loginEmail: membership?.user.email,
  };
  const grantable = roles.filter((r) => canGrantRole(actor, r).ok);
  const target = membership
    ? { userId: membership.userId, systemRole: membership.role.systemRole }
    : null;
  const changed = (granted: boolean) => {
    const keys = new Set(
      membership?.permissionChanges
        .filter((c) => c.granted === granted)
        .map((c) => c.permission.key),
    );
    return AZ.filter((key) => keys.has(key));
  };
  return {
    login: membership
      ? {
          /** The membership: what the permission matrix changes. */
          id: membership.id,
          isYou: membership.userId === ctx.user.id,
          /** Their own changes to the role's permissions, A to Z. */
          permissions: { added: changed(true), removed: changed(false) },
          email: membership.user.email,
          /** On for this company (Settings > Team can switch it off too). */
          active: membership.isActive,
          /** Never signed in yet: still on the temporary password. */
          invited: membership.user.status === "INVITED",
          role: membership.role,
          /** The day and time (company time) it last signed in, or null if never. */
          lastSignIn: membership.user.lastLoginAt
            ? {
                day: localDay(membership.user.lastLoginAt, ctx.company.timezone),
                time: localTime(membership.user.lastLoginAt, ctx.company.timezone),
              }
            : null,
        }
      : null,
    /** Permissions they may not tick for someone who does not hold them yet (Super Admin only). */
    lockedPermissions: lockedPermissionsFor(ctx),
    /** Roles this person may give: for a new login, or to move the login to. */
    roles: membership
      ? grantable.filter(
          (r) => r.id === membership.roleId || canChangeRole(actor, target!, r, others).ok,
        )
      : grantable,
    can: {
      /** Not for someone leaving or gone (as before on the profile). */
      give: manageHr && !employee.exitDate && canGivePortalLogin(subject).ok,
      /** Choose the role of a new login (otherwise it gets the Employee role). */
      chooseRole: manageUsers && grantable.length > 0,
      changeRole:
        manageUsers &&
        membership !== null &&
        membership.isActive &&
        grantable.some(
          (r) => r.id !== membership.roleId && canChangeRole(actor, target!, r, others).ok,
        ),
      switchOff:
        manageUsers && membership?.isActive === true && canDeactivate(actor, target!, others).ok,
      switchOn:
        manageUsers &&
        membership?.isActive === false &&
        canReactivate(actor, { systemRole: membership.role.systemRole }).ok,
      remove: manageHr && canRemovePortalLogin(subject).ok,
      /** Tick or untick permissions for this login alone (people who manage roles too). */
      editPermissions:
        manageUsers &&
        ctx.can("company.roles.manage") &&
        (membership
          ? canEditMemberPermissions(actor, {
              userId: membership.userId,
              systemRole: membership.role.systemRole,
              isPlatformOwner: membership.user.isSuperAdmin,
            }).ok
          : true),
    },
  };
}

export type SystemAccess = NonNullable<Awaited<ReturnType<typeof getSystemAccess>>>;

/**
 * Moves an employee's login to another role, or switches it off or on for
 * this company (company.members.manage), as Settings > Team does.
 */
export async function changeEmployeeLogin(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!ctx.can("company.members.manage")) {
    throw new AppError("FORBIDDEN", "Only people who manage users can change a login.");
  }
  const input = loginChangeSchema.parse(raw);
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true, name: true, userId: true },
  });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const membership = employee.userId ? await membershipOf(ctx, employee.userId) : null;
  if (!membership) throw new AppError("CONFLICT", `${employee.name} has no login yet.`);
  if (input.roleId) {
    if (!membership.isActive) {
      throw new AppError("CONFLICT", "Switch the login on before changing its role.");
    }
    const updated = await changeMemberRole(ctx, membership.id, input.roleId, meta);
    return { email: membership.user.email, role: updated.role as RoleRef, active: true };
  }
  const updated = await setMemberActive(ctx, membership.id, input.active!, meta);
  return { email: membership.user.email, role: updated.role as RoleRef, active: updated.isActive };
}

type RoleRef = { id: string; name: string; systemRole: SystemRole | null };
