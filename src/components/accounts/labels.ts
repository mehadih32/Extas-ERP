import type {
  AccountSubType,
  AccountType,
  AssetStatus,
  CapitalLenderKind,
  DepreciationMethod,
  JournalSource,
  PaymentType,
} from "@prisma/client";

import { formatDay, formatDayRange, FULL_MONTHS, groupAmount } from "@/lib/display";
import type { MoneyAccountKind } from "@/modules/accounts/choices";
import type { CostPeriod } from "@/modules/accounts/cost-periods";
import type { Growth, ProfitPeriod } from "@/modules/accounts/profit-periods";
import type { PeriodPreset } from "@/modules/accounts/periods";
import type { ExpenseStatus } from "@/modules/expenses/schemas";

/*
 * Words and figures for the Accounts screens: plain strings in, plain strings
 * out, so the browser and the tests share them.
 */

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Owner's equity",
  INCOME: "Income",
  EXPENSE: "Expenses",
};

export const ACCOUNT_TYPES: readonly AccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "EXPENSE",
];

export const SUBTYPE_LABELS: Record<AccountSubType, string> = {
  CASH: "Cash in hand",
  BANK: "Bank",
  MOBILE_WALLET: "Mobile wallet",
  ACCOUNTS_RECEIVABLE: "Owed by buyers",
  INVENTORY: "Stock",
  RAW_MATERIALS: "Raw materials",
  PENDING_RETURNS: "Returns waiting for QC",
  ADVANCE_TO_EMPLOYEE: "Advances to employees",
  OTHER_CURRENT_ASSET: "Other asset",
  FIXED_ASSET: "Fixed asset",
  ACCUMULATED_DEPRECIATION: "Depreciation so far",
  ACCOUNTS_PAYABLE: "Owed to suppliers",
  CUSTOMER_ADVANCE: "Buyer advances",
  LOAN: "Loan",
  INVESTOR: "Investor",
  OTHER_LIABILITY: "Other liability",
  CAPITAL: "Capital",
  RETAINED_EARNINGS: "Retained earnings",
  DRAWINGS: "Drawings",
  SALES: "Sales",
  OTHER_INCOME: "Other income",
  COGS: "Cost of goods sold",
  INVENTORY_LOSS: "Stock and production losses",
  OPERATING_EXPENSE: "Running costs",
  PAYROLL_EXPENSE: "Salaries",
  MARKETING_EXPENSE: "Marketing",
  COURIER_EXPENSE: "Courier",
  FINANCE_COST: "Finance costs",
};

/** What each kind of account added by hand is for. */
export const SUBTYPE_HINTS: Partial<Record<AccountSubType, string>> = {
  CASH: "A cash box or petty cash kept somewhere else.",
  MOBILE_WALLET: "Another bKash, Nagad or Rocket account.",
  OTHER_CURRENT_ASSET: "Deposits, prepaid rent, money lent.",
  ADVANCE_TO_EMPLOYEE: "Money given ahead that an employee settles later.",
  OTHER_LIABILITY: "Money the company owes that is not a supplier, loan or salary.",
  SALES: "Another kind of sale to report on its own line.",
  OTHER_INCOME: "Interest received, scrap sales, rent received.",
  INVENTORY_LOSS: "Stock written off.",
  OPERATING_EXPENSE: "Rent, utilities, office and other running costs.",
  PAYROLL_EXPENSE: "Wages, bonuses and allowances.",
  MARKETING_EXPENSE: "Ads, promotions and samples.",
  COURIER_EXPENSE: "Delivery and courier charges.",
  FINANCE_COST: "Bank charges, interest paid.",
};

export const KIND_LABELS: Record<MoneyAccountKind, string> = {
  CASH: "Cash",
  BANK: "Bank",
  MOBILE_WALLET: "Mobile wallet",
};

