/*
 * The Order check card (v6.2, replaces the K3 take/no-take score): five checks,
 * each green, yellow or red with a one-line reason. No number, no score, and
 * never a refusal: the owner decides. The blueprint leaves the thresholds open
 * (its question Q5), so these are the starting rules, written in the help:
 *   - Price vs cost: red below the cost, yellow under the owner's profit % (or
 *     with no profit %, no buyer price or a missing cost), green otherwise.
 *   - Time to ship: the fabric (30 days unless given), the making (25 unless
 *     given) and 7 days to finish and reach the port; red without that time,
 *     yellow with less than 7 days to spare.
 *   - Factory: the pieces it has due by the ship date and this order against
 *     its monthly capacity; red over it, yellow above 85% or with no capacity set.
 *   - Buyer payment: red with money overdue, yellow for a new buyer or any
 *     invoice paid late (3 days' grace), green when every invoice was on time.
 *   - Risks: yellow for one or two, red for three or more or when Eid falls in
 *     the last 21 days before the ship date.
 * Pure: the service gathers the facts.
 */

export type CheckSignal = "green" | "yellow" | "red";
export type CheckKey = "price" | "time" | "factory" | "payment" | "risks";
export type CheckRow = { key: CheckKey; label: string; signal: CheckSignal; reason: string };

export const CHECK_LABELS: Record<CheckKey, string> = {
  price: "Price vs cost",
  time: "Time to ship",
  factory: "Factory",
  payment: "Buyer payment",
  risks: "Risks",
};

export const CHECK_RULES = {
  fabricDays: 30,
  makingDays: 25,
  shippingDays: 7,
  spareDays: 7,
  nearlyFull: 0.85,
  graceDays: 3,
  eidBeforeShipDays: 21,
  manyRisks: 3,
} as const;

const row = (key: CheckKey, signal: CheckSignal, reason: string): CheckRow => ({
  key,
  label: CHECK_LABELS[key],
  signal,
  reason,
});

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

export type PriceStyle = {
  ref: string;
  costPerPiece: number;
  missing: string[];
  buyerPrice: number | null;
  buyerProfit: number | null;
};

export function judgePrice(styles: PriceStyle[], profit: number | null): CheckRow {
  if (styles.length === 0) return row("price", "yellow", "No style on the costing yet.");
  const below = styles.find((s) => s.buyerPrice !== null && s.buyerPrice < s.costPerPiece);
  if (below) {
    return row(
      "price",
      "red",
      `${below.ref}: the buyer's ${money(below.buyerPrice!)} is below the cost of ${money(below.costPerPiece)} a piece.`,
    );
  }
  const incomplete = styles.find((s) => s.missing.length > 0);
  const priced = styles.filter((s) => s.buyerPrice !== null && s.buyerProfit !== null);
  if (priced.length === 0) {
    return row(
      "price",
      "yellow",
      incomplete
        ? `No buyer price yet, and ${incomplete.ref} has no ${incomplete.missing.join(" or ")}.`
        : "No buyer price yet: add it to each style to compare.",
    );
  }
  const worst = priced.reduce((a, b) => (b.buyerProfit! < a.buyerProfit! ? b : a));
  if (incomplete) {
    return row(
      "price",
      "yellow",
      `${incomplete.ref} has no ${incomplete.missing.join(" or ")} yet, so its cost is still too low.`,
    );
  }
  if (profit === null) {
    return row(
      "price",
      "yellow",
      `Profit % not set for this order. The buyer's price leaves ${pct(worst.buyerProfit!)}${priced.length > 1 ? ` on ${worst.ref}` : ""}.`,
    );
  }
  if (worst.buyerProfit! < profit) {
    return row(
      "price",
      "yellow",
      `${worst.ref}: the buyer's price leaves ${pct(worst.buyerProfit!)}, below your ${pct(profit)}.`,
    );
  }
  const unpriced = styles.find((s) => s.buyerPrice === null);
  if (unpriced) return row("price", "yellow", `${unpriced.ref} has no buyer price yet.`);
  return row(
    "price",
    "green",
    `The buyer's price leaves ${pct(worst.buyerProfit!)}${priced.length > 1 ? " or more" : ""} (your ${pct(profit)}).`,
  );
}

