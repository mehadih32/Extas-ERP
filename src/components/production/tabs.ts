import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type ProductionTab = {
  href: string;
  label: string;
  /** Shown to people holding any of these... */
  anyOf: readonly PermissionKey[];
  /** ...and, when given, any of these too. */
  andAnyOf?: readonly PermissionKey[];
};

/*
 * The Production area's tabs, shown to the people their Server Actions let in:
 * projects read with production.view, deliveries with production.view or
 * production.stock_intake, bills need the costs as well (production.manage or
 * accounts.view), and cost heads are changed with production.manage.
 */
export const PRODUCTION_TABS: readonly ProductionTab[] = [
  { href: "/production", label: "Overview", anyOf: ["production.view"] },
  { href: "/production/projects", label: "Projects", anyOf: ["production.view"] },
  {
    href: "/production/deliveries",
    label: "Deliveries",
    anyOf: ["production.view", "production.stock_intake"],
  },
  {
    href: "/production/bills",
    label: "Bills",
    anyOf: ["production.view"],
    andAnyOf: ["production.manage", "accounts.view"],
  },
  { href: "/production/cost-heads", label: "Cost heads", anyOf: ["production.manage"] },
];

/** The tabs this person may open, in order; the first is where /production goes. */
export function visibleProductionTabs(permissions: Iterable<string>): ProductionTab[] {
  const held = [...permissions];
  return PRODUCTION_TABS.filter(
    (tab) => holdsAny(held, tab.anyOf) && (!tab.andAnyOf || holdsAny(held, tab.andAnyOf)),
  );
}
