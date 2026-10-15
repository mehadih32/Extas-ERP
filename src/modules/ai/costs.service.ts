import { Prisma } from "@prisma/client";
import { z } from "zod";

import { addDays, DATE_ONLY, daysBetween, localDay, nextDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { listAccessibleCompanies, resolveCompanyAccess } from "@/modules/companies/access";
import { recordHref } from "@/modules/reminders/links";

import { modelInfo, taskInfo } from "./models";
import { aiOn } from "./claude";
import { budgetOf, periodStarts } from "./usage.service";

/*
 * AI Center > Budget & Costs: the budget and limits form, and what the AI
 * spent, by period (today, the last 7 or 30 days, this month, any range),
 * broken down by task, model, area, agent, person, record and store, with
 * the cost per day, the five costliest calls, the month-end projection and
 * every line with its reason. Read with ai.view or ai.manage; the budget is
 * changed with ai.manage.
 */

export const COST_PERIODS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "30 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
] as const;

export type CostPeriod = (typeof COST_PERIODS)[number]["value"];

export const costQuerySchema = z.object({
  period: z.enum(["today", "7d", "30d", "month", "custom"]).default("month"),
  from: z.string().regex(DATE_ONLY).optional(),
  to: z.string().regex(DATE_ONLY).optional(),
  /** One person's AI use only. */
  userId: z.string().max(60).optional(),
});

export type CostQuery = z.input<typeof costQuerySchema>;

/** The days a period covers, in company time (both ends included). */
export function periodDays(
  query: z.output<typeof costQuerySchema>,
  today: string,
): { from: string; to: string } {
  switch (query.period) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "custom": {
      const from = query.from ?? `${today.slice(0, 7)}-01`;
      const to = query.to ?? today;
      if (to < from) throw new AppError("VALIDATION", "The range ends before it starts.");
      if (daysBetween(from, to) > 366) {
        throw new AppError("VALIDATION", "Pick a range of a year or less.");
      }
      return { from, to };
    }
  }
}

const ZERO = new Prisma.Decimal(0);
/** The most lines read for one screen; a year of a busy store stays well below it. */
const MAX_LINES = 20_000;

type Slice = { key: string; label: string; cost: string; calls: number; href?: string | null };

function slices(
  lines: Array<{ cost: Prisma.Decimal }>,
  keyOf: (i: number) => { key: string; label: string; href?: string | null } | null,
): Slice[] {
  const by = new Map<
    string,
    { label: string; cost: Prisma.Decimal; calls: number; href?: string | null }
  >();
  lines.forEach((line, i) => {
    const k = keyOf(i);
    if (!k) return;
    const seen = by.get(k.key) ?? { label: k.label, cost: ZERO, calls: 0, href: k.href };
    seen.cost = seen.cost.plus(line.cost);
    seen.calls += 1;
    by.set(k.key, seen);
  });
  return [...by.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      cost: v.cost.toFixed(2),
      calls: v.calls,
      href: v.href,
    }))
    .sort((a, b) => Number(b.cost) - Number(a.cost) || b.calls - a.calls);
}

