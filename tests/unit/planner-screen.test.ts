import type { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  complianceListQuery,
  complianceListSearch,
  complianceViewFrom,
  expiryWords,
} from "@/components/compliance/labels";
import {
  dayHeading,
  daysBeforeText,
  dayWords,
  moveLabel,
  offsetText,
  overdueText,
  plannerHref,
  readDays,
} from "@/components/planner/labels";
import {
  reminderListQuery,
  reminderListSearch,
  reminderViewFrom,
  taskListQuery,
  taskListSearch,
  taskViewFrom,
} from "@/components/planner/list-view";
import { visiblePlannerTabs } from "@/components/planner/tabs";
import { MY_HR_TABS } from "@/components/hr/tabs";
import { phoneTabs, visibleNavItems } from "@/components/shell/nav-items";
import {
  canArchive,
  canDelete,
  canRenew,
  canRestore,
  complianceKeys,
} from "@/modules/compliance/rules";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type PermissionKey,
} from "@/modules/rbac/permissions";
import {
  awaitsAcknowledging,
  canAcknowledgeReminder,
  canCancelReminder,
  canDeleteReminder,
  canEditReminder,
  canEditTask,
  canSetMyTaskStatus,
  plannerKeys,
  type ReminderState,
  taskMoves,
} from "@/modules/reminders/checks";
import { recordHref } from "@/modules/reminders/links";

const role = (name: SystemRole): string[] => [...DEFAULT_ROLE_PERMISSIONS[name]];
const holding = (keys: readonly string[]) => ({
  can: (key: PermissionKey) => keys.includes(key),
});
const tabs = (permissions: string[]) => visiblePlannerTabs(permissions).map((t) => t.label);
const nav = (permissions: string[]) => visibleNavItems(permissions).map((i) => i.href);
const ROLES = Object.keys(DEFAULT_ROLE_PERMISSIONS) as SystemRole[];

describe("the Planner and Compliance in the menu, by role", () => {
  it("gives each role the Planner tabs its Server Actions let it open", () => {
    const managers = ["Coming up", "Notepad", "Tasks", "Reminders", "Automatic reminders"];
    expect(tabs(role("SUPER_ADMIN"))).toEqual(managers);
    expect(tabs(role("PRODUCTION_MANAGER"))).toEqual(managers);
    expect(tabs(role("SALES_EXECUTIVE"))).toEqual(managers);
    for (const name of ["ACCOUNTS", "WAREHOUSE_TEAM", "EMPLOYEE"] as const) {
      expect(tabs(role(name)), name).toEqual(["Coming up", "Notepad", "Reminders"]);
    }
    // The owner's settings key alone opens the automatic reminders.
    expect(tabs(["company.settings"])).toEqual(["Coming up", "Automatic reminders"]);
    expect(tabs(["portal.self"])).toEqual([]);
    expect(nav(["portal.self"])).not.toContain("/planner");
  });

  it("shows each tab exactly when the planner keys allow it", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    const sets: string[][] = [...keys.map((key) => [key]), ...ROLES.map(role)];
    for (const held of sets) {
      const can = plannerKeys(holding(held));
      const shown = tabs(held);
      const label = held.join(",");
      expect(shown.includes("Notepad"), label).toBe(can.notepad);
      expect(shown.includes("Tasks"), label).toBe(can.manage);
      expect(shown.includes("Reminders"), label).toBe(can.remind);
      expect(shown.includes("Automatic reminders"), label).toBe(can.rules);
      expect(nav(held).includes("/planner"), label).toBe(shown.length > 0);
    }
  });

  it("shows Compliance to the people who may see the licences", () => {
    for (const name of ROLES) {
      const see = complianceKeys(holding(role(name))).view;
      expect(nav(role(name)).includes("/compliance"), name).toBe(see);
    }
    expect(nav(role("SUPER_ADMIN"))).toContain("/compliance");
    expect(nav(role("ACCOUNTS"))).toContain("/compliance");
    expect(nav(role("PRODUCTION_MANAGER"))).not.toContain("/compliance");
    expect(nav(["compliance.manage"])).toContain("/compliance");
  });

  it("puts the Planner on the employee's phone tab bar and Tasks in My HR", () => {
    const employee = phoneTabs(visibleNavItems(role("EMPLOYEE")));
    expect(employee.tabs.map((i) => i.href)).toEqual([
      "/",
      "/planner",
      "/accounts/expenses",
      "/me",
    ]);
    expect(employee.more).toEqual([]);
    expect(MY_HR_TABS.map((t) => t.href)).toContain("/me/tasks");
  });
});

