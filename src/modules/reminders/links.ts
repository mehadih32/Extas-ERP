import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * Where a reminder, an inbox message or an agenda item opens: the page of the
 * record it is about, when this person's role opens that page. A task opens in
 * the Planner for management and in My HR for the employee it was given to.
 */

type Can = { can: (permission: PermissionKey) => boolean };

export type RecordLink = { type: string; id: string | null };

const enc = encodeURIComponent;

export function recordHref(ctx: Can, link: RecordLink | null): string | null {
  if (!link?.id) return null;
  const id = enc(link.id);
  switch (link.type) {
    case "Task":
      if (ctx.can("reminders.manage")) return `/planner/tasks/${id}`;
      return ctx.can("portal.self") ? "/me/tasks" : null;
    case "Reminder":
      return `/planner/reminders/${id}`;
    case "ProductionProject":
      return ctx.can("production.view") ? `/production/projects/${id}` : null;
    case "SalesOrder":
      return ctx.can("sales.view") ? `/sales/orders/${id}` : null;
    case "PurchaseOrder":
      return ctx.can("materials.view") ? `/materials/orders/${id}` : null;
    case "ComplianceDocument":
      return ctx.can("compliance.view") || ctx.can("compliance.manage")
        ? `/compliance/${id}`
        : null;
    case "Employee":
      return ctx.can("hr.view") || ctx.can("hr.manage") || ctx.can("hr.payroll")
        ? `/hr/employees/${id}`
        : null;
    default:
      return null;
  }
}

/** What the link opens, for its label ("Open the task"). */
export const RECORD_NOUNS: Record<string, string> = {
  Task: "the task",
  Reminder: "the reminder",
  ProductionProject: "the project",
  SalesOrder: "the order",
  PurchaseOrder: "the purchase order",
  ComplianceDocument: "the licence",
  Employee: "the employee",
};
