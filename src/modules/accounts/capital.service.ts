import {
  type CapitalInstallment,
  type CapitalSource,
  type CapitalSourceKind,
  type PaymentMethod,
  Prisma,
} from "@prisma/client";

import { localDay, nextDay, startOfDayInZone, toInstant } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { money, rawBalance, ZERO } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { createNumberedAccount, isCashSubType } from "@/modules/accounts/chart";
import { buildLedger } from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { planInstallments, planTotals } from "@/modules/accounts/installments";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import {
  assertCanManageAccounts,
  assertCanPayMoney,
  assertCanReceiveMoney,
} from "@/modules/accounts/money-guards";
import {
  addInstallmentSchema,
  capitalReceiptSchema,
  createCapitalSchema,
  listCapitalSchema,
  listInstallmentsSchema,
  payInstallmentSchema,
  repaySchema,
  reverseJournalSchema,
  scheduleSchema,
  skipInstallmentSchema,
  updateCapitalSchema,
  voidSchema,
} from "@/modules/accounts/schemas";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Capital, investors and loans, each with its own ledger account so the
 * balance sheet lists every one of them:
 *   Owner puts money in        Dr Cash / Bank / Wallet      Cr Capital — <owner>      (equity)
 *   Investment / loan received Dr Cash / Bank / Wallet      Cr Investor / Loan — <name> (liability)
 *   Owed or invested at go-live Dr Opening Balance Equity   Cr the source's account
 *   Repayment or installment   Dr the source's account (principal)
 *                              Dr Finance Costs (interest, investor profit; owners: Drawings)
 *                                                          Cr Cash / Bank / Wallet
 * Interest is booked when it is paid. A source's principal (everything received)
 * and outstanding balance are recomputed from its ledger after every change.
 */

type Tx = Prisma.TransactionClient;
type LinkedSource = CapitalSource & { ledgerAccountId: string };

const TX_OPTIONS = { timeout: 30_000 };

const KIND_ACCOUNT = {
  OWNER_CAPITAL: { subType: "CAPITAL", label: "Capital" },
  INVESTOR: { subType: "INVESTOR", label: "Investor" },
  BANK_LOAN: { subType: "LOAN", label: "Loan" },
  PRIVATE_LOAN: { subType: "LOAN", label: "Loan" },
} as const satisfies Record<CapitalSourceKind, { subType: string; label: string }>;

const isOwner = (kind: CapitalSourceKind) => kind === "OWNER_CAPITAL";

/** Note on installments skipped because the source was repaid in full. */
const SETTLED_NOTE = "Not needed: repaid in full.";

const UNPAID = ["SCHEDULED", "OVERDUE"] as const;

// =============================================================================
// Helpers
// =============================================================================

