import type { SystemRole } from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";

export { assertAllowed, type Verdict } from "@/lib/verdict";

/*
 * Who may do what to the company's members and roles. The member and role
 * services refuse with these answers, and the Team and Roles screens use the
 * same answers to decide which actions a person is offered, so the screens can
 * never show a button the server would refuse (or hide one it would allow).
 * Holding company.members.manage / company.roles.manage is checked before these.
 */

/** The person acting: their role in the open company and whether they own the platform. */
export type Actor = {
  userId: string;
  systemRole: SystemRole | null;
  isPlatformOwner: boolean;
  /** The role they hold in the open company (none for the platform owner visiting it). */
  roleId?: string | null;
};

/** The person acting, as these rules see them. */
export function actorOf(ctx: CompanyContext): Actor {
  return {
    userId: ctx.user.id,
    systemRole: ctx.role?.systemRole ?? null,
    isPlatformOwner: ctx.user.isSuperAdmin,
    roleId: ctx.role?.id ?? null,
  };
}

type HasSystemRole = { systemRole: SystemRole | null };

const isSuperAdmin = (role: HasSystemRole) => role.systemRole === "SUPER_ADMIN";

/** The company's Super Admins and the platform owner: the only ones who may touch Super Admins. */
export function isPrivileged(actor: Pick<Actor, "systemRole" | "isPlatformOwner">): boolean {
  return isSuperAdmin(actor) || actor.isPlatformOwner;
}

export const LAST_SUPER_ADMIN = "The company must keep at least one active Super Admin.";

/**
 * What only a Super Admin may give, in a role or to one person: recording money
 * received or paid (CLAUDE.md: only Accounts and Super Admin), and managing
 * users or roles (which could give the rest).
 */
export const SUPER_ADMIN_GRANTS: readonly PermissionKey[] = [
  "accounts.receipts.record",
  "accounts.payments.record",
  "company.members.manage",
  "company.roles.manage",
];

export const SUPER_ADMIN_GRANTS_ROLE =
  "Only a Super Admin can give a role that records money or manages users or roles. Ask a Super Admin.";
export const SUPER_ADMIN_GRANTS_KEYS =
  "Only a Super Admin can give the right to record money or to manage users or roles. Ask a Super Admin.";
export const OWN_ROLE = "You cannot change your own role. Ask another admin.";
export const SUPER_ADMIN_REACTIVATES =
  "Only a Super Admin can switch this person back on, because they can record money or manage users or roles. Ask a Super Admin.";
export const SUPER_ADMIN_RESETS =
  "Only a Super Admin can reset the password of someone who can record money or manage users or roles. Ask a Super Admin.";

/**
 * What a member may see and do: their role's permissions with their own
 * changes (a tick adds a permission, an untick takes it away).
 */
export function heldKeys(
  roleKeys: Iterable<string>,
  changes: ReadonlyArray<{ granted: boolean; permission: { key: string } }>,
): Set<string> {
  const held = new Set<string>(roleKeys);
  for (const c of changes) {
    if (c.granted) held.add(c.permission.key);
    else held.delete(c.permission.key);
  }
  return held;
}

/** Among these permissions, the ones only a Super Admin may give. */
export function superAdminGrantsIn(keys: Iterable<string>): string[] {
  return [...keys].filter((key) => (SUPER_ADMIN_GRANTS as readonly string[]).includes(key));
}

/**
 * The permissions the person acting may not give someone who does not hold
 * them yet, nor add to a role: SUPER_ADMIN_GRANTS, or none for a Super Admin.
 * The screens lock these boxes.
 */
export function lockedPermissionsFor(ctx: CompanyContext): PermissionKey[] {
  return isPrivileged(actorOf(ctx)) ? [] : [...SUPER_ADMIN_GRANTS];
}

/** A role being given: its built-in kind and the permissions it holds. */
type GivenRole = HasSystemRole & { permissions: readonly string[] };

// --- Members -------------------------------------------------------------------

/** Giving a role to someone being added to the company. */
export function canGrantRole(actor: Actor, role: GivenRole): Verdict {
  if (isSuperAdmin(role) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can grant the Super Admin role.");
  }
  return canGiveRoleKeys(actor, role);
}

/** A role holding money recording or user / role management: only a Super Admin gives it. */
function canGiveRoleKeys(actor: Actor, role: GivenRole): Verdict {
  if (!isPrivileged(actor) && superAdminGrantsIn(role.permissions).length > 0) {
    return refuse("FORBIDDEN", SUPER_ADMIN_GRANTS_ROLE);
  }
  return ALLOWED;
}