describe("where a reminder or a message opens", () => {
  it("opens a record only where the person's role opens it", () => {
    const at = (name: SystemRole, type: string) =>
      recordHref(holding(role(name)), { type, id: "x 1" });
    expect(at("SALES_EXECUTIVE", "Task")).toBe("/planner/tasks/x%201");
    expect(at("EMPLOYEE", "Task")).toBe("/me/tasks");
    expect(at("SALES_EXECUTIVE", "ProductionProject")).toBeNull();
    expect(at("PRODUCTION_MANAGER", "ProductionProject")).toBe("/production/projects/x%201");
    expect(at("PRODUCTION_MANAGER", "SalesOrder")).toBeNull();
    expect(at("SALES_EXECUTIVE", "PurchaseOrder")).toBeNull();
    expect(at("ACCOUNTS", "ComplianceDocument")).toBe("/compliance/x%201");
    expect(at("PRODUCTION_MANAGER", "ComplianceDocument")).toBeNull();
    expect(at("ACCOUNTS", "Employee")).toBe("/hr/employees/x%201");
    expect(at("PRODUCTION_MANAGER", "Employee")).toBeNull();
    expect(at("EMPLOYEE", "Reminder")).toBe("/planner/reminders/x%201");
    expect(recordHref(holding(role("SUPER_ADMIN")), { type: "Task", id: null })).toBeNull();
    expect(recordHref(holding(role("SUPER_ADMIN")), { type: "Unknown", id: "x" })).toBeNull();
  });
});

const reminder = (over: Partial<ReminderState> = {}): ReminderState => ({
  automatic: false,
  createdById: "u1",
  status: "SCHEDULED",
  repeating: false,
  sentAt: null,
  acknowledgedAt: null,
  ...over,
});
const maker = { userId: "u1", manage: false };
const other = { userId: "u2", manage: false };
const manager = { userId: "u3", manage: true };

describe("what may be done with a reminder", () => {
  it("lets its maker or reminders.manage change one set by hand", () => {
    expect(canEditReminder(reminder(), maker).ok).toBe(true);
    expect(canEditReminder(reminder(), manager).ok).toBe(true);
    const refused = canEditReminder(reminder(), other);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("FORBIDDEN");
    const automatic = canDeleteReminder(reminder({ automatic: true }), manager);
    expect(automatic.ok).toBe(false);
    if (!automatic.ok) expect(automatic.code).toBe("CONFLICT");
  });

  it("changes and cancels only what has not gone out", () => {
    for (const status of ["SENT", "ACKNOWLEDGED", "CANCELLED"] as const) {
      expect(canEditReminder(reminder({ status }), maker).ok, status).toBe(false);
      expect(canCancelReminder(reminder({ status }), maker).ok, status).toBe(false);
      expect(canDeleteReminder(reminder({ status }), maker).ok, status).toBe(true);
    }
  });

  it("asks for it to be dealt with once it has gone out", () => {
    expect(canAcknowledgeReminder(reminder()).ok).toBe(false);
    expect(awaitsAcknowledging(reminder())).toBe(false);
    expect(awaitsAcknowledging(reminder({ status: "SENT" }))).toBe(true);
    expect(awaitsAcknowledging(reminder({ status: "ACKNOWLEDGED" }))).toBe(false);
    expect(canAcknowledgeReminder(reminder({ status: "ACKNOWLEDGED" })).ok).toBe(true);
    expect(awaitsAcknowledging(reminder({ status: "CANCELLED", sentAt: new Date() }))).toBe(false);
    // A repeating one stays scheduled; each time it goes out waits until dealt with.
    const sentAt = new Date("2026-10-10T03:00:00Z");
    const repeating = reminder({ repeating: true, sentAt });
    expect(awaitsAcknowledging(repeating)).toBe(true);
    expect(
      awaitsAcknowledging({ ...repeating, acknowledgedAt: new Date("2026-10-10T04:00:00Z") }),
    ).toBe(false);
    expect(
      awaitsAcknowledging({ ...repeating, acknowledgedAt: new Date("2026-10-09T04:00:00Z") }),
    ).toBe(true);
  });
});