/** Whole days from one calendar day ("2026-10-14") to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function judgeTime(input: {
  today: string;
  shipDate: string | null;
  fabricDays: number | null;
  makingDays: number | null;
}): CheckRow {
  if (!input.shipDate) return row("time", "yellow", "No ship date yet.");
  const left = daysBetween(input.today, input.shipDate);
  if (left < 0) return row("time", "red", "The ship date has passed.");
  const needed =
    (input.fabricDays ?? CHECK_RULES.fabricDays) +
    (input.makingDays ?? CHECK_RULES.makingDays) +
    CHECK_RULES.shippingDays;
  const assumed =
    input.fabricDays === null || input.makingDays === null
      ? ` (${[
          input.fabricDays === null ? `fabric ${CHECK_RULES.fabricDays}` : null,
          input.makingDays === null ? `making ${CHECK_RULES.makingDays}` : null,
        ]
          .filter(Boolean)
          .join(" and ")} days assumed)`
      : "";
  const spare = left - needed;
  if (spare < 0) {
    return row(
      "time",
      "red",
      `Not enough time: about ${needed} days are needed, ${left} are left${assumed}.`,
    );
  }
  if (spare < CHECK_RULES.spareDays) {
    return row(
      "time",
      "yellow",
      `Tight: about ${needed} days are needed, ${left} are left${assumed}.`,
    );
  }
  return row("time", "green", `${left} days are left; about ${needed} are needed${assumed}.`);
}

export function judgeFactory(input: {
  factory: { name: string; monthlyCapacity: number | null } | null;
  booked: number;
  pieces: number;
  months: number;
  /** Other factories with their capacity set, and the room they have in the period. */
  others: Array<{ name: string; room: number }>;
}): CheckRow {
  if (!input.factory) {
    const free = input.others.filter((o) => o.room > 0).sort((a, b) => b.room - a.room);
    return row(
      "factory",
      "yellow",
      free.length > 0
        ? `No factory picked. Room by the ship date: ${free
            .slice(0, 3)
            .map((o) => `${o.name} (${count(o.room)} pieces)`)
            .join(", ")}.`
        : "No factory picked, and no factory has room set (its monthly capacity).",
    );
  }
  const { name, monthlyCapacity } = input.factory;
  if (monthlyCapacity === null) {
    return row(
      "factory",
      "yellow",
      `${name}'s monthly capacity is not set; it has ${count(input.booked)} pieces due by the ship date.`,
    );
  }
  const room = monthlyCapacity * Math.max(1, input.months);
  const load = input.booked + input.pieces;
  if (load > room) {
    return row(
      "factory",
      "red",
      `${name} is full: ${count(input.booked)} pieces booked + ${count(input.pieces)} new, room for ${count(room)}.`,
    );
  }
  if (load > room * CHECK_RULES.nearlyFull) {
    return row(
      "factory",
      "yellow",
      `${name} is nearly full: ${count(load)} of ${count(room)} pieces.`,
    );
  }
  return row(
    "factory",
    "green",
    `${name} has room: ${count(input.booked)} booked + ${count(input.pieces)} new, of ${count(room)}.`,
  );
}

export function judgePayment(input: {
  buyer: string | null;
  invoices: number;
  late: number;
  overdue: { amount: number; count: number; days: number } | null;
  currency: string;
}): CheckRow {
  if (!input.buyer) return row("payment", "yellow", "No buyer picked.");
  if (input.overdue && input.overdue.amount > 0) {
    return row(
      "payment",
      "red",
      `${input.currency} ${money(input.overdue.amount)} overdue on ${input.overdue.count} invoice(s), the oldest by ${input.overdue.days} days.`,
    );
  }
  if (input.invoices === 0) {
    return row(
      "payment",
      "yellow",
      `New buyer: no payment history yet. An advance or an LC is safer.`,
    );
  }
  if (input.late > 0) {
    return row("payment", "yellow", `${input.late} of ${input.invoices} invoices were paid late.`);
  }
  return row(
    "payment",
    "green",
    `${input.invoices === 1 ? "The invoice was" : `All ${input.invoices} invoices were`} paid on time.`,
  );
}

export function judgeRisks(input: { risks: string[]; eidClose: boolean }): CheckRow {
  if (input.risks.length === 0) return row("risks", "green", "No known risk.");
  const text = `${input.risks.join("; ")}.`;
  return row(
    "risks",
    input.eidClose || input.risks.length >= CHECK_RULES.manyRisks ? "red" : "yellow",
    text,
  );
}
