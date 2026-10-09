import { type JournalSource, Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { rawBalance } from "@/modules/accounts/balances";
import {
  getBankAccount,
  getBankStatement,
  listBankAccounts,
} from "@/modules/accounts/bank.service";
import { isPartySubType } from "@/modules/accounts/chart";
import {
  getAccountLedger,
  getAccountOrThrow,
  isLinked,
  listAccounts,
  listCashAccounts,
  openingBalanceBlock,
} from "@/modules/accounts/chart.service";
import {
  isMoneyAccountKind,
  LEDGER_LINES_SHOWN,
  type MoneyAccountKind,
} from "@/modules/accounts/choices";
import { getAccountsOverview } from "@/modules/accounts/reports.service";
import {
  accountsKeys,
  canArchiveAccount,
  canCloseBankAccount,
  canReverseEntry,
  canVoidSupplierPayment,
} from "@/modules/accounts/rules";
import { CREATABLE_SUBTYPES } from "@/modules/accounts/schemas";
import {
  getSupplierPayment,
  listSupplierPayments,
} from "@/modules/accounts/supplier-payment.service";
import { getJournalEntry, listJournalEntries } from "@/modules/accounts/voucher.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { isWalkIn } from "@/modules/parties/walk-in";
import { canSeeProductionCosts } from "@/modules/production/project-costs";

/*
 * What the Accounts screens show, as plain values (amounts as "12500.00"
 * strings, days as "2026-10-08" in company time), with what the person looking
 * may do decided by the same permissions and rules the accounts actions use:
 *   accounts.view             balances, ledgers, bank statements, the journal,
 *                             the chart of accounts and the financial reports
 *   accounts.manage           journal vouchers, accounts, bank accounts
 *   accounts.receipts.record  money into a cash, bank or wallet account
 *   accounts.payments.record  money out of one: supplier payments, transfers
 * and the rules in accounts/rules.ts. Expenses have their own screens service.
 */

const ZERO = new Prisma.Decimal(0);
const sum = (amounts: string[]) => amounts.reduce((total, a) => total.plus(a), ZERO).toFixed(2);

/** What this person may do anywhere in Accounts (each screen narrows it to the record). */
export function accountsAccess(ctx: CompanyContext) {
  const keys = accountsKeys(ctx);
  return {
    ...keys,
    /** Search suppliers to pay or to owe (the same people who see them elsewhere). */
    findParties: ctx.can("parties.view") || keys.view || keys.pay || ctx.can("expenses.manage"),
    /** Open a buyer's or supplier's profile (Buyers & suppliers). */
    openParty: ctx.can("parties.view"),
  };
}

/** Supplier bills open on the Production screens, with their costs. */
const canOpenBill = (ctx: CompanyContext) =>
  ctx.can("production.view") && canSeeProductionCosts(ctx);

const partyOf = (party: { id: string; code: string; name: string } | null) =>
  party ? { id: party.id, code: party.code, name: party.name } : null;

// =============================================================================
// Cash, bank and wallet accounts
// =============================================================================

/** Active cash, bank and wallet accounts with their balances: where money is paid from or into. */
export async function listMoneyAccounts(ctx: CompanyContext) {
  const accounts = await listCashAccounts(ctx);
  return accounts.flatMap((a) =>
    isMoneyAccountKind(a.subType)
      ? [
          {
            id: a.id,
            code: a.code,
            name: a.name,
            kind: a.subType as MoneyAccountKind,
            balance: a.balance,
            bankAccountId: a.linkedTo?.kind === "BANK_ACCOUNT" ? a.linkedTo.id : null,
          },
        ]
      : [],
  );
}

export type MoneyAccountOption = Awaited<ReturnType<typeof listMoneyAccounts>>[number];

/**
 * The Accounts Overview: money in hand and in the bank, what buyers owe and
 * what is owed to suppliers, profit, stock and what is waiting for Accounts.
 */
export async function getOverviewScreen(ctx: CompanyContext) {
  const [o, banks] = await Promise.all([
    getAccountsOverview(ctx),
    ctx.db.bankAccount.findMany({ select: { id: true, ledgerAccountId: true } }),
  ]);
  const access = accountsAccess(ctx);
  const bankOf = new Map(banks.map((b) => [b.ledgerAccountId, b.id]));
  return {
    asOf: o.asOf,
    cash: {
      total: o.cash.total,
      accounts: o.cash.accounts.map((a) => ({
        id: a.accountId,
        code: a.code,
        name: a.name,
        kind: a.subType as MoneyAccountKind,
        isActive: a.isActive,
        balance: a.balance,
        bankAccountId: bankOf.get(a.accountId) ?? null,
      })),
    },
    receivables: o.receivables,
    payables: o.payables,
    customerAdvances: o.customerAdvances,
    todaySales: o.todaySales,
    netProfit: o.netProfit,
    stockValue: o.stockValue,
    rawMaterialsValue: o.rawMaterials.value,
    workInProgress: o.workInProgress,
    fixedAssets: o.fixedAssets,
    liabilities: o.liabilities,
    installments: o.installments,
    pendingClaims: o.pendingClaims,
    payroll: {
      employeeAdvances: o.payroll.employeeAdvances,
      salariesPayable: o.payroll.salariesPayable,
      draftsAwaitingApproval: o.payroll.draftsAwaitingApproval,
      awaitingPayment: o.payroll.awaitingPayment,
    },
    can: { transfer: access.pay, paySupplier: access.pay, payClaims: access.pay },
  };
}

export type AccountsOverviewScreen = Awaited<ReturnType<typeof getOverviewScreen>>;

/**
 * Cash & bank: the cash and wallet accounts, every bank account (closed ones
 * too) with its balance, and whether this person may move money or add one.
 */
export async function getCashBankScreen(ctx: CompanyContext) {
  const [money, banks] = await Promise.all([
    listMoneyAccounts(ctx),
    listBankAccounts(ctx, { includeInactive: true }),
  ]);
  const access = accountsAccess(ctx);
  return {
    total: sum(money.map((a) => a.balance)),
    /** Cash in hand, wallets, and the general bank account before any bank account is added. */
    accounts: money.filter((a) => !a.bankAccountId),
    banks: banks.map((b) => ({
      id: b.id,
      bankName: b.bankName,
      branch: b.branch,
      accountName: b.accountName,
      accountNumber: b.accountNumber,
      isActive: b.isActive,
      balance: b.balance,
      ledgerAccount: { id: b.ledgerAccount.id, code: b.ledgerAccount.code },
    })),
    moneyAccounts: money,
    can: {
      transfer: access.pay && money.length >= 2,
      addBank: access.manage,
      addAccount: access.manage,
    },
  };
}

export type CashBankScreen = Awaited<ReturnType<typeof getCashBankScreen>>;

type Range = { from?: string; to?: string };

/**
 * One bank account: its details, the statement for the days chosen (the latest
 * lines, with a month-by-month summary) and what this person may change.
 */
export async function getBankScreen(ctx: CompanyContext, bankAccountId: string, range: Range = {}) {
  const tz = ctx.company.timezone;
  const [bank, statement] = await Promise.all([
    getBankAccount(ctx, bankAccountId),
    getBankStatement(ctx, bankAccountId, range),
  ]);
  const access = accountsAccess(ctx);
  const close = access.manage && bank.isActive ? canCloseBankAccount(bank, bank.balance) : null;
  const shown = statement.transactions.slice(-LEDGER_LINES_SHOWN);
  const moneyAccounts = access.pay && bank.isActive ? await listMoneyAccounts(ctx) : [];
  return {
    today: localDay(new Date(), tz),
    from: range.from ?? null,
    to: range.to ?? null,
    period: { from: statement.period.from, to: statement.period.to },
    bank: {
      id: bank.id,
      bankName: bank.bankName,
      branch: bank.branch,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      routingNumber: bank.routingNumber,
      swiftCode: bank.swiftCode,
      isActive: bank.isActive,
      balance: bank.balance,
      ledgerAccount: bank.ledgerAccount,
    },
    summary: statement.summary,
    months: statement.months,
    transactions: shown.map((t) => ({
      entryId: t.entryId,
      day: localDay(t.date, tz),
      voucherNumber: t.voucherNumber,
      particulars: t.particulars,
      reference: t.reference,
      deposit: t.deposit,
      withdrawal: t.withdrawal,
      balance: t.balance,
    })),
    hiddenCount: statement.transactions.length - shown.length,
    /** Where money can move to and from this account. */
    moneyAccounts,
    can: {
      edit: access.manage,
      close: close?.ok ?? false,
      reopen: access.manage && !bank.isActive,
      transfer: moneyAccounts.length >= 2,
      openEntries: access.view,
    },
    notes: { close: close && !close.ok ? close.message : null },
  };
}

export type BankScreen = Awaited<ReturnType<typeof getBankScreen>>;

/** What the bank account form starts with: empty for a new one, or the account's details. */
export async function getBankForm(ctx: CompanyContext, bankAccountId?: string) {
  const today = localDay(new Date(), ctx.company.timezone);
  const holder = ctx.company.legalName ?? ctx.company.name;
  if (!bankAccountId) return { today, holder, bank: null };
  const bank = await getBankAccount(ctx, bankAccountId);
  return {
    today,
    holder,
    bank: {
      id: bank.id,
      bankName: bank.bankName,
      branch: bank.branch,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      routingNumber: bank.routingNumber,
      swiftCode: bank.swiftCode,
      isActive: bank.isActive,
    },
  };
}

export type BankForm = Awaited<ReturnType<typeof getBankForm>>;

// =============================================================================
// Supplier payments
// =============================================================================

type PaymentData = Awaited<ReturnType<typeof listSupplierPayments>>["items"][number];

function presentPaymentRow(p: PaymentData, tz: string) {
  return {
    id: p.id,
    number: p.number,
    paidOn: localDay(p.paymentDate, tz),
    method: p.method,
    amount: p.amount,
    reference: p.reference,
    supplier: partyOf(p.supplier),
    account: p.account ? { id: p.account.id, name: p.account.name } : null,
    bill: p.bill,
    isVoid: p.isVoid,
  };
}

export type SupplierPaymentRow = ReturnType<typeof presentPaymentRow>;

export async function listSupplierPaymentRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listSupplierPayments(ctx, raw);
  const tz = ctx.company.timezone;
  return {
    items: page.items.map((p) => presentPaymentRow(p, tz)),
    nextCursor: page.nextCursor,
  };
}

