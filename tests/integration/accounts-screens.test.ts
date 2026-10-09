import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Accounts screens decide what to show and offer from flags the server
 * sends with the data (can.transfer, can.reverse, can.void, can.approve...).
 * These tests open the screens' data as each built-in role and then try every
 * change through the same Server Actions the buttons call: each must work
 * exactly when the screen offers it, and balances, profit and the reports must
 * reach only Accounts and the owner. Next.js' request helpers are replaced as
 * in screens.test.ts.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`Redirected to ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
      redirectedTo: url,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("Not found"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      notFound: true,
    });
  },
  useRouter: () => ({}),
  usePathname: () => "/accounts",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import EditBankAccountPage from "@/app/(app)/accounts/cash-bank/[bankAccountId]/edit/page";
import BankAccountPage from "@/app/(app)/accounts/cash-bank/[bankAccountId]/page";
import NewBankAccountPage from "@/app/(app)/accounts/cash-bank/new/page";
import CashBankPage from "@/app/(app)/accounts/cash-bank/page";
import AccountPage from "@/app/(app)/accounts/chart/[accountId]/page";
import ChartPage from "@/app/(app)/accounts/chart/page";
import EditExpensePage from "@/app/(app)/accounts/expenses/[expenseId]/edit/page";
import ExpensePage from "@/app/(app)/accounts/expenses/[expenseId]/page";
import ExpenseHeadsPage from "@/app/(app)/accounts/expenses/heads/page";
import NewExpensePage from "@/app/(app)/accounts/expenses/new/page";
import ExpensesPage from "@/app/(app)/accounts/expenses/page";
import JournalEntryPage from "@/app/(app)/accounts/journal/[entryId]/page";
import NewVoucherPage from "@/app/(app)/accounts/journal/new/page";
import JournalPage from "@/app/(app)/accounts/journal/page";
import AccountsOverviewPage from "@/app/(app)/accounts/page";
import BalanceSheetPage from "@/app/(app)/accounts/reports/balance-sheet/page";
import BooksCheckPage from "@/app/(app)/accounts/reports/books-check/page";
import ReportsPage from "@/app/(app)/accounts/reports/page";
import ProfitAndLossPage from "@/app/(app)/accounts/reports/profit-and-loss/page";
import TrialBalancePage from "@/app/(app)/accounts/reports/trial-balance/page";
import SupplierPaymentPage from "@/app/(app)/accounts/supplier-payments/[paymentId]/page";
import PaySupplierPage from "@/app/(app)/accounts/supplier-payments/new/page";
import SupplierPaymentsPage from "@/app/(app)/accounts/supplier-payments/page";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { visibleAccountsTabs } from "@/components/accounts/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import * as bankAccounts from "@/modules/accounts/bank.service";
import * as chart from "@/modules/accounts/chart.service";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import * as vouchers from "@/modules/accounts/voucher.service";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import * as expenses from "@/modules/expenses/expense.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import {
  createAccountAction,
  createBankAccountAction,
  createJournalVoucherAction,
  createTransferAction,
  findAccountsPartiesAction,
  getAccountScreenAction,
  getAccountsOverviewScreenAction,
  getBalanceSheetAction,
  getBankFormAction,
  getBankScreenAction,
  getBooksCheckAction,
  getCashBankScreenAction,
  getChartScreenAction,
  getJournalEntryScreenAction,
  getJournalListAction,
  getPayFormAction,
  getProfitAndLossAction,
  getSupplierDuesAction,
  getSupplierPaymentListAction,
  getSupplierPaymentScreenAction,
  getTrialBalanceAction,
  getVoucherFormAction,
  listJournalRowsAction,
  listSupplierPaymentRowsAction,
  paySupplierAction,
  reverseJournalVoucherAction,
  setAccountOpeningBalanceAction,
  updateAccountAction,
  updateBankAccountAction,
  voidSupplierPaymentAction,
} from "@/server/actions/accounts.actions";
import {
  approveExpenseAction,
  createExpenseAction,
  createExpenseHeadAction,
  getExpenseFormAction,
  getExpenseHeadsScreenAction,
  getExpenseListAction,
  getExpenseScreenAction,
  listExpenseRowsAction,
  rejectExpenseAction,
  updateExpenseAction,
  voidExpenseAction,
} from "@/server/actions/expenses.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  accounts: "ACCOUNTS",
  production: "PRODUCTION_MANAGER",
  sales: "SALES_EXECUTIVE",
  store: "WAREHOUSE_TEAM",
  employee: "EMPLOYEE",
} as const;
type Who = keyof typeof ROLES;

async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(
    ["FORBIDDEN", "CONFLICT", "VALIDATION", "NOT_FOUND"],
    `${label}: ${result.error.message}`,
  ).toContain(result.error.code);
}

/** The change works exactly when the screen offered it. */
function expectChange(result: ActionResult<unknown>, offered: boolean, label: string) {
  expect(result.ok, `${label}${result.ok ? "" : `: ${result.error.message}`}`).toBe(offered);
  expectRuleRefusal(result, label);
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** What a page rendered: the "not part of your role" notice, a redirect, not found, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  try {
    const element = await page;
    return element.type === AccountsNoAccess ? "no access" : "page";
  } catch (error) {
    const to = (error as { redirectedTo?: string }).redirectedTo;
    if (to) return `redirect ${to}`;
    if ((error as { notFound?: boolean }).notFound) return "not found";
    throw error;
  }
}

/**
 * Extras with one person in each built-in role, a City Bank account holding
 * 250,000, the mill Narayanganj Fabrics owed 20,000 from before go-live and
 * paid 5,000 of it, a security deposit paid by journal voucher, office rent
 * paid by Accounts and a courier claim from the sales executive.
 */
async function books() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const salesCtx = await contextFor(people.sales.id, company.id);
  const bank = await bankAccounts.createBankAccount(owner, {
    bankName: "City Bank",
    accountName: "Extras Ltd",
    accountNumber: "1102-334455",
    openingBalance: 250000,
  });
  const bankLedger = bank.ledgerAccountId;
  const mill = (await parties.createParty(owner, { kind: "SUPPLIER", name: "Narayanganj Fabrics" }))
    .party;
  await ledger.setOpeningBalance(owner, mill.id, { amount: -20000 });
  const payMill = (amount: number) =>
    supplierPayments.paySupplier(owner, {
      supplierId: mill.id,
      amount,
      method: "BANK_TRANSFER",
      accountId: bankLedger,
    });
  const payment = await payMill(5000);
  const deposit = await chart.createAccount(owner, {
    name: "Security deposits",
    subType: "OTHER_CURRENT_ASSET",
  });
  const voucherFor = (amount: number) =>
    vouchers.createJournalVoucher(owner, {
      description: "Security deposit for the showroom",
      lines: [
        { accountId: deposit.id, debit: amount },
        { accountId: bankLedger, credit: amount },
      ],
    });
  const voucher = await voucherFor(10000);
  const heads = Object.fromEntries(
    (await expenses.listExpenseHeads(owner)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  const rent = await expenses.createExpense(owner, {
    headId: heads["Office Rent"],
    amount: 25000,
    method: "BANK_TRANSFER",
    accountId: bankLedger,
  });
  const claimFor = (amount: number) =>
    expenses.createExpense(salesCtx, { headId: heads["Courier & Delivery"], amount });
  const claim = await claimFor(800);
  return {
    company,
    people,
    owner,
    bank,
    bankLedger,
    mill,
    payment,
    payMill,
    deposit,
    voucher,
    voucherFor,
    heads,
    rent,
    claim,
    claimFor,
  };
}

type Books = Awaited<ReturnType<typeof books>>;

async function as(env: Books, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});

run("Accounts screens", () => {
  beforeEach(resetDb);

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await books();
    const seen: Record<string, unknown> = {};

    for (const who of Object.keys(ROLES) as Who[]) {
      const ctx = await as(env, who);
      const view = ctx.can("accounts.view");
      const manage = ctx.can("accounts.manage");
      const pay = ctx.can("accounts.payments.record");
      const record = ctx.can("expenses.create");
      const manageExpenses = ctx.can("expenses.manage");
      const anyExpense = record || manageExpenses || view || pay;
      const seesAll = manageExpenses || view || pay;
      seen[who] = { view, manage, pay, record, manageExpenses };

      const menu = visibleNavItems([...ctx.permissions]).map((i) => i.href);
      expect(menu.includes("/accounts"), `${who}: Accounts in the menu`).toBe(
        view || pay || manageExpenses,
      );
      expect(menu.includes("/accounts/expenses"), `${who}: Expenses in the menu`).toBe(
        record && !(view || pay || manageExpenses),
      );
      const tabs = visibleAccountsTabs(ctx.permissions).map((t) => t.href);
      expect(tabs.includes("/accounts/reports"), `${who}: reports tab`).toBe(view);
      expect(tabs.includes("/accounts/expenses"), `${who}: expenses tab`).toBe(anyExpense);

      // Each screen's data comes exactly to the people its page is shown to.
      const checks: Array<[string, Promise<ActionResult<unknown>>, boolean]> = [
        ["overview", getAccountsOverviewScreenAction(), view],
        ["cash and bank", getCashBankScreenAction(), view],
        ["bank statement", getBankScreenAction(env.bank.id), view],
        ["new bank form", getBankFormAction(), manage],
        ["bank form", getBankFormAction(env.bank.id), manage],
        ["supplier payments", getSupplierPaymentListAction({}), view || pay],
        ["more payments", listSupplierPaymentRowsAction({}), view || pay],
        ["payment", getSupplierPaymentScreenAction(env.payment.id), view || pay],
        ["pay form", getPayFormAction(), pay],
        ["supplier dues", getSupplierDuesAction(env.mill.id), pay],
        [
          "suppliers",
          findAccountsPartiesAction({ kind: "SUPPLIER", purpose: "PAY", search: "" }),
          ctx.can("parties.view") || view || pay || manageExpenses,
        ],
        ["journal", getJournalListAction({}), view],
        ["more journal", listJournalRowsAction({}), view],
        ["journal entry", getJournalEntryScreenAction(env.voucher.id), view],
        ["voucher form", getVoucherFormAction(), manage],
        ["chart", getChartScreenAction(), view],
        ["account", getAccountScreenAction(env.deposit.id), view],
        ["profit and loss", getProfitAndLossAction({}), view],
        ["balance sheet", getBalanceSheetAction({}), view],
        ["trial balance", getTrialBalanceAction({}), view],
        ["books check", getBooksCheckAction(), view],
        ["expenses", getExpenseListAction({}), anyExpense],
        ["more expenses", listExpenseRowsAction({}), anyExpense],
        ["the claim", getExpenseScreenAction(env.claim.id), seesAll || who === "sales"],
        ["the rent", getExpenseScreenAction(env.rent.id), seesAll],
        ["expense form", getExpenseFormAction(), record],
        ["expense heads", getExpenseHeadsScreenAction(), anyExpense],
      ];
      for (const [label, result, allowed] of checks) {
        const settled = await result;
        expect(settled.ok, `${who}: ${label}`).toBe(allowed);
        expectRuleRefusal(settled, `${who}: ${label}`);
      }

      // What the lists offer follows the same keys.
      const cash = await getCashBankScreenAction();
      if (cash.ok) {
        expect(cash.data.can, who).toEqual({ transfer: pay, addBank: manage, addAccount: manage });
      }
      const journal = await getJournalListAction({});
      if (journal.ok) expect(journal.data.canCreate, who).toBe(manage);
      const accounts = await getChartScreenAction();
      if (accounts.ok) expect(accounts.data.can.add, who).toBe(manage);
      const payments = await getSupplierPaymentListAction({});
      if (payments.ok) expect(payments.data.canPay, who).toBe(pay);
      const list = await getExpenseListAction({});
      if (list.ok) {
        expect(list.data.seesAll, who).toBe(seesAll);
        expect(list.data.can.create, who).toBe(record);
        expect(list.data.can.payClaims, who).toBe(pay);
        expect(list.data.can.manageHeads, who).toBe(manageExpenses || manage);
      }

      // The pages show "not part of your role" in the same cases.
      const page = (allowed: boolean) => (allowed ? "page" : "no access");
      const query = { searchParams: noQuery() };
      const firstTab = visibleAccountsTabs(ctx.permissions)[0]?.href;
      expect(await rendered(AccountsOverviewPage()), `${who}: /accounts`).toBe(
        view ? "page" : firstTab ? `redirect ${firstTab}` : "no access",
      );
      const pages: Array<[string, () => Promise<React.ReactElement>, string]> = [
        ["cash and bank", () => CashBankPage(), page(view)],
        ["new bank", () => NewBankAccountPage(), page(manage)],
        [
          "bank",
          () => BankAccountPage({ params: params({ bankAccountId: env.bank.id }), ...query }),
          page(view),
        ],
        [
          "edit bank",
          () => EditBankAccountPage({ params: params({ bankAccountId: env.bank.id }) }),
          page(manage),
        ],
        ["supplier payments", () => SupplierPaymentsPage(query), page(view || pay)],
        ["pay a supplier", () => PaySupplierPage(query), page(pay)],
        [
          "payment",
          () => SupplierPaymentPage({ params: params({ paymentId: env.payment.id }), ...query }),
          page(view || pay),
        ],
        ["journal", () => JournalPage(query), page(view)],
        ["new voucher", () => NewVoucherPage(), page(manage)],
        [
          "journal entry",
          () => JournalEntryPage({ params: params({ entryId: env.voucher.id }), ...query }),
          page(view),
        ],
        ["chart", () => ChartPage(query), page(view)],
        [
          "account",
          () => AccountPage({ params: params({ accountId: env.deposit.id }), ...query }),
          page(view),
        ],
        ["reports", () => ReportsPage(), page(view)],
        ["profit and loss", () => ProfitAndLossPage(query), page(view)],
        ["balance sheet", () => BalanceSheetPage(query), page(view)],
        ["trial balance", () => TrialBalancePage(query), page(view)],
        ["books check", () => BooksCheckPage(), page(view)],
        ["expenses", () => ExpensesPage(query), page(anyExpense)],
        ["new expense", () => NewExpensePage(), page(record)],
        ["expense heads", () => ExpenseHeadsPage(), page(anyExpense)],
        [
          "the claim",
          () => ExpensePage({ params: params({ expenseId: env.claim.id }), ...query }),
          seesAll || who === "sales" ? "page" : anyExpense ? "not found" : "no access",
        ],
        [
          "change the rent",
          () => EditExpensePage({ params: params({ expenseId: env.rent.id }) }),
          manageExpenses ? "page" : seesAll ? "no access" : anyExpense ? "not found" : "no access",
        ],
      ];
      // Called one at a time, so a page that throws is awaited where it is checked.
      for (const [label, open, expected] of pages) {
        expect(await rendered(open()), `${who}: ${label}`).toBe(expected);
      }
    }

    expect(seen).toEqual({
      owner: { view: true, manage: true, pay: true, record: true, manageExpenses: true },
      accounts: { view: true, manage: true, pay: true, record: true, manageExpenses: true },
      production: { view: false, manage: false, pay: false, record: true, manageExpenses: false },
      sales: { view: false, manage: false, pay: false, record: true, manageExpenses: false },
      store: { view: false, manage: false, pay: false, record: false, manageExpenses: false },
      employee: { view: false, manage: false, pay: false, record: true, manageExpenses: false },
    });
  }, 180_000);

  it("keeps balances and the money accounts away from people who only send claims", async () => {
    const env = await books();
    for (const who of ["sales", "production", "employee"] as const) {
      await as(env, who);
      const list = data(await getExpenseListAction({}), who);
      const form = data(await getExpenseFormAction(), who);
      expect(form.accounts, who).toEqual([]);
      expect(form.can.payNow, who).toBe(false);
      const own = list.items.map((e) => e.id);
      expect(own, who).toEqual(who === "sales" ? [env.claim.id] : []);
      const screens: unknown[] = [list, form];
      if (who === "sales") {
        const claim = data(await getExpenseScreenAction(env.claim.id), who);
        expect(claim.accounts, who).toEqual([]);
        expect(claim.can, who).toMatchObject({ approve: false, reject: true, edit: true });
        screens.push(claim);
      }
      // No balance, no bank and nobody else's expense reaches them.
      const everything = JSON.stringify(screens);
      expect(everything, who).not.toMatch(/225000|250000|City Bank|25000\.00/);
    }
  }, 60_000);

  it("offers each change exactly to the people the actions let make it", async () => {
    const env = await books();
    const done: Record<string, string[]> = {};
    for (const who of ["owner", "accounts", "sales", "employee"] as const) {
      const ctx = await as(env, who);
      done[who] = [];
      const expectOffered = (result: ActionResult<unknown>, offered: boolean, label: string) => {
        expectChange(result, offered, label);
        if (result.ok) done[who]!.push(label.replace(`${who}: `, ""));
      };
      const view = ctx.can("accounts.view");

      // Cash and bank: a new bank account, money moved into it, and closing it.
      const cash = await getCashBankScreenAction();
      const added = await createBankAccountAction({
        bankName: "Dutch-Bangla Bank",
        accountName: `Extras ${who}`,
        accountNumber: `2203-${who}`,
      });
      expectOffered(added, cash.ok && cash.data.can.addBank, `${who}: add a bank`);
      const second = added.ok
        ? added.data
        : await bankAccounts.createBankAccount(env.owner, {
            bankName: "Dutch-Bangla Bank",
            accountName: `Extras ${who}`,
            accountNumber: `2203-${who}`,
          });
      const secondBank = await prisma.bankAccount.findUniqueOrThrow({ where: { id: second.id } });
      const moved = await createTransferAction({
        fromAccountId: env.bankLedger,
        toAccountId: secondBank.ledgerAccountId,
        amount: 1000,
      });
      const statement = await getBankScreenAction(env.bank.id);
      expectOffered(moved, statement.ok && statement.data.can.transfer, `${who}: move money`);
      if (moved.ok) {
        // Moved back out, so the account can close.
        await vouchers.createTransfer(env.owner, {
          fromAccountId: secondBank.ledgerAccountId,
          toAccountId: env.bankLedger,
          amount: 1000,
        });
      }
      const empty = await getBankScreenAction(second.id);
      expectOffered(
        await updateBankAccountAction(second.id, { isActive: false }),
        empty.ok && empty.data.can.close,
        `${who}: close a bank account`,
      );
      if (statement.ok) {
        // One with money in it does not close.
        expect(statement.data.can.close, who).toBe(false);
        expect(statement.data.notes.close, who).toMatch(/transfer the balance out/);
      }

      // Journal: a voucher written by hand is reversed; a payment's entry is not.
      const journal = await getJournalListAction({});
      const written = await createJournalVoucherAction({
        description: `Deposit top-up by ${who}`,
        lines: [
          { accountId: env.deposit.id, debit: 500 },
          { accountId: env.bankLedger, credit: 500 },
        ],
      });
      expectOffered(written, journal.ok && journal.data.canCreate, `${who}: write a voucher`);
      const voucher = await env.voucherFor(700);
      const entry = await getJournalEntryScreenAction(voucher.id);
      expectOffered(
        await reverseJournalVoucherAction(voucher.id, { reason: "Paid twice by mistake" }),
        entry.ok && entry.data.can.reverse,
        `${who}: reverse a voucher`,
      );
      if (entry.ok) expect(entry.data.can.reverse, who).toBe(true);
      const paymentEntry = await prisma.payment.findUniqueOrThrow({
        where: { id: env.payment.id },
        select: { journalEntryId: true },
      });
      const made = await getJournalEntryScreenAction(paymentEntry.journalEntryId!);
      if (made.ok) {
        expect(made.data.can.reverse, who).toBe(false);
        expect(made.data.notes.reverse, who).toMatch(/void the document/);
      }
      expectOffered(
        await reverseJournalVoucherAction(paymentEntry.journalEntryId!, { reason: "Not this one" }),
        false,
        `${who}: reverse a payment's entry`,
      );

      // Chart of accounts: add, rename, bring a balance forward, archive.
      const accounts = await getChartScreenAction();
      const created = await createAccountAction({
        name: `Generator fuel ${who}`,
        subType: "OPERATING_EXPENSE",
      });
      expectOffered(created, accounts.ok && accounts.data.can.add, `${who}: add an account`);
      const petty = created.ok
        ? created.data
        : await chart.createAccount(env.owner, { name: `Petty cash ${who}`, subType: "CASH" });
      const opened = await getAccountScreenAction(petty.id);
      expectOffered(
        await updateAccountAction(petty.id, { name: `Fuel ${who}` }),
        opened.ok && opened.data.can.rename,
        `${who}: rename an account`,
      );
      expectOffered(
        await setAccountOpeningBalanceAction(env.deposit.id, { amount: 3000 }),
        view && data(await getAccountScreenAction(env.deposit.id), who).can.openingBalance,
        `${who}: bring a balance forward`,
      );
      expectOffered(
        await updateAccountAction(petty.id, { isActive: false }),
        opened.ok && opened.data.can.archive,
        `${who}: archive an account`,
      );

      // Supplier payments: paid, then voided.
      const payments = await getSupplierPaymentListAction({});
      const paid = await paySupplierAction({
        supplierId: env.mill.id,
        amount: 1000,
        method: "BANK_TRANSFER",
        accountId: env.bankLedger,
      });
      expectOffered(paid, payments.ok && payments.data.canPay, `${who}: pay a supplier`);
      const payment = paid.ok ? paid.data : await env.payMill(1000);
      const shown = await getSupplierPaymentScreenAction(payment.id);
      expectOffered(
        await voidSupplierPaymentAction(payment.id, { reason: "Paid the wrong mill" }),
        shown.ok && shown.data.can.void,
        `${who}: void a payment`,
      );

      // Expenses: a claim approved or turned down, a posted expense changed and voided.
      const list = data(await getExpenseListAction({}), who);
      const sent = await createExpenseAction({
        headId: env.heads["Courier & Delivery"],
        amount: 300,
      });
      expectOffered(sent, list.can.create, `${who}: record an expense`);
      const claim = await env.claimFor(450);
      const waiting = await getExpenseScreenAction(claim.id);
      expectOffered(
        await updateExpenseAction(claim.id, { amount: 480 }),
        waiting.ok && waiting.data.can.edit,
        `${who}: change a claim`,
      );
      expectOffered(
        await approveExpenseAction(claim.id, {
          method: "BANK_TRANSFER",
          accountId: env.bankLedger,
        }),
        waiting.ok && waiting.data.can.approve,
        `${who}: approve a claim`,
      );
      const other = await env.claimFor(150);
      const another = await getExpenseScreenAction(other.id);
      expectOffered(
        await rejectExpenseAction(other.id, { reason: "No receipt attached" }),
        another.ok && another.data.can.reject,
        `${who}: turn down a claim`,
      );
      const rent = await getExpenseScreenAction(env.rent.id);
      expectOffered(
        await updateExpenseAction(env.rent.id, { description: `Checked by ${who}` }),
        rent.ok && rent.data.can.edit,
        `${who}: change a posted expense`,
      );
      const posted = await expenses.createExpense(env.owner, {
        headId: env.heads["Office Rent"],
        amount: 900,
        method: "BANK_TRANSFER",
        accountId: env.bankLedger,
      });
      const toVoid = await getExpenseScreenAction(posted.id);
      expectOffered(
        await voidExpenseAction(posted.id, { reason: "Recorded twice" }),
        toVoid.ok && toVoid.data.can.void,
        `${who}: void an expense`,
      );
      const heads = await getExpenseHeadsScreenAction();
      expectOffered(
        await createExpenseHeadAction({ name: `Generator fuel ${who}`, category: "UTILITIES" }),
        heads.ok && heads.data.canManage,
        `${who}: add an expense head`,
      );
    }

    // Accounts and the owner can make every change; claimants only their own claims.
    const everything = done.owner!;
    expect(everything).toHaveLength(18);
    expect(done.accounts).toEqual(everything);
    expect(done.sales).toEqual(["record an expense", "change a claim", "turn down a claim"]);
    expect(done.employee).toEqual(["record an expense"]);
  }, 180_000);
});