async function loadCosts(ctx: CompanyContext, raw: unknown) {
  const query = costQuerySchema.parse(raw);
  const tz = ctx.company.timezone;
  const now = new Date();
  const today = localDay(now, tz);
  const { from, to } = periodDays(query, today);
  const start = startOfDayInZone(from, tz);
  const end = startOfDayInZone(nextDay(to), tz);
  const where: Prisma.AiUsageWhereInput = {
    createdAt: { gte: start, lt: end },
    ...(query.userId ? { userId: query.userId } : {}),
  };

  const { monthStart } = periodStarts(now, tz);
  const [lines, budget, monthSum, people, on] = await Promise.all([
    ctx.db.aiUsage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_LINES,
      include: { user: { select: { name: true } } },
    }),
    budgetOf(ctx.company.id),
    ctx.db.aiUsage.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { cost: true } }),
    ctx.db.aiUsage.findMany({
      where: { userId: { not: null } },
      distinct: ["userId"],
      select: { user: { select: { id: true, name: true } } },
    }),
    aiOn(ctx.company.id),
  ]);

  const total = lines.reduce((t, l) => t.plus(l.cost), ZERO);
  const totalUsd = lines.reduce((t, l) => t.plus(l.costUsd), ZERO);

  // The month so far, and where it ends at this pace.
  const monthSpent = monthSum._sum.cost ?? ZERO;
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(
    Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0),
  ).getUTCDate();
  const projection = monthSpent.dividedBy(dayOfMonth).times(daysInMonth).toDecimalPlaces(2);

  // Cost per day across the period, days without calls at zero.
  const perDay = new Map<string, Prisma.Decimal>();
  for (let d = from; d <= to; d = nextDay(d)) perDay.set(d, ZERO);
  for (const l of lines) {
    const day = localDay(l.createdAt, tz);
    perDay.set(day, (perDay.get(day) ?? ZERO).plus(l.cost));
  }

  const lineView = (l: (typeof lines)[number]) => ({
    id: l.id,
    at: l.createdAt,
    who: l.user?.name ?? (l.userId ? "A former member" : "The system"),
    agent: l.agent,
    task: taskInfo(l.task)?.label ?? l.task,
    why: l.why,
    record: l.recordLabel,
    href: recordHref(ctx, l.recordType ? { type: l.recordType, id: l.recordId } : null),
    model: modelInfo(l.model)?.label ?? l.model,
    tokens: { input: l.inputTokens, output: l.outputTokens, cacheRead: l.cacheReadTokens },
    cost: l.cost.toFixed(2),
    costUsd: l.costUsd.toFixed(4),
    result: l.result,
    note: l.note,
  });

  const view = {
    query: { period: query.period, from, to, userId: query.userId ?? null },
    currency: ctx.company.currency,
    timeZone: tz,
    aiOn: on,
    totals: {
      cost: total.toFixed(2),
      costUsd: totalUsd.toFixed(2),
      calls: lines.length,
      failed: lines.filter((l) => l.result === "FAILED").length,
      stopped: lines.filter((l) => l.result === "STOPPED").length,
      tokens: {
        input: lines.reduce((t, l) => t + l.inputTokens, 0),
        output: lines.reduce((t, l) => t + l.outputTokens, 0),
      },
      truncated: lines.length === MAX_LINES,
    },
    month: {
      spent: monthSpent.toFixed(2),
      budget: budget.monthly?.toFixed(2) ?? null,
      percent: budget.monthly?.gt(0)
        ? monthSpent.dividedBy(budget.monthly).times(100).toDecimalPlaces(0).toNumber()
        : null,
      alertPercent: budget.alertPercent,
      projection: projection.toFixed(2),
    },
    perDay: [...perDay.entries()].map(([day, cost]) => ({ day, cost: cost.toFixed(2) })),
    by: {
      task: slices(lines, (i) => ({
        key: lines[i]!.task,
        label: taskInfo(lines[i]!.task)?.label ?? lines[i]!.task,
      })),
      model: slices(lines, (i) => ({
        key: lines[i]!.model,
        label: modelInfo(lines[i]!.model)?.label ?? lines[i]!.model,
      })),
      module: slices(lines, (i) => ({ key: lines[i]!.module, label: lines[i]!.module })),
      agent: slices(lines, (i) => ({ key: lines[i]!.agent, label: lines[i]!.agent })),
      person: slices(lines, (i) => ({
        key: lines[i]!.userId ?? "-",
        label: lines[i]!.user?.name ?? "The system",
      })),
      record: slices(lines, (i) =>
        lines[i]!.recordId
          ? {
              key: `${lines[i]!.recordType}:${lines[i]!.recordId}`,
              label: lines[i]!.recordLabel ?? lines[i]!.recordType!,
              href: recordHref(ctx, { type: lines[i]!.recordType!, id: lines[i]!.recordId }),
            }
          : null,
      ),
    },
    top: [...lines]
      .sort((a, b) => b.cost.comparedTo(a.cost))
      .slice(0, 5)
      .filter((l) => l.cost.gt(0))
      .map(lineView),
    lines: lines.slice(0, 100).map(lineView),
    stores: await storeTotals(ctx, start, end),
    people: people
      .flatMap((p) => (p.user ? [{ id: p.user.id, name: p.user.name }] : []))
      .sort((a, b) => a.name.localeCompare(b.name)),
    budget: {
      monthly: budget.monthly?.toFixed(2) ?? null,
      daily: budget.daily?.toFixed(2) ?? null,
      perOrder: budget.perOrder?.toFixed(2) ?? null,
      perStaffMonthly: budget.perStaffMonthly?.toFixed(2) ?? null,
      perAgentMonthly: budget.perAgentMonthly?.toFixed(2) ?? null,
      askAbove: budget.askAbove?.toFixed(2) ?? null,
      alertPercent: budget.alertPercent,
      atLimit: budget.atLimit,
      usdRate: budget.usdRate.toFixed(2),
    },
    can: { manage: ctx.can("ai.manage") },
  };
  return { view, all: lines.map(lineView) };
}

/** Budget & Costs for a period (the newest 100 lines; the export has them all). */
export async function getCosts(ctx: CompanyContext, raw: unknown = {}) {
  return (await loadCosts(ctx, raw)).view;
}

export type AiCosts = Awaited<ReturnType<typeof getCosts>>;

/** The screen's figures and every line of the period, for the export. */
export async function getCostsWithLines(ctx: CompanyContext, raw: unknown = {}) {
  const { view, all } = await loadCosts(ctx, raw);
  return { costs: view, lines: all };
}

/**
 * The owner's view across stores: each company this person sees the AI Center
 * of, with what its AI spent in the same period. Shown only with two or more.
 */
