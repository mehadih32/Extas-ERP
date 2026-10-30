import { Prisma } from "@prisma/client";
import { z } from "zod";

import { addDays, dateColumn, dateOnly, localDay, localTime } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { EcommerceApiError } from "@/modules/ecommerce/errors";
import { activeMembers } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

import { assertCanManageStores, assertCanSeeStores } from "./stores.service";

/*
 * A retail store's own books (plan v6 sec 6, 6a and 7)
 * ----------------------------------------------------
 * The site sends each day's totals (PUT /daily-summaries/{date}) and each
 * month's fixed costs (PUT /fixed-costs/{month}). Sending again adds a version:
 * the newest counts, the older ones show what changed. A figure the site does
 * not have yet is listed in `incomplete` and shown "not complete yet", never
 * as 0. No day may go missing: the site sends at 00:30; from 01:00 the ERP asks
 * for missing days (webhook summary.missing, hourly); from 09:00 it tells the
 * owner. The owner sets a budget per month and line (80% yellow, over 100% red
 * and an alarm) and a monthly sales target. The ERP's own side (what the store
 * took and gave back) never depends on these: it is in the ERP's books.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LOOK_BACK_DAYS = 60;

const money = z.coerce.number().min(0, "0 or more").max(1e11);
const count = z.coerce.number().int().min(0).max(1e9);

export const SUMMARY_KEYS = [
  "orders",
  "sales",
  "income",
  "deliveries",
  "goods",
  "returnLosses",
  "packaging",
  "delivery",
  "paymentFees",
  "accessories",
  "ads",
  "other",
  "customers",
] as const;
const COST_LINES = [
  "goods",
  "returnLosses",
  "packaging",
  "delivery",
  "paymentFees",
  "accessories",
  "other",
] as const;
const AD_LINES = ["facebook", "instagram", "google", "tiktok", "other"] as const;

export const summarySchema = z
  .object({
    date: z.string().regex(DAY_RE, "A day like 2026-11-02"),
    orders: z.object({ count, pieces: count }).strict().optional(),
    sales: z
      .object({ gross: money, discounts: money, customerReturns: money, net: z.coerce.number() })
      .strict()
      .optional(),
    income: z.object({ deliveryCharges: money }).strict().optional(),
    deliveries: z
      .object({ delivered: count, failed: count, returned: count, codPending: money })
      .strict()
      .optional(),
    costs: z
      .object({
        goods: z.coerce.number().optional(),
        returnLosses: z.coerce.number().optional(),
        packaging: money.optional(),
        delivery: money.optional(),
        paymentFees: money.optional(),
        accessories: money.optional(),
        ads: z
          .object(Object.fromEntries(AD_LINES.map((k) => [k, money.default(0)])))
          .strict()
          .optional(),
        other: money.optional(),
      })
      .strict()
      .default({}),
    returns: z
      .object({ handedBackPieces: count, approvedCredit: money, waitingCheckValue: money })
      .strict()
      .optional(),
    customers: z.object({ new: count, returning: count }).strict().optional(),
    incomplete: z.array(z.enum(SUMMARY_KEYS)).max(SUMMARY_KEYS.length).default([]),
    netProfit: z.coerce.number(),
  })
  .strict()
  .superRefine((input, issue) => {
    const has = (key: (typeof SUMMARY_KEYS)[number]) => {
      if ((COST_LINES as readonly string[]).includes(key) || key === "ads") {
        return (input.costs as Record<string, unknown>)[key] !== undefined;
      }
      return (input as Record<string, unknown>)[key] !== undefined;
    };
    for (const key of SUMMARY_KEYS) {
      if (!has(key) && !input.incomplete.includes(key)) {
        issue.addIssue({
          code: "custom",
          path: [key],
          message: `Send ${key}, or list it in incomplete until it is known`,
        });
      }
    }
  });

export const fixedCostSchema = z
  .object({
    month: z.string().regex(MONTH_RE, "A month like 2026-11"),
    costs: z
      .object({
        salary: money.default(0),
        rent: money.default(0),
        utilities: money.default(0),
        other: money.default(0),
      })
      .strict(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

type Summary = z.infer<typeof summarySchema>;
type Store = { id: string; companyId: string; name: string };

const dec = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2);
const ZERO = new Prisma.Decimal(0);

/** The ads' total, or null when unknown. */
const adsOf = (s: Summary) =>
  s.costs.ads ? Object.values(s.costs.ads).reduce((t, v) => t + Number(v), 0) : null;

