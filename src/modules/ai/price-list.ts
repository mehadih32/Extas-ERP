import type { TokenUse } from "./models";
import type { ProviderId } from "./providers";

/*
 * The built-in price list of Claude, OpenAI and Gemini models (AI Center >
 * Models), US dollars per million tokens, copied from each provider's official
 * price page on the day in `checkedOn`. The owner can set any model's price
 * (prices.service.ts); clearing it brings these back. A model on no list and
 * without the owner's price has no price and is blocked: its cost could not be
 * counted, so it is never called (v6.4 A7).
 *
 * "Cache write" is the provider's price for writing to its prompt cache (for
 * Claude the 5-minute write, the only one the ERP uses); "Batch" the price of
 * work sent through the provider's batch service. Null: the page gives no such
 * price. Plain data and functions, used by the screens too.
 *
 * Claude (read again on 18 October 2026, v6.4.1): a cache hit is a tenth of
 * input, but a twentieth on Opus 5.5 and Sonnet 5.5 and a fortieth on Fable
 * 5.1, as the page says (0.05x, 0.025x). Only Haiku 5.5 is dearer for a long
 * prompt: over 100,000 tokens every price is 5 times; every other Claude model
 * takes its whole context at one price.
 *
 * OpenAI's price page lists only its newest models; every other OpenAI model
 * cites its own model page (developers.openai.com/api/docs/models/<id>), where
 * its price is, and is listed under "Older models". Its batch prices are half
 * the plain ones, as OpenAI's Batch API guide says for every model.
 */

export type PriceFields = {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  batchInput: number | null;
  batchOutput: number | null;
};

export const PRICE_FIELDS = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "batchInput",
  "batchOutput",
] as const satisfies ReadonlyArray<keyof PriceFields>;

/** The owner's long-prompt prices on the price form ("longInput"...), field by field. */
export const LONG_FIELDS = {
  input: "longInput",
  output: "longOutput",
  cacheRead: "longCacheRead",
  cacheWrite: "longCacheWrite",
  batchInput: "longBatchInput",
  batchOutput: "longBatchOutput",
} as const satisfies Record<keyof PriceFields, string>;

/** Each price in words, as the screens and the audit log say them. */
export const PRICE_WORDS: Record<keyof PriceFields, string> = {
  input: "input",
  output: "output",
  cacheRead: "cache read",
  cacheWrite: "cache write",
  batchInput: "batch input",
  batchOutput: "batch output",
};

export type ListedModel = PriceFields & {
  /** The ERP's name of the model: a bare Claude name, or "openai:<id>" / "google:<id>". */
  ref: string;
  label: string;
  /** Still offered, but not the provider's current models: listed under "Older models". */
  older?: boolean;
  /** Higher prices for a prompt over `above` tokens (all of its input, cache included). */
  long?: PriceFields & { above: number };
  /** A price change the page announces: these prices from this day (UTC) on. */
  next?: PriceFields & { from: string };
  sourceUrl: string;
  /** The day the price was read from the page (YYYY-MM-DD). */
  checkedOn: string;
};

export type PriceList = {
  provider: ProviderId;
  /** The section's heading on Models. */
  label: string;
  sourceUrl: string;
  checkedOn: string;
  models: readonly ListedModel[];
};

/** A model's row; `sourceUrl` only when its price is on a page of its own. */
type Row = Omit<ListedModel, "sourceUrl" | "checkedOn"> & { sourceUrl?: string };

const p = (
  input: number,
  output: number,
  cacheRead: number | null,
  cacheWrite: number | null,
  batchInput: number | null,
  batchOutput: number | null,
): PriceFields => ({ input, output, cacheRead, cacheWrite, batchInput, batchOutput });

function list(
  provider: ProviderId,
  label: string,
  sourceUrl: string,
  checkedOn: string,
  rows: Row[],
): PriceList {
  return {
    provider,
    label,
    sourceUrl,
    checkedOn,
    models: rows.map((r) => ({ ...r, sourceUrl: r.sourceUrl ?? sourceUrl, checkedOn })),
  };
}

/** Prompts over 272K input tokens on OpenAI's newer models; over 200K on Gemini's Pro models. */
const OPENAI_LONG = 272_000;

/** An OpenAI model that is not on the price page: its own page gives its price, and it is older. */
const openaiPage = (id: string) => ({
  older: true,
  sourceUrl: `https://developers.openai.com/api/docs/models/${id}`,
});
const GEMINI_LONG = 200_000;

