import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { money, ZERO } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import {
  assertCanManageAccounts,
  assertCanPayMoney,
  assertCanViewAccounts,
} from "@/modules/accounts/money-guards";
import { recurringExpenseSchema, updateRecurringExpenseSchema } from "@/modules/accounts/schemas";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import { requirePin } from "@/modules/ai/settings.service";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import { actingAs } from "@/modules/auth/acting-as";
import type { CompanyContext } from "@/modules/auth/context";
import { createExpense } from "@/modules/expenses/expense.service";

/*
 * Monthly fixed costs (rent, internet, a guard's fee): set once, then the nightly
 * clock records each one as an ordinary expense on its day of the month, paid
 * from its account, in the name of the person who set it up (with the PIN), with
 * every rule checked for them as they are now. They are office costs in profit
 * and loss, never part of an order's costing. A changed amount counts from the
 * next month recorded; Stop ends it (it stays in the list, nothing is deleted).
 * Each month is recorded once: the month is claimed before the expense is made.
 */

const PIN_WHAT = "set up or change a monthly fixed cost";
/** Words that show a cost is someone's salary, which payroll already pays. */
const SALARY_WORDS = /salar|wage|payroll|বেতন/i;

const monthOf = (day: string) => day.slice(0, 7);

function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The day it is recorded in a month: its day, or the month's last day. */
export function dayInMonth(month: string, dayOfMonth: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(dayOfMonth, last)).padStart(2, "0")}`;
}

/** The months not yet recorded whose day has come, oldest first. */
export function monthsDue(
  cost: { startMonth: string; lastPostedMonth: string | null; dayOfMonth: number },
  today: string,
) {
  const months: string[] = [];
  let month = cost.lastPostedMonth ? nextMonth(cost.lastPostedMonth) : cost.startMonth;
  for (let n = 0; n < 120 && dayInMonth(month, cost.dayOfMonth) <= today; n++) {
    months.push(month);
    month = nextMonth(month);
  }
  return months;
}

export async function getFixedCostsScreen(ctx: CompanyContext) {
  assertCanViewAccounts(ctx);
  const today = localDay(new Date(), ctx.company.timezone);
  const canManage = ctx.can("accounts.manage") && ctx.can("accounts.payments.record");
  const [costs, heads, accounts] = await Promise.all([
    ctx.db.recurringExpense.findMany({
      include: { head: { select: { name: true } } },
      orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }, { name: "asc" }],
    }),
    canManage
      ? ctx.db.expenseHead.findMany({
          where: {
            isActive: true,
            isProductionCost: false,
            requiresEmployee: false,
            category: { not: "SALARY" },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canManage ? listMoneyAccounts(ctx) : Promise.resolve([]),
  ]);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const items = costs.map((c) => {
    const due = c.isActive
      ? c.lastPostedMonth
        ? nextMonth(c.lastPostedMonth)
        : c.startMonth
      : null;
    return {
      id: c.id,
      name: c.name,
      head: c.head.name,
      amount: c.amount.toFixed(2),
      dayOfMonth: c.dayOfMonth,
      method: c.method,
      paidFrom: c.accountId ? (names.get(c.accountId) ?? null) : null,
      startMonth: c.startMonth,
      lastPostedMonth: c.lastPostedMonth,
      nextOn: due ? dayInMonth(due, c.dayOfMonth) : null,
      isActive: c.isActive,
      looksLikeSalary: SALARY_WORDS.test(`${c.name} ${c.head.name}`),
    };
  });
  const monthly = costs.filter((c) => c.isActive).reduce((t, c) => t.plus(c.amount), ZERO);
  return {
    items,
    monthly: monthly.toFixed(2),
    heads,
    accounts,
    thisMonth: monthOf(today),
    can: { manage: canManage },
  };
}

export async function createFixedCost(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can set up monthly fixed costs.");
  assertCanPayMoney(ctx);
  // The night records it as an expense in this person's name.
  if (!ctx.can("expenses.create")) {
    throw new AppError("FORBIDDEN", "Recording expenses is not part of your role.");
  }
  const input = recurringExpenseSchema.parse(raw);
  await requirePin(ctx, input.pin, PIN_WHAT);
  const head = await ctx.db.expenseHead.findFirst({
    where: {
      id: input.headId,
      isActive: true,
      isProductionCost: false,
      requiresEmployee: false,
      category: { not: "SALARY" },
    },
  });
  // Salaries are paid in payroll; a head that names an employee needs one each time.
  if (!head) throw new AppError("NOT_FOUND", "That expense head is not in the list.");
  const accountId = await cashAccountFor(prisma, ctx.company.id, input.method, input.accountId);
  const today = localDay(new Date(), ctx.company.timezone);
  // Never a month whose day has passed: that one was most likely paid by hand already.
  const firstOpen = (month: string) =>
    dayInMonth(month, input.dayOfMonth) < today ? nextMonth(month) : month;
  const startMonth = input.startMonth ?? firstOpen(monthOf(today));
  if (startMonth !== firstOpen(startMonth) || startMonth < monthOf(today)) {
    throw new AppError(
      "VALIDATION",
      `Day ${input.dayOfMonth} of ${startMonth} has passed: record that month by hand if it is not paid, and start from ${firstOpen(monthOf(today))}.`,
      { startMonth: [`From ${firstOpen(monthOf(today))}`] },
    );
  }
  return prisma.$transaction(async (tx) => {
    const created = await tx.recurringExpense.create({
      data: {
        companyId: ctx.company.id,
        name: input.name,
        headId: head.id,
        amount: money(input.amount),
        dayOfMonth: input.dayOfMonth,
        method: input.method,
        accountId,
        startMonth,
        createdById: ctx.user.id,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "RecurringExpense",
        entityId: created.id,
        summary: `Monthly fixed cost ${created.name}: ${created.amount.toFixed(2)} (${head.name}) on day ${created.dayOfMonth}, from ${startMonth}`,
      },
      tx,
    );
    return { id: created.id };
  });
}

/** A new amount or day (with the PIN; from the next month recorded), or Stop. */
export async function updateFixedCost(
  ctx: CompanyContext,
  costId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can change monthly fixed costs.");
  const input = updateRecurringExpenseSchema.parse(raw);
  const cost = await ctx.db.recurringExpense.findFirst({ where: { id: costId } });
  if (!cost) throw new AppError("NOT_FOUND", "Monthly fixed cost not found.");
  if (!cost.isActive) throw new AppError("CONFLICT", `${cost.name} is stopped.`);
  const changes = input.amount !== undefined || input.dayOfMonth !== undefined;
  if (changes && !input.stop) {
    assertCanPayMoney(ctx);
    await requirePin(ctx, input.pin, PIN_WHAT);
  }
  await prisma.$transaction(async (tx) => {
    await tx.recurringExpense.update({
      where: { id: cost.id },
      data: input.stop
        ? { isActive: false, stoppedAt: new Date() }
        : {
            ...(input.amount !== undefined ? { amount: money(input.amount) } : {}),
            ...(input.dayOfMonth !== undefined ? { dayOfMonth: input.dayOfMonth } : {}),
          },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: input.stop ? "STATUS_CHANGE" : "UPDATE",
        entityType: "RecurringExpense",
        entityId: cost.id,
        summary: input.stop
          ? `Stopped the monthly fixed cost ${cost.name}`
          : `Monthly fixed cost ${cost.name}: ${[
              input.amount !== undefined
                ? `${cost.amount.toFixed(2)} -> ${money(input.amount).toFixed(2)}`
                : null,
              input.dayOfMonth !== undefined
                ? `day ${cost.dayOfMonth} -> ${input.dayOfMonth}`
                : null,
            ]
              .filter(Boolean)
              .join(", ")}`,
      },
      tx,
    );
  });
  return { id: cost.id };
}

/**
 * Records every monthly fixed cost whose day has come (a month missed while the
 * server was off is recorded too, on its own day). Someone who can no longer pay
 * money stops their costs (logged). Safe to repeat.
 */
export async function recordDueFixedCosts(now: Date = new Date()) {
  const costs = await prisma.recurringExpense.findMany({
    where: { isActive: true },
    include: { company: { select: { timezone: true } } },
    orderBy: { createdAt: "asc" },
  });
  let recorded = 0;
  for (const cost of costs) {
    const months = monthsDue(cost, localDay(now, cost.company.timezone));
    if (months.length === 0) continue;
    const ctx = await actingAs(cost.createdById, cost.companyId);
    if (!ctx || !ctx.can("expenses.create") || !ctx.can("accounts.payments.record")) {
      await prisma.recurringExpense.update({
        where: { id: cost.id },
        data: { isActive: false, stoppedAt: now },
      });
      await recordAudit({
        companyId: cost.companyId,
        userId: null,
        action: "STATUS_CHANGE",
        entityType: "RecurringExpense",
        entityId: cost.id,
        summary: `Stopped the monthly fixed cost ${cost.name}: the person who set it up can no longer pay money; set it up again`,
      });
      continue;
    }
    let last = cost.lastPostedMonth;
    for (const month of months) {
      // Claim the month first, so it is never recorded twice.
      const claimed = await prisma.recurringExpense.updateMany({
        where: { id: cost.id, isActive: true, lastPostedMonth: last },
        data: { lastPostedMonth: month },
      });
      if (claimed.count === 0) break;
      const description = `${cost.name} (monthly fixed cost, ${month})`;
      try {
        await createExpense(ctx, {
          headId: cost.headId,
          amount: Number(cost.amount.toFixed(2)),
          date: dayInMonth(month, cost.dayOfMonth),
          paymentType: "CASH_BANK",
          method: cost.method,
          accountId: cost.accountId ?? undefined,
          useAdvance: false,
          description,
        });
        recorded++;
        last = month;
      } catch (error) {
        // Failed after the expense was made (a read after saving): the month stays claimed.
        const made = await prisma.expense.count({
          where: { companyId: cost.companyId, headId: cost.headId, description },
        });
        if (made > 0) {
          recorded++;
          last = month;
          console.error("[fixed costs] recorded, then failed", cost.id, month, error);
          continue;
        }
        await prisma.recurringExpense.updateMany({
          where: { id: cost.id, lastPostedMonth: month },
          data: { lastPostedMonth: last },
        });
        console.error("[fixed costs] could not record", cost.id, month, error);
        break;
      }
    }
  }
  return recorded;
}

export type FixedCostsScreen = Awaited<ReturnType<typeof getFixedCostsScreen>>;
