import {
  AccountSubType,
  AccountType,
  CapitalSourceKind,
  DepreciationMethod,
  InstallmentStatus,
  JournalSource,
  PaymentMethod,
} from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";
import { PERIOD_PRESETS } from "@/modules/accounts/periods";

const id = z.string().min(1);
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01);
const positiveMoney = money.refine((v) => v > 0, "Must be more than zero");
const signedMoney = z.number().min(-1_000_000_000).max(1_000_000_000).multipleOf(0.01);
const percent = z.number().min(0).max(100).multipleOf(0.01);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const reason = z.string().trim().min(5).max(500);
const take = z.coerce.number().int().min(1).max(200).optional();
/** A calendar day ("2026-02-28", in company time) or an exact timestamp. */
const dayOrInstant = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);
const day = z.iso.date();

/** Where money comes from or goes to: a payment method, and optionally the exact account. */
const cashSide = {
  method: z.enum(PaymentMethod).default("CASH"),
  /** Cash / bank / wallet ledger account; defaults by method. */
  accountId: id.optional(),
  reference: optionalText(120),
};

// --- Chart of accounts ---------------------------------------------------------------

/** Account kinds people can add by hand; the rest are kept by their own modules. */
export const CREATABLE_SUBTYPES = [
  "CASH",
  "MOBILE_WALLET",
  "OTHER_CURRENT_ASSET",
  "ADVANCE_TO_EMPLOYEE",
  "OTHER_LIABILITY",
  "SALES",
  "OTHER_INCOME",
  "INVENTORY_LOSS",
  "OPERATING_EXPENSE",
  "PAYROLL_EXPENSE",
  "MARKETING_EXPENSE",
  "COURIER_EXPENSE",
  "FINANCE_COST",
] as const satisfies AccountSubType[];

export const listAccountsSchema = z.object({
  type: z.enum(AccountType).optional(),
  subType: z.enum(AccountSubType).optional(),
  includeInactive: queryBoolean.optional(),
  search: z.string().trim().max(100).optional(),
  /** Balances at the end of this day (default: now). */
  asOf: day.optional(),
});

export const createAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subType: z.enum(CREATABLE_SUBTYPES),
  /** 4 digits inside the type's range; the next free code when left out. */
  code: z.string().trim().optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
});

export const accountOpeningSchema = z.object({
  /** In the account's normal direction: cash in hand is positive, an overdraft negative. */
  amount: signedMoney,
  /** The go-live day the balance is brought forward to. */
  asOf: dayOrInstant.optional(),
});

export const ledgerQuerySchema = z.object({
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
});

// --- Journal vouchers and transfers ------------------------------------------------------

export const journalLineSchema = z
  .object({
    accountId: id,
    debit: money.optional(),
    credit: money.optional(),
    /** Required on Receivable, Payable and Customer Advance lines. */
    partyId: id.optional(),
    memo: optionalText(200),
  })
  .refine((l) => (l.debit ?? 0) > 0 !== (l.credit ?? 0) > 0, {
    message: "Each line is either a debit or a credit",
    path: ["debit"],
  });

export const createJournalSchema = z.object({
  date: dayOrInstant.optional(),
  description: z.string().trim().min(3).max(300),
  lines: z.array(journalLineSchema).min(2).max(50),
});

export const reverseJournalSchema = z.object({
  reason,
  date: dayOrInstant.optional(),
});

export const listJournalSchema = z.object({
  sourceType: z.enum(JournalSource).optional(),
  accountId: id.optional(),
  search: z.string().trim().max(100).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

export const transferSchema = z
  .object({
    fromAccountId: id,
    toAccountId: id,
    amount: positiveMoney,
    date: dayOrInstant.optional(),
    reference: optionalText(120),
    notes: optionalText(500),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Choose two different accounts",
    path: ["toAccountId"],
  });

// --- Bank accounts -------------------------------------------------------------------------

const bankFields = {
  bankName: z.string().trim().min(2).max(120),
  branch: optionalText(120),
  accountName: z.string().trim().min(2).max(160),
  accountNumber: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .regex(/^[0-9A-Za-z -]+$/, "Use digits, letters, spaces or dashes"),
  routingNumber: optionalText(20),
  swiftCode: optionalText(20),
};

export const createBankAccountSchema = z.object({
  ...bankFields,
  /** Balance on the go-live day; a negative amount is an overdraft. */
  openingBalance: signedMoney.optional(),
  openingDate: dayOrInstant.optional(),
});

export const updateBankAccountSchema = z.object({ ...bankFields, isActive: z.boolean() }).partial();

// --- Fixed assets --------------------------------------------------------------------------

const depreciationFields = {
  /** % per year; leave empty for land and other assets that are not depreciated. */
  depreciationRate: percent.nullish(),
  depreciationMethod: z.enum(DepreciationMethod).optional(),
  /** Value left at the end of its life; book value never goes below it. */
  salvageValue: money.optional(),
};

export const createAssetSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: optionalText(80),
  location: optionalText(160),
  notes: optionalText(2000),
  purchaseDate: dayOrInstant,
  purchaseCost: positiveMoney,
  ...depreciationFields,
  acquisition: z.discriminatedUnion("kind", [
    /** Paid now from cash, bank or a wallet (Accounts: money out). */
    z.object({ kind: z.literal("PAID"), ...cashSide }),
    /** Bought on credit: the supplier's ledger shows what is owed. */
    z.object({
      kind: z.literal("CREDIT"),
      supplierId: id,
      supplierRef: optionalText(80),
    }),
    /** Already owned at go-live: cost and depreciation so far are brought forward. */
    z.object({
      kind: z.literal("OPENING"),
      accumulatedDepreciation: money.default(0),
      asOf: dayOrInstant.optional(),
    }),
  ]),
});