describe("what may be done with a task", () => {
  it("offers management every other status, and the employee start, finish and reopen", () => {
    expect(taskMoves("TODO", true)).toEqual(["IN_PROGRESS", "DONE", "CANCELLED"]);
    expect(taskMoves("IN_PROGRESS", true)).toEqual(["DONE", "TODO", "CANCELLED"]);
    expect(taskMoves("DONE", true)).toEqual(["TODO"]);
    expect(taskMoves("CANCELLED", true)).toEqual(["TODO"]);
    expect(taskMoves("TODO", false)).toEqual(["IN_PROGRESS", "DONE"]);
    expect(taskMoves("IN_PROGRESS", false)).toEqual(["DONE", "TODO"]);
    expect(taskMoves("DONE", false)).toEqual(["TODO"]);
    expect(taskMoves("CANCELLED", false)).toEqual([]);
    expect(canSetMyTaskStatus({ status: "TODO" }, "CANCELLED").ok).toBe(false);
  });

  it("changes only open tasks", () => {
    expect(canEditTask({ status: "TODO" }).ok).toBe(true);
    expect(canEditTask({ status: "IN_PROGRESS" }).ok).toBe(true);
    expect(canEditTask({ status: "DONE" }).ok).toBe(false);
    expect(canEditTask({ status: "CANCELLED" }).ok).toBe(false);
  });

  it("names each move", () => {
    expect(moveLabel("TODO", "IN_PROGRESS")).toBe("Start");
    expect(moveLabel("IN_PROGRESS", "TODO")).toBe("Not started yet");
    expect(moveLabel("DONE", "TODO")).toBe("Reopen");
    expect(moveLabel("TODO", "DONE")).toBe("Mark as done");
  });
});

describe("what may be done with a licence record", () => {
  const live = { supersededAt: null, archivedAt: null, renewal: null };
  const renewed = { supersededAt: new Date(), archivedAt: null, renewal: { id: "new" } };
  const archived = { supersededAt: null, archivedAt: new Date(), renewal: null };

  it("renews and archives the term in force only", () => {
    expect(canRenew(live).ok).toBe(true);
    expect(canRenew(renewed).ok).toBe(false);
    expect(canRenew(archived).ok).toBe(false);
    expect(canArchive(live).ok).toBe(true);
    expect(canArchive(renewed).ok).toBe(false);
    expect(canArchive(archived).ok).toBe(false);
    expect(canRestore(archived).ok).toBe(true);
    expect(canRestore(live).ok).toBe(false);
    expect(canDelete(live).ok).toBe(true);
    expect(canDelete(renewed).ok).toBe(false);
  });

  it("lets compliance.manage see as well as change", () => {
    expect(complianceKeys(holding(["compliance.manage"]))).toEqual({ view: true, manage: true });
    expect(complianceKeys(holding(["compliance.view"]))).toEqual({ view: true, manage: false });
    expect(complianceKeys(holding([]))).toEqual({ view: false, manage: false });
  });
});

