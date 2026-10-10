import { DOCUMENT_KEYS, holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type ReportsTab = {
  href: string;
  label: string;
  /** Shown to people holding any of these. */
  anyOf: readonly PermissionKey[];
};

/*
 * The Reports & documents area's tabs, shown to the people their Server Actions
 * let in: reports with reports.export, printed documents with the right to
 * print some kind of document, templates with templates.manage.
 */
export const REPORTS_TABS: readonly ReportsTab[] = [
  { href: "/reports", label: "Reports", anyOf: ["reports.export"] },
  { href: "/reports/documents", label: "Printed documents", anyOf: DOCUMENT_KEYS },
  { href: "/reports/templates", label: "Templates", anyOf: ["templates.manage"] },
];

/** The tabs this person may open, in order. */
export function visibleReportsTabs(permissions: Iterable<string>): ReportsTab[] {
  const held = [...permissions];
  return REPORTS_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