/** The Supplier payments tab: the first page, the supplier filtered on, and who may pay. */
export async function getSupplierPaymentList(
  ctx: CompanyContext,
  query: { supplierId?: string; cursor?: string; take?: number } = {},
) {
  const supplier = query.supplierId
    ? await ctx.db.party.findUnique({
        where: { id: query.supplierId },
        select: { id: true, code: true, name: true },
      })
    : null;
  return {
    ...(await listSupplierPaymentRows(ctx, { ...query, supplierId: supplier?.id })),
    supplier,
    canPay: accountsAccess(ctx).pay,
  };
}

export type SupplierPaymentList = Awaited<ReturnType<typeof getSupplierPaymentList>>;

/** What a supplier is owed now and their open bills, oldest first (what a payment settles). */
export async function getSupplierDues(ctx: CompanyContext, supplierId: string) {
  const tz = ctx.company.timezone;
  const [balance, bills] = await Promise.all([
    getPartyBalance(ctx, supplierId),
    ctx.db.supplierBill.findMany({
      where: { supplierId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      select: { id: true, number: true, billDate: true, totalAmount: true, dueAmount: true },
      orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
      take: 21,
    }),
  ]);
  return {
    /** Owed to the supplier (negative: they hold an advance from us). */
    payable: balance.neg().toFixed(2),
    openBills: bills.slice(0, 20).map((b) => ({
      id: b.id,
      number: b.number,
      billOn: localDay(b.billDate, tz),
      total: b.totalAmount.toFixed(2),
      due: b.dueAmount.toFixed(2),
    })),
    moreBills: bills.length > 20,
  };
}

export type SupplierDues = Awaited<ReturnType<typeof getSupplierDues>>;

/** One payment to a supplier: what it settled, where the money came from, and voiding it. */
export async function getSupplierPaymentScreen(ctx: CompanyContext, paymentId: string) {
  const p = await getSupplierPayment(ctx, paymentId);
  const access = accountsAccess(ctx);
  const tz = ctx.company.timezone;
  const account = await ctx.db.ledgerAccount.findUnique({
    where: { id: p.account.id },
    select: { subType: true },
  });
  const voiding = access.pay
    ? canVoidSupplierPayment(ctx, {
        number: p.number,
        journalEntry: p.journalEntry,
        accountSubType: account!.subType,
      })
    : null;
  return {
    payment: {
      id: p.id,
      number: p.number,
      paidOn: localDay(p.paymentDate, tz),
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      notes: p.notes,
      supplier: partyOf(p.supplier)!,
      account: { id: p.account.id, code: p.account.code, name: p.account.name },
      bill: p.bill,
      journalEntry: p.journalEntry
        ? { id: p.journalEntry.id, number: p.journalEntry.number }
        : null,
      isVoid: p.isVoid,
    },
    supplierNow: {
      payable: p.supplierNow.payable,
      openBills: p.supplierNow.openBills.map((b) => ({
        id: b.id,
        number: b.number,
        billOn: localDay(b.billDate, tz),
        total: b.totalAmount,
        due: b.dueAmount,
      })),
    },
    can: {
      void: voiding?.ok ?? false,
      openParty: access.openParty,
      openEntry: access.view && Boolean(p.journalEntry),
      openBill: canOpenBill(ctx),
      openLedger: access.view,
    },
    notes: { void: voiding && !voiding.ok && !p.isVoid ? voiding.message : null },
  };
}

export type SupplierPaymentScreen = Awaited<ReturnType<typeof getSupplierPaymentScreen>>;

/**
 * Buyers or suppliers to choose: a supplier to pay (open, settling or dormant
 * accounts) or to owe (open or dormant ones), or the buyer or supplier on a
 * journal line. Never Walk-in customers.
 */
export async function findParties(
  ctx: CompanyContext,
  query: { kind: "SUPPLIER" | "BUYER"; purpose: "PAY" | "DUE" | "JOURNAL"; search?: string },
) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const rows = await ctx.db.party.findMany({
    where: {
      kind: { in: [query.kind, "BOTH"] },
      status: {
        in: query.purpose === "DUE" ? ["ACTIVE", "DORMANT"] : ["ACTIVE", "DORMANT", "SETTLING"],
      },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
              { contactPerson: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 21,
  });
  return rows
    .filter((p) => !isWalkIn(p))
    .slice(0, 20)
    .map((p) => ({ id: p.id, code: p.code, name: p.name, phone: p.phone, city: p.city }));
}

export type PartyOption = Awaited<ReturnType<typeof findParties>>[number];

/**
 * What the payment form needs: today, the accounts money can come from, and
 * the supplier it starts on (from their profile or a bill) with what they are owed.
 */
export async function getPayForm(ctx: CompanyContext, supplierId?: string) {
  const accounts = await listMoneyAccounts(ctx);
  let supplier: { option: PartyOption; dues: SupplierDues } | null = null;
  if (supplierId) {
    const p = await ctx.db.party.findUnique({ where: { id: supplierId } });
    if (p && p.kind !== "BUYER" && p.status !== "CLOSED" && !isWalkIn(p)) {
      supplier = {
        option: { id: p.id, code: p.code, name: p.name, phone: p.phone, city: p.city },
        dues: await getSupplierDues(ctx, p.id),
      };
    }
  }
  return { today: localDay(new Date(), ctx.company.timezone), accounts, supplier };
}

export type PayForm = Awaited<ReturnType<typeof getPayForm>>;

// =============================================================================
// The journal
// =============================================================================

type EntryData = Awaited<ReturnType<typeof getJournalEntry>>;

function presentEntryRow(e: EntryData, tz: string) {
  const accounts = [...new Set(e.lines.map((l) => l.account.name))];
  return {
    id: e.id,
    number: e.number,
    day: localDay(e.date, tz),
    description: e.description,
    sourceType: e.sourceType,
    total: e.total,
    isReversed: e.isReversed,
    reversalOf: e.reversalOf,
    accounts: accounts.slice(0, 3),
    moreAccounts: Math.max(0, accounts.length - 3),
  };
}

export type JournalRow = ReturnType<typeof presentEntryRow>;

export async function listJournalRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listJournalEntries(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((e) => presentEntryRow(e, tz)), nextCursor: page.nextCursor };
}

/** The Journal tab: the first page, and whether this person may write a journal voucher. */
export async function getJournalList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listJournalRows(ctx, raw)), canCreate: accountsAccess(ctx).manage };
}