async function storeTotals(ctx: CompanyContext, start: Date, end: Date) {
  const companies = await listAccessibleCompanies(ctx.user);
  if (companies.length < 2) return [];
  const seen = [];
  for (const c of companies) {
    const access = c.id === ctx.company.id ? ctx : await resolveCompanyAccess(ctx.user, c.id);
    if (!access || !(access.permissions.has("ai.view") || access.permissions.has("ai.manage"))) {
      continue;
    }
    const sum = await prisma.aiUsage.aggregate({
      where: { companyId: c.id, createdAt: { gte: start, lt: end } },
      _sum: { cost: true },
      _count: true,
    });
    const company = await prisma.company.findUnique({
      where: { id: c.id },
      select: { currency: true },
    });
    seen.push({
      id: c.id,
      name: c.name,
      currency: company?.currency ?? ctx.company.currency,
      cost: (sum._sum.cost ?? ZERO).toFixed(2),
      calls: sum._count,
      here: c.id === ctx.company.id,
    });
  }
  return seen.length > 1 ? seen : [];
}

const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/,/g, ""))
  .refine((v) => v === "" || /^\d{1,10}(\.\d{1,2})?$/.test(v), "Use an amount like 5000 or 5000.50")
  .transform((v) => (v === "" ? null : v));

export const budgetSchema = z.object({
  monthly: amount.nullish(),
  daily: amount.nullish(),
  perOrder: amount.nullish(),
  perStaffMonthly: amount.nullish(),
  perAgentMonthly: amount.nullish(),
  askAbove: amount.nullish(),
  alertPercent: z.coerce.number().int().min(10, "Use 10 to 100").max(100, "Use 10 to 100"),
  atLimit: z.enum(["STOP", "CHEAPER"]),
  usdRate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine(
      (v) => /^\d{1,4}(\.\d{1,4})?$/.test(v) && Number(v) > 0,
      "Taka for one US dollar, like 122",
    ),
});

/** Saves the budget and limits (empty = no limit). */
export async function setBudget(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner sets the AI's budget.");
  }
  const b = budgetSchema.parse(input);
  const data = {
    monthly: b.monthly ?? null,
    daily: b.daily ?? null,
    perOrder: b.perOrder ?? null,
    perStaffMonthly: b.perStaffMonthly ?? null,
    perAgentMonthly: b.perAgentMonthly ?? null,
    askAbove: b.askAbove ?? null,
    alertPercent: b.alertPercent,
    atLimit: b.atLimit,
    usdRate: b.usdRate,
    updatedById: ctx.user.id,
  };
  await prisma.aiBudget.upsert({
    where: { companyId: ctx.company.id },
    create: { ...data, companyId: ctx.company.id },
    update: data,
  });
  const money = (v: string | null) => (v ? `${ctx.company.currency} ${v}` : "none");
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `AI budget: monthly ${money(data.monthly)}, daily ${money(data.daily)}, alert at ${data.alertPercent}%, at the limit ${data.atLimit === "STOP" ? "stop" : "small model"}, 1 USD = ${data.usdRate}`,
  });
}

/** This month's spending against the budget, for AI Home. */
export async function getMonthCost(ctx: CompanyContext) {
  const { monthStart } = periodStarts(new Date(), ctx.company.timezone);
  const [sum, budget] = await Promise.all([
    ctx.db.aiUsage.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { cost: true },
      _count: true,
    }),
    budgetOf(ctx.company.id),
  ]);
  const spent = sum._sum.cost ?? ZERO;
  return {
    spent: spent.toFixed(2),
    calls: sum._count,
    budget: budget.monthly?.toFixed(2) ?? null,
    percent: budget.monthly?.gt(0)
      ? spent.dividedBy(budget.monthly).times(100).toDecimalPlaces(0).toNumber()
      : null,
    alertPercent: budget.alertPercent,
    currency: ctx.company.currency,
  };
}

export type AiMonthCost = Awaited<ReturnType<typeof getMonthCost>>;

/** The records that show the AI box: production projects and batches, and sales orders. */
export const AI_BOX_RECORDS = ["ProductionProject", "ProductionBatch", "SalesOrder"] as const;

/**
 * AI status and cost so far for one record (the box on project, batch and
 * order pages). The cost shows only to the people who see the AI Center.
 */
export async function recordCost(ctx: CompanyContext, record: { type: string; id: string }) {
  const sees = ctx.can("ai.view") || ctx.can("ai.manage");
  const [sum, on] = await Promise.all([
    sees
      ? ctx.db.aiUsage.aggregate({
          where: { recordType: record.type, recordId: record.id },
          _sum: { cost: true },
          _count: true,
        })
      : null,
    aiOn(ctx.company.id),
  ]);
  return {
    on,
    cost: sum ? (sum._sum.cost ?? ZERO).toFixed(2) : null,
    calls: sum?._count ?? 0,
    currency: ctx.company.currency,
  };
}

export type AiRecordCost = Awaited<ReturnType<typeof recordCost>>;
