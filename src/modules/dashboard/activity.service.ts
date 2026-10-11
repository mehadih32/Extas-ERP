import type { AuditAction } from "@prisma/client";
import { z } from "zod";

import { assetHref, accountsHref } from "@/components/accounts/labels";
import { complianceHref } from "@/components/compliance/labels";
import { hrHref } from "@/components/hr/labels";
import { materialsHref } from "@/components/materials/labels";
import { partyHref } from "@/components/parties/labels";
import { plannerHref } from "@/components/planner/labels";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";
import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * The Home screen's live activity feed: the latest things done in the company,
 * newest first, from the audit trail that records every change ("10:15 AM ·
 * Rahim · Issued invoice INV-2026-00102"). The owner, and any role with the
 * audit trail permission, sees everyone's; everyone else sees their own.
 *
 * Signing in and out, switching company, downloads and attendance check-ins are
 * left out: they are in the audit trail, but they are not the business's
 * activity. Amounts in the text come back as their own parts so the page can
 * hide them behind the eye. A row links to what it was about when the reader
 * may open it.
 */

/** Rows the feed shows. */
export const FEED_ROWS = 12;

/** Audit actions that are not business activity. */
const LEFT_OUT_ACTIONS: AuditAction[] = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "COMPANY_SWITCH",
  "EXPORT",
];

/** Records that would flood the feed every morning. */
const LEFT_OUT_TYPES = ["Attendance"];

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(FEED_ROWS),
});

/** Whether this person sees everyone's activity, or only their own. */
export const seesEveryonesActivity = (ctx: Pick<CompanyContext, "can">) => ctx.can("audit.view");

/** A piece of a row's text: words, or an amount ("10200.00") the eye hides. */
export type FeedPart = { text: string } | { amount: string };

/**
 * An amount in the audit trail's text: digits with two decimal places
 * ("10200.00", "-500.00"), the way every summary writes money. Quantities
 * ("180 pcs", "64.5 yd"), codes and dates do not match.
 */
const AMOUNT = /(?<![\w.])-?\d+\.\d{2}(?![\d.])/g;