export type JournalList = Awaited<ReturnType<typeof getJournalList>>;

/**
 * The record an entry came from, for people who may open it there: the
 * invoice, the receipt, the bill, the issue note... Entries from screens not
 * built yet (payroll, assets, capital) name no record.
 */
async function sourceLink(
  ctx: CompanyContext,
  sourceType: JournalSource,
  sourceId: string | null,
): Promise<{ title: string; href: string | null } | null> {
  if (!sourceId) return null;
  const sales = ctx.can("sales.view");
  const production = ctx.can("production.view");
  /** Material purchases and returns open with their prices in Raw materials. */
  const materials = ctx.can("materials.view") && canSeeMaterialCosts(ctx);
  switch (sourceType) {
    case "SALE": {
      const invoice = await ctx.db.invoice.findUnique({
        where: { id: sourceId },
        select: { number: true },
      });
      if (!invoice) return null;
      return {
        title: `Invoice ${invoice.number}`,
        href: sales ? `/sales/invoices/${sourceId}` : null,
      };
    }
    case "PAYMENT": {
      const payment = await ctx.db.payment.findUnique({
        where: { id: sourceId },
        select: { number: true, direction: true, partyId: true },
      });
      if (payment?.direction === "RECEIVED") {
        return {
          title: `Receipt ${payment.number}`,
          href: sales ? `/sales/payments/${sourceId}` : null,
        };
      }
      if (payment) {
        const access = accountsAccess(ctx);
        return {
          title: `Payment ${payment.number}`,
          href:
            payment.partyId && (access.view || access.pay)
              ? `/accounts/supplier-payments/${sourceId}`
              : null,
        };
      }
      // Payments held as an advance after an invoice was voided name their order.
      const order = await ctx.db.salesOrder.findUnique({
        where: { id: sourceId },
        select: { number: true },
      });
      return order
        ? { title: `Order ${order.number}`, href: sales ? `/sales/orders/${sourceId}` : null }
        : null;
    }
    case "REFUND": {
      const refund = await ctx.db.refund.findUnique({
        where: { id: sourceId },
        select: { number: true, orderId: true, proformaId: true },
      });
      if (!refund) return null;
      const href = !sales
        ? null
        : refund.orderId
          ? `/sales/orders/${refund.orderId}`
          : refund.proformaId
            ? `/sales/proformas/${refund.proformaId}`
            : null;
      return { title: `Refund ${refund.number}`, href };
    }
    case "EXPENSE": {
      const expense = await ctx.db.expense.findUnique({
        where: { id: sourceId },
        select: { number: true, projectId: true, project: { select: { code: true } } },
      });
      if (!expense) return null;
      if (expense.projectId) {
        return {
          title: `${expense.number}, a cost on ${expense.project?.code ?? "a project"}`,
          href: production ? `/production/projects/${expense.projectId}` : null,
        };
      }
      return { title: `Expense ${expense.number}`, href: `/accounts/expenses/${sourceId}` };
    }
    case "SUPPLIER_BILL": {
      const bill = await ctx.db.supplierBill.findUnique({
        where: { id: sourceId },
        select: { number: true, _count: { select: { items: true } } },
      });
      if (!bill) return null;
      // Raw material purchases open in Raw materials; bills shared across projects in Production.
      if (bill._count.items > 0 && materials) {
        return { title: `Bill ${bill.number}`, href: `/materials/purchases/${sourceId}` };
      }
      return {
        title: `Bill ${bill.number}`,
        href: canOpenBill(ctx) ? `/production/bills/${sourceId}` : null,
      };
    }
    case "PURCHASE_RETURN": {
      const ret = await ctx.db.purchaseReturn.findUnique({
        where: { id: sourceId },
        select: { number: true },
      });
      if (!ret) return null;
      return {
        title: `Return ${ret.number} to the supplier`,
        href: materials ? `/materials/returns/${sourceId}` : null,
      };
    }
    case "MATERIAL_ISSUE": {
      const note = await ctx.db.materialIssue.findUnique({
        where: { id: sourceId },
        select: { number: true, kind: true, project: { select: { code: true } } },
      });
      if (!note) return null;
      return {
        title: `${note.kind === "ISSUE" ? "Issue note" : "Return note"} ${note.number}, ${
          note.project.code
        }`,
        href: ctx.can("materials.view") ? `/materials/issues/${sourceId}` : null,
      };
    }
    case "STOCK_ADJUSTMENT": {
      // Raw material counts, wastage and opening stock name the stock card line.
      const line = await ctx.db.rawMaterialMovement.findUnique({
        where: { id: sourceId },
        select: { rawMaterialId: true, rawMaterial: { select: { code: true, name: true } } },
      });
      if (!line) return null;
      return {
        title: `${line.rawMaterial.code} ${line.rawMaterial.name}`,
        href: ctx.can("materials.view") ? `/materials/stock/${line.rawMaterialId}` : null,
      };
    }
    case "STOCK_INTAKE": {
      const intake = await ctx.db.stockIntake.findUnique({
        where: { id: sourceId },
        select: { number: true },
      });
      if (!intake) return null;
      return {
        title: `Delivery ${intake.number}`,
        href:
          production || ctx.can("production.stock_intake")
            ? `/production/deliveries/${sourceId}`
            : null,
      };
    }
    case "PRODUCTION": {
      const project = await ctx.db.productionProject.findUnique({
        where: { id: sourceId },
        select: { code: true },
      });
      if (!project) return null;
      return {
        title: `Project ${project.code}`,
        href: production ? `/production/projects/${sourceId}` : null,
      };
    }
    case "OPENING_BALANCE": {
      const account = await ctx.db.ledgerAccount.findUnique({
        where: { id: sourceId },
        select: { code: true, name: true },
      });
      if (account) {
        return {
          title: `${account.code} ${account.name}`,
          href: `/accounts/chart/${sourceId}`,
        };
      }
      const party = await ctx.db.party.findUnique({
        where: { id: sourceId },
        select: { name: true, kind: true },
      });
      if (!party) return null;
      return {
        title: party.name,
        href: ctx.can("parties.view")
          ? `/parties/${party.kind === "SUPPLIER" ? "suppliers" : "buyers"}/${sourceId}`
          : null,
      };
    }
    default:
      return null;
  }
}

