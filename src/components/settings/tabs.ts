import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type SettingsTab = { href: string; label: string; anyOf: readonly PermissionKey[] };

/*
 * The settings area's tabs, shown to the people their Server Actions let in:
 * the team needs company.members.manage; the roles can be read with either team
 * permission (changing them needs company.roles.manage); the company details can
 * be read by everyone in the company (changing them needs company.settings);
 * everyone chooses their own look (Appearance).
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { href: "/settings/team", label: "Team", anyOf: ["company.members.manage"] },
  {
    href: "/settings/roles",
    label: "Roles",
    anyOf: ["company.members.manage", "company.roles.manage"],
  },
  { href: "/settings/company", label: "Company", anyOf: [] },
  { href: "/settings/appearance", label: "Appearance", anyOf: [] },
];

/** The tabs this person may open, in order; the first is where /settings goes. */
export function visibleSettingsTabs(permissions: Iterable<string>): SettingsTab[] {
  const held = [...permissions];
  return SETTINGS_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