/** The profit before fixed costs from the figures sent: net sales + delivery charges - costs. */
export function checkedProfitOf(s: Summary) {
  const costs = COST_LINES.reduce((t, k) => t + Number(s.costs[k] ?? 0), 0) + Number(adsOf(s) ?? 0);
  return dec((s.sales?.net ?? 0) + (s.income?.deliveryCharges ?? 0) - costs);
}

/** The same JSON whatever the order of its keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

// ---------------------------------------------------------------------------
// The site's calls
// ---------------------------------------------------------------------------

/** PUT /daily-summaries/{date}: a day's totals; the same body again changes nothing. */
export async function putDailySummary(
  ctx: CompanyContext,
  store: Store,
  date: string,
  raw: unknown,
) {
  const input = summarySchema.parse(raw);
  if (input.date !== date) {
    throw new EcommerceApiError(422, "VALIDATION", "The body's date is not the day in the path.");
  }
  if (date >= today(ctx)) {
    throw new EcommerceApiError(422, "VALIDATION", "Send a day only once it is over.");
  }
  const checked = checkedProfitOf(input);
  const payload = { ...input, incomplete: [...new Set(input.incomplete)].sort() };
  const latest = await ctx.db.retailDailySummary.findFirst({
    where: { storeId: store.id, date: dateColumn(date) },
    orderBy: { version: "desc" },
  });
  let row = latest;
  if (!latest || canonical(latest.payload) !== canonical(payload)) {
    row = await ctx.db.retailDailySummary.create({
      data: {
        companyId: ctx.company.id,
        storeId: store.id,
        date: dateColumn(date),
        version: (latest?.version ?? 0) + 1,
        payload: payload as unknown as Prisma.InputJsonObject,
        incomplete: payload.incomplete,
        netProfit: dec(input.netProfit),
        checkedProfit: checked,
      },
    });
    await checkBudget(store, date.slice(0, 7));
  }
  return {
    date,
    version: row!.version,
    receivedAt: row!.receivedAt.toISOString(),
    netProfit: Number(row!.netProfit),
    checkedProfit: Number(row!.checkedProfit),
    profitMatches: row!.netProfit.equals(row!.checkedProfit),
    incomplete: row!.incomplete,
    changed: row !== latest,
  };
}

const rangeSchema = z.object({
  from: z.string().regex(DAY_RE).optional(),
  to: z.string().regex(DAY_RE).optional(),
});

/** The newest version of each day in a range. */
async function latestDays(storeId: string, from: string, to: string) {
  const rows = await prisma.retailDailySummary.findMany({
    where: { storeId, date: { gte: dateColumn(from), lte: dateColumn(to) } },
    orderBy: [{ date: "asc" }, { version: "asc" }],
  });
  const byDay = new Map<string, (typeof rows)[number] & { versions: typeof rows }>();
  for (const r of rows) {
    const day = dateOnly(r.date);
    byDay.set(day, { ...r, versions: [...(byDay.get(day)?.versions ?? []), r] });
  }
  return byDay;
}

