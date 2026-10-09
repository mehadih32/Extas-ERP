import { type AccountSubType, type JournalSource, Prisma } from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import type { CompanyContext } from "@/modules/auth/context";
import { isCashSubType } from "@/modules/accounts/chart";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What may be done with a journal entry, a supplier payment, an account or a
 * bank account from where it stands, given the person's Accounts keys. The
 * accounts services refuse with these answers and the Accounts screens read the
 * same answers to decide what to offer.
 */

type Can = { can: (permission: PermissionKey) => boolean };
type Amount = Prisma.Decimal | string | number;
const positive = (v: Amount) => new Prisma.Decimal(v).gt(0);
const lower = (text: string) => text.toLowerCase().replace(/_/g, " ");

const RECEIVE = "Only Accounts can record money received.";
const PAY = "Only Accounts can record money paid out.";

type CashLine = { subType: AccountSubType; debit: Amount; credit: Amount };

/** Money moving into a cash, bank or wallet account needs receipts; out of one, payments. */
export function canMoveMoney(ctx: Can, lines: CashLine[]): Verdict {
  const cash = lines.filter((l) => isCashSubType(l.subType));
  if (cash.some((l) => positive(l.debit)) && !ctx.can("accounts.receipts.record")) {
    return refuse("FORBIDDEN", RECEIVE);
  }
  if (cash.some((l) => positive(l.credit)) && !ctx.can("accounts.payments.record")) {
    return refuse("FORBIDDEN", PAY);
  }
  return ALLOWED;
}

// --- Journal entries --------------------------------------------------------------------

type EntryState = {
  number: string;
  sourceType: JournalSource;
  reversalOfId: string | null;
  isReversed: boolean;
  lines: CashLine[];
};

/**
 * Journal vouchers and transfers are undone with a mirror entry; entries made
 * by other modules are undone through their own documents (void the bill...).
 */
export function canReverseEntry(ctx: Can, entry: EntryState): Verdict {
  if (entry.sourceType !== "MANUAL" && entry.sourceType !== "TRANSFER") {
    return refuse(
      "CONFLICT",
      `${entry.number} was made by ${lower(entry.sourceType)}; undo it there (void the document).`,
    );
  }
  if (entry.reversalOfId) return refuse("CONFLICT", `${entry.number} is itself a reversal.`);
  if (entry.isReversed) return refuse("CONFLICT", `${entry.number} was already reversed.`);
  if (entry.sourceType === "MANUAL" && !ctx.can("accounts.manage")) {
    return refuse("FORBIDDEN", "Only Accounts can do this.");
  }
  if (entry.sourceType === "TRANSFER" && !ctx.can("accounts.payments.record")) {
    return refuse("FORBIDDEN", "Only Accounts can move money between accounts.");
  }
  // The reversal moves the money the other way, so it needs the mirrored keys.
  return canMoveMoney(
    ctx,
    entry.lines.map((l) => ({ subType: l.subType, debit: l.credit, credit: l.debit })),
  );
}

// --- Supplier payments -------------------------------------------------------------------

type PaymentState = {
  number: string;
  journalEntry: { isReversed: boolean } | null;
  /** The account the money left from. */
  accountSubType: AccountSubType;
};

/** A payment made by mistake is voided: the money comes back into its account. */
export function canVoidSupplierPayment(ctx: Can, payment: PaymentState): Verdict {
  if (!ctx.can("accounts.payments.record")) {
    return refuse("FORBIDDEN", "Only Accounts can void supplier payments.");
  }
  if (!payment.journalEntry) {
    return refuse("CONFLICT", `${payment.number} has no journal entry to reverse.`);
  }
  if (payment.journalEntry.isReversed) {
    return refuse("CONFLICT", `${payment.number} is already void.`);
  }
  if (isCashSubType(payment.accountSubType) && !ctx.can("accounts.receipts.record")) {
    return refuse("FORBIDDEN", RECEIVE);
  }
  return ALLOWED;
}

// --- Accounts and bank accounts -----------------------------------------------------------

type AccountState = {
  name: string;
  isSystem: boolean;
  isActive: boolean;
  /** Kept by a bank account, a loan or an asset. */
  linked: boolean;
};

/** An account is archived once nothing uses it and it holds no money. */
export function canArchiveAccount(account: AccountState, balance: Amount): Verdict {
  if (!account.isActive) return refuse("CONFLICT", `${account.name} is already archived.`);
  if (account.isSystem) {
    return refuse("CONFLICT", `${account.name} is used by the system and stays active.`);
  }
  if (account.linked) {
    return refuse("CONFLICT", "Archive the bank account, loan or asset this belongs to.");
  }
  const left = new Prisma.Decimal(balance);
  if (!left.isZero()) {
    return refuse(
      "CONFLICT",
      `${account.name} still has a balance of ${left.abs().toFixed(2)}; move it out first.`,
    );
  }
  return ALLOWED;
}

/** A bank account closes once its balance has been moved out. */
export function canCloseBankAccount(bank: { isActive: boolean }, balance: Amount): Verdict {
  if (!bank.isActive) return refuse("CONFLICT", "This bank account is already closed.");
  const left = new Prisma.Decimal(balance);
  if (!left.isZero()) {
    return refuse(
      "CONFLICT",
      `This account still shows ${left.toFixed(2)}; transfer the balance out before closing it.`,
    );
  }
  return ALLOWED;
}

/** The keys each kind of change needs, for screens deciding what to offer. */
export function accountsKeys(ctx: Pick<CompanyContext, "can">) {
  return {
    view: ctx.can("accounts.view"),
    manage: ctx.can("accounts.manage"),
    receive: ctx.can("accounts.receipts.record"),
    pay: ctx.can("accounts.payments.record"),
  };
}