/** One journal entry: its lines, the record it came from, and reversing it. */
export async function getJournalEntryScreen(ctx: CompanyContext, entryId: string) {
  const e = await getJournalEntry(ctx, entryId);
  const access = accountsAccess(ctx);
  const tz = ctx.company.timezone;
  const reversing =
    access.manage || access.pay
      ? canReverseEntry(ctx, {
          number: e.number,
          sourceType: e.sourceType,
          reversalOfId: e.reversalOf?.id ?? null,
          isReversed: e.isReversed,
          lines: e.lines.map((l) => ({
            subType: l.account.subType,
            debit: l.debit,
            credit: l.credit,
          })),
        })
      : null;
  return {
    today: localDay(new Date(), tz),
    entry: {
      id: e.id,
      number: e.number,
      day: localDay(e.date, tz),
      description: e.description,
      sourceType: e.sourceType,
      total: e.total,
      isReversed: e.isReversed,
      reversalOf: e.reversalOf,
      reversedBy: e.reversedBy,
      postedBy: e.postedBy?.name ?? null,
      lines: e.lines.map((l) => ({
        id: l.id,
        account: { id: l.account.id, code: l.account.code, name: l.account.name },
        party: partyOf(l.party),
        memo: l.memo,
        debit: l.debit,
        credit: l.credit,
      })),
    },
    source: await sourceLink(ctx, e.sourceType, e.sourceId),
    can: { reverse: reversing?.ok ?? false },
    notes: {
      reverse:
        reversing && !reversing.ok && !e.isReversed && !e.reversalOf ? reversing.message : null,
    },
  };
}

