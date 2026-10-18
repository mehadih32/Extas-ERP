import { describe, expect, it } from "vitest";

import { AI_MODELS, costUsd } from "@/modules/ai/models";
import {
  costOf,
  listedModel,
  PRICE_FIELDS,
  PRICE_LISTS,
  priceListOf,
  snapshotOf,
} from "@/modules/ai/price-list";
import {
  blockedText,
  costIn,
  type Price,
  type PriceBook,
  priceFor,
  priceSchema,
} from "@/modules/ai/prices.service";
import { parseModel, PROVIDER_IDS } from "@/modules/ai/providers";

/*
 * v6.4 F and A7: the built-in prices of Claude, OpenAI and Gemini models, from
 * each provider's official price page (where from, and the day checked), the
 * cost maths with cache writing, batch work, long prompts and announced price
 * changes, and the rule that a model with no price is never counted as cost 0.
 */

/** An OpenAI model's own page, where its price is given. */
const MODEL_PAGE = (ref: string) =>
  `https://developers.openai.com/api/docs/models/${ref.replace(/^openai:/, "")}`;

const listed = (ref: string) => {
  const m = listedModel(ref);
  if (!m) throw new Error(`${ref} is not on the list`);
  return m;
};

const bookOf = (...entries: Array<[string, Partial<Price>]>): PriceBook =>
  new Map(
    entries.map(([model, p]) => [
      model,
      {
        input: 0,
        output: 0,
        cacheRead: null,
        cacheWrite: null,
        batchInput: null,
        batchOutput: null,
        from: "owner" as const,
        ...p,
      },
    ]),
  );

