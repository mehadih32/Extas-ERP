import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * Who reads tech packs (the list, a tech pack's page, its PDF, measurement
 * sheet and files): everyone who sees production, and the people who approve
 * tech packs or tick their logos, who need the page to do it (v6.4.1 C5).
 * Reading only: changing a tech pack still needs production.manage.
 */
export const TECH_PACK_READ: readonly PermissionKey[] = [
  "production.view",
  "production.techpack.approve",
  "production.logo.approve",
];

/** Whether someone holding these permissions reads tech packs. */
export const readsTechPacks = (can: (permission: PermissionKey) => boolean) =>
  TECH_PACK_READ.some((p) => can(p));
