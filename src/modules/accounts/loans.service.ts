import {
  type CapitalInstallment,
  type CapitalLender,
  type CapitalSource,
  Prisma,
} from "@prisma/client";

import { addDays, localDay, nextDay, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { money, ZERO } from "@/modules/accounts/balances";
import {
  createCapitalSourceTx,
  lockSource,
  outstandingTx,
  payInstallmentTx,
} from "@/modules/accounts/capital.service";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { planFromInstallment } from "@/modules/accounts/installments";
import {
  assertCanManageAccounts,
  assertCanPayMoney,
  assertCanViewAccounts,
} from "@/modules/accounts/money-guards";
import { NightProblems, reasonOf } from "@/modules/accounts/loan-alerts";
import { addMonths } from "@/modules/accounts/periods";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import {
  addLoanSchema,
  autoPaySchema,
  keepInCapitalSchema,
  termActionSchema,
} from "@/modules/accounts/schemas";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import { actingAs } from "@/modules/auth/acting-as";
import type { CompanyContext } from "@/modules/auth/context";
import { requirePin } from "@/modules/ai/settings.service";

/*
 * The Loans & capital page, on top of the capital sources (capital.service.ts):
 *   - each bank, NGO or person who lent money has a profile (CapitalLender) that
 *     groups every loan or term with them, running or closed (closed ones stay for
 *     good; nothing is deleted);
 *   - a bank or NGO loan is repaid by a fixed installment; what is paid beyond the
 *     loan is its interest, split evenly over the installments (no rate maths), and
 *     the installments can pay themselves on their due day (the nightly clock, in
 *     the name of whoever switched it on with the PIN);
 *   - a person's money is a term: profit every few months, then renewed, returned
 *     or partly returned;
 *   - a loan "kept in capital" counts in the owner's capital for ever: the money
 *     working in the business never drops for it, and its principal repayments come
 *     out of profit (reports.service.ts shows them below net profit). Interest and a
 *     person's profit are always a cost (Finance costs), whatever the choice.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };
const UNPAID = ["SCHEDULED", "OVERDUE"] as const;
const LOAN_KINDS = ["BANK_LOAN", "PRIVATE_LOAN", "INVESTOR"] as const;
const PIN_WHAT = "set installments to pay by themselves";

const isUnpaid = (i: CapitalInstallment) => i.status === "SCHEDULED" || i.status === "OVERDUE";
const isTerm = (s: CapitalSource) => s.kind === "PRIVATE_LOAN" && s.periodMonths !== null;

/** Today in company time ("2026-10-31"). */
const todayOf = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

/** The first due day on or after `from`, stepping from `start` by `months`. */
function nextPeriodEnd(start: string, months: number, from: string) {
  let due = addMonths(start, months);
  for (let n = 2; due < from && n < 1000; n++) due = addMonths(start, months * n);
  return due;
}

// =============================================================================
// Reads
// =============================================================================

type SourceWithInstallments = CapitalSource & { installments: CapitalInstallment[] };

/** One loan or term, with what was paid and what is left. */
function presentLoan(
  s: SourceWithInstallments,
  tz: string,
  today: string,
  names: Map<string, string>,
) {
  const paid = s.installments.filter((i) => i.status === "PAID");
  const left = s.installments.filter(isUnpaid);
  const sum = (rows: CapitalInstallment[], pick: (i: CapitalInstallment) => Prisma.Decimal) =>
    rows.reduce((t, i) => t.plus(pick(i)), ZERO);
  const principalOf = (i: CapitalInstallment) =>
    i.principalPart ?? i.amount.minus(i.interestPart ?? 0);
  const interestOf = (i: CapitalInstallment) => i.interestPart ?? ZERO;
  const next = left[0] ?? null;
  const last = left.at(-1) ?? null;
  const taken = s.takenAmount ?? s.principal;
  const state: "RUNNING" | "RENEWED" | "CLOSED" =
    s.status === "SETTLED" ? "CLOSED" : s.renewals > 0 && isTerm(s) ? "RENEWED" : "RUNNING";
  return {
    id: s.id,
    name: s.name,
    state,
    defaulted: s.status === "DEFAULTED",
    isTerm: isTerm(s),
    takenOn: localDay(s.startDate, tz),
    taken: taken.toFixed(2),
    /** Repaid before the ERP (a running loan entered at what was owed then). */
    repaidBefore: taken.minus(s.principal).toFixed(2),
    /** Interest or profit paid before the ERP (shown only; it was never in these books). */
    interestPaidBefore: (s.interestPaidBefore ?? ZERO).toFixed(2),
    owedNow: s.outstanding.toFixed(2),
    interestRate: s.interestRate?.toFixed(2) ?? null,
    keepInCapital: s.keepInCapital,
    autoPay: s.autoPay,
    periodMonths: s.periodMonths,
    profitPerPeriod: s.profitPerPeriod?.toFixed(2) ?? null,
    renewals: s.renewals,
    notes: s.notes,
    next: next
      ? {
          id: next.id,
          dueDate: localDay(next.dueDate, tz),
          amount: next.amount.toFixed(2),
          principal: principalOf(next).toFixed(2),
          interest: interestOf(next).toFixed(2),
          overdue: localDay(next.dueDate, tz) < today,
        }
      : null,
    /** The last installment still to pay: when the loan ends. */
    endsOn: last ? localDay(last.dueDate, tz) : null,
    paid: {
      count: paid.length,
      amount: sum(paid, (i) => i.amount).toFixed(2),
      principal: sum(paid, principalOf).toFixed(2),
      interest: sum(paid, interestOf).toFixed(2),
    },
    left: { count: left.length, amount: sum(left, (i) => i.amount).toFixed(2) },
    installments: s.installments
      .filter((i) => i.status !== "SKIPPED" || i.journalEntryId)
      .map((i) => ({
        id: i.id,
        dueDate: localDay(i.dueDate, tz),
        status: isUnpaid(i) && localDay(i.dueDate, tz) < today ? ("OVERDUE" as const) : i.status,
        amount: i.amount.toFixed(2),
        principal: principalOf(i).toFixed(2),
        interest: interestOf(i).toFixed(2),
        paidOn: i.paidAt ? localDay(i.paidAt, tz) : null,
        paidFrom: i.paidFromAccountId ? (names.get(i.paidFromAccountId) ?? null) : null,
      })),
  };
}

async function accountNames(ids: Array<string | null>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await prisma.ledgerAccount.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The money working in the business: the owner's capital, every loan kept in
 * capital at what was taken (for ever), and what is still owed on the others.
 */
function capitalFigure(sources: CapitalSource[]) {
  let own = ZERO;
  let kept = ZERO;
  let keptOwed = ZERO;
  let other = ZERO;
  for (const s of sources) {
    if (s.kind === "OWNER_CAPITAL") own = own.plus(s.outstanding);
    else if (s.keepInCapital) {
      kept = kept.plus(s.takenAmount ?? s.principal);
      keptOwed = keptOwed.plus(s.outstanding);
    } else other = other.plus(s.outstanding);
  }
  return {
    own: own.toFixed(2),
    kept: kept.toFixed(2),
    keptStillOwed: keptOwed.toFixed(2),
    otherLoans: other.toFixed(2),
    working: own.plus(kept).plus(other).toFixed(2),
  };
}

/** The Loans & capital page: the capital figure, every lender, and what falls due next. */
export async function getLoansPage(ctx: CompanyContext) {
  assertCanViewAccounts(ctx);
  const tz = ctx.company.timezone;
  const today = todayOf(ctx);
  const [sources, lenders] = await Promise.all([
    ctx.db.capitalSource.findMany({
      where: { voidedAt: null },
      include: { installments: { orderBy: [{ dueDate: "asc" }, { id: "asc" }] } },
      orderBy: { startDate: "asc" },
    }),
    ctx.db.capitalLender.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] }),
  ]);
  const loans = sources.filter((s) => s.kind !== "OWNER_CAPITAL");
  const lenderRows = lenders
    .map((l) => {
      const mine = loans.filter((s) => s.lenderId === l.id);
      const unpaid = mine
        .filter((s) => s.status !== "SETTLED")
        .flatMap((s) => s.installments.filter(isUnpaid));
      unpaid.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
      const paid = mine.flatMap((s) => s.installments.filter((i) => i.status === "PAID"));
      return {
        id: l.id,
        kind: l.kind,
        name: l.name,
        running: mine.filter((s) => s.status !== "SETTLED").length,
        closed: mine.filter((s) => s.status === "SETTLED").length,
        taken: mine.reduce((t, s) => t.plus(s.takenAmount ?? s.principal), ZERO).toFixed(2),
        owedNow: mine.reduce((t, s) => t.plus(s.outstanding), ZERO).toFixed(2),
        paidSoFar: paid.reduce((t, i) => t.plus(i.amount), ZERO).toFixed(2),
        next: unpaid[0]
          ? {
              dueDate: localDay(unpaid[0].dueDate, tz),
              amount: unpaid[0].amount.toFixed(2),
              overdue: localDay(unpaid[0].dueDate, tz) < today,
            }
          : null,
      };
    })
    .filter((l) => l.running + l.closed > 0);
  const byId = new Map(loans.map((s) => [s.id, s]));
  const lenderOf = new Map(lenders.map((l) => [l.id, l]));
  const soon = addMonths(today, 1);
  const dueSoon = loans
    .filter((s) => s.status === "ACTIVE")
    .flatMap((s) => s.installments.filter(isUnpaid))
    .filter((i) => localDay(i.dueDate, tz) <= soon)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .slice(0, 20)
    .map((i) => {
      const s = byId.get(i.capitalSourceId)!;
      const lender = s.lenderId ? lenderOf.get(s.lenderId) : undefined;
      return {
        id: i.id,
        sourceId: s.id,
        lenderId: lender?.id ?? null,
        name: lender?.name ?? s.name,
        dueDate: localDay(i.dueDate, tz),
        amount: i.amount.toFixed(2),
        principal: (i.principalPart ?? i.amount.minus(i.interestPart ?? 0)).toFixed(2),
        interest: (i.interestPart ?? ZERO).toFixed(2),
        overdue: localDay(i.dueDate, tz) < today,
        autoPay: s.autoPay,
        isTerm: isTerm(s),
      };
    });
  const canPay = ctx.can("accounts.manage") && ctx.can("accounts.payments.record");
  return {
    capital: capitalFigure(sources),
    lenders: lenderRows,
    /** Loans and investors added before this page, with no lender profile. */
    others: loans
      .filter((s) => !s.lenderId && s.status !== "SETTLED")
      .map((s) => ({ id: s.id, kind: s.kind, name: s.name, owedNow: s.outstanding.toFixed(2) })),
    dueSoon,
    /** Where an installment or a person's profit is paid from. */
    accounts: canPay ? await listMoneyAccounts(ctx) : [],
    today,
    can: {
      manage: ctx.can("accounts.manage"),
      pay: canPay,
      receive: ctx.can("accounts.receipts.record"),
    },
  };
}

