import { Prisma } from "@prisma/client";

import { money, ZERO } from "@/modules/accounts/balances";
import { addMonths } from "@/modules/accounts/periods";

/*
 * Installment plans (pure functions, no database). The rate per installment is
 * the yearly rate spread over the gap between installments (monthly = rate / 12).
 *   EMI            equal payments; interest on the balance still owed, the rest
 *                  repays principal (bank-style reducing balance)
 *   FLAT           equal principal each time plus interest on the original amount
 *   INTEREST_ONLY  interest (or an investor's agreed return) each time, all the
 *                  principal back with the last installment
 * Amounts are rounded to the paisa; the last installment absorbs the rounding.
 */

export type InstallmentPlan = "EMI" | "FLAT" | "INTEREST_ONLY";

export type PlannedInstallment = {
  number: number;
  dueDate: string;
  principal: Prisma.Decimal;
  interest: Prisma.Decimal;
  amount: Prisma.Decimal;
  /** Principal still owed after this installment. */
  balanceAfter: Prisma.Decimal;
};

export function planInstallments(input: {
  plan: InstallmentPlan;
  principal: Prisma.Decimal;
  /** % per year. */
  annualRatePct: Prisma.Decimal.Value;
  count: number;
  firstDueDate: string;
  everyMonths: number;
}): PlannedInstallment[] {
  const { plan, principal, count, firstDueDate, everyMonths } = input;
  const rate = new Prisma.Decimal(input.annualRatePct)
    .dividedBy(100)
    .times(everyMonths)
    .dividedBy(12);
  const installments: PlannedInstallment[] = [];
  let balance = principal;

  // EMI with no interest is just equal principal.
  const emi =
    plan === "EMI" && rate.gt(0)
      ? money(
          principal.times(rate).dividedBy(new Prisma.Decimal(1).minus(rate.plus(1).pow(-count))),
        )
      : null;
  const flatPrincipal = money(principal.dividedBy(count));

  for (let i = 1; i <= count; i++) {
    const last = i === count;
    let principalPart: Prisma.Decimal;
    let interest: Prisma.Decimal;
    if (plan === "INTEREST_ONLY") {
      interest = money(principal.times(rate));
      principalPart = last ? balance : ZERO;
    } else if (plan === "FLAT") {
      interest = money(principal.times(rate));
      principalPart = last ? balance : Prisma.Decimal.min(flatPrincipal, balance);
    } else {
      interest = money(balance.times(rate));
      principalPart = last
        ? balance
        : Prisma.Decimal.min(emi ? emi.minus(interest) : flatPrincipal, balance);
    }
    balance = balance.minus(principalPart);
    installments.push({
      number: i,
      dueDate: addMonths(firstDueDate, (i - 1) * everyMonths),
      principal: principalPart,
      interest,
      amount: principalPart.plus(interest),
      balanceAfter: balance,
    });
  }
  return installments;
}

export function planTotals(installments: PlannedInstallment[]) {
  return installments.reduce(
    (t, i) => ({
      principal: t.principal.plus(i.principal),
      interest: t.interest.plus(i.interest),
      amount: t.amount.plus(i.amount),
    }),
    { principal: ZERO, interest: ZERO, amount: ZERO },
  );
}

/**
 * A plan from the installment the lender asks for, with no interest rate: what is
 * paid over the loan (amount x count) beyond what is owed is the interest, spread
 * evenly. 10,00,000 repaid as 12 x 1,00,000: each installment is 83,333.33
 * principal and 16,666.67 interest; the last takes the paisa left over. Null when
 * the installments do not cover what is owed.
 */
export function planFromInstallment(input: {
  principal: Prisma.Decimal;
  amount: Prisma.Decimal;
  count: number;
  firstDueDate: string;
  everyMonths: number;
}): PlannedInstallment[] | null {
  const { principal, amount, count, firstDueDate, everyMonths } = input;
  if (amount.times(count).lt(principal)) return null;
  // Rounded up, so the last installment's share is never more than the others' (and its
  // interest never below zero): the installment covers it, as amount x count >= principal.
  const each = principal.dividedBy(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
  const installments: PlannedInstallment[] = [];
  let balance = principal;
  for (let i = 1; i <= count; i++) {
    const principalPart = i === count ? balance : Prisma.Decimal.min(each, balance);
    balance = balance.minus(principalPart);
    installments.push({
      number: i,
      dueDate: addMonths(firstDueDate, (i - 1) * everyMonths),
      principal: principalPart,
      interest: amount.minus(principalPart),
      amount,
      balanceAfter: balance,
    });
  }
  return installments;
}
