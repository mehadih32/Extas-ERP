import { holdsAny, PLANNER_KEYS } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type PlannerTab = {
  href: string;
  label: string;
  /** Shown to people holding any of these. */
  anyOf: readonly PermissionKey[];
};

/*
 * The Planner's tabs, shown to the people their Server Actions let in: what is
 * coming up to everyone who opens the Planner, the notepad with notepad.use,
 * tasks with reminders.manage, reminders to whoever may set them, and the
 * automatic reminder settings to reminders.manage (to read) and
 * company.settings (to change).
 */
export const PLANNER_TABS: readonly PlannerTab[] = [
  { href: "/planner", label: "Coming up", anyOf: PLANNER_KEYS },
  { href: "/planner/notepad", label: "Notepad", anyOf: ["notepad.use"] },
  { href: "/planner/tasks", label: "Tasks", anyOf: ["reminders.manage"] },
  { href: "/planner/reminders", label: "Reminders", anyOf: ["notepad.use", "reminders.manage"] },
  {
    href: "/planner/automatic",
    label: "Automatic reminders",
    anyOf: ["reminders.manage", "company.settings"],
  },
];

/** The tabs this person may open, in order. */
export function visiblePlannerTabs(permissions: Iterable<string>): PlannerTab[] {
  const held = [...permissions];
  return PLANNER_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
