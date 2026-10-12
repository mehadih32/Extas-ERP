import type { SystemRole } from "@prisma/client";

import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  type PermissionKey,
} from "@/modules/rbac/permissions";

/** One person's change to their role's permissions (the MemberPermission table). */
export type PermissionChange = { key: string; granted: boolean };

/**
 * Effective permissions for a user inside one company.
 * Platform super admins and the company's Super Admin role get everything;
 * everyone else gets what their role grants, with their own changes on top:
 * a permission added for them, or one of the role's taken away.
 */
export function resolvePermissions(input: {
  isPlatformSuperAdmin: boolean;
  systemRole: SystemRole | null;
  grantedKeys: readonly string[];
  changes?: readonly PermissionChange[];
}): Set<PermissionKey> {
  if (input.isPlatformSuperAdmin || input.systemRole === "SUPER_ADMIN") {
    return new Set(ALL_PERMISSION_KEYS);
  }
  const keys = new Set(input.grantedKeys.filter(isPermissionKey));
  for (const change of input.changes ?? []) {
    if (!isPermissionKey(change.key)) continue;
    if (change.granted) keys.add(change.key);
    else keys.delete(change.key);
  }
  return keys;
}

/** The changes that turn a role's permissions into the ones wanted for one person, A to Z. */
export function permissionChanges(
  roleKeys: Iterable<string>,
  wanted: Iterable<string>,
): { added: PermissionKey[]; removed: PermissionKey[] } {
  const role = new Set(roleKeys);
  const want = new Set(wanted);
  const az = [...ALL_PERMISSION_KEYS].sort();
  return {
    added: az.filter((key) => want.has(key) && !role.has(key)),
    removed: az.filter((key) => role.has(key) && !want.has(key)),
  };
}
