import { readOnlyReason } from "@/lib/read-only";
import { type B2bAcquisitionLine, Prisma, type SalesChannel } from "@prisma/client";
import { z } from "zod";

import type { Db } from "@/lib/db-types";
import { localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { createNumberedAccount } from "@/modules/accounts/chart";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";

/*
 * Customer acquisition (B2B), 2026-11-12
 * --------------------------------------
 * What finding new wholesale buyers costs: one expense head "Customer
 * acquisition (B2B)" (a parent ledger account) with six sub-heads, each an
 * expense head with its own child account. They are recorded like any expense
 * through Accounts (the money rules are unchanged). It is an office cost: never
 * part of order costing, a cost before Net profit, and never mixed with the
 * shops' ad spend (that comes in the shops' daily summaries, not the books).
 *
 * Business > B2B shows a month's spend, by sub-head (from the books, so every
 * way of recording it counts; a voided expense and its reversal both drop out),
 * the new buyers whose first wholesale order is in that month, the cost per new
 * buyer, and an optional budget per sub-head (80% yellow, over 100% red).
 * Who sees it: the same as Business > Overview (the financials).
 */

export const ACQUISITION_HEAD = "Customer acquisition (B2B)";

export const ACQUISITION_LINES: ReadonlyArray<{ line: B2bAcquisitionLine; name: string }> = [
  { line: "ONLINE_ADS", name: "Online ads" },
  { line: "TRADE_FAIRS", name: "Trade fairs and exhibitions" },
  { line: "SAMPLES", name: "Samples to new buyers" },
  { line: "PLATFORMS", name: "B2B platforms" },
  { line: "TRAVEL", name: "Travel and buyer visits" },
  { line: "OTHER", name: "Other" },
];

/** "Customer acquisition (B2B): Online ads": the sub-head's name in Accounts' head list. */
export const acquisitionHeadName = (name: string) => `${ACQUISITION_HEAD}: ${name}`;

/**
 * Gives a company the "Customer acquisition (B2B)" account and its six
 * sub-heads (each an expense head on its own child account), on first use.
 * Safe to repeat and to run at once from two requests (a per-company lock).
 * A sub-head someone renamed or archived is found by its line and left as it is.
 */
export async function ensureB2bAcquisitionHeads(companyId: string, db: Db = prisma) {
  const have = await db.expenseHead.count({
    where: { companyId, acquisitionLine: { not: null } },
  });
  if (have >= ACQUISITION_LINES.length) return;
  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`b2b-heads:${companyId}`}))`;
    const heads = await tx.expenseHead.findMany({
      where: { companyId, acquisitionLine: { not: null } },
      select: { acquisitionLine: true, ledgerAccount: { select: { parentId: true } } },
    });
    const done = new Set(heads.map((h) => h.acquisitionLine));
    if (done.size >= ACQUISITION_LINES.length) return;
    const parentId =
      heads.find((h) => h.ledgerAccount?.parentId)?.ledgerAccount?.parentId ??
      (
        await tx.ledgerAccount.findFirst({
          where: { companyId, type: "EXPENSE", name: ACQUISITION_HEAD },
          select: { id: true },
        })
      )?.id ??
      (
        await createNumberedAccount(tx, companyId, {
          name: ACQUISITION_HEAD,
          subType: "MARKETING_EXPENSE",
          isSystem: true,
        })
      ).id;
    for (const { line, name } of ACQUISITION_LINES) {
      if (done.has(line)) continue;
      const headName = acquisitionHeadName(name);
      const account =
        (await tx.ledgerAccount.findFirst({
          where: { companyId, type: "EXPENSE", name: headName },
          select: { id: true },
        })) ??
        (await createNumberedAccount(tx, companyId, {
          name: headName,
          subType: "MARKETING_EXPENSE",
          isSystem: true,
        }));
      await tx.ledgerAccount.update({ where: { id: account.id }, data: { parentId } });
      // A head with that name made by hand becomes the sub-head (its account stays its own).
      const same = await tx.expenseHead.findUnique({
        where: { companyId_name: { companyId, name: headName } },
        select: { id: true, acquisitionLine: true },
      });
      if (same) {
        if (!same.acquisitionLine) {
          await tx.expenseHead.update({
            where: { id: same.id },
            data: { acquisitionLine: line },
          });
        }
        continue;
      }
      await tx.expenseHead.create({
        data: {
          companyId,
          name: headName,
          category: "MARKETING",
          isProductionCost: false,
          ledgerAccountId: account.id,
          acquisitionLine: line,
        },
      });
    }
  };
  // Inside a caller's transaction already, or a transaction of its own.
  if ("$transaction" in db) await (db as typeof prisma).$transaction(run, { timeout: 30_000 });
  else await run(db as Prisma.TransactionClient);
}

function assertCanSee(ctx: CompanyContext) {
  if (!canSeeFinancials(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Business > B2B shows business money: it needs the permission to see the financials.",
    );
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthSchema = z.string().regex(MONTH_RE, "A month like 2026-11");

function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthRange(month: string, tz: string) {
  return {
    start: startOfDayInZone(`${month}-01`, tz),
    end: startOfDayInZone(`${nextMonth(month)}-01`, tz),
  };
}

const ZERO = new Prisma.Decimal(0);
/** The wholesale channels (as sales/pricing.ts), named here to keep Accounts' setup light. */
const WHOLESALE_CHANNELS: SalesChannel[] = ["WHOLESALE", "B2B_PREORDER"];

/** A budget's state: 80% yellow, over 100% red (as the retail budgets). */
export function budgetState(spent: Prisma.Decimal, budget: Prisma.Decimal | null) {
  if (!budget || budget.lte(0)) return "NONE" as const;
  const share = spent.dividedBy(budget);
  if (share.gt(1)) return "RED" as const;
  if (share.gte(0.8)) return "YELLOW" as const;
  return "GREEN" as const;
}

/**
 * Buyers whose first wholesale order (not cancelled) is in the range: new
 * buyers. A retail store (a special buyer of the ERP's) and sales without a
 * buyer never count.
 */
async function newBuyersIn(ctx: CompanyContext, start: Date, end: Date) {
  const firsts = await ctx.db.salesOrder.groupBy({
    by: ["partyId"],
    where: {
      partyId: { not: null },
      channel: { in: WHOLESALE_CHANNELS },
      status: { not: "CANCELLED" },
      party: { retailStore: null },
    },
    _min: { orderDate: true },
  });
  const ids = firsts
    .filter((f) => f._min.orderDate && f._min.orderDate >= start && f._min.orderDate < end)
    .map((f) => f.partyId!);
  if (ids.length === 0) return [];
  return ctx.db.party.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Business > B2B for a month (this month unless given). */
export async function b2bPage(ctx: CompanyContext, raw: { month?: unknown } = {}) {
  assertCanSee(ctx);
  const tz = ctx.company.timezone;
  const thisMonth = localDay(new Date(), tz).slice(0, 7);
  const month = raw.month === undefined || raw.month === "" ? thisMonth : String(raw.month);
  if (!MONTH_RE.test(month)) {
    throw new AppError("VALIDATION", "Choose a month like 2026-11.", { month: ["A month"] });
  }
  // A read-only session (Full check) never writes: the heads are made on a normal visit.
  if (!(await readOnlyReason())) await ensureB2bAcquisitionHeads(ctx.company.id);
  const { start, end } = monthRange(month, tz);
  const heads = await ctx.db.expenseHead.findMany({
    where: { acquisitionLine: { not: null } },
    select: { id: true, name: true, acquisitionLine: true, ledgerAccountId: true, isActive: true },
  });
  const accountOf = new Map(heads.map((h) => [h.acquisitionLine!, h.ledgerAccountId]));
  const accountIds = heads.flatMap((h) => (h.ledgerAccountId ? [h.ledgerAccountId] : []));
  const [sums, budgets, buyers] = await Promise.all([
    accountIds.length > 0
      ? prisma.journalLine.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: accountIds },
            // A reversed entry and its reversal (a voided expense) both drop out.
            entry: {
              companyId: ctx.company.id,
              date: { gte: start, lt: end },
              isReversed: false,
              reversalOfId: null,
            },
          },
          _sum: { debit: true, credit: true },
        })
      : Promise.resolve([]),
    ctx.db.b2bAcquisitionBudget.findMany({ where: { month } }),
    newBuyersIn(ctx, start, end),
  ]);
  const spentOn = new Map(
    sums.map((s) => [s.accountId, (s._sum.debit ?? ZERO).minus(s._sum.credit ?? ZERO)]),
  );
  // A budget cleared to 0 is no budget.
  const budgetOf = new Map(budgets.filter((b) => b.amount.gt(0)).map((b) => [b.line, b.amount]));
  const lines = ACQUISITION_LINES.map(({ line, name }) => {
    const accountId = accountOf.get(line);
    const spent = (accountId && spentOn.get(accountId)) || ZERO;
    const budget = budgetOf.get(line) ?? null;
    return {
      line,
      name,
      spent: spent.toFixed(2),
      budget: budget?.toFixed(2) ?? null,
      state: budgetState(spent, budget),
      percent: budget && budget.gt(0) ? Math.round(Number(spent.dividedBy(budget)) * 100) : null,
    };
  });
  const total = lines.reduce((t, l) => t.plus(l.spent), ZERO);
  const budgetTotal = lines.reduce<Prisma.Decimal | null>(
    (t, l) => (l.budget === null ? t : (t ?? ZERO).plus(l.budget)),
    null,
  );
  return {
    month,
    thisMonth,
    currency: ctx.company.currency,
    lines,
    total: total.toFixed(2),
    budgetTotal: budgetTotal?.toFixed(2) ?? null,
    totalState: budgetState(total, budgetTotal),
    newBuyers: buyers,
    costPerNewBuyer: buyers.length > 0 ? total.dividedBy(buyers.length).toFixed(2) : null,
  };
}

export type B2bPage = Awaited<ReturnType<typeof b2bPage>>;

const amount = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().min(0, "0 or more").max(1e11).nullable(),
);

export const b2bBudgetSchema = z.object({
  month: monthSchema,
  ...Object.fromEntries(ACQUISITION_LINES.map(({ line }) => [line, amount])),
}) as z.ZodType<{ month: string } & Partial<Record<B2bAcquisitionLine, number | null>>>;

/**
 * Sets a month's budget per sub-head (an empty one has no budget). Only who
 * sees Business > B2B sets it; a budget moves no money.
 */
export async function setB2bBudget(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanSee(ctx);
  const input = b2bBudgetSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    for (const { line } of ACQUISITION_LINES) {
      const value = input[line];
      const key = { companyId_month_line: { companyId: ctx.company.id, month: input.month, line } };
      if (value === null || value === undefined) {
        // No budget for that line: the row is cleared to 0 (kept, never deleted).
        await tx.b2bAcquisitionBudget.updateMany({
          where: { companyId: ctx.company.id, month: input.month, line },
          data: { amount: 0, setById: ctx.user.id },
        });
        continue;
      }
      await tx.b2bAcquisitionBudget.upsert({
        where: key,
        create: {
          companyId: ctx.company.id,
          month: input.month,
          line,
          amount: new Prisma.Decimal(value).toDecimalPlaces(2),
          setById: ctx.user.id,
        },
        update: { amount: new Prisma.Decimal(value).toDecimalPlaces(2), setById: ctx.user.id },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "B2bAcquisitionBudget",
        entityId: input.month,
        summary: `Customer acquisition (B2B) budget for ${input.month}: ${ACQUISITION_LINES.map(
          ({ line, name }) => `${name} ${input[line] ?? "-"}`,
        ).join(", ")}`,
      },
      tx,
    );
  });
}