export const updateAssetSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    category: optionalText(80),
    location: optionalText(160),
    notes: optionalText(2000),
    status: z.enum(["IN_USE", "UNDER_REPAIR"]),
    ...depreciationFields,
  })
  .partial();

export const listAssetsSchema = z.object({
  status: z.enum(["IN_USE", "UNDER_REPAIR", "DISPOSED"]).optional(),
  category: z.string().trim().max(80).optional(),
  search: z.string().trim().max(100).optional(),
});

export const depreciationRunSchema = z.object({
  /** Depreciate up to the end of this day; default: the end of last month. */
  through: day.optional(),
});

export const disposeAssetSchema = z.object({
  date: dayOrInstant.optional(),
  /** Sale proceeds; 0 when the asset is scrapped. */
  proceeds: money.default(0),
  ...cashSide,
  reason,
});

/** Removing or voiding something entered by mistake. */
export const voidSchema = z.object({ reason });

// --- Capital, investors and loans ------------------------------------------------------------

const capitalFields = {
  name: z.string().trim().min(2).max(160),
  contact: optionalText(200),
  /** Yearly interest for loans, or the agreed yearly return for investors (%). */
  interestRate: percent.nullish(),
  /** Investors: share of profit agreed (%). */
  profitSharePct: percent.nullish(),
  maturityDate: dayOrInstant.nullish(),
  notes: optionalText(2000),
};

export const createCapitalSchema = z
  .object({
    kind: z.enum(CapitalSourceKind),
    ...capitalFields,
    startDate: dayOrInstant.optional(),
    /** Money received now (Accounts: money in)... */
    received: z.object({ amount: positiveMoney, ...cashSide }).optional(),
    /** ...or the balance already owed / invested at go-live. */
    opening: z.object({ amount: positiveMoney, asOf: dayOrInstant.optional() }).optional(),
  })
  .refine((v) => !(v.received && v.opening), {
    message: "Record either money received now or an opening balance",
    path: ["opening"],
  });

export const updateCapitalSchema = z
  .object({ ...capitalFields, status: z.enum(["ACTIVE", "DEFAULTED"]) })
  .partial();

export const listCapitalSchema = z.object({
  kind: z.enum(CapitalSourceKind).optional(),
  status: z.enum(["ACTIVE", "SETTLED", "DEFAULTED"]).optional(),
});

export const capitalReceiptSchema = z.object({
  amount: positiveMoney,
  date: dayOrInstant.optional(),
  ...cashSide,
  notes: optionalText(500),
});

export const INSTALLMENT_PLANS = ["EMI", "FLAT", "INTEREST_ONLY"] as const;

export const scheduleSchema = z.object({
  /**
   * EMI: equal payments, interest on the balance left. FLAT: equal principal plus
   * interest on the original amount. INTEREST_ONLY: interest / profit each time,
   * principal back with the last one.
   */
  plan: z.enum(INSTALLMENT_PLANS),
  /** Principal to schedule; default: what is outstanding. */
  amount: positiveMoney.optional(),
  /** Yearly rate (%); default: the source's interest rate. */
  annualRate: percent.optional(),
  count: z.number().int().min(1).max(360),
  firstDueDate: day,
  /** 1 = monthly, 3 = quarterly, 6 = half-yearly, 12 = yearly. */
  everyMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).default(1),
  /** Remove unpaid installments first (re-scheduling). */
  replaceUnpaid: z.boolean().default(false),
});

export const addInstallmentSchema = z
  .object({
    dueDate: day,
    principalPart: money.default(0),
    interestPart: money.default(0),
    note: optionalText(300),
  })
  .refine((v) => v.principalPart + v.interestPart > 0, {
    message: "Enter the principal, the interest or both",
    path: ["principalPart"],
  });

export const payInstallmentSchema = z.object({
  date: dayOrInstant.optional(),
  /** Defaults to the scheduled split; change them when the bank charged differently. */
  principalPart: money.optional(),
  interestPart: money.optional(),
  ...cashSide,
  notes: optionalText(500),
});

export const repaySchema = z
  .object({
    date: dayOrInstant.optional(),
    /** Reduces what is owed (loans, investors) or the capital invested (owners). */
    principal: money.default(0),
    /** Interest or profit paid: Finance Costs (owners: Drawings). */
    interest: money.default(0),
    ...cashSide,
    notes: optionalText(500),
  })
  .refine((v) => v.principal + v.interest > 0, {
    message: "Enter the principal, the interest or both",
    path: ["principal"],
  });

export const skipInstallmentSchema = z.object({ reason });

export const listInstallmentsSchema = z.object({
  status: z.enum(InstallmentStatus).optional(),
  /** Unpaid and past their due date. */
  overdue: queryBoolean.optional(),
  sourceId: id.optional(),
  from: day.optional(),
  to: day.optional(),
});

// --- Supplier payments ------------------------------------------------------------------------

export const paySupplierSchema = z.object({
  supplierId: id,
  amount: positiveMoney,
  paymentDate: dayOrInstant.optional(),
  /** Pay for this production project: its bills are settled first. */
  projectId: id.optional(),
  ...cashSide,
  notes: optionalText(1000),
});

export const listSupplierPaymentsSchema = z.object({
  supplierId: id.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Reports -------------------------------------------------------------------------------------

export const periodSchema = z.object({
  period: z.enum(PERIOD_PRESETS).optional(),
  from: day.optional(),
  to: day.optional(),
});

export const profitAndLossSchema = periodSchema.extend({
  /** Adds a column per calendar month. */
  byMonth: queryBoolean.optional(),
});

export const asOfSchema = z.object({ asOf: day.optional() });