/**
 * For Home: the unpaid installments and a person's profit dates that are late
 * or fall due within `days`, earliest first (no permission check: the caller
 * shows them only to those who see the business's money).
 */
export async function installmentsComing(
  ctx: CompanyContext,
  days = 7,
  limit = 5,
  now: Date = new Date(),
) {
  const tz = ctx.company.timezone;
  const today = localDay(now, tz);
  const until = addDays(today, days);
  const rows = await ctx.db.capitalInstallment.findMany({
    where: {
      status: { in: [...UNPAID] },
      dueDate: { lt: toInstant(addDays(until, 1), tz) },
      capitalSource: { status: "ACTIVE", voidedAt: null, kind: { not: "OWNER_CAPITAL" } },
    },
    include: {
      capitalSource: {
        select: {
          name: true,
          lenderId: true,
          autoPay: true,
          kind: true,
          periodMonths: true,
          lender: { select: { name: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });
  const items = rows.map((i) => {
    const s = i.capitalSource;
    const day = localDay(i.dueDate, tz);
    return {
      id: i.id,
      lenderId: s.lenderId,
      name: s.lender?.name ?? s.name,
      dueDate: day,
      amount: i.amount.toFixed(2),
      overdue: day < today,
      autoPay: s.autoPay,
      isTerm: s.kind === "PRIVATE_LOAN" && s.periodMonths !== null,
    };
  });
  return {
    days,
    late: items.filter((i) => i.overdue).length,
    count: items.length,
    total: items.reduce((t, i) => t.plus(i.amount), ZERO).toFixed(2),
    items: items.slice(0, limit),
  };
}

/** A lender's profile: every loan or term with them, running or closed, and the totals. */
export async function getLenderProfile(ctx: CompanyContext, lenderId: string) {
  assertCanViewAccounts(ctx);
  const tz = ctx.company.timezone;
  const today = todayOf(ctx);
  const lender = await ctx.db.capitalLender.findFirst({
    where: { id: lenderId },
    include: {
      loans: {
        where: { voidedAt: null },
        include: { installments: { orderBy: [{ dueDate: "asc" }, { id: "asc" }] } },
        orderBy: { startDate: "desc" },
      },
    },
  });
  if (!lender) throw new AppError("NOT_FOUND", "Not found.");
  const names = await accountNames(
    lender.loans.flatMap((s) => s.installments.map((i) => i.paidFromAccountId)),
  );
  const loans = lender.loans.map((s) => presentLoan(s, tz, today, names));
  const canPay = ctx.can("accounts.manage") && ctx.can("accounts.payments.record");
  const total = (pick: (l: (typeof loans)[number]) => string) =>
    loans.reduce((t, l) => t.plus(pick(l)), ZERO).toFixed(2);
  return {
    id: lender.id,
    kind: lender.kind,
    name: lender.name,
    contact: lender.contact,
    totals: {
      taken: total((l) => l.taken),
      owedNow: total((l) => l.owedNow),
      principalPaid: total((l) => l.paid.principal),
      interestPaid: total((l) => l.paid.interest),
      interestPaidBefore: total((l) => l.interestPaidBefore),
      paid: total((l) => l.paid.amount),
      running: loans.filter((l) => l.state !== "CLOSED").length,
      closed: loans.filter((l) => l.state === "CLOSED").length,
    },
    loans,
    accounts: canPay ? await listMoneyAccounts(ctx) : [],
    today,
    can: { manage: ctx.can("accounts.manage"), pay: canPay },
  };
}

/** What the add-a-loan form offers: the existing banks, NGOs and people. */
export async function getLoanFormOptions(ctx: CompanyContext) {
  assertCanManageAccounts(ctx, "Only Accounts can add loans.");
  const lenders = await ctx.db.capitalLender.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, kind: true, name: true, contact: true },
  });
  return {
    lenders,
    accounts: await listMoneyAccounts(ctx),
    today: todayOf(ctx),
    can: { receive: ctx.can("accounts.receipts.record"), pay: ctx.can("accounts.payments.record") },
  };
}

// =============================================================================
// Changes
// =============================================================================

async function lenderFor(
  tx: Tx,
  ctx: CompanyContext,
  input: {
    lenderKind: CapitalLender["kind"];
    lenderId?: string;
    lenderName?: string;
    contact?: string | null;
  },
) {
  if (input.lenderId) {
    const found = await tx.capitalLender.findFirst({
      where: { id: input.lenderId, companyId: ctx.company.id, kind: input.lenderKind },
    });
    if (!found) throw new AppError("NOT_FOUND", "That bank, NGO or person is not in the list.");
    return found;
  }
  const name = input.lenderName!.trim();
  const existing = await tx.capitalLender.findFirst({
    where: {
      companyId: ctx.company.id,
      kind: input.lenderKind,
      name: { equals: name, mode: "insensitive" },
    },
  });
  if (existing) return existing;
  return tx.capitalLender.create({
    data: {
      companyId: ctx.company.id,
      kind: input.lenderKind,
      name,
      contact: input.contact ?? null,
    },
  });
}

/**
 * Adds a loan: money received now into cash or a bank (Accounts: money in), or a
 * loan running before the ERP at what is owed today. Then its installments (a
 * bank or NGO) or its first profit date (a person).
 */
export async function addLoan(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can add loans.");
  const input = addLoanSchema.parse(raw);
  if (
    input.autoPay &&
    input.lenderKind !== "PERSON" &&
    input.nextDueDate &&
    input.nextDueDate < todayOf(ctx)
  ) {
    // Installments already due were most likely paid at the bank: never paid again by themselves.
    throw new AppError(
      "VALIDATION",
      "Installments paying by themselves start from today or later.",
      {
        nextDueDate: ["Today or later, to pay by itself"],
      },
    );
  }
  if (input.autoPay) {
    assertCanPayMoney(ctx);
    await requirePin(ctx, input.pin, PIN_WHAT);
  }
  const tz = ctx.company.timezone;
  const today = todayOf(ctx);
  const person = input.lenderKind === "PERSON";
  const owed = money(input.before?.owedNow ?? input.amount);

  const sourceId = await runTransaction(async (tx) => {
    const lender = await lenderFor(tx, ctx, input);
    const source = await createCapitalSourceTx(
      tx,
      ctx,
      {
        kind: person ? "PRIVATE_LOAN" : "BANK_LOAN",
        name: lender.name,
        contact: input.contact ?? lender.contact,
        interestRate: input.interestRate ?? null,
        startDate: input.takenOn,
        notes: input.notes,
        ...(input.before
          ? { opening: { amount: input.before.owedNow } }
          : {
              received: {
                amount: input.amount,
                method: input.method,
                accountId: input.accountId,
                reference: input.reference,
              },
            }),
      },
      meta,
    );

    let autoPay = {};
    if (input.autoPay && !person) {
      const accountId = await cashAccountFor(tx, ctx.company.id, input.method, input.accountId);
      autoPay = {
        autoPay: true,
        autoPayMethod: input.method,
        autoPayAccountId: accountId,
        autoPayById: ctx.user.id,
      };
    }
    let profit: Prisma.Decimal | null = null;
    if (person) {
      profit = money(input.profitPerPeriod ?? owed.times(input.profitPct!).dividedBy(100));
      if (profit.lte(0)) {
        throw new AppError("VALIDATION", "The profit works out to nothing.", {
          profitPerPeriod: ["Enter the profit"],
        });
      }
    }
    await tx.capitalSource.update({
      where: { id: source.id },
      data: {
        lenderId: lender.id,
        takenAmount: money(input.amount),
        interestPaidBefore: input.before?.interestPaid ? money(input.before.interestPaid) : null,
        keepInCapital: input.keepInCapital,
        keptInCapitalFrom: input.keepInCapital ? toInstant(input.takenOn, tz) : null,
        ...autoPay,
        ...(person ? { periodMonths: input.periodMonths!, profitPerPeriod: profit } : {}),
      },
    });

    if (person) {
      const due =
        input.nextDueDate ??
        nextPeriodEnd(input.takenOn, input.periodMonths!, input.before ? today : input.takenOn);
      await tx.capitalInstallment.create({
        data: {
          capitalSourceId: source.id,
          dueDate: toInstant(due, tz),
          amount: profit!,
          principalPart: ZERO,
          interestPart: profit!,
          note: `Profit for ${input.periodMonths} month(s)`,
        },
      });
    } else {
      const plan = planFromInstallment({
        principal: owed,
        amount: money(input.installmentAmount!),
        count: input.installmentsLeft!,
        firstDueDate: input.nextDueDate!,
        everyMonths: 1,
      });
      if (!plan) {
        throw new AppError(
          "VALIDATION",
          `${input.installmentsLeft} installments of ${money(input.installmentAmount!).toFixed(2)} do not cover the ${owed.toFixed(2)} owed.`,
          { installmentAmount: ["Too small for the loan"] },
        );
      }
      await tx.capitalInstallment.createMany({
        data: plan.map((i) => ({
          capitalSourceId: source.id,
          dueDate: toInstant(i.dueDate, tz),
          amount: i.amount,
          principalPart: i.principal,
          interestPart: i.interest,
          note: `Installment ${i.number} of ${plan.length}`,
        })),
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CapitalLender",
        entityId: lender.id,
        summary: `Loan from ${lender.name} (${lender.kind}): ${money(input.amount).toFixed(2)}${
          input.before ? `, ${owed.toFixed(2)} still owed when entered` : ""
        }${input.keepInCapital ? ", kept in capital" : ""}${input.autoPay && !person ? ", installments pay by themselves" : ""}`,
      },
      tx,
    );
    return source.id;
  }, TX_OPTIONS);
  const created = await ctx.db.capitalSource.findFirstOrThrow({
    where: { id: sourceId },
    select: { id: true, lenderId: true },
  });
  return { id: created.id, lenderId: created.lenderId! };
}

async function loanOf(ctx: CompanyContext, sourceId: string) {
  const source = await ctx.db.capitalSource.findFirst({
    where: { id: sourceId, voidedAt: null, kind: { in: [...LOAN_KINDS] } },
  });
  if (!source) throw new AppError("NOT_FOUND", "Loan not found.");
  return source;
}

/**
 * The end of a person's term: the profit is paid and the money is renewed for
 * another term, returned in full (the term closes), or partly returned (the
 * profit for the next term goes down in step).
 */
export async function termAction(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can pay a term's profit.");
  assertCanPayMoney(ctx);
  const input = termActionSchema.parse(raw);
  const found = await loanOf(ctx, sourceId);
  if (!isTerm(found)) throw new AppError("VALIDATION", "This is not a person's term.");
  const tz = ctx.company.timezone;
  await runTransaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    const due = await tx.capitalInstallment.findFirst({
      where: { capitalSourceId: source.id, status: { in: [...UNPAID] } },
      orderBy: { dueDate: "asc" },
    });
    if (!due) throw new AppError("CONFLICT", `No profit is due for ${source.name}.`);
    // Pressed twice (two tabs, a retry): the second never pays the next term at once.
    if (input.installmentId && input.installmentId !== due.id) {
      throw new AppError(
        "CONFLICT",
        `${source.name}'s profit was paid already; open the page again.`,
      );
    }
    const owed = await outstandingTx(tx, ctx.company.id, source);
    const first = await tx.capitalInstallment.findFirst({
      where: { capitalSourceId: source.id },
      orderBy: { dueDate: "asc" },
      select: { dueDate: true },
    });
    const back =
      input.action === "RETURN"
        ? owed
        : input.action === "RETURN_PART"
          ? money(input.returnAmount!)
          : ZERO;
    if (input.action === "RETURN_PART" && back.gte(owed)) {
      throw new AppError(
        "VALIDATION",
        `That is all of the ${owed.toFixed(2)}; choose "Return money" instead.`,
        {
          returnAmount: [`Less than ${owed.toFixed(2)}`],
        },
      );
    }
    const profit = money(input.profit ?? due.interestPart ?? source.profitPerPeriod ?? 0);
    await payInstallmentTx(
      tx,
      ctx,
      due.id,
      {
        date: input.date,
        principalPart: Number(back.toFixed(2)),
        interestPart: Number(profit.toFixed(2)),
        method: input.method,
        accountId: input.accountId,
        reference: input.reference,
        notes:
          input.action === "RENEW"
            ? "profit, renewed"
            : input.action === "RETURN"
              ? "profit and the money back"
              : `profit and ${back.toFixed(2)} back`,
      },
      meta,
    );
    if (input.action === "RETURN") return;
    const left = owed.minus(back);
    const nextProfit =
      input.action === "RETURN_PART"
        ? money((source.profitPerPeriod ?? profit).times(left).dividedBy(owed))
        : (source.profitPerPeriod ?? profit);
    await tx.capitalInstallment.create({
      data: {
        capitalSourceId: source.id,
        // Counted from the first profit date, so a short month never shifts the day.
        dueDate: toInstant(
          nextPeriodEnd(
            localDay(first?.dueDate ?? source.startDate, tz),
            source.periodMonths!,
            nextDay(localDay(due.dueDate, tz)),
          ),
          tz,
        ),
        amount: nextProfit,
        principalPart: ZERO,
        interestPart: nextProfit,
        note: `Profit for ${source.periodMonths} month(s)`,
      },
    });
    await tx.capitalSource.update({
      where: { id: source.id },
      data: { renewals: { increment: 1 }, profitPerPeriod: nextProfit },
    });
  }, TX_OPTIONS);
  return { id: found.id, lenderId: found.lenderId };
}

/** Installments that pay themselves on their due day: on (with the PIN) or off. */
export async function setAutoPay(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can change how a loan is paid.");
  const input = autoPaySchema.parse(raw);
  const found = await loanOf(ctx, sourceId);
  if (isTerm(found)) {
    throw new AppError("VALIDATION", "A person's profit is paid with Renew or Return.");
  }
  if (input.on) {
    assertCanPayMoney(ctx);
    const late = await ctx.db.capitalInstallment.count({
      where: {
        capitalSourceId: found.id,
        status: { in: [...UNPAID] },
        dueDate: { lt: toInstant(todayOf(ctx), ctx.company.timezone) },
      },
    });
    if (late > 0) {
      // Late ones may have been paid at the bank already: never paid again by themselves.
      throw new AppError(
        "VALIDATION",
        `${late} installment(s) are late: pay or skip them first, then switch it on.`,
      );
    }
    await requirePin(ctx, input.pin, PIN_WHAT);
  }
  await runTransaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    const accountId = input.on
      ? await cashAccountFor(tx, ctx.company.id, input.method, input.accountId)
      : null;
    await tx.capitalSource.update({
      where: { id: source.id },
      data: input.on
        ? {
            autoPay: true,
            autoPayMethod: input.method,
            autoPayAccountId: accountId,
            autoPayById: ctx.user.id,
          }
        : { autoPay: false, autoPayMethod: null, autoPayAccountId: null, autoPayById: null },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "CapitalSource",
        entityId: source.id,
        summary: input.on
          ? `${source.name}: installments now pay by themselves on their due day (${input.method})`
          : `${source.name}: installments no longer pay by themselves`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return { id: found.id, lenderId: found.lenderId };
}

/** Whether a loan counts in the owner's capital for ever (from now on). */
export async function setKeepInCapital(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can change this.");
  const { keepInCapital } = keepInCapitalSchema.parse(raw);
  const found = await loanOf(ctx, sourceId);
  if (found.keepInCapital === keepInCapital) return { id: found.id, lenderId: found.lenderId };
  if (!keepInCapital && found.keptInCapitalFrom && found.ledgerAccountId) {
    // Reports never change after the fact: repayments already taken out of profit stay so.
    const repaid = await ctx.db.journalEntry.count({
      where: {
        sourceType: "INSTALLMENT",
        date: { gte: found.keptInCapitalFrom },
        lines: { some: { accountId: found.ledgerAccountId, debit: { gt: 0 } } },
      },
    });
    if (repaid > 0) {
      throw new AppError(
        "CONFLICT",
        `${found.name}'s repayments already came out of profit while it was in your capital, so it stays there.`,
      );
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.capitalSource.update({
      where: { id: found.id },
      // From now on: the months before stay as they were reported.
      data: { keepInCapital, keptInCapitalFrom: keepInCapital ? new Date() : null },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "CapitalSource",
        entityId: found.id,
        summary: `${found.name}: ${keepInCapital ? "kept in capital for ever, from now on" : "no longer kept in capital"}`,
      },
      tx,
    );
  });
  return { id: found.id, lenderId: found.lenderId };
}

// =============================================================================
// The nightly clock
// =============================================================================

/**
 * Pays every installment due today or earlier on loans set to pay by themselves,
 * in the name of the person who switched it on, with every rule checked for them
 * as they are now. Someone who can no longer pay money switches it off (logged),
 * so the installment shows as overdue on the page. Safe to repeat: a paid
 * installment is never paid again.
 */
export async function payDueInstallments(now: Date = new Date()) {
  const due = await prisma.capitalInstallment.findMany({
    where: {
      status: { in: [...UNPAID] },
      dueDate: { lte: now },
      capitalSource: { autoPay: true, status: "ACTIVE", voidedAt: null },
    },
    include: { capitalSource: { include: { company: { select: { timezone: true } } } } },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });
  let paid = 0;
  const contexts = new Map<string, CompanyContext | null>();
  const switchedOff = new Set<string>();
  const problems = new NightProblems();
  for (const installment of due) {
    const source = installment.capitalSource;
    if (switchedOff.has(source.id)) continue;
    const key = `${source.companyId}:${source.autoPayById}`;
    if (!contexts.has(key)) {
      contexts.set(
        key,
        source.autoPayById ? await actingAs(source.autoPayById, source.companyId) : null,
      );
    }
    const ctx = contexts.get(key) ?? null;
    if (!ctx || !ctx.can("accounts.manage") || !ctx.can("accounts.payments.record")) {
      await prisma.capitalSource.updateMany({
        where: { id: source.id, autoPay: true },
        data: { autoPay: false },
      });
      switchedOff.add(source.id);
      await recordAudit({
        companyId: source.companyId,
        userId: null,
        action: "UPDATE",
        entityType: "CapitalSource",
        entityId: source.id,
        summary: `${source.name}: installments stopped paying by themselves, because the person who switched it on can no longer pay money; pay the one due ${localDay(installment.dueDate, source.company.timezone)} by hand`,
      });
      problems.add(
        source.companyId,
        `${source.name}: stopped paying by itself, because the person who switched it on can no longer pay money. Pay the one due ${localDay(installment.dueDate, source.company.timezone)} by hand.`,
      );
      continue;
    }
    try {
      const done = await runTransaction(async (tx) => {
        // Switched off while the night ran: left for the person to pay.
        const fresh = await lockSource(tx, ctx, source.id);
        if (!fresh.autoPay) return false;
        await payInstallmentTx(tx, ctx, installment.id, {
          date: localDay(installment.dueDate, ctx.company.timezone),
          method: fresh.autoPayMethod ?? "BANK_TRANSFER",
          accountId: fresh.autoPayAccountId ?? undefined,
          notes: "paid by itself on its due day",
        });
        return true;
      }, TX_OPTIONS);
      if (done) paid++;
    } catch (error) {
      // It stays unpaid (and shows as overdue); the next night tries again.
      console.error("[loans] an installment could not pay by itself", installment.id, error);
      problems.add(
        source.companyId,
        `${source.name}: the installment due ${localDay(installment.dueDate, source.company.timezone)} could not pay by itself (${reasonOf(error)}). It shows as late; pay it by hand or fix the cause, and the next night tries again.`,
      );
    }
  }
  await problems.send("A loan installment did not pay by itself", "CapitalSource", now);
  return paid;
}

export type LoansPage = Awaited<ReturnType<typeof getLoansPage>>;
export type LenderProfile = Awaited<ReturnType<typeof getLenderProfile>>;
export type LoanFormOptions = Awaited<ReturnType<typeof getLoanFormOptions>>;