/** Days with no summary from the store's first one (or `from`) up to yesterday. */
async function missingDays(storeId: string, from: string, yesterday: string, have: Set<string>) {
  const first = await prisma.retailDailySummary.findFirst({
    where: { storeId },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (!first) return [];
  const missing: string[] = [];
  for (let d = from < dateOnly(first.date) ? dateOnly(first.date) : from; d <= yesterday;) {
    if (!have.has(d)) missing.push(d);
    d = addDays(d, 1);
  }
  return missing;
}

/** GET /daily-summaries?from&to: the days the ERP has, and the days it is missing. */
export async function listDailySummaries(ctx: CompanyContext, store: Store, raw: unknown) {
  const q = rangeSchema.parse(raw);
  const yesterday = addDays(today(ctx), -1);
  const to = q.to ?? yesterday;
  const from = q.from ?? addDays(to, -29);
  if (from > to || addDays(from, 92) < to) {
    throw new EcommerceApiError(422, "VALIDATION", "Ask for at most 92 days, from before to.");
  }
  const days = await latestDays(store.id, from, to);
  return {
    from,
    to,
    days: [...days.values()].map((d) => ({
      date: dateOnly(d.date),
      version: d.version,
      receivedAt: d.receivedAt.toISOString(),
      incomplete: d.incomplete,
      netProfit: Number(d.netProfit),
    })),
    missing: await missingDays(
      store.id,
      from,
      to < yesterday ? to : yesterday,
      new Set(days.keys()),
    ),
  };
}

/** PUT /fixed-costs/{month}: a month's fixed costs; the same body again changes nothing. */
export async function putFixedCosts(
  ctx: CompanyContext,
  store: Store,
  month: string,
  raw: unknown,
) {
  const input = fixedCostSchema.parse(raw);
  if (input.month !== month) {
    throw new EcommerceApiError(
      422,
      "VALIDATION",
      "The body's month is not the month in the path.",
    );
  }
  const c = input.costs;
  const values = {
    salary: dec(c.salary),
    rent: dec(c.rent),
    utilities: dec(c.utilities),
    other: dec(c.other),
  };
  const total = Object.values(values).reduce((t, v) => t.plus(v), ZERO);
  const latest = await ctx.db.retailFixedCost.findFirst({
    where: { storeId: store.id, month },
    orderBy: { version: "desc" },
  });
  const same =
    latest &&
    (Object.keys(values) as Array<keyof typeof values>).every((k) => latest[k].equals(values[k])) &&
    (latest.note ?? null) === (input.note ?? null);
  const row = same
    ? latest
    : await ctx.db.retailFixedCost.create({
        data: {
          companyId: ctx.company.id,
          storeId: store.id,
          month,
          version: (latest?.version ?? 0) + 1,
          ...values,
          total,
          note: input.note ?? null,
        },
      });
  if (!same) await checkBudget(store, month);
  return { ...fixedView(row), changed: !same };
}

const fixedView = (r: {
  month: string;
  version: number;
  salary: Prisma.Decimal;
  rent: Prisma.Decimal;
  utilities: Prisma.Decimal;
  other: Prisma.Decimal;
  total: Prisma.Decimal;
  note: string | null;
  receivedAt: Date;
}) => ({
  month: r.month,
  version: r.version,
  costs: {
    salary: Number(r.salary),
    rent: Number(r.rent),
    utilities: Number(r.utilities),
    other: Number(r.other),
  },
  total: Number(r.total),
  note: r.note,
  receivedAt: r.receivedAt.toISOString(),
});

/** GET /fixed-costs?from&to (months): the newest version of each month. */
export async function listFixedCosts(ctx: CompanyContext, store: Store, raw: unknown) {
  const q = z
    .object({
      from: z.string().regex(MONTH_RE).optional(),
      to: z.string().regex(MONTH_RE).optional(),
    })
    .parse(raw);
  const rows = await ctx.db.retailFixedCost.findMany({
    where: {
      storeId: store.id,
      ...(q.from || q.to
        ? { month: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    },
    orderBy: [{ month: "asc" }, { version: "asc" }],
  });
  const latest = new Map(rows.map((r) => [r.month, r]));
  return { months: [...latest.values()].map(fixedView) };
}

// ---------------------------------------------------------------------------
// Budget, target and the month's figures
// ---------------------------------------------------------------------------

export const BUDGET_LINES = ["ads", "packaging", "delivery", "salary", "other"] as const;
type BudgetLine = (typeof BUDGET_LINES)[number];

const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** A month's spend per budget line, from the newest summaries and fixed costs. */
async function monthFigures(storeId: string, month: string) {
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const rows = await prisma.retailDailySummary.findMany({
    where: { storeId, date: { gte: dateColumn(from), lte: dateColumn(to) } },
    orderBy: [{ date: "asc" }, { version: "asc" }],
  });
  const days = new Map(rows.map((r) => [dateOnly(r.date), r]));
  const fixed = await prisma.retailFixedCost.findFirst({
    where: { storeId, month },
    orderBy: { version: "desc" },
  });
  const spent: Record<BudgetLine, number> = {
    ads: 0,
    packaging: 0,
    delivery: 0,
    salary: 0,
    other: 0,
  };
  let netSales = 0;
  let netProfit = 0;
  const incomplete = new Set<string>();
  for (const r of days.values()) {
    const s = r.payload as unknown as Summary;
    spent.ads += Number(adsOf(s) ?? 0);
    spent.packaging += Number(s.costs.packaging ?? 0);
    spent.delivery += Number(s.costs.delivery ?? 0);
    spent.other +=
      Number(s.costs.paymentFees ?? 0) +
      Number(s.costs.accessories ?? 0) +
      Number(s.costs.other ?? 0);
    netSales += Number(s.sales?.net ?? 0);
    netProfit += Number(r.netProfit);
    for (const k of r.incomplete) incomplete.add(k);
  }
  if (fixed) {
    spent.salary += Number(fixed.salary);
    spent.other += Number(fixed.rent) + Number(fixed.utilities) + Number(fixed.other);
  }
  return { days: days.size, spent, netSales, netProfit, fixed, incomplete: [...incomplete] };
}

/** Over 100% of a budget line: the owner is told once per line and month. */
async function checkBudget(store: Store, month: string) {
  const budget = await prisma.retailBudget.findUnique({
    where: { storeId_month: { storeId: store.id, month } },
  });
  if (!budget) return;
  const { spent } = await monthFigures(store.id, month);
  const over = BUDGET_LINES.filter(
    (l) =>
      budget[l] !== null &&
      budget[l]!.gt(0) &&
      spent[l] > Number(budget[l]) &&
      !budget.alerted.includes(l),
  );
  if (over.length === 0) return;
  await prisma.retailBudget.update({
    where: { id: budget.id },
    data: { alerted: [...budget.alerted, ...over] },
  });
  const text = over
    .map((l) => `${l} ${spent[l].toFixed(0)} of ${Number(budget[l]).toFixed(0)}`)
    .join(", ");
  await alarm(store, `${store.name}: budget passed for ${month}`, `Over the budget: ${text}.`);
}

/** In the inbox of the people who look after the stores, and on the bot as an alarm. */
async function alarm(store: Store, subject: string, body: string) {
  const to = (await activeMembers(store.companyId)).filter(
    (m) => m.permissions.has("retail.manage") || m.permissions.has("retail.view"),
  );
  await sendInApp(prisma, store.companyId, to, {
    subject,
    body,
    entityType: "RetailStore",
    entityId: store.id,
  });
  try {
    const { pushToBot } = await import("@/modules/ai/bot/push");
    await pushToBot(
      store.companyId,
      { kind: "text", text: `${subject}. ${body}` },
      { alarm: true },
    );
  } catch (error) {
    console.error(
      "[retail] alarm not sent to the bot",
      error instanceof Error ? error.message : error,
    );
  }
}

const optionalAmount = z
  .string()
  .trim()
  .regex(/^(\d{1,10}(\.\d{1,2})?)?$/, "An amount like 15000")
  .optional()
  .transform((v) => (v ? new Prisma.Decimal(v) : null));

export const budgetSchema = z.object({
  month: z.string().regex(MONTH_RE, "A month like 2026-11"),
  ads: optionalAmount,
  packaging: optionalAmount,
  delivery: optionalAmount,
  salary: optionalAmount,
  other: optionalAmount,
});

/** The owner sets a month's budget (an empty line is not budgeted). */
export async function setBudget(
  ctx: CompanyContext,
  storeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageStores(ctx);
  const input = budgetSchema.parse(raw);
  const store = await ctx.db.retailStore.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
  const lines = Object.fromEntries(BUDGET_LINES.map((l) => [l, input[l]])) as Record<
    BudgetLine,
    Prisma.Decimal | null
  >;
  await ctx.db.retailBudget.upsert({
    where: { storeId_month: { storeId, month: input.month } },
    create: {
      companyId: ctx.company.id,
      storeId,
      month: input.month,
      ...lines,
      setById: ctx.user.id,
    },
    update: { ...lines, alerted: [], setById: ctx.user.id },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: storeId,
    summary: `${store.name}: budget for ${input.month} set (${BUDGET_LINES.map(
      (l) => `${l} ${lines[l]?.toFixed(0) ?? "-"}`,
    ).join(", ")})`,
  });
  await checkBudget(store, input.month);
}

/** "Copy last month": last month's budget for this month (then changeable). */
export async function copyLastMonthBudget(
  ctx: CompanyContext,
  storeId: string,
  month: string,
  meta?: RequestMeta,
) {
  assertCanManageStores(ctx);
  if (!MONTH_RE.test(month)) throw new AppError("VALIDATION", "A month like 2026-11.");
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const before = await ctx.db.retailBudget.findUnique({
    where: { storeId_month: { storeId, month: last } },
  });
  if (!before) throw new AppError("VALIDATION", `There is no budget for ${last} to copy.`);
  await setBudget(
    ctx,
    storeId,
    {
      month,
      ...Object.fromEntries(BUDGET_LINES.map((l) => [l, before[l]?.toFixed(2) ?? ""])),
    },
    meta,
  );
}

export const targetSchema = z.object({
  month: z.string().regex(MONTH_RE, "A month like 2026-11"),
  sales: z
    .string()
    .trim()
    .regex(/^\d{1,11}(\.\d{1,2})?$/, "An amount like 500000"),
});

/** The owner sets a month's sales target (0 takes it off). */
export async function setTarget(
  ctx: CompanyContext,
  storeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageStores(ctx);
  const input = targetSchema.parse(raw);
  const store = await ctx.db.retailStore.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
  const sales = new Prisma.Decimal(input.sales);
  await ctx.db.retailTarget.upsert({
    where: { storeId_month: { storeId, month: input.month } },
    create: { companyId: ctx.company.id, storeId, month: input.month, sales, setById: ctx.user.id },
    update: { sales, setById: ctx.user.id },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: storeId,
    summary: `${store.name}: sales target for ${input.month} = ${sales.toFixed(2)}`,
  });
}

/** The store page's own-books part: recent days, missing days, this month's costs, budget and target. */
export async function storeBooks(ctx: CompanyContext, storeId: string) {
  assertCanSeeStores(ctx);
  const store = await ctx.db.retailStore.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
  const day = today(ctx);
  const yesterday = addDays(day, -1);
  const month = day.slice(0, 7);
  const lookFrom = addDays(yesterday, -(LOOK_BACK_DAYS - 1));
  const [all, figures, budget, target] = await Promise.all([
    latestDays(storeId, lookFrom, yesterday),
    monthFigures(storeId, month),
    ctx.db.retailBudget.findUnique({ where: { storeId_month: { storeId, month } } }),
    ctx.db.retailTarget.findUnique({ where: { storeId_month: { storeId, month } } }),
  ]);
  const missing = await missingDays(storeId, lookFrom, yesterday, new Set(all.keys()));
  const days = [...all.values()].slice(-14);
  const daysSoFar = Number(day.slice(8, 10)) - 1;
  const fixedSoFar = figures.fixed
    ? (Number(figures.fixed.total) / daysInMonth(month)) * daysSoFar
    : null;
  return {
    month,
    missing,
    days: days.reverse().map((d) => {
      const previous = d.versions.length > 1 ? d.versions[d.versions.length - 2]! : null;
      return {
        date: dateOnly(d.date),
        netProfit: d.netProfit.toFixed(2),
        profitMatches: d.netProfit.equals(d.checkedProfit),
        checkedProfit: d.checkedProfit.toFixed(2),
        incomplete: d.incomplete,
        versions: d.version,
        previousProfit: previous ? previous.netProfit.toFixed(2) : null,
      };
    }),
    fixed: figures.fixed
      ? {
          ...fixedView(figures.fixed),
          perDay: (Number(figures.fixed.total) / daysInMonth(month)).toFixed(2),
        }
      : null,
    monthSoFar: {
      days: figures.days,
      netSales: figures.netSales.toFixed(2),
      netProfit: figures.netProfit.toFixed(2),
      afterFixed: fixedSoFar === null ? null : (figures.netProfit - fixedSoFar).toFixed(2),
      incomplete: figures.incomplete,
    },
    budget: BUDGET_LINES.map((line) => {
      const limit = budget?.[line] ?? null;
      const spent = figures.spent[line];
      const share = limit && limit.gt(0) ? spent / Number(limit) : null;
      return {
        line,
        budget: limit?.toFixed(2) ?? null,
        spent: spent.toFixed(2),
        state: share === null ? "NONE" : share > 1 ? "RED" : share >= 0.8 ? "YELLOW" : "GREEN",
      };
    }),
    target:
      target && target.sales.gt(0)
        ? {
            sales: target.sales.toFixed(2),
            done: figures.netSales.toFixed(2),
            percent: target.sales.gt(0)
              ? Math.round((figures.netSales / Number(target.sales)) * 100)
              : 0,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// The guards: no day goes missing
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;

/**
 * Every minute (the shops' webhook clock): from 01:00 asks each site for its
 * missing days (summary.missing, at most hourly); from 09:00 tells the owner
 * once a day. Returns how many stores were asked.
 */
export async function summaryGuards(now: Date = new Date()) {
  const stores = await prisma.retailStore.findMany({
    where: { closedAt: null, integrationId: { not: null }, summaries: { some: {} } },
    include: { company: { select: { timezone: true } }, integration: true },
  });
  let asked = 0;
  for (const store of stores) {
    const zone = store.company.timezone;
    const time = localTime(now, zone);
    if (time < "01:00") continue;
    const day = localDay(now, zone);
    const yesterday = addDays(day, -1);
    const from = addDays(yesterday, -(LOOK_BACK_DAYS - 1));
    const rows = await prisma.retailDailySummary.findMany({
      where: { storeId: store.id, date: { gte: dateColumn(from), lte: dateColumn(yesterday) } },
      select: { date: true },
    });
    const missing = await missingDays(
      store.id,
      from,
      yesterday,
      new Set(rows.map((r) => dateOnly(r.date))),
    );
    if (missing.length === 0) continue;
    const shop = store.integration;
    if (
      shop?.isActive &&
      shop.webhookUrl &&
      (!store.summaryAskedAt || now.getTime() - store.summaryAskedAt.getTime() >= HOUR)
    ) {
      const { queueShopEvent } = await import("@/modules/ecommerce/webhooks");
      await queueShopEvent(shop, "summary.missing", { dates: missing }, now);
      await prisma.retailStore.update({ where: { id: store.id }, data: { summaryAskedAt: now } });
      asked += 1;
    }
    if (time >= "09:00" && (!store.summaryAlertedOn || dateOnly(store.summaryAlertedOn) !== day)) {
      await prisma.retailStore.update({
        where: { id: store.id },
        data: { summaryAlertedOn: dateColumn(day) },
      });
      await alarm(
        store,
        `${store.name}: daily figures missing`,
        `Missing days: ${missing.join(", ")}. The site was asked for them; check its connection.`,
      );
      await recordAudit({
        companyId: store.companyId,
        userId: null,
        action: "STATUS_CHANGE",
        entityType: "RetailStore",
        entityId: store.id,
        summary: `${store.name}: daily summaries missing for ${missing.join(", ")}`,
      });
    }
  }
  return asked;
}

export type StoreBooks = Awaited<ReturnType<typeof storeBooks>>;
