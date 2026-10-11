import type { EmployeeDocumentKind, PaymentMethod, Prisma } from "@prisma/client";

/*
 * The employee data vault's rules, for the server and the screens alike: what a
 * complete record holds, and which way of paying needs which details.
 *   NID           the national ID number
 *   BLOOD_GROUP   for emergencies
 *   REFERENCE     a person who knows them (name and phone)
 *   PAY_DETAILS   the bank account or wallet number their salary goes to
 *                 (nothing more is needed for cash)
 */

export const VAULT_ITEMS = ["NID", "BLOOD_GROUP", "REFERENCE", "PAY_DETAILS"] as const;
export type VaultItem = (typeof VAULT_ITEMS)[number];

export const VAULT_ITEM_LABELS: Record<VaultItem, string> = {
  NID: "National ID",
  BLOOD_GROUP: "Blood group",
  REFERENCE: "Reference person",
  PAY_DETAILS: "Bank or wallet details",
};

/** The same items inside a sentence: "HR still needs your blood group". */
export const VAULT_ITEM_WORDS: Record<VaultItem, string> = {
  NID: "national ID number",
  BLOOD_GROUP: "blood group",
  REFERENCE: "reference person",
  PAY_DETAILS: "bank or wallet details",
};

/** "3 of 4 filled" or "Complete". */
export function vaultScore(gaps: readonly VaultItem[]): string {
  const filled = VAULT_ITEMS.length - gaps.length;
  return gaps.length === 0 ? "Complete" : `${filled} of ${VAULT_ITEMS.length} filled`;
}

/**
 * The kinds of paper people add to the vault, in the order they are offered.
 * Signed terms (TERMS) are added by the app itself when someone agrees.
 */
export const DOCUMENT_KINDS: readonly EmployeeDocumentKind[] = [
  "NID",
  "PHOTO",
  "CERTIFICATE",
  "CONTRACT",
  "OTHER",
];

export const DOCUMENT_KIND_LABELS: Record<EmployeeDocumentKind, string> = {
  NID: "National ID card",
  PHOTO: "Photo",
  CERTIFICATE: "Certificate",
  CONTRACT: "Appointment letter or contract",
  OTHER: "Other paper",
  TERMS: "Signed terms of employment",
};

/** Papers the employee adds themselves (an appointment letter comes from HR). */
export const SELF_DOCUMENT_KINDS: readonly EmployeeDocumentKind[] = [
  "NID",
  "PHOTO",
  "CERTIFICATE",
  "OTHER",
];

/** Bank transfers and cheques need a bank and account; wallets a number; cash nothing. */
export function payDetailsKind(method: PaymentMethod): "BANK" | "WALLET" | null {
  if (method === "BANK_TRANSFER" || method === "CHEQUE") return "BANK";
  if (method === "BKASH" || method === "NAGAD" || method === "ROCKET") return "WALLET";
  return null;
}

const filled = (value: string | null | undefined) => Boolean(value?.trim());

export type VaultFields = {
  nid: string | null;
  bloodGroup: string | null;
  referenceName: string | null;
  referencePhone: string | null;
  salaryMethod: PaymentMethod;
  bankName: string | null;
  bankAccountNumber: string | null;
  walletNumber: string | null;
};

/** What is still missing from an employee's record, in the vault's order. */
export function vaultGaps(e: VaultFields): VaultItem[] {
  const kind = payDetailsKind(e.salaryMethod);
  const has: Record<VaultItem, boolean> = {
    NID: filled(e.nid),
    BLOOD_GROUP: filled(e.bloodGroup),
    REFERENCE: filled(e.referenceName) && filled(e.referencePhone),
    PAY_DETAILS:
      kind === "BANK"
        ? filled(e.bankName) && filled(e.bankAccountNumber)
        : kind === "WALLET"
          ? filled(e.walletNumber)
          : true,
  };
  return VAULT_ITEMS.filter((item) => !has[item]);
}

const blank = (
  field:
    | "nid"
    | "bloodGroup"
    | "referenceName"
    | "referencePhone"
    | "bankName"
    | "bankAccountNumber"
    | "walletNumber",
) => [{ [field]: null }, { [field]: "" }];

/** Employees with something missing from their record (the same rules as vaultGaps). */
export function vaultIncompleteWhere(): Prisma.EmployeeWhereInput {
  return {
    OR: [
      ...blank("nid"),
      ...blank("bloodGroup"),
      ...blank("referenceName"),
      ...blank("referencePhone"),
      {
        salaryMethod: { in: ["BANK_TRANSFER", "CHEQUE"] },
        OR: [...blank("bankName"), ...blank("bankAccountNumber")],
      },
      { salaryMethod: { in: ["BKASH", "NAGAD", "ROCKET"] }, OR: blank("walletNumber") },
    ],
  };
}

/** Pay details as stored on the employee and in a change request. */
export type PayDetails = {
  salaryMethod: PaymentMethod;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountNumber: string | null;
  walletNumber: string | null;
};

export const payDetailsOf = (e: PayDetails): PayDetails => ({
  salaryMethod: e.salaryMethod,
  bankName: e.bankName ?? null,
  bankBranch: e.bankBranch ?? null,
  bankAccountNumber: e.bankAccountNumber ?? null,
  walletNumber: e.walletNumber ?? null,
});

export function samePayDetails(a: PayDetails, b: PayDetails): boolean {
  const norm = (v: string | null) => v?.trim() || null;
  return (
    a.salaryMethod === b.salaryMethod &&
    norm(a.bankName) === norm(b.bankName) &&
    norm(a.bankBranch) === norm(b.bankBranch) &&
    norm(a.bankAccountNumber) === norm(b.bankAccountNumber) &&
    norm(a.walletNumber) === norm(b.walletNumber)
  );
}

const PAY_FIELDS = [
  "salaryMethod",
  "bankName",
  "bankBranch",
  "bankAccountNumber",
  "walletNumber",
] as const;

/** Whether an update would change any pay detail, compared with what is stored. */
export function payFieldsChanged(
  current: PayDetails,
  input: Partial<Record<(typeof PAY_FIELDS)[number], unknown>>,
): boolean {
  return PAY_FIELDS.some(
    (field) =>
      input[field] !== undefined &&
      ((input[field] as string | null) ?? null) !== (current[field] ?? null),
  );
}
