import type { AiOrderRunStatus } from "@prisma/client";

import { addDays, daysBetween } from "@/lib/dates";
import { CHECK_RULES, type CheckSignal } from "@/modules/costing/order-check";

/*
 * Order automation, the parts with no database: the form a new order is read
 * into, what it still needs, the intake checks (totals, size spread, dates
 * back from the ship date, the buyer's House Rules, mismatches), the T&A dates
 * and the steps Mehedi 2.0 follows after the owner's Approve. The day counts
 * are the Order check card's starting rules (costing/order-check.ts).
 */

export type OrderLine = {
  style: string;
  colour: string | null;
  size: string | null;
  quantity: number;
};

export type OrderFields = {
  /** The buyer as the PO names it; buyerId on the run once it is matched. */
  buyer: string | null;
  po: string | null;
  lines: OrderLine[];
  /** The total the PO states (the lines are checked against it). */
  quantity: number | null;
  /** Calendar day, "2026-12-20". */
  shipDate: string | null;
  /** The buyer's price per piece. */
  price: number | null;
  currency: string | null;
  fabric: string | null;
  logo: string | null;
  packing: string | null;
  notes: string | null;
};

export const EMPTY_FIELDS: OrderFields = {
  buyer: null,
  po: null,
  lines: [],
  quantity: null,
  shipDate: null,
  price: null,
  currency: null,
  fabric: null,
  logo: null,
  packing: null,
  notes: null,
};

export const NEEDED = [
  "buyer",
  "po",
  "lines",
  "quantity",
  "shipDate",
  "price",
  "fabric",
  "logo",
  "packing",
] as const;

export type NeededField = (typeof NEEDED)[number];

export const FIELD_LABELS: Record<NeededField, string> = {
  buyer: "Buyer",
  po: "PO number",
  lines: "Styles, colours and sizes",
  quantity: "Total quantity",
  shipDate: "Ship date",
  price: "Price per piece",
  fabric: "Fabric",
  logo: "Logo",
  packing: "Packing",
};

/** What the form still needs, in the order Mehedi asks for it. */
export function missingFields(f: OrderFields): NeededField[] {
  return NEEDED.filter((key) => {
    const value = f[key];
    if (key === "lines") return f.lines.length === 0;
    return value === null || (typeof value === "string" && value.trim() === "");
  });
}

/** The one question Mehedi asks next, or null when nothing is missing. */
export function nextQuestion(missing: readonly NeededField[]): string | null {
  const first = missing[0];
  if (!first) return null;
  const more = missing.length > 1 ? ` (then ${missing.length - 1} more)` : "";
  const ask: Record<NeededField, string> = {
    buyer: "Which buyer is this order for?",
    po: "What is the buyer's PO number?",
    lines: "Which styles, colours and sizes, and how many of each?",
    quantity: "What total quantity does the PO give?",
    shipDate: "What is the ship date?",
    price: "What price per piece did the buyer give?",
    fabric: "Which fabric (type, GSM, colour)?",
    logo: "Which logo or print goes on it?",
    packing: "How is it packed (polybag, carton, pieces per carton)?",
  };
  return `${ask[first]}${more}`;
}

export type IntakeCheckKey = "totals" | "sizes" | "dates" | "rules" | "match";

export type IntakeCheck = {
  key: IntakeCheckKey;
  label: string;
  signal: CheckSignal;
  reason: string;
};

export const INTAKE_LABELS: Record<IntakeCheckKey, string> = {
  totals: "Totals",
  sizes: "Size spread",
  dates: "Dates from the ship date",
  rules: "Buyer and House Rules",
  match: "Mismatches",
};

const check = (key: IntakeCheckKey, signal: CheckSignal, reason: string): IntakeCheck => ({
  key,
  label: INTAKE_LABELS[key],
  signal,
  reason,
});

const count = (n: number) => n.toLocaleString("en-US");

export const linesTotal = (lines: readonly OrderLine[]) =>
  lines.reduce((sum, l) => sum + l.quantity, 0);

/** The styles in the order of the lines, each once. */
export const stylesOf = (lines: readonly OrderLine[]) => [
  ...new Set(lines.map((l) => l.style.trim()).filter(Boolean)),
];

export function judgeTotals(f: OrderFields): IntakeCheck {
  const sum = linesTotal(f.lines);
  if (f.lines.length === 0) return check("totals", "yellow", "No colour and size lines yet.");
  if (f.quantity === null) {
    return check(
      "totals",
      "yellow",
      `The lines add up to ${count(sum)} pieces; the PO total is not given.`,
    );
  }
  if (sum !== f.quantity) {
    return check(
      "totals",
      "red",
      `The lines add up to ${count(sum)} pieces but the PO says ${count(f.quantity)}.`,
    );
  }
  return check("totals", "green", `The lines add up to the PO's ${count(sum)} pieces.`);
}

/** A size takes more than this share of its colour: worth a second look. */
const ONE_SIZE_SHARE = 0.5;