export const SOURCE_LABELS: Record<JournalSource, string> = {
  MANUAL: "Journal voucher",
  SALE: "Sale",
  PAYMENT: "Payment",
  SUPPLIER_BILL: "Supplier bill",
  EXPENSE: "Expense",
  PAYROLL: "Payroll",
  SALARY_ADVANCE: "Salary advance",
  BAD_STOCK: "Damage & QC rejects",
  STOCK_INTAKE: "Factory delivery",
  RETURN: "Sales return",
  COURIER_PAYOUT: "Courier payout",
  CAPITAL: "Capital or loan",
  INSTALLMENT: "Installment",
  DEPRECIATION: "Depreciation",
  OPENING_BALANCE: "Opening balance",
  PRODUCTION: "Production",
  TRANSFER: "Transfer",
  FIXED_ASSET: "Fixed asset",
  STOCK_ADJUSTMENT: "Stock adjustment",
  MATERIAL_ISSUE: "Materials issued",
  PURCHASE_RETURN: "Return to supplier",
  REFUND: "Refund",
  STAFF_CLAIM: "Staff claims",
  CM_SETTLEMENT: "CM settlement",
  SUPPLIER_FAULT: "Supplier fault",
  CORRECTION: "Bug Guard correction",
  RETAIL_EXCHANGE: "Retail exchange",
};

/** The journal's "made by" filter, in the order people look for them. */
export const SOURCE_FILTERS: readonly JournalSource[] = [
  "MANUAL",
  "TRANSFER",
  "SALE",
  "PAYMENT",
  "REFUND",
  "RETURN",
  "RETAIL_EXCHANGE",
  "EXPENSE",
  "SUPPLIER_BILL",
  "STOCK_INTAKE",
  "PRODUCTION",
  "PAYROLL",
  "SALARY_ADVANCE",
  "STAFF_CLAIM",
  "OPENING_BALANCE",
  "STOCK_ADJUSTMENT",
  "BAD_STOCK",
  "MATERIAL_ISSUE",
  "PURCHASE_RETURN",
  "CM_SETTLEMENT",
  "SUPPLIER_FAULT",
  "CORRECTION",
  "FIXED_ASSET",
  "DEPRECIATION",
  "CAPITAL",
  "INSTALLMENT",
];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  PENDING: "Waiting for Accounts",
  POSTED: "In the books",
  REJECTED: "Turned down",
  VOID: "Void",
};

export const EXPENSE_STATUSES: readonly ExpenseStatus[] = ["PENDING", "POSTED", "REJECTED", "VOID"];

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  RENT: "Rent",
  UTILITIES: "Utilities",
  SALARY: "Salaries",
  MARKETING: "Marketing",
  COURIER: "Courier",
  OFFICE: "Office",
  MAINTENANCE: "Repairs",
  CONVEYANCE: "Conveyance",
  FOOD: "Food",
  OTHER: "Other",
};

export const EXPENSE_CATEGORIES = [
  "RENT",
  "UTILITIES",
  "SALARY",
  "MARKETING",
  "COURIER",
  "OFFICE",
  "MAINTENANCE",
  "CONVEYANCE",
  "FOOD",
  "OTHER",
] as const;

export const EXPENSE_PAYMENT_LABELS: Record<PaymentType, string> = {
  CASH_BANK: "Paid",
  DUE: "Owed to a supplier",
};

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  TODAY: "Today",
  THIS_MONTH: "This month",
  LAST_MONTH: "Last month",
  THIS_FINANCIAL_YEAR: "This financial year",
  LAST_FINANCIAL_YEAR: "Last financial year",
  ONE_WEEK: "Last 7 days",
  ONE_MONTH: "Last 30 days",
  SIX_MONTHS: "Last 6 months",
  ONE_YEAR: "Last 12 months",
};

/** The quick choices offered above a report, in order. */
export const PERIOD_CHOICES: readonly PeriodPreset[] = [
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_FINANCIAL_YEAR",
  "LAST_FINANCIAL_YEAR",
  "ONE_YEAR",
];

/** Below zero ("-0.00" is not). */
export const isNegative = (fixed: string) => fixed.startsWith("-") && /[1-9]/.test(fixed);

/** "BDT 12,500.00", or "− BDT 12,500.00" below zero (an overdraft, a loss). */
export function signedMoney(fixed: string, currency: string): string {
  return `${isNegative(fixed) ? "− " : ""}${currency} ${groupAmount(fixed.replace(/^-/, ""), currency)}`;
}

/** An amount in a debit or credit column: blank when zero. */
export function columnAmount(fixed: string, currency: string): string {
  return /[1-9]/.test(fixed) ? `${currency} ${groupAmount(fixed, currency)}` : "";
}