export const PRICE_LISTS: readonly PriceList[] = [
  list(
    "anthropic",
    "Claude",
    "https://platform.claude.com/docs/en/about-claude/pricing",
    "2026-10-18",
    [
      { ref: "claude-fable-5-1", label: "Fable 5.1", ...p(10, 50, 0.25, 12.5, 5, 25) },
      { ref: "claude-opus-5-5", label: "Opus 5.5", ...p(4, 20, 0.2, 5, 2, 10) },
      { ref: "claude-sonnet-5-5", label: "Sonnet 5.5", ...p(2, 10, 0.1, 2.5, 1, 5) },
      {
        ref: "claude-haiku-5-5",
        label: "Haiku 5.5",
        ...p(0.1, 0.5, 0.01, 0.125, 0.05, 0.25),
        long: { above: 100_000, ...p(0.5, 2.5, 0.05, 0.625, 0.25, 1.25) },
      },
      { ref: "claude-fable-5", label: "Fable 5", older: true, ...p(10, 50, 1, 12.5, 5, 25) },
      { ref: "claude-opus-5", label: "Opus 5", older: true, ...p(5, 25, 0.5, 6.25, 2.5, 12.5) },
      { ref: "claude-opus-4-8", label: "Opus 4.8", older: true, ...p(5, 25, 0.5, 6.25, 2.5, 12.5) },
      { ref: "claude-opus-4-7", label: "Opus 4.7", older: true, ...p(5, 25, 0.5, 6.25, 2.5, 12.5) },
      { ref: "claude-opus-4-6", label: "Opus 4.6", older: true, ...p(5, 25, 0.5, 6.25, 2.5, 12.5) },
      { ref: "claude-opus-4-5", label: "Opus 4.5", older: true, ...p(5, 25, 0.5, 6.25, 2.5, 12.5) },
      { ref: "claude-sonnet-5", label: "Sonnet 5", older: true, ...p(2, 10, 0.2, 2.5, 1, 5) },
      {
        ref: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
        older: true,
        ...p(3, 15, 0.3, 3.75, 1.5, 7.5),
      },
      {
        ref: "claude-sonnet-4-5",
        label: "Sonnet 4.5",
        older: true,
        ...p(3, 15, 0.3, 3.75, 1.5, 7.5),
      },
      { ref: "claude-haiku-4-5", label: "Haiku 4.5", older: true, ...p(1, 5, 0.1, 1.25, 0.5, 2.5) },
    ],
  ),
  list("openai", "OpenAI", "https://developers.openai.com/api/docs/pricing", "2026-10-16", [
    {
      ref: "openai:gpt-6-astra",
      label: "GPT-6 Astra",
      ...p(10, 50, 1, 12.5, 5, 25),
      long: { above: OPENAI_LONG, ...p(20, 75, 2, 25, 10, 37.5) },
    },
    {
      ref: "openai:gpt-6.1-sol",
      label: "GPT-6.1 Sol",
      ...p(2, 10, 0.1, 2.5, 1, 5),
      long: { above: OPENAI_LONG, ...p(4, 15, 0.2, 5, 2, 7.5) },
    },
    {
      ref: "openai:gpt-6-luna",
      label: "GPT-6 Luna",
      ...p(0.1, 0.5, 0.01, 0.125, 0.05, 0.25),
      long: { above: OPENAI_LONG, ...p(0.2, 0.75, 0.02, 0.25, 0.1, 0.375) },
    },
    {
      ref: "openai:gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      ...p(4, 20, 0.4, 5, 2, 10),
      long: { above: OPENAI_LONG, ...p(8, 30, 0.8, 10, 4, 15) },
    },
    {
      ref: "openai:gpt-6-sol",
      label: "GPT-6 Sol",
      ...openaiPage("gpt-6-sol"),
      ...p(2, 10, 0.2, 2.5, 1, 5),
      long: { above: OPENAI_LONG, ...p(4, 15, 0.4, 5, 2, 7.5) },
    },
    {
      ref: "openai:gpt-5.6-terra",
      label: "GPT-5.6 Terra",
      ...openaiPage("gpt-5.6-terra"),
      ...p(2, 12, 0.2, 2.5, 1, 6),
      long: { above: OPENAI_LONG, ...p(4, 18, 0.4, 5, 2, 9) },
    },
    {
      ref: "openai:gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      ...openaiPage("gpt-5.6-luna"),
      ...p(0.2, 1.2, 0.02, 0.25, 0.1, 0.6),
      long: { above: OPENAI_LONG, ...p(0.4, 1.8, 0.04, 0.5, 0.2, 0.9) },
    },
    {
      ref: "openai:gpt-5.5",
      label: "GPT-5.5",
      ...openaiPage("gpt-5.5"),
      ...p(5, 30, 0.5, null, 2.5, 15),
      long: { above: OPENAI_LONG, ...p(10, 45, 1, null, 5, 22.5) },
    },
    {
      ref: "openai:gpt-5.4",
      label: "GPT-5.4",
      ...openaiPage("gpt-5.4"),
      ...p(2.5, 15, 0.25, null, 1.25, 7.5),
      long: { above: OPENAI_LONG, ...p(5, 22.5, 0.5, null, 2.5, 11.25) },
    },
    {
      ref: "openai:gpt-5.4-mini",
      label: "GPT-5.4 mini",
      ...openaiPage("gpt-5.4-mini"),
      ...p(0.75, 4.5, 0.075, null, 0.375, 2.25),
    },
    {
      ref: "openai:gpt-5.4-nano",
      label: "GPT-5.4 nano",
      ...openaiPage("gpt-5.4-nano"),
      ...p(0.2, 1.25, 0.02, null, 0.1, 0.625),
    },
    {
      ref: "openai:gpt-5.2",
      label: "GPT-5.2",
      ...openaiPage("gpt-5.2"),
      ...p(1.75, 14, 0.175, null, 0.875, 7),
    },
    {
      ref: "openai:gpt-5.1",
      label: "GPT-5.1",
      ...openaiPage("gpt-5.1"),
      ...p(1.25, 10, 0.125, null, 0.625, 5),
    },
    {
      ref: "openai:gpt-5",
      label: "GPT-5",
      ...openaiPage("gpt-5"),
      ...p(1.25, 10, 0.125, null, 0.625, 5),
    },
    {
      ref: "openai:gpt-5-mini",
      label: "GPT-5 mini",
      ...openaiPage("gpt-5-mini"),
      ...p(0.25, 2, 0.025, null, 0.125, 1),
    },
    {
      ref: "openai:gpt-5-nano",
      label: "GPT-5 nano",
      ...openaiPage("gpt-5-nano"),
      ...p(0.05, 0.4, 0.005, null, 0.025, 0.2),
    },
    {
      ref: "openai:gpt-4.1",
      label: "GPT-4.1",
      ...openaiPage("gpt-4.1"),
      ...p(2, 8, 0.5, null, 1, 4),
    },
    {
      ref: "openai:gpt-4.1-mini",
      label: "GPT-4.1 mini",
      ...openaiPage("gpt-4.1-mini"),
      ...p(0.4, 1.6, 0.1, null, 0.2, 0.8),
    },
    {
      ref: "openai:gpt-4.1-nano",
      label: "GPT-4.1 nano",
      ...openaiPage("gpt-4.1-nano"),
      ...p(0.1, 0.4, 0.025, null, 0.05, 0.2),
    },
    {
      ref: "openai:gpt-4o",
      label: "GPT-4o",
      ...openaiPage("gpt-4o"),
      ...p(2.5, 10, 1.25, null, 1.25, 5),
    },
    {
      ref: "openai:gpt-4o-mini",
      label: "GPT-4o mini",
      ...openaiPage("gpt-4o-mini"),
      ...p(0.15, 0.6, 0.075, null, 0.075, 0.3),
    },
    { ref: "openai:o3", label: "o3", ...openaiPage("o3"), ...p(2, 8, 0.5, null, 1, 4) },
    {
      ref: "openai:o4-mini",
      label: "o4-mini",
      ...openaiPage("o4-mini"),
      ...p(1.1, 4.4, 0.275, null, 0.55, 2.2),
    },
  ]),
  list("google", "Gemini", "https://ai.google.dev/gemini-api/docs/pricing", "2026-10-16", [
    {
      ref: "google:gemini-4-argon",
      label: "Gemini 4 Argon",
      ...p(2, 10, 0.1, null, 1, 5),
      next: { from: "2026-12-01", ...p(4, 20, 0.2, null, 2, 10) },
    },
    {
      ref: "google:gemini-3.8-flash",
      label: "Gemini 3.8 Flash",
      ...p(0.75, 3.75, 0.075, null, 0.375, 1.875),
      next: { from: "2027-01-01", ...p(1.5, 7.5, 0.15, null, 0.75, 3.75) },
    },
    {
      ref: "google:gemini-3.6-flash",
      label: "Gemini 3.6 Flash",
      ...p(0.75, 3.75, 0.075, null, 0.375, 1.875),
      next: { from: "2027-01-01", ...p(1.5, 7.5, 0.15, null, 0.75, 3.75) },
    },
    {
      ref: "google:gemini-3.5-flash-lite",
      label: "Gemini 3.5 Flash-Lite",
      ...p(0.3, 2.5, 0.03, null, 0.15, 1.25),
    },
    {
      ref: "google:gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash-Lite",
      ...p(0.25, 1.5, 0.025, null, 0.125, 0.75),
    },
    {
      ref: "google:gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      ...p(2, 12, 0.2, null, 1, 6),
      long: { above: GEMINI_LONG, ...p(4, 18, 0.4, null, 2, 9) },
    },
    {
      ref: "google:gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      older: true,
      ...p(1.25, 10, 0.125, null, 0.625, 5),
      long: { above: GEMINI_LONG, ...p(2.5, 15, 0.25, null, 1.25, 7.5) },
    },
    {
      ref: "google:gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      older: true,
      ...p(0.3, 2.5, 0.03, null, 0.15, 1.25),
    },
    {
      ref: "google:gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash-Lite",
      older: true,
      ...p(0.1, 0.4, 0.01, null, 0.05, 0.2),
    },
  ]),
];

