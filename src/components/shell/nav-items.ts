import { LayoutDashboardIcon, type LucideIcon } from "lucide-react";

import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * The app's sections, in menu order. Each module's screens add their entry here
 * with the permissions that open them (the same keys their Server Actions check).
 */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown to people holding any of these permissions; to everyone when empty. */
  anyOf: readonly PermissionKey[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon, anyOf: [] },
];

/** The sections this person may open in the active company. */
export function visibleNavItems(permissions: readonly string[]): NavItem[] {
  const held = new Set(permissions);
  return NAV_ITEMS.filter((item) => item.anyOf.length === 0 || item.anyOf.some((p) => held.has(p)));
}

/** Whether a menu entry is the current section ("/sales" also covers "/sales/123"). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