export const accountsHref = {
  bank: (id: string) => `/accounts/cash-bank/${encodeURIComponent(id)}`,
  reconcile: (id: string, show?: "ticked") =>
    `/accounts/cash-bank/${encodeURIComponent(id)}/reconcile${show ? `?show=${show}` : ""}`,
  account: (id: string) => `/accounts/chart/${encodeURIComponent(id)}`,
  entry: (id: string) => `/accounts/journal/${encodeURIComponent(id)}`,
  payment: (id: string) => `/accounts/supplier-payments/${encodeURIComponent(id)}`,
  pay: (supplierId?: string, projectId?: string) =>
    supplierId
      ? `/accounts/supplier-payments/new?supplier=${encodeURIComponent(supplierId)}${
          projectId ? `&project=${encodeURIComponent(projectId)}` : ""
        }`
      : "/accounts/supplier-payments/new",
  expense: (id: string) => `/accounts/expenses/${encodeURIComponent(id)}`,
  file: (id: string) => `/api/files/${encodeURIComponent(id)}`,
};

/** Where a cash, bank or wallet account opens: its bank account, or its ledger. */
export function moneyAccountHref(account: { id: string; bankAccountId: string | null }): string {
  return account.bankAccountId
    ? accountsHref.bank(account.bankAccountId)
    : accountsHref.account(account.id);
}

export const PROFIT_PERIOD_LABELS: Record<ProfitPeriod, string> = {
  TODAY: "Today",
  MONTH: "This month",
  YEAR: "This year",
  LIFETIME: "Lifetime",
};

const COMPARED_WITH: Record<Exclude<ProfitPeriod, "LIFETIME">, string> = {
  TODAY: "yesterday",
  MONTH: "the same days last month",
  YEAR: "the same days last year",
};

/** "Up 12.5% on the same days last month", "Down on yesterday", "Same as yesterday". */
export function growthText(growth: Growth, period: Exclude<ProfitPeriod, "LIFETIME">): string {
  const than = COMPARED_WITH[period];
  if (growth.direction === "FLAT") return `Same as ${than}`;
  const word = growth.direction === "UP" ? "Up" : "Down";
  return growth.percent ? `${word} ${growth.percent}% on ${than}` : `${word} on ${than}`;
}

/** The days a profit figure covers: "1 – 11 Oct 2026", "Today, 11 Oct 2026", "All time to 11 Oct 2026". */
export function profitSpan(card: {
  period: ProfitPeriod;
  from: string | null;
  to: string;
}): string {
  if (!card.from) return `All time to ${formatDay(card.to)}`;
  if (card.period === "TODAY") return `Today, ${formatDay(card.to)}`;
  return formatDayRange(card.from, card.to);
}

/** The breakdown's month or year: "October 2026", or "2026" for the whole year. */
export function costPeriodLabel(period: CostPeriod): string {
  return period.month === null
    ? String(period.year)
    : `${FULL_MONTHS[period.month - 1]} ${period.year}`;
}

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  IN_USE: "In use",
  UNDER_REPAIR: "Under repair",
  DISPOSED: "Sold or scrapped",
};

export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  STRAIGHT_LINE: "The same amount every year",
  REDUCING_BALANCE: "A share of what is left each year",
};

export const assetHref = {
  register: "/accounts/assets",
  asset: (id: string) => `/accounts/assets/${encodeURIComponent(id)}`,
  edit: (id: string) => `/accounts/assets/${encodeURIComponent(id)}/edit`,
  record: "/accounts/assets/new",
};

export const pettyCashHref = {
  box: (id: string) => `/accounts/petty-cash/${encodeURIComponent(id)}`,
  edit: (id: string) => `/accounts/petty-cash/${encodeURIComponent(id)}/edit`,
  open: "/accounts/petty-cash/new",
  /** The expense form with the box chosen as where the money came from. */
  spend: (id: string) => `/accounts/expenses/new?box=${encodeURIComponent(id)}`,
};

/** One employee's pay, month by month, for a year. */
export function employeePayHref(employeeId: string, year?: number): string {
  const base = `/accounts/salaries/${encodeURIComponent(employeeId)}`;
  return year ? `${base}?year=${year}` : base;
}

export const LENDER_KIND_LABELS: Record<CapitalLenderKind, string> = {
  BANK: "Bank",
  NGO: "NGO",
  PERSON: "Person",
};

export const LOAN_STATE_LABELS = {
  RUNNING: "Running",
  RENEWED: "Renewed",
  CLOSED: "Closed",
} as const;

export const loansHref = {
  page: "/accounts/loans",
  add: "/accounts/loans/new",
  lender: (id: string) => `/accounts/loans/${encodeURIComponent(id)}`,
  fixedCosts: "/accounts/expenses/fixed-costs",
};