/** "Loan — BRAC Bank", or "Loan — BRAC Bank (2)" when that name is taken. */
async function uniqueAccountName(tx: Tx, companyId: string, base: string, exceptId?: string) {
  for (let n = 1; n <= 50; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    const clash = await tx.ledgerAccount.findFirst({
      where: {
        companyId,
        name: { equals: name, mode: "insensitive" },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (!clash) return name;
  }
  throw new AppError("CONFLICT", `Too many accounts are called "${base}".`);
}

const accountName = (kind: CapitalSourceKind, name: string) =>
  `${KIND_ACCOUNT[kind].label} — ${name}`;

/** Locks the source; gives it a ledger account if it has none yet. */
async function lockSource(tx: Tx, ctx: CompanyContext, sourceId: string): Promise<LinkedSource> {
  await lockRow(tx, "CapitalSource", sourceId);
  const source = await tx.capitalSource.findFirst({
    where: { id: sourceId, companyId: ctx.company.id },
  });
  if (!source) throw new AppError("NOT_FOUND", "Capital source not found.");
  if (source.ledgerAccountId) return source as LinkedSource;
  const account = await createNumberedAccount(tx, ctx.company.id, {
    name: await uniqueAccountName(tx, ctx.company.id, accountName(source.kind, source.name)),
    subType: KIND_ACCOUNT[source.kind].subType,
  });
  return (await tx.capitalSource.update({
    where: { id: source.id },
    data: { ledgerAccountId: account.id },
  })) as LinkedSource;
}

/** What is still owed (or invested) right now, from the ledger. */
async function outstandingTx(db: Db, companyId: string, source: LinkedSource) {
  return (await rawBalance(companyId, source.ledgerAccountId, {}, db)).neg();
}

/**
 * Recomputes principal and outstanding from the source's ledger. A loan or
 * investor repaid in full becomes SETTLED (its unpaid installments are skipped);
 * money owed again makes it ACTIVE again. When that comes from reversing the
 * final repayment, the installments skipped for it come back.
 */
async function syncSourceTx(
  tx: Tx,
  companyId: string,
  sourceId: string,
  options: { restoreSkipped?: boolean } = {},
) {
  const source = (await tx.capitalSource.findFirstOrThrow({
    where: { id: sourceId, companyId },
  })) as LinkedSource;
  const [row] = await tx.$queryRaw<
    Array<{ outstanding: Prisma.Decimal | null; principal: Prisma.Decimal | null }>
  >`
    SELECT SUM(jl.credit - jl.debit) AS outstanding,
           SUM(CASE WHEN NOT je."isReversed" AND je."reversalOfId" IS NULL THEN jl.credit ELSE 0 END)
             AS principal
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} AND jl."accountId" = ${source.ledgerAccountId}`;
  const outstanding = new Prisma.Decimal(row?.outstanding ?? 0);
  const principal = new Prisma.Decimal(row?.principal ?? 0);

  let status = source.status;
  if (!isOwner(source.kind)) {
    if (status !== "SETTLED" && principal.gt(0) && outstanding.lte(0)) status = "SETTLED";
    else if (status === "SETTLED" && outstanding.gt(0)) status = "ACTIVE";
  }
  if (status === "SETTLED" && source.status !== "SETTLED") {
    await tx.capitalInstallment.updateMany({
      where: { capitalSourceId: source.id, status: { in: [...UNPAID] } },
      data: { status: "SKIPPED", note: SETTLED_NOTE },
    });
  } else if (options.restoreSkipped && status === "ACTIVE" && source.status === "SETTLED") {
    await tx.capitalInstallment.updateMany({
      where: { capitalSourceId: source.id, status: "SKIPPED", note: SETTLED_NOTE },
      data: { status: "SCHEDULED", note: null },
    });
  }
  return tx.capitalSource.update({
    where: { id: source.id },
    data: { outstanding, principal, status },
  });
}

type MoneySide = {
  method: PaymentMethod;
  accountId?: string;
  reference?: string | null;
};

/** Money in: Dr Cash / Bank / Wallet, Cr the source's account. */
async function postReceiptTx(
  tx: Tx,
  ctx: CompanyContext,
  source: LinkedSource,
  input: MoneySide & { amount: Prisma.Decimal; date: Date; notes?: string | null },
) {
  const into = await cashAccountFor(tx, ctx.company.id, input.method, input.accountId);
  const what = isOwner(source.kind)
    ? `Capital introduced by ${source.name}`
    : source.kind === "INVESTOR"
      ? `Investment received from ${source.name}`
      : `Loan received from ${source.name}`;
  return postJournalEntry(tx, {
    companyId: ctx.company.id,
    date: input.date,
    description: input.notes ? `${what} — ${input.notes}` : what,
    sourceType: "CAPITAL",
    sourceId: source.id,
    postedById: ctx.user.id,
    lines: [
      { accountId: into, debit: input.amount, memo: input.reference ?? undefined },
      { accountId: source.ledgerAccountId, credit: input.amount, memo: source.name },
    ],
  });
}

/**
 * Money out: principal reduces what is owed (owners: their capital); interest
 * or profit goes to Finance Costs (owners: Drawings).
 */
async function postPayoutTx(
  tx: Tx,
  ctx: CompanyContext,
  source: LinkedSource,
  input: MoneySide & {
    principal: Prisma.Decimal;
    interest: Prisma.Decimal;
    date: Date;
    description: string;
  },
) {
  const companyId = ctx.company.id;
  const from = await cashAccountFor(tx, companyId, input.method, input.accountId);
  const acc = await ensureControlAccounts(companyId, tx);
  const owner = isOwner(source.kind);
  const returnMemo = owner
    ? `Drawings — ${source.name}`
    : source.kind === "INVESTOR"
      ? `Profit paid — ${source.name}`
      : `Interest — ${source.name}`;
  return postJournalEntry(tx, {
    companyId,
    date: input.date,
    description: input.description,
    sourceType: "INSTALLMENT",
    sourceId: source.id,
    postedById: ctx.user.id,
    lines: [
      {
        accountId: source.ledgerAccountId,
        debit: input.principal,
        memo: owner ? `Capital withdrawn — ${source.name}` : `Principal — ${source.name}`,
      },
      {
        accountId: owner ? acc.DRAWINGS : acc.FINANCE_COST,
        debit: input.interest,
        memo: returnMemo,
      },
      {
        accountId: from,
        credit: input.principal.plus(input.interest),
        memo: input.reference ?? undefined,
      },
    ],
  });
}

function assertPrincipalFits(
  source: CapitalSource,
  principal: Prisma.Decimal,
  outstanding: Prisma.Decimal,
) {
  if (principal.gt(outstanding)) {
    throw new AppError(
      "VALIDATION",
      `Only ${outstanding.toFixed(2)} is ${isOwner(source.kind) ? "invested by" : "owed to"} ${source.name}.`,
      { principal: [`At most ${outstanding.toFixed(2)}.`] },
    );
  }
}

/** Unpaid and due before today (company time). */
function isOverdue(installment: CapitalInstallment, todayStart: Date) {
  return (
    (installment.status === "SCHEDULED" || installment.status === "OVERDUE") &&
    installment.dueDate < todayStart
  );
}

function todayStart(ctx: CompanyContext) {
  const tz = ctx.company.timezone;
  return startOfDayInZone(localDay(new Date(), tz), tz);
}

function presentInstallment(i: CapitalInstallment, tz: string, today: Date) {
  const unpaid = i.status === "SCHEDULED" || i.status === "OVERDUE";
  const principal = i.principalPart ?? i.amount.minus(i.interestPart ?? 0);
  return {
    id: i.id,
    capitalSourceId: i.capitalSourceId,
    dueDate: localDay(i.dueDate, tz),
    status: isOverdue(i, today) ? ("OVERDUE" as const) : unpaid ? ("SCHEDULED" as const) : i.status,
    amount: i.amount.toFixed(2),
    principalPart: principal.toFixed(2),
    interestPart: (i.interestPart ?? ZERO).toFixed(2),
    paidAt: i.paidAt,
    paidFromAccountId: i.paidFromAccountId,
    journalEntryId: i.journalEntryId,
    note: i.note,
  };
}

function presentSource(s: CapitalSource, tz: string) {
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    contact: s.contact,
    notes: s.notes,
    status: s.status,
    /** Owners' capital is equity; investors and loans are owed back (liabilities). */
    isLiability: !isOwner(s.kind),
    ledgerAccountId: s.ledgerAccountId,
    principal: s.principal.toFixed(2),
    outstanding: s.outstanding.toFixed(2),
    repaid: s.principal.minus(s.outstanding).toFixed(2),
    interestRate: s.interestRate?.toFixed(2) ?? null,
    profitSharePct: s.profitSharePct?.toFixed(2) ?? null,
    startDate: localDay(s.startDate, tz),
    maturityDate: s.maturityDate ? localDay(s.maturityDate, tz) : null,
    createdAt: s.createdAt,
  };
}

// =============================================================================
// Reads
// =============================================================================

export async function listCapitalSources(ctx: CompanyContext, raw: unknown = {}) {
  const q = listCapitalSchema.parse(raw);
  const tz = ctx.company.timezone;
  const sources = await ctx.db.capitalSource.findMany({
    where: { ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}) },
    orderBy: [{ kind: "asc" }, { startDate: "asc" }],
  });
  const unpaid = await prisma.capitalInstallment.findMany({
    where: {
      capitalSourceId: { in: sources.map((s) => s.id) },
      status: { in: [...UNPAID] },
      capitalSource: { companyId: ctx.company.id },
    },
    orderBy: { dueDate: "asc" },
  });
  const today = todayStart(ctx);
  const items = sources.map((s) => {
    const mine = unpaid.filter((i) => i.capitalSourceId === s.id);
    const overdue = mine.filter((i) => isOverdue(i, today));
    return {
      ...presentSource(s, tz),
      nextInstallment: mine[0] ? presentInstallment(mine[0], tz, today) : null,
      overdue: {
        count: overdue.length,
        amount: overdue.reduce((t, i) => t.plus(i.amount), ZERO).toFixed(2),
      },
    };
  });
  const sum = (kinds: CapitalSourceKind[]) =>
    sources.filter((s) => kinds.includes(s.kind)).reduce((t, s) => t.plus(s.outstanding), ZERO);
  const investors = sum(["INVESTOR"]);
  const loans = sum(["BANK_LOAN", "PRIVATE_LOAN"]);
  return {
    items,
    summary: {
      ownerCapital: sum(["OWNER_CAPITAL"]).toFixed(2),
      investors: investors.toFixed(2),
      loans: loans.toFixed(2),
      /** Dashboard "Liabilities (Loans / Investors)". */
      liabilities: investors.plus(loans).toFixed(2),
      overdueInstallments: items.reduce((n, i) => n + i.overdue.count, 0),
    },
  };
}

