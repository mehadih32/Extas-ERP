import type { AuditAction } from "@prisma/client";
import { z } from "zod";

import { localDay, localTime } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeProductionCosts } from "@/modules/production/project-costs";

/*
 * The Employee Action Log of a style or a master batch: every input recorded
 * on it, newest first, with when, who and what (who received the goods, who
 * entered a cutting report, who issued the fabric...). It reads the audit
 * log, which every production change writes in the same transaction and
 * nothing ever edits or deletes. Production Managers and Accounts read it,
 * since some lines carry costs.
 */

/** What each kind of record is called on the log. */
export const LOG_KINDS = {
  ProductionBatch: "Master batch",
  ProductionProject: "Style",
  ProductionContract: "Contract",
  PurchaseOrder: "Purchase order",
  SupplierBill: "Bill",
  MaterialIssue: "Material issue",
  MaterialChallan: "Materials sent",
  CuttingReport: "Cutting",
  EmbroideryJob: "Embroidery and print",
  FinishingReport: "Finishing",
  StockIntake: "Delivery to stock",
  SupplierFault: "Fault log",
  Expense: "Cost",
  Payment: "Payment",
} as const;

export type LogKind = keyof typeof LOG_KINDS;
const KINDS = Object.keys(LOG_KINDS) as LogKind[];

const PAGE = 100;

/** A filter left on "Everyone" or "Everything" comes in empty (?userId=&kind=): no filter. */
const unset = (value: unknown) => (value === "" ? undefined : value);

export const actionLogSchema = z.object({
  /** Only what this person did. */
  userId: z.preprocess(unset, z.string().min(1).optional()),
  /** Only this kind of record. */
  kind: z.preprocess(unset, z.enum(KINDS as [LogKind, ...LogKind[]]).optional()),
  /** Older than this (the next page). */
  before: z.preprocess(unset, z.iso.datetime().optional()),
});

/** The kind of change, in a word. */
const ACTION_WORDS: Record<AuditAction, string> = {
  CREATE: "Added",
  UPDATE: "Changed",
  DELETE: "Deleted",
  FORCE_OVERRIDE: "Overridden",
  INVOICE_EDIT: "Changed",
  STATUS_CHANGE: "Status",
  LOGIN: "Signed in",
  LOGIN_FAILED: "Sign-in failed",
  LOGOUT: "Signed out",
  COMPANY_SWITCH: "Switched company",
  PASSWORD_CHANGE: "Password",
  EXPORT: "Exported",
  PERMISSION_CHANGE: "Permissions",
  STOCK_ADJUSTMENT: "Stock",
  RESTORE: "Restored",
};

/** Who may read the log: Production Managers and Accounts. */
export function canReadActionLog(ctx: CompanyContext) {
  return canSeeProductionCosts(ctx);
}

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);

/** Every record a set of styles (and their batch) has, by kind, for the log. */
async function recordsOf(ctx: CompanyContext, projectIds: string[], batchId: string | null) {
  const companyId = ctx.company.id;
  const project = { companyId, projectId: { in: projectIds } };
  const select = { id: true } as const;
  const [
    intakes,
    cuts,
    jobs,
    finishing,
    faults,
    issues,
    challans,
    expenses,
    allocations,
    payments,
    orders,
    contracts,
  ] = await Promise.all([
    prisma.stockIntake.findMany({ where: project, select }),
    prisma.cuttingReport.findMany({ where: project, select }),
    prisma.embroideryJob.findMany({ where: project, select }),
    prisma.finishingReport.findMany({ where: project, select }),
    prisma.supplierFault.findMany({
      where: {
        companyId,
        OR: [{ projectId: { in: projectIds } }, ...(batchId ? [{ batchId }] : [])],
      },
      select,
    }),
    prisma.materialIssue.findMany({ where: project, select }),
    prisma.materialChallan.findMany({ where: project, select }),
    prisma.expense.findMany({ where: project, select }),
    prisma.supplierBillAllocation.findMany({
      where: { projectId: { in: projectIds }, bill: { companyId } },
      select: { billId: true },
    }),
    prisma.payment.findMany({ where: project, select }),
    prisma.purchaseOrder.findMany({
      where: {
        companyId,
        OR: [{ projectId: { in: projectIds } }, ...(batchId ? [{ batchId }] : [])],
      },
      select,
    }),
    batchId
      ? prisma.productionContract.findMany({ where: { companyId, batchId }, select })
      : Promise.resolve([]),
  ]);
  const orderIds = ids(orders);
  const bills = orderIds.length
    ? await prisma.supplierBill.findMany({
        where: { companyId, purchaseOrderId: { in: orderIds } },
        select,
      })
    : [];
  return new Map<LogKind, string[]>([
    ["ProductionBatch", batchId ? [batchId] : []],
    ["ProductionProject", projectIds],
    ["ProductionContract", ids(contracts)],
    ["PurchaseOrder", orderIds],
    ["SupplierBill", [...new Set([...ids(bills), ...allocations.map((a) => a.billId)])]],
    ["MaterialIssue", ids(issues)],
    ["MaterialChallan", ids(challans)],
    ["CuttingReport", ids(cuts)],
    ["EmbroideryJob", ids(jobs)],
    ["FinishingReport", ids(finishing)],
    ["StockIntake", ids(intakes)],
    ["SupplierFault", ids(faults)],
    ["Expense", ids(expenses)],
    ["Payment", ids(payments)],
  ]);
}