/** Splits a row's text into words and amounts. */
export function feedParts(text: string): FeedPart[] {
  const parts: FeedPart[] = [];
  let last = 0;
  for (const match of text.matchAll(AMOUNT)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ amount: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const ACTION_WORDS: Record<AuditAction, string> = {
  CREATE: "Added",
  UPDATE: "Changed",
  DELETE: "Deleted",
  FORCE_OVERRIDE: "Overrode the stock check on",
  INVOICE_EDIT: "Edited",
  STATUS_CHANGE: "Changed the status of",
  LOGIN: "Signed in",
  LOGIN_FAILED: "Failed to sign in",
  LOGOUT: "Signed out",
  COMPANY_SWITCH: "Switched company",
  PASSWORD_CHANGE: "Changed the password of",
  EXPORT: "Downloaded",
  PERMISSION_CHANGE: "Changed the access of",
  STOCK_ADJUSTMENT: "Adjusted the stock of",
  RESTORE: "Restored",
};

/** "Added a sales order" when a row has no text of its own. */
export function fallbackText(action: AuditAction, entityType: string): string {
  const thing = entityType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `${ACTION_WORDS[action]} a ${thing}`;
}

type Link = { anyOf: readonly PermissionKey[]; href: (id: string) => string };

/** Where a row about each kind of record opens, and who may open it. */
const LINKS: Record<string, Link> = {
  SalesOrder: { anyOf: ["sales.view"], href: salesHref.order },
  Invoice: { anyOf: ["sales.view"], href: salesHref.invoice },
  Quotation: { anyOf: ["sales.view"], href: salesHref.quotation },
  ProformaInvoice: { anyOf: ["sales.view"], href: salesHref.proforma },
  SalesReturn: { anyOf: ["sales.view"], href: salesHref.salesReturn },
  ProductionProject: { anyOf: ["production.view"], href: productionHref.project },
  StockIntake: {
    anyOf: ["production.view", "production.stock_intake"],
    href: productionHref.delivery,
  },
  Style: { anyOf: ["inventory.view"], href: (id) => `/products/${encodeURIComponent(id)}` },
  RawMaterial: { anyOf: ["materials.view"], href: materialsHref.material },
  PurchaseOrder: { anyOf: ["materials.view"], href: materialsHref.order },
  MaterialIssue: { anyOf: ["materials.view"], href: materialsHref.issue },
  JournalEntry: { anyOf: ["accounts.view"], href: accountsHref.entry },
  FixedAsset: { anyOf: ["accounts.view"], href: assetHref.asset },
  Employee: { anyOf: ["hr.view", "hr.manage", "hr.payroll"], href: (id) => hrHref.employee(id) },
  LeaveRequest: { anyOf: ["hr.view", "hr.manage", "hr.payroll"], href: hrHref.leaveRequest },
  PayrollRun: { anyOf: ["hr.manage", "hr.payroll", "accounts.view"], href: hrHref.payrollRun },
  ComplianceDocument: {
    anyOf: ["compliance.view", "compliance.manage"],
    href: complianceHref.record,
  },
  Task: { anyOf: ["reminders.manage"], href: plannerHref.task },
};

const canOpen = (ctx: Pick<CompanyContext, "can">, anyOf: readonly PermissionKey[]) =>
  anyOf.some((key) => ctx.can(key));

/** "10:15 AM" in company time. */
function clockTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

/**
 * The latest activity this person may see: everyone's for the audit trail's
 * readers, their own for everyone else.
 */
export async function getActivityFeed(ctx: CompanyContext, raw: unknown = {}, now = new Date()) {
  const { limit } = feedQuerySchema.parse(raw);
  const everyone = seesEveryonesActivity(ctx);
  const tz = ctx.company.timezone;
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId: ctx.company.id,
      action: { notIn: LEFT_OUT_ACTIONS },
      entityType: { notIn: LEFT_OUT_TYPES },
      ...(everyone ? {} : { userId: ctx.user.id }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      createdAt: true,
      userId: true,
      user: { select: { name: true } },
    },
  });

  // Buyers and suppliers, and money in and out, open on different pages.
  const idsOf = (type: string) =>
    rows.flatMap((r) => (r.entityType === type && r.entityId ? [r.entityId] : []));
  const partyIds = ctx.can("parties.view") ? idsOf("Party") : [];
  const paymentIds = idsOf("Payment");
  const [parties, payments] = await Promise.all([
    partyIds.length > 0
      ? ctx.db.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, kind: true } })
      : [],
    paymentIds.length > 0
      ? ctx.db.payment.findMany({
          where: { id: { in: paymentIds } },
          select: { id: true, direction: true },
        })
      : [],
  ]);
  const partyKind = new Map(parties.map((p) => [p.id, p.kind]));
  const paymentDirection = new Map(payments.map((p) => [p.id, p.direction]));

  const hrefOf = (type: string, id: string | null, action: AuditAction): string | null => {
    if (!id || action === "DELETE") return null;
    if (type === "Party") {
      const kind = partyKind.get(id);
      return kind ? partyHref({ id, kind }) : null;
    }
    if (type === "Payment") {
      const direction = paymentDirection.get(id);
      if (direction === "RECEIVED") return ctx.can("sales.view") ? salesHref.payment(id) : null;
      if (direction === "PAID") {
        return canOpen(ctx, ["accounts.view", "accounts.payments.record"])
          ? accountsHref.payment(id)
          : null;
      }
      return null;
    }
    const link = LINKS[type];
    return link && canOpen(ctx, link.anyOf) ? link.href(id) : null;
  };

  return {
    today: localDay(now, tz),
    currency: ctx.company.currency,
    /** "COMPANY": everyone's activity; "OWN": this person's. */
    scope: everyone ? ("COMPANY" as const) : ("OWN" as const),
    items: rows.map((r) => {
      const text = r.summary?.trim() || fallbackText(r.action, r.entityType);
      const mine = r.userId === ctx.user.id;
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        day: localDay(r.createdAt, tz),
        time: clockTime(r.createdAt, tz),
        /** Who did it: "You", their name, or the app itself (automatic jobs). */
        who: mine ? "You" : (r.user?.name ?? "The app"),
        mine,
        action: r.action,
        parts: feedParts(text),
        href: hrefOf(r.entityType, r.entityId, r.action),
      };
    }),
  };
}

export type ActivityFeed = Awaited<ReturnType<typeof getActivityFeed>>;
export type ActivityItem = ActivityFeed["items"][number];