/**
 * Giving these permissions on their own: ticked for one person, or added to a
 * role (which gives them to everyone in it).
 */
export function canGivePermissions(actor: Actor, keys: Iterable<string>): Verdict {
  if (!isPrivileged(actor) && superAdminGrantsIn(keys).length > 0) {
    return refuse("FORBIDDEN", SUPER_ADMIN_GRANTS_KEYS);
  }
  return ALLOWED;
}

/**
 * Moving a member (`target`: who they are and their current role) to `role`.
 * Never one's own role. `otherActiveSuperAdmins` counts the company's active
 * Super Admins besides the member, and only matters when the member is a
 * Super Admin.
 */
export function canChangeRole(
  actor: Actor,
  target: HasSystemRole & { userId: string },
  role: GivenRole,
  otherActiveSuperAdmins: number,
): Verdict {
  if (target.userId === actor.userId) return refuse("CONFLICT", OWN_ROLE);
  if ((isSuperAdmin(role) || isSuperAdmin(target)) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can grant or remove the Super Admin role.");
  }
  if (isSuperAdmin(target) && otherActiveSuperAdmins === 0) {
    return refuse("CONFLICT", LAST_SUPER_ADMIN);
  }
  return canGiveRoleKeys(actor, role);
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

/**
 * Giving a deactivated member their access back, in the role and with the
 * permissions they had (`heldKeys`: the role's with their own changes). That
 * gives those rights back, so someone who records money or manages users or
 * roles is switched on only by a Super Admin, as only a Super Admin gives
 * those rights.
 */
export function canReactivate(
  actor: Actor,
  target: HasSystemRole & { heldKeys: Iterable<string> },
): Verdict {
  if (isSuperAdmin(target) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can reactivate a Super Admin.");
  }
  if (!isPrivileged(actor) && superAdminGrantsIn(target.heldKeys).length > 0) {
    return refuse("FORBIDDEN", SUPER_ADMIN_REACTIVATES);
  }
  return ALLOWED;
}

/**
 * Issuing a new temporary password (which also ends any wait on their
 * sign-in). A company admin may only reset people who work in no other
 * company; the platform owner may reset anyone else. Whoever resets a password
 * can sign in as that person, so someone who records money or manages users or
 * roles (`heldKeys`: their role's permissions with their own changes) is reset
 * only by a Super Admin, as for switching them back on (canReactivate).
 */
export function canResetPassword(
  actor: Actor,
  target: HasSystemRole & {
    userId: string;
    isPlatformOwner: boolean;
    worksElsewhere: boolean;
    heldKeys: Iterable<string>;
  },
): Verdict {
  if (target.userId === actor.userId) {
    return refuse("CONFLICT", "Use Change Password for your own account.");
  }
  if (isSuperAdmin(target) && !isPrivileged(actor)) {
    return refuse("FORBIDDEN", "Only a Super Admin can reset a Super Admin's password.");
  }
  if (!isPrivileged(actor) && superAdminGrantsIn(target.heldKeys).length > 0) {
    return refuse("FORBIDDEN", SUPER_ADMIN_RESETS);
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

/**
 * Ticking or unticking permissions for one member (the permission matrix), on
 * top of the role they hold or are moving to (`target.systemRole`). Holding
 * company.roles.manage is checked before this, as for editing a role.
 */
export function canEditMemberPermissions(
  actor: Actor,
  target: HasSystemRole & { userId: string; isPlatformOwner: boolean },
): Verdict {
  if (isSuperAdmin(target) || target.isPlatformOwner) {
    return refuse("FORBIDDEN", "A Super Admin always has every permission.");
  }
  if (target.userId === actor.userId) {
    return refuse("CONFLICT", "You cannot change your own permissions. Ask another admin.");
  }
  return ALLOWED;
}

// --- Roles ---------------------------------------------------------------------

type RoleFacts = HasSystemRole & { isSystem: boolean };

export const HELD_ROLE = "You cannot change a role you hold. Ask another admin.";

/**
 * Changing, renaming or deleting a role at all: never the role one holds,
 * unless one is a Super Admin (else someone who manages roles could give
 * themselves anything through it). Checked before the rules below.
 */
export function canChangeHeldRole(actor: Actor, role: { id: string }): Verdict {
  if (!isPrivileged(actor) && actor.roleId === role.id) return refuse("FORBIDDEN", HELD_ROLE);
  return ALLOWED;
}

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
