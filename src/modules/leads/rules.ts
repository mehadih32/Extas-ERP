import { createHash } from "node:crypto";

import type { LeadStage, LeadSuppressionKind, TradePayment } from "@prisma/client";

import { whatsappDigits } from "@/modules/parties/contact";

/*
 * Leads, the rules with no database (plain functions the tests check):
 *   - cleaning a website, an email, a phone or a company name before comparing;
 *   - which existing leads and buyers look like the same company (duplicates);
 *   - the "Do not contact" list's hash and hint (the value itself is never kept);
 *   - the lead check card: five checks, each green, yellow or red with a reason.
 */

/** Open stages: a lead still being worked on (Won, Lost and Nurture are not). */
export const OPEN_STAGES: readonly LeadStage[] = [
  "NEW",
  "CONTACTED",
  "IN_TALKS",
  "SAMPLING",
  "QUOTED",
];

export const isOpenStage = (stage: LeadStage) => OPEN_STAGES.includes(stage);

/** Email domains many people share: never a sign that two leads are one company. */
export const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.ru",
  "yandex.com",
  "qq.com",
  "163.com",
]);

/** "https://www.Brand.com/about" -> "brand.com"; null when it is not a web address. */
export function websiteDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.trim().toLowerCase();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = `https://${text}`;
  try {
    const host = new URL(text).hostname.replace(/^www\./, "").replace(/\.$/, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** An email, trimmed and in lower case; null when empty. */
export function cleanEmail(raw: string | null | undefined): string | null {
  const text = raw?.trim().toLowerCase();
  return text ? text : null;
}

/** The domain of an email ("anna@brand.com" -> "brand.com"). */
export function emailDomain(raw: string | null | undefined): string | null {
  const email = cleanEmail(raw);
  const at = email?.lastIndexOf("@") ?? -1;
  return email && at > 0 ? email.slice(at + 1) : null;
}

/** A company's email domain worth comparing: not a free-mail one. */
export function companyDomain(raw: string | null | undefined): string | null {
  const domain = emailDomain(raw);
  return domain && !FREE_MAIL.has(domain) ? domain : null;
}

/** A phone as digits with its country code (local Bangladeshi numbers get 880). */
export const phoneDigits = (raw: string | null | undefined) => whatsappDigits(raw);

const LEGAL_SUFFIX =
  /\b(ltd|limited|llc|inc|incorporated|gmbh|ag|bv|ab|sas|sarl|pty|plc|co|corp|corporation|company|srl|spa|oy|as|aps|kg)\b/g;

/** "Nordic Wear Ltd." -> "nordic wear": lower case, no punctuation or legal suffix. */
export function cleanCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How much two cleaned names share, by words (0 to 1). */
export function nameOverlap(a: string, b: string): number {
  const wa = new Set(a.split(" ").filter(Boolean));
  const wb = new Set(b.split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.max(wa.size, wb.size);
}

/** What a new lead is compared by. */
export type LeadKeys = {
  name: string;
  country?: string | null;
  websiteDomain?: string | null;
  emails: string[];
  phones: string[];
};

/** An existing lead or buyer, cleaned the same way. */
export type Candidate = LeadKeys & { id: string; label: string; kind: "LEAD" | "BUYER" };

export type DuplicateMatch = {
  id: string;
  kind: "LEAD" | "BUYER";
  label: string;
  /** Why it looks like the same company, in plain words. */
  why: string;
  /** Same email or website: almost surely the same company. */
  strong: boolean;
};

/** The keys of a lead or buyer, cleaned. */
export function keysOf(input: {
  name: string;
  country?: string | null;
  website?: string | null;
  emails?: Array<string | null | undefined>;
  phones?: Array<string | null | undefined>;
}): LeadKeys {
  return {
    name: input.name,
    country: input.country ?? null,
    websiteDomain: websiteDomain(input.website),
    emails: (input.emails ?? []).map(cleanEmail).filter((e): e is string => e !== null),
    phones: (input.phones ?? []).map(phoneDigits).filter((p): p is string => p !== null),
  };
}

/**
 * Which candidates look like the same company, and why: the same email or
 * website (strong), the same phone, the same company email domain, the same
 * cleaned name, or most of the name's words in the same country.
 */
export function matchDuplicates(lead: LeadKeys, candidates: Candidate[]): DuplicateMatch[] {
  const name = cleanCompanyName(lead.name);
  const emails = new Set(lead.emails);
  const phones = new Set(lead.phones);
  const domains = new Set(lead.emails.map(companyDomain).filter(Boolean));
  if (lead.websiteDomain) domains.add(lead.websiteDomain);
  const country = lead.country?.trim().toLowerCase() ?? null;

  const matches: DuplicateMatch[] = [];
  for (const c of candidates) {
    const why: string[] = [];
    let strong = false;
    if (c.emails.some((e) => emails.has(e))) {
      why.push("same email");
      strong = true;
    }
    if (lead.websiteDomain && c.websiteDomain === lead.websiteDomain) {
      why.push("same website");
      strong = true;
    }
    if (c.phones.some((p) => phones.has(p))) why.push("same phone");
    const theirDomains = new Set(c.emails.map(companyDomain).filter(Boolean));
    if (c.websiteDomain) theirDomains.add(c.websiteDomain);
    if (!why.includes("same website") && [...theirDomains].some((d) => domains.has(d))) {
      why.push("same email domain");
    }
    const theirName = cleanCompanyName(c.name);
    if (name && theirName === name) why.push("same name");
    else if (
      name &&
      country &&
      c.country?.trim().toLowerCase() === country &&
      nameOverlap(name, theirName) >= 0.6
    ) {
      why.push("similar name in the same country");
    }
    if (why.length > 0) {
      matches.push({ id: c.id, kind: c.kind, label: c.label, why: why.join(", "), strong });
    }
  }
  return matches.sort((a, b) => Number(b.strong) - Number(a.strong));
}

// --- "Do not contact" list ---------------------------------------------------------------

/** The cleaned value an entry is hashed from; null when it cannot be one. */
export function suppressionValue(kind: LeadSuppressionKind, raw: string): string | null {
  if (kind === "EMAIL") {
    const email = cleanEmail(raw);
    return email && email.includes("@") ? email : null;
  }
  if (kind === "DOMAIN") return websiteDomain(raw.replace(/^.*@/, ""));
  return phoneDigits(raw);
}

/** SHA-256 of the company and the cleaned value: the list keeps only this. */
export function suppressionHash(companyId: string, value: string): string {
  return createHash("sha256").update(`${companyId}:${value}`).digest("hex");
}

/** Enough to recognise an entry, never the whole value: "a***@brand.com", "*******6789". */
export function suppressionHint(kind: LeadSuppressionKind, value: string): string {
  if (kind === "EMAIL") {
    const [user = "", domain = ""] = value.split("@");
    return `${user.slice(0, 1)}***@${domain}`;
  }
  if (kind === "DOMAIN") return value;
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

// --- The lead check card -----------------------------------------------------------------

export type CheckColour = "green" | "yellow" | "red";
export type LeadCheck = { key: CheckKey; label: string; colour: CheckColour; reason: string };
export type CheckKey = "products" | "quantity" | "price" | "risk" | "decider";

export const CHECK_LABELS: Record<CheckKey, string> = {
  products: "Product fit",
  quantity: "Quantity",
  price: "Price",
  risk: "Country and payment",
  decider: "Decision-maker",
};

/** The owner's rules for the card (Lead settings). */
export type CheckRules = {
  productFocus: string[];
  minPieces: number | null;
  priceMin: number | null;
  priceMax: number | null;
  targetCountries: string[];
  riskyCountries: string[];
};

export type CheckInput = {
  products: string[];
  piecesPerStyle: number | null;
  targetPrice: number | null;
  country: string | null;
  paymentTerms: TradePayment | null;
  contacts: Array<{
    isDecisionMaker: boolean;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    erased: boolean;
  }>;
};

const lower = (list: string[]) => list.map((s) => s.trim().toLowerCase()).filter(Boolean);
const PAY_WORDS: Record<TradePayment, string> = {
  TT: "TT",
  BANK_TRANSFER: "bank transfer",
  LC: "LC",
};

/**
 * The lead check card: five checks from the owner's rules, each with its
 * colour and a one-line reason. It decides nothing: the owner does.
 */
export function leadCheck(input: CheckInput, rules: CheckRules, currency: string): LeadCheck[] {
  const check = (key: CheckKey, colour: CheckColour, reason: string): LeadCheck => ({
    key,
    label: CHECK_LABELS[key],
    colour,
    reason,
  });

  const focus = lower(rules.productFocus);
  const wants = lower(input.products);
  const products =
    wants.length === 0
      ? check("products", "yellow", "Their products are not noted yet.")
      : focus.length === 0
        ? check("products", "yellow", "Set the products you make in Lead settings.")
        : wants.some((w) => focus.some((f) => w.includes(f) || f.includes(w)))
          ? check("products", "green", `They want ${input.products.join(", ")}, which you make.`)
          : check("products", "red", `${input.products.join(", ")} is not among what you make.`);

  const quantity =
    input.piecesPerStyle === null
      ? check("quantity", "yellow", "Pieces per style not known yet.")
      : rules.minPieces === null
        ? check("quantity", "yellow", "Set the fewest pieces per style in Lead settings.")
        : input.piecesPerStyle >= rules.minPieces
          ? check(
              "quantity",
              "green",
              `${input.piecesPerStyle} pieces per style, at least your ${rules.minPieces}.`,
            )
          : input.piecesPerStyle >= rules.minPieces / 2
            ? check(
                "quantity",
                "yellow",
                `${input.piecesPerStyle} pieces per style, under your ${rules.minPieces}.`,
              )
            : check(
                "quantity",
                "red",
                `${input.piecesPerStyle} pieces per style, far under your ${rules.minPieces}.`,
              );

  const range =
    rules.priceMin !== null && rules.priceMax !== null
      ? `${currency} ${rules.priceMin}–${rules.priceMax}`
      : null;
  const price =
    input.targetPrice === null
      ? check("price", "yellow", "Their price is not known yet.")
      : rules.priceMin === null && rules.priceMax === null
        ? check("price", "yellow", "Set your price range in Lead settings.")
        : rules.priceMin !== null && input.targetPrice < rules.priceMin
          ? input.targetPrice >= rules.priceMin * 0.9
            ? check(
                "price",
                "yellow",
                `${currency} ${input.targetPrice} a piece is a little under your lowest (${currency} ${rules.priceMin}).`,
              )
            : check(
                "price",
                "red",
                `${currency} ${input.targetPrice} a piece is under your lowest (${currency} ${rules.priceMin}).`,
              )
          : rules.priceMax !== null && input.targetPrice > rules.priceMax
            ? check(
                "price",
                "yellow",
                `${currency} ${input.targetPrice} a piece is above your usual range: check what they expect for it.`,
              )
            : check(
                "price",
                "green",
                `${currency} ${input.targetPrice} a piece${range ? `, inside ${range}` : ""}.`,
              );

  const country = input.country?.trim() ?? "";
  const risky = lower(rules.riskyCountries).includes(country.toLowerCase());
  const target = lower(rules.targetCountries).includes(country.toLowerCase());
  const pay = input.paymentTerms ? PAY_WORDS[input.paymentTerms] : null;
  const risk = !country
    ? check("risk", "yellow", "Country not noted yet.")
    : risky
      ? check("risk", "red", `${country} is on your risky countries list.`)
      : !pay
        ? check(
            "risk",
            "yellow",
            `${country}${target ? " is a country you want" : ""}; how they pay is not known yet.`,
          )
        : target || rules.targetCountries.length === 0
          ? check("risk", "green", `${country}, paying by ${pay}.`)
          : check("risk", "yellow", `${country} is not on your target list; paying by ${pay}.`);

  const live = input.contacts.filter((c) => !c.erased);
  const reachable = (c: CheckInput["contacts"][number]) =>
    Boolean(c.email || c.phone || c.whatsapp);
  const decider = live.find((c) => c.isDecisionMaker);
  const decision = !decider
    ? live.length === 0
      ? check("decider", "red", "No contact person yet.")
      : check("decider", "yellow", "Who decides is not known yet.")
    : reachable(decider)
      ? check("decider", "green", "You can reach the person who decides.")
      : check("decider", "yellow", "You know who decides, but have no email or phone for them.");

  return [products, quantity, price, risk, decision];
}

/** The lead number: LD-0001. */
export function leadNumber(n: number) {
  return `LD-${String(n).padStart(4, "0")}`;
}

export { STAGE_LABELS } from "@/modules/leads/labels";