export type JournalEntryScreen = Awaited<ReturnType<typeof getJournalEntryScreen>>;

/**
 * What the journal voucher form needs: the accounts that take hand-written
 * lines, which need a buyer or supplier, and which move money (each needs the
 * matching money permission).
 */
export async function getVoucherForm(ctx: CompanyContext) {
  const { items } = await listAccounts(ctx, {});
  const keys = accountsKeys(ctx);
  return {
    today: localDay(new Date(), ctx.company.timezone),
    accounts: items
      .filter((a) => a.manualPosting)
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        party: isPartySubType(a.subType)
          ? a.subType === "ACCOUNTS_PAYABLE"
            ? ("SUPPLIER" as const)
            : ("BUYER" as const)
          : null,
        isCash: a.isCash,
      })),
    can: { receive: keys.receive, pay: keys.pay },
  };
}

export type VoucherForm = Awaited<ReturnType<typeof getVoucherForm>>;

// =============================================================================
// Chart of accounts
// =============================================================================

/** Every account with its balance today (archived ones on request), and adding one. */
export async function getChartScreen(
  ctx: CompanyContext,
  query: { includeInactive?: boolean } = {},
) {
  const { items } = await listAccounts(ctx, { includeInactive: query.includeInactive ?? false });
  return {
    includeInactive: query.includeInactive ?? false,
    accounts: items.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      isSystem: a.isSystem,
      isActive: a.isActive,
      balance: a.balance,
      linkedTo: a.linkedTo,
    })),
    creatable: CREATABLE_SUBTYPES,
    can: { add: accountsAccess(ctx).manage },
  };
}

