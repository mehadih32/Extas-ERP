import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type SettingsTab = {
  href: string;
  label: string;
  anyOf: readonly PermissionKey[];
  /** Only for the platform owner (a backup holds every company's data). */
  platformOwner?: boolean;
};

/*
 * The settings area's tabs, shown to the people their Server Actions let in:
 * the team needs company.members.manage; the roles can be read with either team
 * permission (changing them needs company.roles.manage); the company details can
 * be read by everyone in the company (changing them needs company.settings);
 * the online shops (Integrations) need integrations.ecommerce.manage; everyone
 * chooses their own look (Appearance); Backups is the platform owner's.
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { href: "/settings/team", label: "Team", anyOf: ["company.members.manage"] },
  {
    href: "/settings/roles",
    label: "Roles",
    anyOf: ["company.members.manage", "company.roles.manage"],
  },
  { href: "/settings/company", label: "Company", anyOf: [] },
  {
    href: "/settings/integrations",
    label: "Integrations",
    anyOf: ["integrations.ecommerce.manage"],
  },
  { href: "/settings/appearance", label: "Appearance", anyOf: [] },
  { href: "/settings/backups", label: "Backups", anyOf: [], platformOwner: true },
];

/** The tabs this person may open, in order; the first is where /settings goes. */
export function visibleSettingsTabs(
  permissions: Iterable<string>,
  platformOwner = false,
): SettingsTab[] {
  const held = [...permissions];
  return SETTINGS_TABS.filter(
    (tab) => holdsAny(held, tab.anyOf) && (!tab.platformOwner || platformOwner),
  );
}
