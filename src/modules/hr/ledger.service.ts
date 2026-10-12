import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { ZERO } from "@/modules/accounts/balances";
import type { CompanyContext } from "@/modules/auth/context";
import { requireLinkedEmployee } from "@/modules/hr/access";
import { monthKey, monthLabel } from "@/modules/hr/calendar";
import { owedForClaims } from "@/modules/hr/claims.service";
import { balanceOf } from "@/modules/hr/payroll-calc";

/*
 * The employee's money with the company, in plain figures (My HR > Money):
 * each approved month's take-home worked out line by line
 *   basic + approved overtime (+ allowances, bonus) + claims paid back
 *   - (unpaid days + advance EMI + tax + other deductions) = take-home
 * with every part paid so far (date, how, voucher) and what is still to come;
 * and, beside it, what they still owe on advances and the claims to be paid
 * back on their own. Drafts are not shown: their figures can still change.
 */

const MONTHS = 24;

export type LedgerLine = { label: string; amount: string; sign: "+" | "-" };

export async function myMoney(ctx: CompanyContext) {
  const employee = await requireLinkedEmployee(ctx);
  const tz = ctx.company.timezone;
  const [items, advances, claimsOwed] = await Promise.all([
    prisma.payrollItem.findMany({
      where: {
        employeeId: employee.id,
        run: { companyId: ctx.company.id, status: { in: ["APPROVED", "PAID"] } },
      },
      include: {
        run: { select: { year: true, month: true, approvedAt: true } },
        claims: { select: { number: true }, orderBy: { number: "asc" } },
        paymentLines: {
          where: { payment: { voidedAt: null } },
          include: { payment: { select: { number: true, date: true, method: true } } },
          orderBy: { payment: { date: "asc" } },
        },
      },
      orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
      take: MONTHS,
    }),
    prisma.salaryAdvance.findMany({
      where: { companyId: ctx.company.id, employeeId: employee.id, status: "OPEN" },
      select: { number: true, outstanding: true },
      orderBy: { givenAt: "asc" },
    }),
    owedForClaims(prisma, ctx.company.id, employee.id),
  ]);

  const months = items.map((i) => {
    const plus = (label: string, amount: typeof i.basic): LedgerLine[] =>
      amount.gt(0) ? [{ label, amount: amount.toFixed(2), sign: "+" }] : [];
    const minus = (label: string, amount: typeof i.basic): LedgerLine[] =>
      amount.gt(0) ? [{ label, amount: amount.toFixed(2), sign: "-" }] : [];
    const unpaid = i.unpaidDays.toNumber();
    const lines: LedgerLine[] = [
      { label: "Basic salary for the month", amount: i.basic.toFixed(2), sign: "+" },
      ...plus(`Overtime, approved (${i.overtimeHours.toFixed(2)} h)`, i.overtime),
      ...plus("Allowances", i.allowances),
      ...plus("Bonus", i.bonus),
      ...plus(
        i.claims.length
          ? `Claims paid back (${i.claims.map((c) => c.number).join(", ")})`
          : "Claims paid back",
        i.reimbursements,
      ),
      ...minus(
        `Absence (${unpaid} unpaid ${unpaid === 1 ? "day" : "days"})`,
        i.unpaidLeaveDeduction,
      ),
      ...minus("Advance taken back (EMI)", i.advanceDeduction),
      ...minus("Tax (TDS)", i.taxDeduction),
      ...minus("Other deductions", i.otherDeductions),
    ];
    const month = monthKey(i.run.year, i.run.month);
    return {
      itemId: i.id,
      month,
      label: monthLabel(month),
      lines,
      netPay: i.netPay.toFixed(2),
      paid: i.paidAmount.toFixed(2),
      balance: balanceOf(i).toFixed(2),
      parts: i.paymentLines.map((l) => ({
        id: l.id,
        on: localDay(l.payment.date, tz),
        amount: l.amount.toFixed(2),
        method: l.payment.method,
        number: l.payment.number,
        payout: l.payout,
      })),
      note: i.note,
    };
  });

  const salaryOwed = items.reduce((t, i) => t.plus(balanceOf(i)), ZERO);
  const advancesOwed = advances.reduce((t, a) => t.plus(a.outstanding), ZERO);
  return {
    employee: { id: employee.id, code: employee.code, name: employee.name },
    summary: {
      /** Approved salaries not paid yet. */
      salaryOwed: salaryOwed.toFixed(2),
      /** Still owed on advances (taken back from salaries as set). */
      advancesOwed: advancesOwed.toFixed(2),
      advances: advances.length,
      /** Approved claims to be paid back on their own (not on a salary yet). */
      claimsOwed: claimsOwed.toFixed(2),
    },
    months,
  };
}

export type MyMoney = Awaited<ReturnType<typeof myMoney>>;