export async function getCapitalSource(ctx: CompanyContext, sourceId: string) {
  const tz = ctx.company.timezone;
  const source = await ctx.db.capitalSource.findUnique({
    where: { id: sourceId },
    include: { installments: { orderBy: [{ dueDate: "asc" }, { id: "asc" }] } },
  });
  if (!source) throw new AppError("NOT_FOUND", "Capital source not found.");
  const today = todayStart(ctx);
  const installments = source.installments.map((i) => presentInstallment(i, tz, today));
  const unpaid = source.installments.filter(
    (i) => i.status === "SCHEDULED" || i.status === "OVERDUE",
  );
  const overdue = unpaid.filter((i) => isOverdue(i, today));
  // Interest / profit / drawings paid, net of reversals.
  const acc = await ensureControlAccounts(ctx.company.id);
  const returns = await prisma.journalLine.aggregate({
    where: {
      accountId: { in: [acc.FINANCE_COST, acc.DRAWINGS] },
      entry: { companyId: ctx.company.id, sourceType: "INSTALLMENT", sourceId: source.id },
    },
    _sum: { debit: true, credit: true },
  });
  const ledger = source.ledgerAccountId
    ? await buildLedger(
        ctx.company.id,
        { id: source.ledgerAccountId, type: isOwner(source.kind) ? "EQUITY" : "LIABILITY" },
        {},
      )
    : null;
  return {
    ...presentSource(source, tz),
    totals: {
      received: source.principal.toFixed(2),
      repaid: source.principal.minus(source.outstanding).toFixed(2),
      outstanding: source.outstanding.toFixed(2),
      /** Interest and investor profit paid (owners: drawings). */
      returnsPaid: (returns._sum.debit ?? ZERO).minus(returns._sum.credit ?? ZERO).toFixed(2),
      scheduled: {
        count: unpaid.length,
        amount: unpaid.reduce((t, i) => t.plus(i.amount), ZERO).toFixed(2),
      },
      overdue: {
        count: overdue.length,
        amount: overdue.reduce((t, i) => t.plus(i.amount), ZERO).toFixed(2),
      },
    },
    installments,
    ledger: ledger
      ? {
          totalDebit: ledger.totalDebit.toFixed(2),
          totalCredit: ledger.totalCredit.toFixed(2),
          closing: ledger.closing.toFixed(2),
          lines: ledger.lines,
        }
      : null,
  };
}

