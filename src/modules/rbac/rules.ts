import type { SystemRole } from "@prisma/client";

import { AppError } from "@/lib/errors";

/*
 * Who may do what to the company's members and roles. The member and role
 * services refuse with these answers, and the Team and Roles screens use the
 * same answers to decide which actions a person is offered, so the screens can
 * never show a button the server would refuse (or hide one it would allow).
 * Holding company.members.manage / company.roles.manage is checked before these.
 */

export type Verdict = { ok: true } | { ok: false; code: "FORBIDDEN" | "CONFLICT"; message: string };

const ALLOWED: Verdict = { ok: true };

function refuse(code: "FORBIDDEN" | "CONFLICT", message: string): Verdict {
  return { ok: false, code, message };
}

/** Throws the refusal as the AppError the API and Server Actions report. */
export function assertAllowed(verdict: Verdict): void {
  if (!verdict.ok) throw new AppError(verdict.code, verdict.message);
}

/** The person acting: their role in the open company and whether they own the platform. */
export type Actor = {
  userId: string;
  systemRole: SystemRole | null;
  isPlatformOwner: boolean;
};

type HasSystemRole = { systemRole: SystemRole | null };

const isSuperAdmin = (role: HasSystemRole) => role.systemRole === "SUPER_ADMIN";

/** The company's Super Admins and the platform owner: the only ones who may touch Super Admins. */
export function isPrivileged(actor: Pick<Actor, "systemRole" | "isPlatformOwner">): boolean {
  return isSuperAdmin(actor) || actor.isPlatformOwner;
}

export const LAST_SUPER_ADMIN = "The company must keep at least one active Super Admin.";

// --- Members -------------------------------------------------------------------

/** Giving a role to someone being added to the company. */
export function canGrantRole(actor: Actor, role: HasSystemRole): Verdict {
  if (isSuperAdmin(role) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can grant the Super Admin role.");
  }
  return ALLOWED;
}

/**
 * Moving a member (`target` is their current role) to `role`.
 * `otherActiveSuperAdmins` counts the company's active Super Admins besides the
 * member, and only matters when the member is a Super Admin.
 */
export function canChangeRole(
  actor: Actor,
  target: HasSystemRole,
  role: HasSystemRole,
  otherActiveSuperAdmins: number,
): Verdict {
  if ((isSuperAdmin(role) || isSuperAdmin(target)) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can grant or remove the Super Admin role.");
  }
  if (isSuperAdmin(target) && otherActiveSuperAdmins === 0) {
    return refuse("CONFLICT", LAST_SUPER_ADMIN);
  }
  return ALLOWED;
}

/** Taking away a member's access to the company. */
export function canDeactivate(
  actor: Actor,
  target: HasSystemRole & { userId: string },
  otherActiveSuperAdmins: number,
): Verdict {
  if (target.userId === actor.userId) {
    return refuse("CONFLICT", "You cannot deactivate your own access.");
  }
  if (isSuperAdmin(target)) {
    if (!isPrivileged(actor)) {
      return refuse("FORBIDDEN", "Only a Super Admin can deactivate a Super Admin.");
    }
    if (otherActiveSuperAdmins === 0) return refuse("CONFLICT", LAST_SUPER_ADMIN);
  }
  return ALLOWED;
}

/** Giving a deactivated member their access back, in the role they had. */
export function canReactivate(actor: Actor, target: HasSystemRole): Verdict {
  if (isSuperAdmin(target) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can reactivate a Super Admin.");
  }
  return ALLOWED;
}

/**
 * Issuing a new temporary password. A company admin may only reset people who
 * work in no other company; the platform owner may reset anyone else.
 */
export function canResetPassword(
  actor: Actor,
  target: HasSystemRole & { userId: string; isPlatformOwner: boolean; worksElsewhere: boolean },
): Verdict {
  if (target.userId === actor.userId) {
    return refuse("CONFLICT", "Use Change Password for your own account.");
  }
  if (isSuperAdmin(target) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can reset a Super Admin's password.");
  }
  if (!actor.isPlatformOwner) {
    if (target.isPlatformOwner) {
      return refuse("FORBIDDEN", "You cannot reset the platform owner.");
    }
    if (target.worksElsewhere) {
      return refuse(
        "FORBIDDEN",
        "This user also works in another company. Ask the platform owner.",
      );
    }
  }
  return ALLOWED;
}

// --- Roles ---------------------------------------------------------------------

type RoleFacts = HasSystemRole & { isSystem: boolean };

/** Changing a role's permissions or description. */
export function canEditRole(role: HasSystemRole): Verdict {
  if (isSuperAdmin(role)) {
    return refuse("FORBIDDEN", "The Super Admin role always has every permission.");
  }
  return ALLOWED;
}

/** Giving a role a new name. */
export function canRenameRole(role: RoleFacts): Verdict {
  if (role.isSystem) return refuse("FORBIDDEN", "Built-in roles cannot be renamed.");
  return ALLOWED;
}

/** Deleting a role; `membershipCount` includes deactivated members, who keep their role. */
export function canDeleteRole(role: RoleFacts, membershipCount: number): Verdict {
  if (role.isSystem) return refuse("FORBIDDEN", "Built-in roles cannot be deleted.");
  if (membershipCount > 0) {
    return refuse("CONFLICT", "Move the users in this role to another role first.");
  }
  return ALLOWED;
}