const LISTED = new Map(PRICE_LISTS.flatMap((l) => l.models.map((m) => [m.ref, m] as const)));

export const priceListOf = (provider: ProviderId) =>
  PRICE_LISTS.find((l) => l.provider === provider)!;

/**
 * The Claude model a dated snapshot name belongs to: "<name>-<yyyymmdd>" is
 * "<name>" (Anthropic prices a model and its snapshots alike).
 * Other providers price some dated names differently, so those need a price
 * of their own. Null when it is not a Claude snapshot name.
 */
export function snapshotOf(ref: string): string | null {
  const m = /^(claude-[a-z0-9-]+?)-(\d{8})$/.exec(ref);
  return m ? m[1]! : null;
}

/** A model's entry on the built-in list (a dated snapshot takes its model's), or null. */
export function listedModel(ref: string): ListedModel | null {
  const own = LISTED.get(ref);
  if (own) return own;
  const base = snapshotOf(ref);
  return base ? (LISTED.get(base) ?? null) : null;
}

/** Writing to Claude's prompt cache costs a quarter more than plain input. */
export const CACHE_WRITE_FACTOR = 1.25;

/** A price as the cost maths takes it: the list's (with its long and dated prices) or the owner's. */
export type PriceRule = PriceFields & {
  long?: PriceFields & { above: number };
  next?: PriceFields & { from: string };
};

