/**
 * Contact helpers (pure functions).
 */

/** Digits for wa.me links. Local Bangladeshi numbers (01XXXXXXXXX) get the 880 prefix. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01\d{9}$/.test(digits)) digits = `88${digits}`;
  return digits.length >= 8 ? digits : null;
}

/** One-click WhatsApp share link with a pre-filled message. */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const digits = whatsappDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

/** Replaces {BuyerName}, {ContactPerson} and {CompanyName} in a message template. */
export function fillTemplate(template: string, values: Record<string, string | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