/** Installments across every loan and investor: upcoming, overdue, paid out. */
export async function listInstallments(ctx: CompanyContext, raw: unknown = {}) {
  const q = listInstallmentsSchema.parse(raw);
  const tz = ctx.company.timezone;
  const today = todayStart(ctx);
  const wantOverdue = q.overdue === true || q.status === "OVERDUE";
  const statusWhere: Prisma.CapitalInstallmentWhereInput = wantOverdue
    ? { status: { in: [...UNPAID] }, dueDate: { lt: today } }
    : q.status === "SCHEDULED"
      ? { status: { in: [...UNPAID] }, dueDate: { gte: today } }
      : q.status
        ? { status: q.status }
        : {};
  const dueWindow =
    q.from || q.to
      ? {
          ...(q.from ? { gte: startOfDayInZone(q.from, tz) } : {}),
          ...(q.to ? { lt: startOfDayInZone(nextDay(q.to), tz) } : {}),
        }
      : undefined;
  const rows = await prisma.capitalInstallment.findMany({
    where: {
      AND: [
        { capitalSource: { companyId: ctx.company.id } },
        q.sourceId ? { capitalSourceId: q.sourceId } : {},
        statusWhere,
        dueWindow ? { dueDate: dueWindow } : {},
      ],
    },
    include: { capitalSource: { select: { id: true, name: true, kind: true } } },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: 1000,
  });
  const items = rows.map((r) => ({
    ...presentInstallment(r, tz, today),
    source: r.capitalSource,
  }));
  const total = rows.reduce((t, r) => t.plus(r.amount), ZERO);
  return { items, summary: { count: items.length, amount: total.toFixed(2) } };
}

// =============================================================================
// Sources
// =============================================================================