/** The prices that hold at `at` for a prompt of `prompt` tokens. */
export function pricesAt(price: PriceRule, prompt: number, at: Date): PriceFields {
  const base =
    price.next && at.getTime() >= Date.parse(`${price.next.from}T00:00:00Z`) ? price.next : price;
  return price.long && prompt > price.long.above ? price.long : base;
}

/**
 * What a call cost in US dollars at these prices. Cache reading without its
 * own price is charged as input; cache writing without one as input (Claude:
 * a quarter more). Batch work uses the batch prices, and its cache reading
 * and writing get the same discount as its input.
 */
export function costOf(price: PriceRule, use: TokenUse, provider: ProviderId, at = new Date()) {
  const cacheRead = use.cacheRead ?? 0;
  const cacheWrite = use.cacheWrite ?? 0;
  const t = pricesAt(price, use.input + cacheRead + cacheWrite, at);
  const batch = use.batch === true;
  const input = batch ? (t.batchInput ?? t.input) : t.input;
  const output = batch ? (t.batchOutput ?? t.output) : t.output;
  const discount = batch && t.input > 0 ? input / t.input : 1;
  const read = (t.cacheRead ?? t.input) * discount;
  const write =
    (t.cacheWrite ?? t.input * (provider === "anthropic" ? CACHE_WRITE_FACTOR : 1)) * discount;
  return (
    (use.input * input + use.output * output + cacheRead * read + cacheWrite * write) / 1_000_000
  );
}

/** "$4", "$0.50", "$0.625": dollars as the price pages write them. */
export function usdText(value: number): string {
  if (Number.isInteger(value)) return `$${value}`;
  const text = String(value);
  return (text.split(".")[1]?.length ?? 0) < 2 ? `$${value.toFixed(2)}` : `$${text}`;
}

/** "1 Dec 2026" from "2026-12-01" (a day, whatever the time zone). */
export function dayText(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "$0.50 input, $2.50 output, …": the prices given, in words. */
export const pricesText = (fields: PriceFields) =>
  PRICE_FIELDS.flatMap((f) =>
    fields[f] === null ? [] : [`${usdText(fields[f]!)} ${PRICE_WORDS[f]}`],
  ).join(", ");

/** The list's other prices of a model, in a line each: long prompts, an announced change. */
export function priceNotes(m: Pick<ListedModel, "long" | "next">): string[] {
  return [
    ...(m.long
      ? [`Prompts over ${m.long.above.toLocaleString("en-US")} tokens: ${pricesText(m.long)}`]
      : []),
    ...(m.next ? [`From ${dayText(m.next.from)}: ${pricesText(m.next)}`] : []),
  ];
}
