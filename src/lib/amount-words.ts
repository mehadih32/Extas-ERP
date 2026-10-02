import { Prisma } from "@prisma/client";

/*
 * Amounts in words for vouchers and payslips, in the South Asian system used on
 * Bangladeshi documents (thousand, lakh, crore): 1,25,050.50 BDT reads
 * "Taka One Lakh Twenty Five Thousand Fifty and Fifty Paisa Only".
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const unit = n % 10;
  return `${TENS[Math.floor(n / 10)]}${unit ? ` ${ONES[unit]}` : ""}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""]
    .filter(Boolean)
    .join(" ");
}

/** A whole number in words: 125050 -> "One Lakh Twenty Five Thousand Fifty". */
export function numberInWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Expected a whole number.");
  if (value === 0) return "Zero";
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const rest = value % 1000;
  return [
    crore ? `${numberInWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "Taka Twelve Thousand Five Hundred Only" (BDT) or "Twelve Thousand Five Hundred USD Only". */
export function amountInWords(amount: Prisma.Decimal.Value, currency = "BDT"): string {
  const value = new Prisma.Decimal(amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const negative = value.isNegative();
  const abs = value.abs();
  const whole = abs.floor().toNumber();
  const cents = abs.minus(abs.floor()).times(100).toNumber();
  const sign = negative ? "Minus " : "";
  if (currency === "BDT") {
    return `${sign}Taka ${numberInWords(whole)}${
      cents ? ` and ${numberInWords(cents)} Paisa` : ""
    } Only`;
  }
  const hundredths = String(cents).padStart(2, "0");
  return `${sign}${numberInWords(whole)}${cents ? ` and ${hundredths}/100` : ""} ${currency} Only`;
}