export type ChartScreen = Awaited<ReturnType<typeof getChartScreen>>;

/**
 * One account: its balance, its ledger for the days chosen (the latest lines),
 * and renaming, archiving or setting its balance brought forward.
 */
export async function getAccountScreen(ctx: CompanyContext, accountId: string, range: Range = {}) {
  const tz = ctx.company.timezone;
  const [ledger, account] = await Promise.all([
    getAccountLedger(ctx, accountId, range),
    getAccountOrThrow(ctx, accountId),
  ]);
  const access = accountsAccess(ctx);
  const linked = isLinked(account);
  const archive =
    access.manage && account.isActive
      ? canArchiveAccount({ ...account, linked }, await rawBalance(ctx.company.id, account.id))
      : null;
  const a = ledger.account;
  const shown = ledger.lines.slice(-LEDGER_LINES_SHOWN);
  return {
    today: localDay(new Date(), tz),
    from: range.from ?? null,
    to: range.to ?? null,
    account: {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      isSystem: a.isSystem,
      isActive: a.isActive,
      balance: a.balance,
      openingBalance: a.openingBalance,
      linkedTo: a.linkedTo,
      manualPostingNote: a.manualPostingNote,
    },
    summary: ledger.summary,
    lines: shown.map((l) => ({
      entryId: l.entryId,
      day: localDay(l.date, tz),
      number: l.number,
      description: l.description,
      particulars: l.particulars,
      parties: l.parties,
      memo: l.memo,
      debit: l.debit,
      credit: l.credit,
      balance: l.balance,
      isReversal: l.isReversal,
      isReversed: l.isReversed,
    })),
    hiddenCount: ledger.lines.length - shown.length,
    can: {
      rename: access.manage && !linked,
      archive: archive?.ok ?? false,
      reactivate: access.manage && !account.isActive && !linked,
      openingBalance: access.manage && account.isActive && openingBalanceBlock(account) === null,
    },
    // Linked and system accounts explain themselves; a balance left is worth saying.
    notes: {
      archive: archive && !archive.ok && !linked && !account.isSystem ? archive.message : null,
    },
  };
}

export type AccountScreen = Awaited<ReturnType<typeof getAccountScreen>>;
