import { PaymentMethod } from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";
import type { GeneralExpenseCategory } from "@/modules/accounts/chart";

const id = z.string().min(1);
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01);
const positiveMoney = money.refine((v) => v > 0, "Must be more than zero");
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const reason = z.string().trim().min(5).max(500);
const take = z.coerce.number().int().min(1).max(200).optional();
/** A calendar day ("2026-02-28", in company time) or an exact timestamp. */
const dayOrInstant = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);

/** Expense categories outside production (production costs live on projects). */
export const GENERAL_CATEGORIES = [
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
] as const satisfies readonly GeneralExpenseCategory[];

/**
 * PENDING   a claim waiting for Accounts (to pay it back, or to owe the supplier)
 * POSTED    in the books (paid, or owed to a supplier)
 * REJECTED  a claim turned down or withdrawn
 * VOID      posted, then voided (its entry is reversed)
 */
export const EXPENSE_STATUSES = ["PENDING", "POSTED", "REJECTED", "VOID"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

// --- Heads -------------------------------------------------------------------------

export const expenseHeadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.enum(GENERAL_CATEGORIES),
  /** Conveyance / food: every expense names the employee and the purpose. */
  requiresEmployee: z.boolean().optional(),
  /** The expense account it posts to; default: the category's account. */
  ledgerAccountId: id.nullish(),
});

export const updateExpenseHeadSchema = expenseHeadSchema
  .extend({ isActive: z.boolean() })
  .partial();

export const listExpenseHeadsSchema = z.object({
  includeInactive: queryBoolean.optional(),
});

// --- Expenses ------------------------------------------------------------------------

const detailFields = {
  /** Required on conveyance / food heads. */
  employeeId: id.nullish(),
  purpose: optionalText(300),
  fromLocation: optionalText(160),
  toLocation: optionalText(160),
  description: optionalText(1000),
  /** An uploaded receipt or memo photo. */
  receiptFileId: id.nullish(),
};

export const createExpenseSchema = z
  .object({
    headId: id,
    amount: positiveMoney,
    /** The day it was spent; default: now. */
    date: dayOrInstant.optional(),
    /**
     * CASH_BANK: paid from cash, bank or a wallet (Accounts), or a claim that
     * Accounts pays back. DUE: owed to a supplier (paid later by Accounts);
     * from anyone but Accounts it waits for Accounts to approve it.
     */
    paymentType: z.enum(["CASH_BANK", "DUE"]).default("CASH_BANK"),
    method: z.enum(PaymentMethod).default("CASH"),
    /** Cash / bank / wallet ledger account; defaults by method. */
    accountId: id.optional(),
    reference: optionalText(120),
    /** The supplier a Due expense is owed to. */
    supplierId: id.optional(),
    /**
     * Conveyance / food paid now: settle it from the employee's open advances
     * first (the rest is paid in cash). Default: yes.
     */
    useAdvance: z.boolean().default(true),
    ...detailFields,
  })
  .superRefine((v, ctx) => {
    if (v.paymentType === "DUE" && !v.supplierId) {
      ctx.addIssue({
        code: "custom",
        path: ["supplierId"],
        message: "Choose the supplier this is owed to",
      });
    }
    if (v.paymentType === "CASH_BANK" && v.supplierId) {
      ctx.addIssue({
        code: "custom",
        path: ["supplierId"],
        message: "Only Due expenses name a supplier",
      });
    }
  });

export const updateExpenseSchema = z
  .object({
    /** Only while the expense is a pending claim. */
    headId: id,
    amount: positiveMoney,
    date: dayOrInstant,
    ...detailFields,
  })
  .partial();

/** Accounts approves a claim (a cash one is paid back; a Due one goes to the supplier). */
export const approveExpenseSchema = z.object({
  method: z.enum(PaymentMethod).default("CASH"),
  accountId: id.optional(),
  reference: optionalText(120),
  /** When the money was paid; default: now. */
  date: dayOrInstant.optional(),
  /** Conveyance / food: settle it from the employee's open advances first. Default: yes. */
  useAdvance: z.boolean().default(true),
});

export const rejectExpenseSchema = z.object({ reason });
export const voidExpenseSchema = z.object({ reason });

export const listExpensesSchema = z.object({
  status: z.enum(EXPENSE_STATUSES).optional(),
  headId: id.optional(),
  category: z.enum(GENERAL_CATEGORIES).optional(),
  employeeId: id.optional(),
  supplierId: id.optional(),
  /** Only the ones I recorded. */
  mine: queryBoolean.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  take,
});