export async function createCapitalSource(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can add capital, investors and loans.");
  const input = createCapitalSchema.parse(raw);
  if (input.received) assertCanReceiveMoney(ctx);
  const tz = ctx.company.timezone;
  const companyId = ctx.company.id;
  const now = new Date();
  const openingDate = input.opening
    ? input.opening.asOf
      ? toInstant(input.opening.asOf, tz)
      : now
    : null;
  const startDate = input.startDate ? toInstant(input.startDate, tz) : (openingDate ?? now);
  const maturityDate = input.maturityDate ? toInstant(input.maturityDate, tz) : null;
  if (maturityDate && maturityDate < startDate) {
    throw new AppError("VALIDATION", "The maturity date is before the start date.", {
      maturityDate: ["Must be on or after the start date."],
    });
  }

  const source = await prisma.$transaction(async (tx) => {
    const { subType } = KIND_ACCOUNT[input.kind];
    const account = await createNumberedAccount(tx, companyId, {
      name: await uniqueAccountName(tx, companyId, accountName(input.kind, input.name)),
      subType,
    });
    const created = (await tx.capitalSource.create({
      data: {
        companyId,
        ledgerAccountId: account.id,
        kind: input.kind,
        name: input.name,
        contact: input.contact ?? null,
        principal: 0,
        outstanding: 0,
        interestRate: input.interestRate ?? null,
        profitSharePct: input.profitSharePct ?? null,
        startDate,
        maturityDate,
        notes: input.notes ?? null,
      },
    })) as LinkedSource;
    if (input.received) {
      await postReceiptTx(tx, ctx, created, {
        amount: money(input.received.amount),
        date: startDate,
        method: input.received.method,
        accountId: input.received.accountId,
        reference: input.received.reference,
      });
    } else if (input.opening) {
      const acc = await ensureControlAccounts(companyId, tx);
      const amount = money(input.opening.amount);
      await postJournalEntry(tx, {
        companyId,
        date: openingDate!,
        description: `Opening balance — ${account.name} (before go-live)`,
        sourceType: "CAPITAL",
        sourceId: created.id,
        postedById: ctx.user.id,
        lines: [
          { accountId: acc.OPENING_EQUITY, debit: amount },
          { accountId: account.id, credit: amount, memo: created.name },
        ],
      });
    }
    const synced = await syncSourceTx(tx, companyId, created.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CapitalSource",
        entityId: created.id,
        summary: `Added ${KIND_ACCOUNT[input.kind].label.toLowerCase()} ${created.name} (${account.code})${
          input.received
            ? `: received ${money(input.received.amount).toFixed(2)} (${input.received.method})`
            : input.opening
              ? `: opening balance ${money(input.opening.amount).toFixed(2)}`
              : ""
        }`,
      },
      tx,
    );
    return synced;
  }, TX_OPTIONS);
  return getCapitalSource(ctx, source.id);
}