describe("the built-in price list", () => {
  it("has a section for each provider, headed Claude, OpenAI and Gemini, from the official page", () => {
    expect(PRICE_LISTS.map((l) => [l.provider, l.label])).toEqual([
      ["anthropic", "Claude"],
      ["openai", "OpenAI"],
      ["google", "Gemini"],
    ]);
    expect(priceListOf("anthropic").sourceUrl).toBe(
      "https://platform.claude.com/docs/en/about-claude/pricing",
    );
    expect(priceListOf("openai").sourceUrl).toBe("https://developers.openai.com/api/docs/pricing");
    expect(priceListOf("google").sourceUrl).toBe("https://ai.google.dev/gemini-api/docs/pricing");
    // Claude's page was read again on 18 October 2026 (v6.4.1 C4); no newer
    // OpenAI or Gemini page was read, so theirs keep their day.
    const checked = { anthropic: "2026-10-18", openai: "2026-10-16", google: "2026-10-16" };
    for (const l of PRICE_LISTS) {
      expect(l.checkedOn, l.provider).toBe(checked[l.provider]);
      expect(l.models.length, l.provider).toBeGreaterThanOrEqual(5);
      expect(
        l.models.some((m) => !m.older),
        l.provider,
      ).toBe(true);
    }
    expect(PROVIDER_IDS).toEqual(PRICE_LISTS.map((l) => l.provider));
  });

  it("gives every model a name, a page, a day, its provider and a full price", () => {
    const refs = new Set<string>();
    for (const l of PRICE_LISTS) {
      for (const m of l.models) {
        expect(refs.has(m.ref), m.ref).toBe(false);
        refs.add(m.ref);
        expect(parseModel(m.ref)?.provider, m.ref).toBe(l.provider);
        expect(m.label.trim().length, m.ref).toBeGreaterThan(1);
        // The section's price page, or (OpenAI) the model's own page when its price is there.
        expect([l.sourceUrl, MODEL_PAGE(m.ref)], m.ref).toContain(m.sourceUrl);
        expect(m.checkedOn, m.ref).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(m.input, m.ref).toBeGreaterThan(0);
        expect(m.output, m.ref).toBeGreaterThan(0);
        for (const tier of [m, m.long, m.next].filter(Boolean)) {
          for (const f of PRICE_FIELDS) {
            const v = tier![f];
            expect(v === null || (Number.isFinite(v) && v >= 0), `${m.ref} ${f}`).toBe(true);
          }
        }
        // Batch work is never dearer than plain work; a long prompt never cheaper.
        if (m.batchInput !== null) expect(m.batchInput, m.ref).toBeLessThanOrEqual(m.input);
        if (m.long) expect(m.long.input, m.ref).toBeGreaterThanOrEqual(m.input);
      }
    }
  });

  it("cites for each OpenAI model the page its price is on; those not on the price page are older", () => {
    const openai = priceListOf("openai").models;
    // On OpenAI's price page (16 October 2026): its flagship models and GPT-5.6 Sol.
    const onPricePage = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-5.6-sol"];
    expect(
      openai.filter((m) => m.sourceUrl === priceListOf("openai").sourceUrl).map((m) => m.ref),
    ).toEqual(onPricePage.map((id) => `openai:${id}`));
    expect(openai.filter((m) => !m.older).map((m) => m.ref)).toEqual(
      onPricePage.map((id) => `openai:${id}`),
    );
    // Every other one: its own model page, under "Older models".
    for (const m of openai.filter((x) => !onPricePage.includes(x.ref.slice(7)))) {
      expect(m.sourceUrl, m.ref).toBe(MODEL_PAGE(m.ref));
      expect(m.older, m.ref).toBe(true);
    }
    // As those pages give them: long prompts are over 272K input tokens.
    expect(listed("openai:gpt-6-sol")).toMatchObject({
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      batchInput: 1,
      batchOutput: 5,
      long: { above: 272_000, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 },
    });
    expect(listed("openai:gpt-5.6-terra")).toMatchObject({
      input: 2,
      output: 12,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      long: { above: 272_000, input: 4, output: 18 },
    });
    expect(listed("openai:gpt-5.6-luna")).toMatchObject({
      input: 0.2,
      output: 1.2,
      cacheRead: 0.02,
      cacheWrite: 0.25,
      long: { above: 272_000, input: 0.4, output: 1.8 },
    });
    expect(listed("openai:o4-mini")).toMatchObject({ input: 1.1, output: 4.4, cacheRead: 0.275 });
  });

  it("prices every one of the ERP's own Claude models", () => {
    for (const m of AI_MODELS) {
      expect(listedModel(m.id), m.id).not.toBeNull();
      expect(listed(m.id).label).toBe(m.label);
    }
  });

  it("pins every Claude price to Claude's official price page of 18 October 2026 (v6.4.1 C4)", () => {
    // platform.claude.com/docs/en/about-claude/pricing, read on 18 October 2026:
    // input, output, cache hit, 5-minute cache write, batch input, batch output.
    const page: Record<string, [string, number, number, number, number, number, number]> = {
      "claude-fable-5-1": ["Fable 5.1", 10, 50, 0.25, 12.5, 5, 25],
      "claude-opus-5-5": ["Opus 5.5", 4, 20, 0.2, 5, 2, 10],
      "claude-sonnet-5-5": ["Sonnet 5.5", 2, 10, 0.1, 2.5, 1, 5],
      "claude-haiku-5-5": ["Haiku 5.5", 0.1, 0.5, 0.01, 0.125, 0.05, 0.25],
      "claude-fable-5": ["Fable 5", 10, 50, 1, 12.5, 5, 25],
      "claude-opus-5": ["Opus 5", 5, 25, 0.5, 6.25, 2.5, 12.5],
      "claude-opus-4-8": ["Opus 4.8", 5, 25, 0.5, 6.25, 2.5, 12.5],
      "claude-opus-4-7": ["Opus 4.7", 5, 25, 0.5, 6.25, 2.5, 12.5],
      "claude-opus-4-6": ["Opus 4.6", 5, 25, 0.5, 6.25, 2.5, 12.5],
      "claude-opus-4-5": ["Opus 4.5", 5, 25, 0.5, 6.25, 2.5, 12.5],
      "claude-sonnet-5": ["Sonnet 5", 2, 10, 0.2, 2.5, 1, 5],
      "claude-sonnet-4-6": ["Sonnet 4.6", 3, 15, 0.3, 3.75, 1.5, 7.5],
      "claude-sonnet-4-5": ["Sonnet 4.5", 3, 15, 0.3, 3.75, 1.5, 7.5],
      "claude-haiku-4-5": ["Haiku 4.5", 1, 5, 0.1, 1.25, 0.5, 2.5],
    };
    const claude = priceListOf("anthropic");
    expect(claude.sourceUrl).toBe("https://platform.claude.com/docs/en/about-claude/pricing");
    expect(claude.checkedOn).toBe("2026-10-18");
    expect(claude.models.map((m) => m.ref).sort()).toEqual(Object.keys(page).sort());
    for (const m of claude.models) {
      const [label, input, output, cacheRead, cacheWrite, batchInput, batchOutput] = page[m.ref]!;
      expect(
        {
          label: m.label,
          input: m.input,
          output: m.output,
          cacheRead: m.cacheRead,
          cacheWrite: m.cacheWrite,
          batchInput: m.batchInput,
          batchOutput: m.batchOutput,
        },
        m.ref,
      ).toEqual({ label, input, output, cacheRead, cacheWrite, batchInput, batchOutput });
      expect(m.sourceUrl, m.ref).toBe(claude.sourceUrl);
      expect(m.checkedOn, m.ref).toBe("2026-10-18");
      // Writing to the 5-minute cache is 1.25 times input; batch work half price.
      expect(m.cacheWrite, m.ref).toBeCloseTo(m.input * 1.25, 9);
      expect(m.batchInput, m.ref).toBeCloseTo(m.input / 2, 9);
      expect(m.batchOutput, m.ref).toBeCloseTo(m.output / 2, 9);
      // No announced change; only Haiku 5.5 is dearer for a long prompt (every
      // other Claude model takes its whole 1M context at the same price).
      expect(m.next, m.ref).toBeUndefined();
      expect(Boolean(m.long), m.ref).toBe(m.ref === "claude-haiku-5-5");
    }
    // A cache hit is a tenth of input, except on the newest models: a twentieth
    // on Opus 5.5 and Sonnet 5.5, a fortieth on Fable 5.1 (the page's 0.05x and
    // 0.025x), so $0.20 for Opus 5.5 is right, not a mistake.
    const ratio = (ref: string) => listed(ref).cacheRead! / listed(ref).input;
    expect(ratio("claude-opus-5-5")).toBeCloseTo(0.05, 9);
    expect(ratio("claude-sonnet-5-5")).toBeCloseTo(0.05, 9);
    expect(ratio("claude-fable-5-1")).toBeCloseTo(0.025, 9);
    for (const ref of [
      "claude-haiku-5-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]) {
      expect(ratio(ref), ref).toBeCloseTo(0.1, 9);
    }
    // Haiku 5.5: a prompt over 100,000 tokens (not 200,000) pays 5 times every price.
    const haiku = listed("claude-haiku-5-5");
    expect(haiku.long).toEqual({
      above: 100_000,
      input: 0.5,
      output: 2.5,
      cacheRead: 0.05,
      cacheWrite: 0.625,
      batchInput: 0.25,
      batchOutput: 1.25,
    });
    for (const f of PRICE_FIELDS) expect(haiku.long![f], f).toBeCloseTo(haiku[f]! * 5, 9);
  });

  it("records the prices exactly as the pages gave them on 16 October 2026", () => {
    expect(listed("claude-opus-5-5")).toMatchObject({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
      batchInput: 2,
      batchOutput: 10,
    });
    // The Claude page gives this cache hit price as $0.10 (the old list said $0.20).
    expect(listed("claude-sonnet-5-5")).toMatchObject({ input: 2, output: 10, cacheRead: 0.1 });
    expect(listed("claude-haiku-5-5").long).toMatchObject({
      above: 100_000,
      input: 0.5,
      output: 2.5,
      cacheRead: 0.05,
      cacheWrite: 0.625,
      batchInput: 0.25,
      batchOutput: 1.25,
    });
    expect(listed("claude-fable-5-1")).toMatchObject({ input: 10, output: 50, cacheRead: 0.25 });
    expect(listed("openai:gpt-6.1-sol")).toMatchObject({
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
      batchInput: 1,
      batchOutput: 5,
      long: { above: 272_000, input: 4, output: 15 },
    });
    expect(listed("openai:gpt-5")).toMatchObject({ input: 1.25, output: 10, cacheWrite: null });
    expect(listed("google:gemini-4-argon")).toMatchObject({
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: null,
      next: { from: "2026-12-01", input: 4, output: 20 },
    });
    expect(listed("google:gemini-2.5-pro").long).toMatchObject({
      above: 200_000,
      input: 2.5,
      output: 15,
    });
  });

  it("gives a Claude snapshot its model's price, but never guesses another provider's", () => {
    expect(snapshotOf("claude-opus-4-5-20251101")).toBe("claude-opus-4-5");
    expect(listedModel("claude-haiku-4-5-20251001")?.ref).toBe("claude-haiku-4-5");
    // OpenAI prices some dated models differently from the base model: no guess.
    expect(listedModel("openai:gpt-4o-2024-05-13")).toBeNull();
    expect(listedModel("openai:gpt-5-mini")?.ref).toBe("openai:gpt-5-mini");
    expect(listedModel("openai:gpt-test")).toBeNull();
    expect(listedModel("google:gemini-2.5-flash-preview-09-2025")).toBeNull();
  });
});

describe("the cost maths", () => {
  it("keeps the Claude rules: plain, cache and the long-prompt price of Haiku 5.5", () => {
    expect(costUsd("claude-opus-5-5", { input: 1_000_000, output: 1_000_000 })).toBeCloseTo(24, 9);
    expect(costUsd("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 1_000_000 })).toBe(0.1);
    // Over 100K prompt tokens: every price is the long one, cache included.
    expect(costUsd("claude-haiku-5-5", { input: 200_000, output: 1_000 })).toBeCloseTo(0.1025, 9);
    expect(
      costUsd("claude-haiku-5-5", { input: 50_000, output: 0, cacheRead: 60_000 }),
    ).toBeCloseTo((50_000 * 0.5 + 60_000 * 0.05) / 1e6, 9);
    expect(costUsd("unknown", { input: 1, output: 1 })).toBe(0);
  });

  it("charges cache writing at the page's price, or as input (Claude: a quarter more)", () => {
    const use = { input: 0, output: 0, cacheWrite: 1_000_000 };
    expect(
      costOf(listed("openai:gpt-6.1-sol"), { input: 0, output: 0, cacheWrite: 100_000 }, "openai"),
    ).toBeCloseTo(0.25, 9);
    expect(costOf(listed("claude-opus-5-5"), use, "anthropic")).toBe(5);
    const flat = { ...listed("openai:gpt-5"), cacheWrite: null };
    expect(costOf(flat, use, "openai")).toBe(1.25);
    expect(costOf({ ...flat, input: 2 }, use, "anthropic")).toBe(2.5);
  });

  it("uses the batch prices for batch work, with the cache at the same discount", () => {
    const sol = listed("openai:gpt-6.1-sol");
    // 100K in at $1 and 100K out at $5 (plain: $2 and $10).
    expect(costOf(sol, { input: 100_000, output: 100_000, batch: true }, "openai")).toBeCloseTo(
      0.6,
      9,
    );
    // Cache reading at $0.10, halved like the input.
    expect(
      costOf(sol, { input: 0, output: 0, cacheRead: 100_000, batch: true }, "openai"),
    ).toBeCloseTo(0.005, 9);
    expect(
      costOf(
        listed("claude-sonnet-5-5"),
        { input: 1_000_000, output: 0, batch: true },
        "anthropic",
      ),
    ).toBe(1);
    // Without a batch price, batch work costs as plain work.
    const noBatch = { ...sol, batchInput: null, batchOutput: null };
    expect(costOf(noBatch, { input: 100_000, output: 0, batch: true }, "openai")).toBeCloseTo(
      0.2,
      9,
    );
  });

  it("uses a long prompt's prices above the page's line", () => {
    const sol = listed("openai:gpt-6.1-sol");
    expect(costOf(sol, { input: 272_000, output: 0 }, "openai")).toBeCloseTo(0.544, 9);
    expect(costOf(sol, { input: 272_001, output: 0 }, "openai")).toBeCloseTo(1.088004, 9);
    const pro = listed("google:gemini-2.5-pro");
    expect(costOf(pro, { input: 300_000, output: 1_000_000 }, "google")).toBeCloseTo(0.75 + 15, 9);
  });

  it("uses an announced new price from its day on", () => {
    const argon = listed("google:gemini-4-argon");
    const use = { input: 1_000_000, output: 1_000_000 };
    expect(costOf(argon, use, "google", new Date("2026-11-30T23:59:59Z"))).toBe(12);
    expect(costOf(argon, use, "google", new Date("2026-12-01T00:00:00Z"))).toBe(24);
  });
});

describe("a model with no price (A7)", () => {
  const book = bookOf(["openai:gpt-test", { input: 1.25, output: 10 }]);

  it("is never counted as cost 0 for work it did", () => {
    expect(costIn(book, "google:gemini-x", { input: 10, output: 0 })).toEqual({
      usd: 0,
      known: false,
    });
    expect(costIn(book, "openai:gpt-4o-2024-05-13", { input: 0, output: 5 }).known).toBe(false);
    // A call that never ran used nothing: its cost is known to be nothing.
    expect(costIn(book, "google:gemini-x", { input: 0, output: 0 })).toEqual({
      usd: 0,
      known: true,
    });
  });

  it("finds the owner's price first, then the list's (a Claude snapshot its model's)", () => {
    expect(priceFor(book, "openai:gpt-test")?.input).toBe(1.25);
    expect(priceFor(book, "google:gemini-x")).toBeNull();
    const owner = bookOf(["claude-opus-5-5", { input: 3, output: 15 }]);
    expect(priceFor(owner, "claude-opus-5-5")).toMatchObject({ input: 3, from: "owner" });
    expect(priceFor(new Map(), "claude-opus-5-5")).toMatchObject({ input: 4, from: "erp" });
    expect(priceFor(new Map(), "claude-opus-4-5-20251101")).toMatchObject({ input: 5 });
    expect(priceFor(new Map(), "anthropic:claude-opus-5")).toMatchObject({ input: 5 });
    // The owner's price is used as given, with no announced change of the page's.
    expect(
      costIn(owner, "claude-opus-5-5", { input: 1_000_000, output: 0, cacheWrite: 1_000_000 }).usd,
    ).toBeCloseTo(3 + 3.75, 9);
  });

  it("keeps the page's long-prompt prices under the owner's normal ones (v6.4.1 C4)", () => {
    const plain = bookOf(["claude-haiku-5-5", { input: 0.2, output: 1 }]);
    const own = priceFor(plain, "claude-haiku-5-5")!;
    expect(own).toMatchObject({ input: 0.2, output: 1, from: "owner" });
    expect(own.long).toEqual(listed("claude-haiku-5-5").long);
    // Up to 100,000 prompt tokens the owner's price; over it the page's long one.
    expect(costIn(plain, "claude-haiku-5-5", { input: 100_000, output: 0 }).usd).toBeCloseTo(
      0.02,
      9,
    );
    expect(costIn(plain, "claude-haiku-5-5", { input: 200_000, output: 0 }).usd).toBeCloseTo(
      0.1,
      9,
    );
    // A snapshot takes its model's owner price, long prices included.
    expect(priceFor(plain, "claude-haiku-5-5-20261001")?.long?.above).toBe(100_000);
    // The owner's own long-prompt prices win over the page's.
    const long = {
      above: 50_000,
      input: 1,
      output: 4,
      cacheRead: null,
      cacheWrite: null,
      batchInput: null,
      batchOutput: null,
    };
    const mine = bookOf(["claude-haiku-5-5", { input: 0.2, output: 1, long }]);
    expect(priceFor(mine, "claude-haiku-5-5")?.long).toEqual(long);
    expect(costIn(mine, "claude-haiku-5-5", { input: 60_000, output: 0 }).usd).toBeCloseTo(0.06, 9);
    // A model with no long prices anywhere stays at one price.
    const opus = bookOf(["claude-opus-5-5", { input: 3, output: 15 }]);
    expect(priceFor(opus, "claude-opus-5-5")?.long).toBeUndefined();
  });

  it("is named plainly when blocked", () => {
    expect(blockedText("gpt-test (OpenAI)")).toBe(
      "gpt-test (OpenAI) has no price yet, so it is blocked. Add its price in AI Center > Models.",
    );
  });
});

describe("the price the owner sets", () => {
  it("takes every price on the page, input and output both or neither", () => {
    expect(
      priceSchema.parse({
        model: "openai:gpt-test",
        input: "$1.25",
        output: "10",
        cacheRead: "0.125",
        cacheWrite: "",
        batchInput: "0.625",
        batchOutput: "5",
      }),
    ).toEqual({
      model: "openai:gpt-test",
      input: "1.25",
      output: "10",
      cacheRead: "0.125",
      cacheWrite: null,
      batchInput: "0.625",
      batchOutput: "5",
      source: null,
    });
    expect(priceSchema.safeParse({ model: "openai:gpt-test", input: "1" }).success).toBe(false);
    expect(
      priceSchema.safeParse({ model: "openai:gpt-test", input: "1", output: "abc" }).success,
    ).toBe(false);
    expect(priceSchema.safeParse({ model: "not a model", input: "1", output: "2" }).success).toBe(
      false,
    );
    // Clearing: no prices at all.
    expect(priceSchema.parse({ model: "claude-opus-5-5", input: "", output: "" })).toMatchObject({
      input: null,
      output: null,
    });
  });

  it("never takes a price of 0: input and output above 0, the others empty or above 0", () => {
    const refused = (more: Record<string, string>) => {
      const parsed = priceSchema.safeParse({
        model: "openai:gpt-test",
        input: "1.25",
        output: "10",
        ...more,
      });
      expect(parsed.success, JSON.stringify(more)).toBe(false);
      return parsed.error!.issues.map((i) => [i.path.join("."), i.message]);
    };
    expect(refused({ input: "0" })).toEqual([["input", "More than 0 dollars, like 2.50"]]);
    expect(refused({ output: "0.00" })).toEqual([["output", "More than 0 dollars, like 2.50"]]);
    expect(refused({ input: "$0", output: "0" })).toHaveLength(2);
    for (const f of ["cacheRead", "cacheWrite", "batchInput", "batchOutput"]) {
      expect(refused({ [f]: "0" })).toEqual([[f, "Empty, or more than 0 dollars, like 2.50"]]);
    }
    // The smallest price a page gives is taken, and the others may stay empty.
    expect(
      priceSchema.parse({
        model: "openai:gpt-test",
        input: "0.0001",
        output: "0.005",
        cacheRead: "0.0001",
        cacheWrite: "",
      }),
    ).toMatchObject({ input: "0.0001", output: "0.005", cacheRead: "0.0001", cacheWrite: null });
  });

  it("keeps where a typed price came from (v6.4.1 C4)", () => {
    const base = { model: "openai:gpt-test", input: "1", output: "2" };
    expect(priceSchema.parse({ ...base, source: "  https://openai.com/api/pricing " }).source).toBe(
      "https://openai.com/api/pricing",
    );
    // Empty: the service writes "Typed by <name> on <day>".
    expect(priceSchema.parse({ ...base, source: "" }).source).toBeNull();
    expect(priceSchema.safeParse({ ...base, source: "x".repeat(301) }).success).toBe(false);
  });

  it("takes long-prompt prices, and leaves them alone when none are sent (v6.4.1 C4)", () => {
    const base = { model: "claude-haiku-5-5", input: "0.1", output: "0.5" };
    // Not sent at all: whatever is saved stays.
    expect(priceSchema.parse(base).long).toBeUndefined();
    // Sent empty: back to the page's long-prompt prices.
    const empty = {
      longAbove: "",
      longInput: "",
      longOutput: "",
      longCacheRead: "",
      longCacheWrite: "",
      longBatchInput: "",
      longBatchOutput: "",
    };
    expect(priceSchema.parse({ ...base, ...empty }).long).toBeNull();
    expect(
      priceSchema.parse({
        ...base,
        ...empty,
        longAbove: "100,000",
        longInput: "0.5",
        longOutput: "2.50",
        longCacheRead: "0.05",
      }).long,
    ).toEqual({
      above: 100_000,
      input: "0.5",
      output: "2.50",
      cacheRead: "0.05",
      cacheWrite: null,
      batchInput: null,
      batchOutput: null,
    });
    // Without a line, a model on the list takes the page's (Haiku 5.5: 100,000 tokens).
    expect(
      priceSchema.parse({ ...base, ...empty, longInput: "0.5", longOutput: "2.5" }).long?.above,
    ).toBe(100_000);
    const issues = (more: Record<string, string>, model = "claude-haiku-5-5") => {
      const parsed = priceSchema.safeParse({ ...base, model, ...empty, ...more });
      expect(parsed.success, JSON.stringify(more)).toBe(false);
      return parsed.error!.issues.map((i) => [i.path.join("."), i.message]);
    };
    expect(issues({ longInput: "0.5" })).toEqual([
      ["longOutput", "Give both long-prompt prices (input and output), or neither"],
    ]);
    expect(issues({ longInput: "0", longOutput: "2" })).toEqual([
      ["longInput", "More than 0 dollars, like 2.50"],
    ]);
    // A model with no long prompts on its page needs the line given.
    expect(issues({ longInput: "4", longOutput: "16" }, "claude-opus-5-5")).toEqual([
      ["longAbove", "Give the prompt length the long prices start above, like 200000"],
    ]);
    expect(issues({ longAbove: "abc", longInput: "4", longOutput: "16" })).toEqual([
      ["longAbove", "Tokens, a whole number like 200000"],
    ]);
  });

  it("leaves a model on no price list blocked when its price is cleared, never at cost 0", () => {
    const cleared = priceSchema.parse({ model: "openai:gpt-test", input: "", output: "" });
    expect(cleared).toMatchObject({ input: null, output: null });
    // Cleared: the owner's row goes, and the model has no price again.
    expect(priceFor(bookOf(), "openai:gpt-test")).toBeNull();
    expect(costIn(bookOf(), "openai:gpt-test", { input: 10, output: 5 })).toEqual({
      usd: 0,
      known: false,
    });
  });
});