export function judgeSizes(lines: readonly OrderLine[]): IntakeCheck {
  const sized = lines.filter((l) => l.size);
  if (sized.length === 0) return check("sizes", "yellow", "No sizes yet.");
  const zero = sized.find((l) => l.quantity <= 0);
  if (zero) {
    return check(
      "sizes",
      "red",
      `${zero.style} ${zero.colour ?? ""} ${zero.size}: no pieces.`.replace(/\s+/g, " "),
    );
  }
  const groups = new Map<string, OrderLine[]>();
  for (const l of sized) {
    const key = `${l.style}|${l.colour ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  for (const group of groups.values()) {
    const total = linesTotal(group);
    const big = group.find((l) => group.length > 1 && l.quantity / total > ONE_SIZE_SHARE);
    if (big) {
      return check(
        "sizes",
        "yellow",
        `${big.style}${big.colour ? ` ${big.colour}` : ""}: size ${big.size} is ${Math.round((big.quantity / total) * 100)}% of the colour. Check the ratio with the buyer.`,
      );
    }
  }
  // The whole order's spread, size by size.
  const bySize = new Map<string, number>();
  for (const l of sized) bySize.set(l.size!, (bySize.get(l.size!) ?? 0) + l.quantity);
  const total = linesTotal(sized);
  const spread = [...bySize]
    .map(([size, n]) => `${size} ${Math.round((n / total) * 100)}%`)
    .join(", ");
  return check("sizes", "green", `Sizes spread as usual: ${spread}.`);
}

export type TaDate = { key: TaKey; label: string; by: string };
export type TaKey = "techPack" | "booking" | "cutting" | "packed" | "ship";

export const TA_LABELS: Record<TaKey, string> = {
  techPack: "Tech pack approved",
  booking: "Fabric booked",
  cutting: "Fabric in house, cutting starts",
  packed: "Sewn, finished and packed",
  ship: "Ship",
};

/**
 * The T&A dates back from the ship date: packed a week before it, making
 * before that, the fabric before the making, the tech pack before the booking.
 */
export function taDates(
  shipDate: string,
  days: { fabricDays?: number | null; makingDays?: number | null } = {},
): TaDate[] {
  const fabric = days.fabricDays ?? CHECK_RULES.fabricDays;
  const making = days.makingDays ?? CHECK_RULES.makingDays;
  const packed = addDays(shipDate, -CHECK_RULES.shippingDays);
  const cutting = addDays(packed, -making);
  const booking = addDays(cutting, -fabric);
  const techPack = addDays(booking, -2);
  const at: Record<TaKey, string> = { techPack, booking, cutting, packed, ship: shipDate };
  return (Object.keys(TA_LABELS) as TaKey[]).map((key) => ({
    key,
    label: TA_LABELS[key],
    by: at[key],
  }));
}

export function judgeDates(f: OrderFields, today: string): IntakeCheck {
  if (!f.shipDate) return check("dates", "yellow", "No ship date yet.");
  const ta = taDates(f.shipDate);
  const techPack = ta.find((d) => d.key === "techPack")!.by;
  const left = daysBetween(today, techPack);
  if (daysBetween(today, f.shipDate) < 0) return check("dates", "red", "The ship date has passed.");
  if (left < 0) {
    return check(
      "dates",
      "red",
      `The tech pack should have been approved by ${techPack} for this ship date: ${-left} days short.`,
    );
  }
  if (left < CHECK_RULES.spareDays) {
    return check(
      "dates",
      "yellow",
      `Tight: the tech pack must be approved by ${techPack} and the fabric booked by ${ta[1]!.by}.`,
    );
  }
  return check(
    "dates",
    "green",
    `Tech pack by ${techPack}, fabric booked by ${ta[1]!.by}, cutting from ${ta[2]!.by}.`,
  );
}

export function judgeRules(buyer: string | null, rules: readonly string[]): IntakeCheck {
  if (rules.length === 0) {
    return check("rules", "green", `No House Rules for ${buyer ?? "this buyer"} yet.`);
  }
  const shown = rules.slice(0, 3).join("; ");
  return check(
    "rules",
    "yellow",
    `Follow ${rules.length} House Rule${rules.length > 1 ? "s" : ""}: ${shown}${rules.length > 3 ? "; …" : ""}`,
  );
}

export function judgeMatch(
  f: OrderFields,
  known: { buyerFound: boolean; styles: readonly string[] },
): IntakeCheck {
  const problems: string[] = [];
  if (f.buyer && !known.buyerFound) problems.push(`${f.buyer} is not a buyer in the ERP yet`);
  const seen = new Set<string>();
  for (const l of f.lines) {
    const key = `${l.style}|${l.colour ?? ""}|${l.size ?? ""}`.toUpperCase();
    if (seen.has(key)) {
      problems.push(
        `${l.style} ${l.colour ?? ""} ${l.size ?? ""} is listed twice`.replace(/\s+/g, " "),
      );
      break;
    }
    seen.add(key);
  }
  const knownUpper = new Set(known.styles.map((s) => s.toUpperCase()));
  const fresh = stylesOf(f.lines).filter((s) => !knownUpper.has(s.toUpperCase()));
  if (fresh.length > 0) {
    problems.push(
      `new style${fresh.length > 1 ? "s" : ""} ${fresh.slice(0, 4).join(", ")} (a tech pack is needed)`,
    );
  }
  if (problems.length === 0) return check("match", "green", "The buyer and styles are known.");
  const first = problems[0]!;
  return check(
    "match",
    "yellow",
    `${first.charAt(0).toUpperCase()}${first.slice(1)}${problems.length > 1 ? `; ${problems.slice(1).join("; ")}` : ""}.`,
  );
}

export function intakeChecks(
  f: OrderFields,
  input: {
    today: string;
    rules: readonly string[];
    buyerFound: boolean;
    styles: readonly string[];
  },
): IntakeCheck[] {
  return [
    judgeTotals(f),
    judgeSizes(f.lines),
    judgeDates(f, input.today),
    judgeRules(f.buyer, input.rules),
    judgeMatch(f, { buyerFound: input.buyerFound, styles: input.styles }),
  ];
}

// ---------------------------------------------------------------- the steps after Approve

export type StepKey =
  | "costing"
  | "order"
  | "production"
  | "techPack"
  | "booking"
  | "factory"
  | "making"
  | "shipped"
  | "cm";

export type StepState = "done" | "late" | "waiting";

export type Step = {
  key: StepKey;
  label: string;
  /** What Mehedi would do (or watches for), in his words. */
  would: string;
  /** The T&A day it is due, when it has one. */
  by: string | null;
  state: StepState;
  href: string | null;
};

export const STEP_TEXT: Record<StepKey, { label: string; would: string; ta: TaKey | null }> = {
  costing: {
    label: "Costing sheet",
    would:
      "Make the costing sheet with the supplier's fabric price per kg and the CM fixed per style; you set the profit %.",
    ta: null,
  },
  order: {
    label: "Order in Sales",
    would: "Enter the buyer's order in Sales once you take it.",
    ta: null,
  },
  production: {
    label: "Start production",
    would: "Open a master batch with one production project per style.",
    ta: null,
  },
  techPack: {
    label: "Tech pack",
    would: "Draft the tech pack with the experts, then the review board, for your approval.",
    ta: "techPack",
  },
  booking: {
    label: "Bookings",
    would: "Make the fabric and trims bookings from the tech packs for you to check and send.",
    ta: "booking",
  },
  factory: {
    label: "Factory and CM",
    would: "Prepare the factory contract with the CM fixed per style (you commit to the price).",
    ta: "cutting",
  },
  making: {
    label: "Cutting to packing",
    would: "Follow cutting, sewing and finishing against the T&A and tell you of any slip.",
    ta: "packed",
  },
  shipped: {
    label: "Shipment",
    would: "Remind you of the shipment papers; nothing goes to the buyer without your OK.",
    ta: "ship",
  },
  cm: {
    label: "CM settlement",
    would: "Prepare the CM settlement with the factory for your approval.",
    ta: null,
  },
};

export const STEP_KEYS = Object.keys(STEP_TEXT) as StepKey[];

/** Each step's state from what the ERP holds, and whether it is late against the T&A. */
export function stepsFor(input: {
  today: string;
  shipDate: string | null;
  done: Partial<Record<StepKey, boolean>>;
  hrefs: Partial<Record<StepKey, string | null>>;
}): Step[] {
  const ta = input.shipDate ? taDates(input.shipDate) : [];
  return STEP_KEYS.map((key) => {
    const text = STEP_TEXT[key];
    const by = text.ta ? (ta.find((d) => d.key === text.ta)?.by ?? null) : null;
    const done = input.done[key] === true;
    const late = !done && by !== null && daysBetween(input.today, by) < 0;
    return {
      key,
      label: text.label,
      would: text.would,
      by,
      state: done ? "done" : late ? "late" : "waiting",
      href: input.hrefs[key] ?? null,
    };
  });
}

export const RUN_STATUS_TEXT: Record<AiOrderRunStatus, string> = {
  INTAKE: "Filling in",
  WAITING_OWNER: "Waiting for your Approve",
  APPROVED: "Approved",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  DONE: "Done",
};

/** The first orders are dry runs: he only shows what he would do. */
export const DRY_RUNS = 5;

/** Words in a staff update that mean the owner should hear of it at once. */
const PROBLEM =
  /\b(problem|issue|late|delay|delayed|short|shortage|broken|damaged|reject(?:ed)?|stuck|stopped)\b|সমস্যা|দেরি|বন্ধ|নষ্ট|কম এসেছে|আটকে|রিজেক্ট|ভুল/i;

export const isProblem = (text: string) => PROBLEM.test(text.normalize("NFC"));
