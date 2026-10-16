import { claimAccess } from "@/modules/hr/claims";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * Where a reminder, an inbox message or an agenda item opens: the page of the
 * record it is about, when this person's role opens that page. A task opens in
 * the Planner for management and in My HR for the employee it was given to.
 */

type Can = {
  can: (permission: PermissionKey) => boolean;
  /** The platform owner (Server Health). */
  user?: { isSuperAdmin: boolean };
};

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
    case "ProductionBatch":
      return ctx.can("production.view") ? `/production/batches/${id}` : null;
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
    case "MyDetails":
      // The employee's own details in My HR (a pay details change decided by HR).
      return ctx.can("portal.self") ? "/me/profile" : null;
    case "Terms":
      // New terms of employment to read and agree to (anyone linked to an employee).
      return "/terms";
    case "StaffClaim":
      // A staff claim waiting for Accounts (HR sees the claims too).
      return claimAccess(ctx).see ? `/hr/claims?claim=${id}#claim-${id}` : null;
    case "MyClaim":
      // The employee's own claim, decided or paid back.
      return ctx.can("portal.self") ? "/me/claims" : null;
    case "Notice":
      // A notice on the staff notice board: read it in My HR (HR without My HR sees the board).
      if (ctx.can("portal.self")) return `/me/notices#notice-${id}`;
      return ctx.can("hr.manage") ? `/hr/notices#notice-${id}` : null;
    case "MyItems":
      // A company item given to the employee or taken back: the list in My details.
      return ctx.can("portal.self") ? "/me/profile#my-items" : null;
    case "MySalary":
      // A salary paid (in full or in part): the employee's money ledger.
      return ctx.can("portal.self") ? "/me/ledger" : null;
    case "AiBudget":
      // The AI's spending passed the alert percentage of the month's budget.
      return ctx.can("ai.view") || ctx.can("ai.manage") ? "/ai/costs" : null;
    case "AiModelPrice":
      // Something tried to use a model with no price (blocked): its price on Models.
      return ctx.can("ai.view") || ctx.can("ai.manage") ? "/ai/models#ai-prices-heading" : null;
    case "AiDraft":
      // A draft Mehedi 2.0 made for the owner to send (a buyer's follow-up, a reply waiting).
      return ctx.can("ai.view") || ctx.can("ai.manage") ? `/ai/drafts#draft-${id}` : null;
    case "OrderCosting":
      return ctx.can("costing.view") ? `/production/costing/${id}` : null;
    case "HouseRule":
      // A House Rule Mehedi 2.0 proposed, for the owner to approve.
      return ctx.can("ai.view") || ctx.can("ai.manage") ? "/ai/mehedi#teach" : null;
    case "AiRequest":
      // Something the AI asks the owner for (permission, a Deletion request), or the morning brief.
      return ctx.can("ai.view") || ctx.can("ai.manage") ? "/ai" : null;
    case "AiOrderRun":
      // An order given to Mehedi 2.0: a step late, or a problem staff told the AI.
      return ctx.can("ai.view") || ctx.can("ai.manage") ? `/ai/orders/${id}` : null;
    case "ServerHealthRun":
      // The weekly Server Health check (the platform owner's).
      return ctx.user?.isSuperAdmin ? "/ai/health" : null;
    case "BackupRun":
      // A backup, test restore or restore failed or finished (the platform owner's).
      return ctx.user?.isSuperAdmin ? "/settings/backups" : null;
    case "FullCheckRun":
    case "ClaudeCodeRequest":
      // A Full check finished, or a Claude Code fix is ready (the platform owner's).
      return ctx.user?.isSuperAdmin ? "/ai/full-check" : null;
    default:
      return null;
  }
}

/** What the link opens, for its label ("Open the task"). */
export const RECORD_NOUNS: Record<string, string> = {
  Task: "the task",
  Reminder: "the reminder",
  ProductionProject: "the project",
  ProductionBatch: "the batch",
  SalesOrder: "the order",
  PurchaseOrder: "the purchase order",
  ComplianceDocument: "the licence",
  Employee: "the employee",
  MyDetails: "my details",
  Terms: "the terms",
  StaffClaim: "the claim",
  MyClaim: "my claims",
  Notice: "the notice",
  MyItems: "my items",
  MySalary: "my money",
  AiBudget: "the AI costs",
  AiModelPrice: "the model prices",
  AiDraft: "the draft",
  AiRequest: "the AI's requests",
  OrderCosting: "the costing sheet",
  HouseRule: "the House Rule",
  AiOrderRun: "the order",
  ServerHealthRun: "Server Health",
  BackupRun: "Backups",
  FullCheckRun: "the Full check",
  ClaudeCodeRequest: "the Full check",
};
