/*
 * Reading what people type into the Products forms, before it goes to the
 * server (which checks it again): amounts in the company currency and short texts.
 */

/** Largest amount the catalogue takes (a price or a cost per piece). */
export const MAX_AMOUNT = 1_000_000_000;

/**
 * An amount such as "950", "950.5" or "1,450.00": a number with at most two
 * decimals, null when the box is empty, or "invalid".
 */
export function readAmount(text: string | undefined): number | null | "invalid" {
  const value = (text ?? "").trim().replaceAll(",", "");
  if (value === "") return null;
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return "invalid";
  const amount = Number(value);
  return amount <= MAX_AMOUNT ? amount : "invalid";
}

export const AMOUNT_HINT = "Enter an amount like 950 or 950.50.";

/** A form field's text, trimmed ("" when missing). */
export function textOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}