export async function updateCapitalSource(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can change capital, investors and loans.");
  const input = updateCapitalSchema.parse(raw);
  const tz = ctx.company.timezone;
  await prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    if (input.status && source.status === "SETTLED") {
      throw new AppError("CONFLICT", `${source.name} is repaid in full.`);
    }
    if (input.status && isOwner(source.kind)) {
      throw new AppError("VALIDATION", "Owner's capital has no repayment status.");
    }
    const maturityDate =
      input.maturityDate === undefined
        ? undefined
        : input.maturityDate === null
          ? null
          : toInstant(input.maturityDate, tz);
    if (maturityDate && maturityDate < source.startDate) {
      throw new AppError("VALIDATION", "The maturity date is before the start date.", {
        maturityDate: ["Must be on or after the start date."],
      });
    }
    if (input.name && input.name !== source.name) {
      await tx.ledgerAccount.update({
        where: { id: source.ledgerAccountId },
        data: {
          name: await uniqueAccountName(
            tx,
            ctx.company.id,
            accountName(source.kind, input.name),
            source.ledgerAccountId,
          ),
        },
      });
    }
    await tx.capitalSource.update({
      where: { id: source.id },
      data: {
        name: input.name,
        contact: input.contact,
        interestRate: input.interestRate,
        profitSharePct: input.profitSharePct,
        maturityDate,
        notes: input.notes,
        status: input.status,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: input.status && input.status !== source.status ? "STATUS_CHANGE" : "UPDATE",
        entityType: "CapitalSource",
        entityId: source.id,
        summary: `Updated ${source.name}: ${Object.keys(input).join(", ")}${
          input.status && input.status !== source.status
            ? ` (${source.status} -> ${input.status})`
            : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}

/** More money in: another loan disbursement, a top-up, more capital. */
export async function receiveCapital(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can record capital and loans.");
  assertCanReceiveMoney(ctx);
  const input = capitalReceiptSchema.parse(raw);
  const amount = money(input.amount);
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  await prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    if (source.status === "DEFAULTED") {
      throw new AppError("CONFLICT", `${source.name} is marked defaulted.`);
    }
    const entry = await postReceiptTx(tx, ctx, source, { ...input, amount, date });
    await syncSourceTx(tx, ctx.company.id, source.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CapitalSource",
        entityId: source.id,
        summary: `Received ${amount.toFixed(2)} (${input.method}) from ${source.name}: ${entry.number}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}

/**
 * Money out outside the schedule: repaying principal early, paying interest or an
 * investor's profit, an owner withdrawing capital or taking drawings.
 */
export async function repayCapital(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can record repayments.");
  assertCanPayMoney(ctx);
  const input = repaySchema.parse(raw);
  const principal = money(input.principal);
  const interest = money(input.interest);
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  await prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    assertPrincipalFits(source, principal, await outstandingTx(tx, ctx.company.id, source));
    const owner = isOwner(source.kind);
    const what = owner
      ? principal.gt(0)
        ? `Capital withdrawn by ${source.name}`
        : `Drawings — ${source.name}`
      : principal.gt(0)
        ? `Repayment to ${source.name}`
        : `${source.kind === "INVESTOR" ? "Profit" : "Interest"} paid to ${source.name}`;
    const entry = await postPayoutTx(tx, ctx, source, {
      ...input,
      principal,
      interest,
      date,
      description: input.notes ? `${what} — ${input.notes}` : what,
    });
    await syncSourceTx(tx, ctx.company.id, source.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CapitalSource",
        entityId: source.id,
        summary: `${what}: principal ${principal.toFixed(2)}, ${owner ? "drawings" : "interest"} ${interest.toFixed(2)} (${input.method}) ${entry.number}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}

/**
 * Undoes one receipt or payment entered by mistake (both entries stay in the
 * books). A paid installment it settled goes back to unpaid.
 */
export async function reverseCapitalEntry(
  ctx: CompanyContext,
  sourceId: string,
  entryId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can correct capital entries.");
  const input = reverseJournalSchema.parse(raw);
  const entry = await ctx.db.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { include: { account: { select: { subType: true } } } } },
  });
  if (
    !entry ||
    entry.sourceId !== sourceId ||
    (entry.sourceType !== "CAPITAL" && entry.sourceType !== "INSTALLMENT")
  ) {
    throw new AppError("NOT_FOUND", "Entry not found on this capital source.");
  }
  if (entry.reversalOfId) throw new AppError("CONFLICT", `${entry.number} is itself a reversal.`);
  if (entry.isReversed) throw new AppError("CONFLICT", `${entry.number} was already reversed.`);
  // The reversal moves money the other way.
  const cash = entry.lines.filter((l) => isCashSubType(l.account.subType));
  if (cash.some((l) => l.credit.gt(0))) assertCanReceiveMoney(ctx);
  if (cash.some((l) => l.debit.gt(0))) assertCanPayMoney(ctx);

  await prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    const reversal = await reverseJournalEntry(tx, entry.id, {
      description: `Reversal of ${entry.number} (${source.name}): ${input.reason}`,
      postedById: ctx.user.id,
      date: input.date ? toInstant(input.date, ctx.company.timezone) : undefined,
    });
    const reopened = await tx.capitalInstallment.updateMany({
      where: { capitalSourceId: source.id, journalEntryId: entry.id },
      data: { status: "SCHEDULED", paidAt: null, paidFromAccountId: null, journalEntryId: null },
    });
    const synced = await syncSourceTx(tx, ctx.company.id, source.id, { restoreSkipped: true });
    // Money taken back out of a source can't leave it below zero.
    if (synced.outstanding.lt(0)) {
      throw new AppError(
        "CONFLICT",
        `Reversing ${entry.number} would leave ${source.name} overpaid by ${synced.outstanding.abs().toFixed(2)}; reverse the later repayments first.`,
      );
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "CapitalSource",
        entityId: source.id,
        summary: `Reversed ${entry.number} with ${reversal.number} on ${source.name}${
          reopened.count > 0 ? " (installment back to unpaid)" : ""
        }: ${input.reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}

/**
 * Removes a source added by mistake: every entry on it is reversed (they stay in
 * the books), its installments go, and its ledger account is archived.
 */
export async function voidCapitalSource(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can remove capital, investors and loans.");
  const { reason } = voidSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    const entries = await tx.journalEntry.findMany({
      where: {
        companyId: ctx.company.id,
        sourceId: source.id,
        sourceType: { in: ["CAPITAL", "INSTALLMENT"] },
        isReversed: false,
        reversalOfId: null,
      },
      include: { lines: { include: { account: { select: { subType: true } } } } },
      orderBy: { date: "desc" },
    });
    const cash = entries.flatMap((e) => e.lines).filter((l) => isCashSubType(l.account.subType));
    if (cash.some((l) => l.credit.gt(0))) assertCanReceiveMoney(ctx);
    if (cash.some((l) => l.debit.gt(0))) assertCanPayMoney(ctx);
    for (const entry of entries) {
      await reverseJournalEntry(tx, entry.id, {
        description: `Void ${entry.number} (${source.name}): ${reason}`,
        postedById: ctx.user.id,
      });
    }
    await tx.capitalSource.delete({ where: { id: source.id } });
    await tx.ledgerAccount.update({
      where: { id: source.ledgerAccountId },
      data: {
        isActive: false,
        name: await uniqueAccountName(
          tx,
          ctx.company.id,
          `${accountName(source.kind, source.name)} (void)`,
          source.ledgerAccountId,
        ),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "CapitalSource",
        entityId: source.id,
        summary: `Removed ${source.name}, ${entries.length} entr${
          entries.length === 1 ? "y" : "ies"
        } reversed: ${reason}`,
      },
      tx,
    );
    return { id: source.id, removed: true, reversedEntries: entries.length };
  }, TX_OPTIONS);
}

// =============================================================================
// Installments
// =============================================================================

async function buildSchedule(
  ctx: CompanyContext,
  db: Db,
  source: LinkedSource,
  input: ReturnType<typeof scheduleSchema.parse>,
) {
  if (isOwner(source.kind)) {
    throw new AppError("VALIDATION", "Owner's capital has no repayment schedule.");
  }
  if (source.status === "SETTLED") {
    throw new AppError("CONFLICT", `${source.name} is repaid in full.`);
  }
  const principal = input.amount
    ? money(input.amount)
    : await outstandingTx(db, ctx.company.id, source);
  if (principal.lte(0)) {
    throw new AppError(
      "VALIDATION",
      `Nothing is owed to ${source.name}; enter the amount to schedule.`,
      {
        amount: ["Enter the principal to schedule."],
      },
    );
  }
  const rate = new Prisma.Decimal(input.annualRate ?? source.interestRate ?? 0);
  if (input.plan === "INTEREST_ONLY" && rate.lte(0)) {
    throw new AppError("VALIDATION", "An interest-only plan needs an interest or return rate.", {
      annualRate: ["Enter the yearly rate."],
    });
  }
  const plan = planInstallments({
    plan: input.plan,
    principal,
    annualRatePct: rate,
    count: input.count,
    firstDueDate: input.firstDueDate,
    everyMonths: input.everyMonths,
  });
  return { principal, rate, plan, totals: planTotals(plan) };
}

function presentPlan(built: Awaited<ReturnType<typeof buildSchedule>>) {
  return {
    principal: built.principal.toFixed(2),
    annualRate: built.rate.toFixed(2),
    installments: built.plan.map((i) => ({
      number: i.number,
      dueDate: i.dueDate,
      principal: i.principal.toFixed(2),
      interest: i.interest.toFixed(2),
      amount: i.amount.toFixed(2),
      balanceAfter: i.balanceAfter.toFixed(2),
    })),
    totals: {
      principal: built.totals.principal.toFixed(2),
      interest: built.totals.interest.toFixed(2),
      amount: built.totals.amount.toFixed(2),
    },
  };
}

/** The installments a plan would create, without saving them. */
export async function previewSchedule(ctx: CompanyContext, sourceId: string, raw: unknown) {
  const input = scheduleSchema.parse(raw);
  const source = await ctx.db.capitalSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new AppError("NOT_FOUND", "Capital source not found.");
  if (!source.ledgerAccountId) {
    throw new AppError("CONFLICT", `Record money received from ${source.name} first.`);
  }
  return presentPlan(await buildSchedule(ctx, prisma, source as LinkedSource, input));
}

/** Creates an installment plan (EMI, flat or interest-only), replacing unpaid ones if asked. */
export async function scheduleInstallments(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can schedule installments.");
  const input = scheduleSchema.parse(raw);
  const tz = ctx.company.timezone;
  await prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    const unpaid = await tx.capitalInstallment.count({
      where: { capitalSourceId: source.id, status: { in: [...UNPAID] } },
    });
    if (unpaid > 0 && !input.replaceUnpaid) {
      throw new AppError(
        "CONFLICT",
        `${source.name} already has ${unpaid} unpaid installment(s); choose to replace them to reschedule.`,
      );
    }
    const built = await buildSchedule(ctx, tx, source, input);
    if (unpaid > 0) {
      await tx.capitalInstallment.deleteMany({
        where: { capitalSourceId: source.id, status: { in: [...UNPAID] } },
      });
    }
    await tx.capitalInstallment.createMany({
      data: built.plan.map((i) => ({
        capitalSourceId: source.id,
        dueDate: startOfDayInZone(i.dueDate, tz),
        amount: i.amount,
        principalPart: i.principal,
        interestPart: i.interest,
        note: `${input.plan.replace("_", " ")} ${i.number} of ${input.count}`,
      })),
    });
    if (input.annualRate !== undefined && source.interestRate === null) {
      await tx.capitalSource.update({
        where: { id: source.id },
        data: { interestRate: input.annualRate },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CapitalInstallment",
        entityId: source.id,
        summary: `Scheduled ${input.count} ${input.plan} installment(s) for ${source.name}: principal ${built.totals.principal.toFixed(2)}, interest ${built.totals.interest.toFixed(2)}${
          unpaid > 0 ? ` (replaced ${unpaid} unpaid)` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}

/** One installment added by hand (an irregular due, a profit payout date). */
export async function addInstallment(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can schedule installments.");
  const input = addInstallmentSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const source = await lockSource(tx, ctx, sourceId);
    if (isOwner(source.kind)) {
      throw new AppError("VALIDATION", "Owner's capital has no repayment schedule.");
    }
    if (source.status === "SETTLED") {
      throw new AppError("CONFLICT", `${source.name} is repaid in full.`);
    }
    const principal = money(input.principalPart);
    const interest = money(input.interestPart);
    const created = await tx.capitalInstallment.create({
      data: {
        capitalSourceId: source.id,
        dueDate: startOfDayInZone(input.dueDate, ctx.company.timezone),
        amount: principal.plus(interest),
        principalPart: principal,
        interestPart: interest,
        note: input.note ?? null,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CapitalInstallment",
        entityId: created.id,
        summary: `Added an installment of ${created.amount.toFixed(2)} due ${input.dueDate} for ${source.name}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}

async function findInstallment(ctx: CompanyContext, installmentId: string) {
  const installment = await prisma.capitalInstallment.findFirst({
    where: { id: installmentId, capitalSource: { companyId: ctx.company.id } },
  });
  if (!installment) throw new AppError("NOT_FOUND", "Installment not found.");
  return installment;
}

/** Locks source then installment (always in that order) and re-reads the installment. */
async function lockInstallment(tx: Tx, ctx: CompanyContext, installmentId: string) {
  const found = await findInstallment(ctx, installmentId);
  const source = await lockSource(tx, ctx, found.capitalSourceId);
  await lockRow(tx, "CapitalInstallment", found.id);
  const installment = await tx.capitalInstallment.findUniqueOrThrow({ where: { id: found.id } });
  if (installment.status === "PAID") {
    throw new AppError("CONFLICT", "This installment is already paid.");
  }
  if (installment.status === "SKIPPED") {
    throw new AppError("CONFLICT", "This installment was skipped.");
  }
  return { source, installment };
}

/** Pays an installment; the split defaults to the schedule's principal and interest. */
export async function payInstallment(
  ctx: CompanyContext,
  installmentId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can pay installments.");
  assertCanPayMoney(ctx);
  const input = payInstallmentSchema.parse(raw);
  const tz = ctx.company.timezone;
  const date = input.date ? toInstant(input.date, tz) : new Date();
  const sourceId = await prisma.$transaction(async (tx) => {
    const { source, installment } = await lockInstallment(tx, ctx, installmentId);
    const scheduledInterest = installment.interestPart ?? ZERO;
    const scheduledPrincipal =
      installment.principalPart ?? installment.amount.minus(scheduledInterest);
    const principal = money(input.principalPart ?? scheduledPrincipal);
    const interest = money(input.interestPart ?? scheduledInterest);
    if (principal.plus(interest).lte(0)) {
      throw new AppError("VALIDATION", "Enter the principal, the interest or both.");
    }
    assertPrincipalFits(source, principal, await outstandingTx(tx, ctx.company.id, source));
    const due = localDay(installment.dueDate, tz);
    const paidFrom = await cashAccountFor(tx, ctx.company.id, input.method, input.accountId);
    const entry = await postPayoutTx(tx, ctx, source, {
      method: input.method,
      accountId: paidFrom,
      reference: input.reference,
      principal,
      interest,
      date,
      description: `Installment due ${due} — ${source.name}${input.notes ? ` — ${input.notes}` : ""}`,
    });
    await tx.capitalInstallment.update({
      where: { id: installment.id },
      data: {
        status: "PAID",
        paidAt: date,
        paidFromAccountId: paidFrom,
        journalEntryId: entry.id,
        principalPart: principal,
        interestPart: interest,
        amount: principal.plus(interest),
      },
    });
    await syncSourceTx(tx, ctx.company.id, source.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CapitalInstallment",
        entityId: installment.id,
        summary: `Paid installment due ${due} to ${source.name}: ${principal.plus(interest).toFixed(2)} (principal ${principal.toFixed(2)}, interest ${interest.toFixed(2)}, ${input.method}) ${entry.number}`,
      },
      tx,
    );
    return source.id;
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}

/** Marks an unpaid installment as not needed (waived, rescheduled by the lender...). */
export async function skipInstallment(
  ctx: CompanyContext,
  installmentId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can change installments.");
  const { reason } = skipInstallmentSchema.parse(raw);
  const sourceId = await prisma.$transaction(async (tx) => {
    const { source, installment } = await lockInstallment(tx, ctx, installmentId);
    await tx.capitalInstallment.update({
      where: { id: installment.id },
      data: { status: "SKIPPED", note: reason },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "CapitalInstallment",
        entityId: installment.id,
        summary: `Skipped installment due ${localDay(installment.dueDate, ctx.company.timezone)} (${installment.amount.toFixed(2)}) for ${source.name}: ${reason}`,
      },
      tx,
    );
    return source.id;
  }, TX_OPTIONS);
  return getCapitalSource(ctx, sourceId);
}
