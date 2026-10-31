import { prisma } from "@/lib/prisma";
import { addLoan } from "@/modules/accounts/loans.service";
import { ensureGeneralExpenseHeads } from "@/modules/expenses/expense.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * The loans sample on the demo site, so Loans & capital, a lender's profile and
 * Monthly fixed costs show real-looking records (and the Help pictures have
 * them): a BRAC Bank loan running before the ERP and kept in capital, a person's
 * money on 3-month terms, and the office rent as a monthly fixed cost. Each is
 * entered as "taken before the ERP", so no money moves. Once: when the bank loan
 * is there already it does nothing.
 */

export const LOANS_SAMPLE_BANK = "BRAC Bank";

export async function loadLoansSamples(ctx: CompanyContext) {
  const there = await prisma.capitalLender.findFirst({
    where: { companyId: ctx.company.id, name: LOANS_SAMPLE_BANK },
    select: { id: true },
  });
  if (there) return null;
  const today = new Date().toISOString().slice(0, 10);
  const monthsAgo = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.toISOString().slice(0, 10);
  };
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  const bank = await addLoan(ctx, {
    lenderKind: "BANK",
    lenderName: LOANS_SAMPLE_BANK,
    contact: "Gulshan branch",
    amount: 1_000_000,
    takenOn: monthsAgo(4),
    before: { owedNow: 666_666.68 },
    interestRate: 12,
    keepInCapital: true,
    installmentAmount: 100_000,
    installmentsLeft: 8,
    nextDueDate: inDays(10),
    notes: "Working capital loan for the winter orders",
  });
  await addLoan(ctx, {
    lenderKind: "PERSON",
    lenderName: "Shishir",
    amount: 1_000_000,
    takenOn: monthsAgo(2),
    before: { owedNow: 1_000_000 },
    periodMonths: 3,
    profitPerPeriod: 30_000,
  });
  await ensureGeneralExpenseHeads(ctx.company.id);
  const heads = await prisma.expenseHead.findMany({
    where: {
      companyId: ctx.company.id,
      isActive: true,
      isProductionCost: false,
      requiresEmployee: false,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const head = heads.find((h) => /rent/i.test(h.name)) ?? heads[0];
  if (head) {
    await prisma.recurringExpense.create({
      data: {
        companyId: ctx.company.id,
        name: "Office rent",
        headId: head.id,
        amount: 45_000,
        dayOfMonth: 5,
        startMonth: inDays(40).slice(0, 7),
        createdById: ctx.user.id,
      },
    });
  }
  return { lenderId: bank.lenderId, name: LOANS_SAMPLE_BANK };
}
