"use client";

import { AccessTree } from "@/components/settings/roles/access-tree-view";
import { PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";

export const PERMISSION_TOTAL = PERMISSIONS.length;

/**
 * The full disclosure permission matrix: every permission in the app as a tree,
 * Main area > sub-area > action (e.g. Production > Bookings > Add bookings >
 * Ready stock). Ticked is what the person may see and use; anything left
 * unticked is hidden from them. Ticking an area gives all of it, and opening it
 * lets someone tick only part. Each line says when it differs from their role's
 * ("Added" or "Taken away"). Without `onChange` it only shows.
 */
export function PermissionMatrix({
  roleName,
  roleKeys,
  selected,
  onChange,
}: {
  roleName: string;
  roleKeys: ReadonlySet<PermissionKey>;
  selected: ReadonlySet<PermissionKey>;
  onChange?: (next: Set<PermissionKey>) => void;
}) {
  return (
    <AccessTree
      selected={selected}
      onChange={onChange}
      baseline={roleKeys}
      label={`Permissions (${roleName})`}
      scroll
    />
  );
}
