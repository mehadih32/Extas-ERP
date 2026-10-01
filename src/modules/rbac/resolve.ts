import type { SystemRole } from "@prisma/client";

import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  type PermissionKey,
} from "@/modules/rbac/permissions";

/**
 * Effective permissions for a user inside one company.
 * Platform super admins and the company's Super Admin role get everything;
 * everyone else gets exactly what their role grants.
 */
export function resolvePermissions(input: {
  isPlatformSuperAdmin: boolean;
  systemRole: SystemRole | null;
  grantedKeys: readonly string[];
}): Set<PermissionKey> {
  if (input.isPlatformSuperAdmin || input.systemRole === "SUPER_ADMIN") {
    return new Set(ALL_PERMISSION_KEYS);
  }
  return new Set(input.grantedKeys.filter(isPermissionKey));
}