describe("the Planner's words and addresses", () => {
  it("reads and writes the days before a date", () => {
    expect(readDays("7, 3 1 0")).toEqual([7, 3, 1, 0]);
    expect(readDays("1, 1, 3")).toEqual([3, 1]);
    expect(readDays("")).toEqual([]);
    expect(readDays("2.5")).toBeNull();
    expect(readDays("-1")).toBeNull();
    expect(readDays("400")).toBeNull();
    expect(daysBeforeText([7, 3, 1, 0])).toBe("7, 3 and 1 days before and on the day");
    expect(daysBeforeText([1])).toBe("1 day before");
    expect(daysBeforeText([0])).toBe("On the day");
    expect(daysBeforeText([])).toBe("Only once the date has passed");
    expect(overdueText(0)).toBe("Not again once overdue");
    expect(overdueText(1)).toBe("Every day while overdue");
    expect(overdueText(7)).toBe("Every 7 days while overdue");
    expect(offsetText(3)).toBe("3 days before");
    expect(offsetText(0)).toBe("On the day");
    expect(offsetText(-1)).toBe("1 day after");
  });

  it("names days near today", () => {
    expect(dayWords("2026-10-10", "2026-10-10")).toBe("Today");
    expect(dayWords("2026-10-11", "2026-10-10")).toBe("Tomorrow");
    expect(dayWords("2026-10-09", "2026-10-10")).toBe("Yesterday");
    expect(dayWords("2026-10-20", "2026-10-10")).toBe("20 Oct 2026");
    expect(dayHeading("2026-10-10", "2026-10-10")).toBe("Today · Saturday, 10 October 2026");
    expect(dayHeading("2026-10-12", "2026-10-10")).toBe("Monday, 12 October 2026");
    expect(expiryWords(12)).toBe("Expires in 12 days");
    expect(expiryWords(0)).toBe("Expires today");
    expect(expiryWords(-3)).toBe("Expired 3 days ago");
    expect(expiryWords(null)).toBe("No expiry");
  });

  it("keeps the lists' filters in the address bar", () => {
    const tasks = taskViewFrom({ show: "overdue", mine: "1", q: " visit " });
    expect(tasks).toEqual({ show: "overdue", mine: true, q: "visit" });
    expect(taskListSearch(tasks)).toBe("?show=overdue&mine=1&q=visit");
    expect(taskListQuery(tasks, "c1")).toMatchObject({
      overdue: true,
      mine: true,
      search: "visit",
      cursor: "c1",
    });
    expect(taskViewFrom({ show: "nonsense" })).toEqual({ show: "open" });
    expect(taskListSearch(taskViewFrom({}))).toBe("");

    const reminders = reminderViewFrom({ show: "dealt", kind: "automatic", everyone: "1" });
    expect(reminderListSearch(reminders)).toBe("?show=dealt&kind=automatic&everyone=1");
    expect(reminderListQuery(reminders)).toMatchObject({
      status: "ACKNOWLEDGED",
      automatic: true,
      all: true,
    });
    expect(reminderListQuery(reminderViewFrom({}))).not.toHaveProperty("status");

    const licences = complianceViewFrom({ show: "history", type: "TIN", q: "123" });
    expect(complianceListSearch(licences)).toBe("?show=history&type=TIN&q=123");
    expect(complianceListQuery(licences)).toEqual({ history: true, type: "TIN", search: "123" });
    expect(complianceListQuery(complianceViewFrom({ show: "renew" }))).toEqual({
      status: "EXPIRING",
    });
    expect(complianceViewFrom({ type: "NOPE" })).toEqual({ show: "current" });
  });

  it("builds the Planner's addresses", () => {
    expect(plannerHref.agenda()).toBe("/planner");
    expect(plannerHref.agenda(7)).toBe("/planner");
    expect(plannerHref.agenda(30)).toBe("/planner?days=30");
    expect(plannerHref.notepad("DAILY_ROUTINE")).toBe("/planner/notepad");
    expect(plannerHref.notepad("GENERAL")).toBe("/planner/notepad?tab=GENERAL");
    expect(plannerHref.myTasks("open")).toBe("/me/tasks");
    expect(plannerHref.myTasks("done")).toBe("/me/tasks?show=done");
  });
});
