import { describe, expect, it } from "vitest";

import {
  myDetailsSchema,
  payDetailsRequestSchema,
  updateEmployeeSchema,
} from "@/modules/hr/schemas";
import {
  payDetailsKind,
  payFieldsChanged,
  samePayDetails,
  vaultGaps,
  vaultScore,
} from "@/modules/hr/vault";
import { payDetailsText } from "@/modules/hr/vault.service";

/*
 * The data vault's rules: what a complete record holds, which way of paying
 * needs which details, and how an employee's ask for a pay change is read.
 */

const record = {
  nid: "1234567890",
  bloodGroup: "B+",
  referenceName: "Karim",
  referencePhone: "01911000000",
  salaryMethod: "CASH" as const,
  bankName: null,
  bankAccountNumber: null,
  walletNumber: null,
};

describe("a complete record", () => {
  it("holds a national ID, a blood group, a reference person and the pay details needed", () => {
    expect(vaultGaps(record)).toEqual([]);
    expect(vaultScore([])).toBe("Complete");
    const empty = {
      ...record,
      nid: " ",
      bloodGroup: null,
      referenceName: "Karim",
      referencePhone: "",
    };
    expect(vaultGaps(empty)).toEqual(["NID", "BLOOD_GROUP", "REFERENCE"]);
    expect(vaultScore(vaultGaps(empty))).toBe("1 of 4 filled");
  });

  it("needs a bank and account for a transfer or cheque, a number for a wallet, nothing for cash", () => {
    expect(payDetailsKind("CASH")).toBeNull();
    expect(payDetailsKind("CHEQUE")).toBe("BANK");
    expect(payDetailsKind("ROCKET")).toBe("WALLET");
    expect(vaultGaps({ ...record, salaryMethod: "BANK_TRANSFER", bankName: "City" })).toEqual([
      "PAY_DETAILS",
    ]);
    expect(
      vaultGaps({
        ...record,
        salaryMethod: "BANK_TRANSFER",
        bankName: "City",
        bankAccountNumber: "1",
      }),
    ).toEqual([]);
    expect(vaultGaps({ ...record, salaryMethod: "BKASH" })).toEqual(["PAY_DETAILS"]);
    expect(vaultGaps({ ...record, salaryMethod: "BKASH", walletNumber: "01711000000" })).toEqual(
      [],
    );
  });
});

describe("an employee's ask to be paid another way", () => {
  it("keeps only the details the way of paying needs, the wallet number tidied", () => {
    expect(
      payDetailsRequestSchema.parse({
        salaryMethod: "BKASH",
        walletNumber: "+880 1711-000000",
        bankName: "Left over",
        note: "  ",
      }),
    ).toEqual({
      changes: {
        salaryMethod: "BKASH",
        bankName: null,
        bankBranch: null,
        bankAccountNumber: null,
        walletNumber: "01711000000",
      },
      note: null,
    });
    expect(
      payDetailsRequestSchema.parse({
        salaryMethod: "CHEQUE",
        bankName: "City Bank",
        bankBranch: "",
        bankAccountNumber: "12-345 678",
        walletNumber: "01711000000",
      }).changes,
    ).toEqual({
      salaryMethod: "CHEQUE",
      bankName: "City Bank",
      bankBranch: null,
      bankAccountNumber: "12-345 678",
      walletNumber: null,
    });
    expect(payDetailsRequestSchema.parse({ salaryMethod: "CASH" }).changes.walletNumber).toBeNull();
  });

  it("says which detail is missing or wrong", () => {
    const fields = (input: unknown) => {
      const result = payDetailsRequestSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    };
    expect(fields({ salaryMethod: "BANK_TRANSFER" })).toEqual(["bankName", "bankAccountNumber"]);
    expect(
      fields({ salaryMethod: "BANK_TRANSFER", bankName: "City", bankAccountNumber: "abc" }),
    ).toEqual(["bankAccountNumber"]);
    expect(fields({ salaryMethod: "NAGAD" })).toEqual(["walletNumber"]);
    expect(fields({ salaryMethod: "NAGAD", walletNumber: "0171100000" })).toEqual(["walletNumber"]);
    expect(fields({ salaryMethod: "NAGAD", walletNumber: "01211000000" })).toEqual([
      "walletNumber",
    ]);
    expect(fields({ salaryMethod: "CARD" })).toEqual(["salaryMethod"]);
  });

  it("is written out as people read it", () => {
    const p = { bankName: null, bankBranch: null, bankAccountNumber: null, walletNumber: null };
    expect(payDetailsText({ ...p, salaryMethod: "CASH" })).toBe("Cash");
    expect(payDetailsText({ ...p, salaryMethod: "BKASH", walletNumber: "01711000000" })).toBe(
      "bKash 01711000000",
    );
    expect(
      payDetailsText({
        ...p,
        salaryMethod: "BANK_TRANSFER",
        bankName: "City Bank",
        bankBranch: "Gulshan",
        bankAccountNumber: "123",
      }),
    ).toBe("Bank transfer: City Bank, Gulshan, 123");
  });

  it("compares pay details as stored, blanks and spaces aside", () => {
    const a = {
      salaryMethod: "BKASH" as const,
      bankName: null,
      bankBranch: "",
      bankAccountNumber: null,
      walletNumber: "01711000000",
    };
    expect(samePayDetails(a, { ...a, bankBranch: null, walletNumber: " 01711000000 " })).toBe(true);
    expect(samePayDetails(a, { ...a, walletNumber: "01711000001" })).toBe(false);
    expect(payFieldsChanged(a, { name: "x", walletNumber: "01711000000" } as never)).toBe(false);
    expect(payFieldsChanged(a, { walletNumber: "01711000001" })).toBe(true);
    expect(payFieldsChanged(a, { bankBranch: null })).toBe(true);
    expect(payFieldsChanged(a, {})).toBe(false);
  });
});

describe("what employees fill in themselves", () => {
  it("tidies the national ID and turns blanks into nothing", () => {
    expect(
      myDetailsSchema.parse({ nid: "1990 1234-56789", address: "", referenceName: "Karim" }),
    ).toEqual({ nid: "1990123456789", address: null, referenceName: "Karim" });
    expect(myDetailsSchema.safeParse({ nid: "12345" }).success).toBe(false);
    expect(myDetailsSchema.safeParse({ referencePhone: "+880 1711-000000" }).success).toBe(true);
    expect(myDetailsSchema.safeParse({ referencePhone: "12" }).success).toBe(false);
    expect(myDetailsSchema.safeParse({ bloodGroup: "C+" }).success).toBe(false);
  });

  it("leaves HR's own fields to HR's form", () => {
    expect(Object.keys(myDetailsSchema.parse({ salaryMethod: "BKASH", name: "x" }))).toEqual([]);
    expect(updateEmployeeSchema.parse({ referenceName: "Karim", bankBranch: "Mirpur" })).toEqual({
      referenceName: "Karim",
      bankBranch: "Mirpur",
    });
  });
});