/**
 * The action log of one style (`projectId`) or a master batch and all its
 * styles (`batchId`), a page at a time, with the people and kinds of record
 * on it to filter by.
 */
export async function getActionLog(
  ctx: CompanyContext,
  scope: { projectId: string } | { batchId: string },
  raw: unknown = {},
) {
  if (!canReadActionLog(ctx)) {
    throw new AppError("FORBIDDEN", "The action log is for Production Managers and Accounts.");
  }
  const input = actionLogSchema.parse(raw);
  let subject: { kind: "style" | "batch"; id: string; code: string; name: string };
  let projectIds: string[];
  let batchId: string | null;
  let styles: Array<{ id: string; code: string; name: string }> = [];
  if ("projectId" in scope) {
    const project = await ctx.db.productionProject.findUnique({
      where: { id: scope.projectId },
      select: { id: true, code: true, name: true },
    });
    if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
    subject = { kind: "style", ...project };
    projectIds = [project.id];
    batchId = null;
  } else {
    const batch = await ctx.db.productionBatch.findUnique({
      where: { id: scope.batchId },
      select: {
        id: true,
        code: true,
        name: true,
        projects: { select: { id: true, code: true, name: true }, orderBy: { code: "asc" } },
      },
    });
    if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
    subject = { kind: "batch", id: batch.id, code: batch.code, name: batch.name };
    styles = batch.projects;
    projectIds = batch.projects.map((p) => p.id);
    batchId = batch.id;
  }

  const records = [...(await recordsOf(ctx, projectIds, batchId)).entries()].filter(
    ([, list]) => list.length > 0,
  );
  const of = (list: typeof records) =>
    list.map(([kind, inList]) => ({ entityType: kind, entityId: { in: inList } }));
  const all = { companyId: ctx.company.id, OR: of(records) };
  const shown = of(records.filter(([kind]) => !input.kind || kind === input.kind));
  if (shown.length === 0) {
    return { subject, styles, rows: [], people: [], kinds: [], next: null, filters: input };
  }
  const [rows, people, kinds] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        companyId: ctx.company.id,
        OR: shown,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}),
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
    }),
    prisma.auditLog.groupBy({ by: ["userId"], where: all, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["entityType"], where: all, _count: { _all: true } }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: people.map((p) => p.userId).filter((u): u is string => Boolean(u)) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const page = rows.slice(0, PAGE);
  const styleOf = new Map(styles.map((s) => [s.id, s]));
  return {
    subject,
    styles,
    rows: page.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      day: localDay(r.createdAt, ctx.company.timezone),
      time: localTime(r.createdAt, ctx.company.timezone),
      action: ACTION_WORDS[r.action] ?? r.action,
      kind: LOG_KINDS[r.entityType as LogKind] ?? r.entityType,
      summary: r.summary ?? "",
      who: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email } : null,
      /** On a batch's log: the style a line of a style is about. */
      style:
        r.entityType === "ProductionProject" && r.entityId
          ? (styleOf.get(r.entityId)?.code ?? null)
          : null,
    })),
    people: users,
    kinds: KINDS.filter((k) => kinds.some((g) => g.entityType === k)).map((k) => ({
      key: k,
      label: LOG_KINDS[k],
    })),
    next: rows.length > PAGE ? page[page.length - 1]!.createdAt.toISOString() : null,
    filters: input,
  };
}

export type ActionLog = Awaited<ReturnType<typeof getActionLog>>;
