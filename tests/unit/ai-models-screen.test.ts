import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/actions/ai.actions", () => ({
  readProviderModelsAction: vi.fn(),
  runModelTestAction: vi.fn(),
  setAgentModelAction: vi.fn(),
  setFableAllowedAction: vi.fn(),
  setModelPriceAction: vi.fn(),
  setTaskModelAction: vi.fn(),
}));

import { BlockedModels } from "@/components/ai/blocked-models";
import { ModelsTable, PriceFormFields } from "@/components/ai/models-table";
import { PRICE_FIELDS, PRICE_LISTS, priceNotes } from "@/modules/ai/price-list";
import type { AiModelsScreen, PriceRow } from "@/modules/ai/settings.service";

/*
 * v6.4 F and A7 on the screen: AI Center > Models draws a section each for
 * Claude, OpenAI and Gemini with every price, where it came from and when it
 * was checked; a model with no price is marked "No price: blocked" and cannot
 * be picked; and the warning lists the blocked models that have work.
 */

const strings = (m: Record<string, unknown>) =>
  Object.fromEntries(PRICE_FIELDS.map((f) => [f, m[f] === null ? null : String(m[f])])) as Pick<
    PriceRow,
    (typeof PRICE_FIELDS)[number]
  >;

function screen(): AiModelsScreen {
  const priceSections = PRICE_LISTS.map((l) => ({
    provider: l.provider,
    label: l.label,
    sourceUrl: l.sourceUrl,
    checkedOn: l.checkedOn,
    rows: l.models
      .filter((m) => !m.older)
      .map((m): PriceRow => ({
        model: m.ref,
        label: m.label,
        id: m.ref.replace(/^\w+:/, ""),
        builtIn: false,
        size: null,
        inUse: false,
        state: "erp",
        ...strings(m),
        list: strings(m),
        long: m.long ? { above: String(m.long.above), ...strings(m.long) } : null,
        notes: priceNotes(m),
        sourceUrl: m.sourceUrl,
        checkedOn: m.checkedOn,
        setBy: null,
        setAt: null,
        source: null,
      })),
    older: [],
  }));
  priceSections[1]!.rows.push({
    model: "openai:gpt-test",
    label: "gpt-test (OpenAI)",
    id: "gpt-test",
    builtIn: false,
    size: null,
    inUse: true,
    state: "blocked",
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    batchInput: null,
    batchOutput: null,
    list: null,
    long: null,
    notes: [],
    sourceUrl: null,
    checkedOn: null,
    setBy: null,
    setAt: null,
    source: null,
  });
  priceSections[0]!.rows[1] = {
    ...priceSections[0]!.rows[1]!,
    state: "owner",
    input: "3",
    setBy: "Mehadi Hasan",
    setAt: new Date("2026-10-16T05:00:00Z"),
    source: "https://platform.claude.com/docs/en/about-claude/pricing#opus",
  };
  return {
    allowFable: false,
    tasks: [
      {
        key: "chat",
        label: "Questions and answers",
        module: "AI",
        system: "claude-sonnet-5-5",
        chosen: "openai:gpt-test",
        runsOn: "openai:gpt-test",
        runsOnLabel: "gpt-test (OpenAI)",
        blocked: true,
        test: { state: "NONE", text: "Not tested", last: null },
      },
    ],
    agents: [],
    providers: [
      {
        id: "openai",
        label: "OpenAI",
        hasKey: true,
        readAt: "2026-10-16T00:00:00Z",
        models: [
          { ref: "openai:gpt-6.1-sol", label: "gpt-6.1-sol", priced: true },
          { ref: "openai:gpt-test", label: "gpt-test", priced: false },
        ],
      },
    ],
    priceSections,
    blocked: [
      { model: "openai:gpt-test", label: "gpt-test (OpenAI)", where: ["Questions and answers"] },
    ],
    can: { manage: true },
  } as unknown as AiModelsScreen;
}

describe("AI Center > Models", () => {
  const html = renderToStaticMarkup(createElement(ModelsTable, { models: screen() }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");

  it("has a section each for Claude, OpenAI and Gemini with every price, where from and when", () => {
    for (const id of ["anthropic", "openai", "google"]) {
      expect(html).toContain(`id="ai-prices-${id}-heading"`);
    }
    for (const heading of [
      "Input",
      "Output",
      "Cache read",
      "Cache write",
      "Batch input",
      "Batch output",
      "Where from",
      "Checked on",
    ]) {
      expect(text).toContain(heading);
    }
    expect(html).toContain('href="https://platform.claude.com/docs/en/about-claude/pricing"');
    expect(html).toContain('href="https://developers.openai.com/api/docs/pricing"');
    expect(html).toContain('href="https://ai.google.dev/gemini-api/docs/pricing"');
    expect(text).toContain("Anthropic's price page");
    expect(text).toContain("checked on 18 Oct 2026");
    expect(text).toContain("checked on 16 Oct 2026");
    // The second Claude row with the owner's input price; "—" where a provider has no such price.
    expect(text).toMatch(/Opus 5\.5.*\$3.*\$20.*\$0\.20.*\$5.*\$2.*\$10/);
    expect(text).toContain("—");
    // The owner's own price says so, who set it, and where it came from (a link).
    expect(text).toContain("Your price (Mehadi Hasan)");
    expect(html).toContain('href="https://platform.claude.com/docs/en/about-claude/pricing#opus"');
    // Haiku 5.5's long-prompt prices are in its row.
    expect(text).toContain("Prompts over 100,000 tokens: $0.50 input, $2.50 output");
    expect(html.match(/>Edit</g)?.length).toBeGreaterThan(10);
  });

  it("marks a model with no price as blocked, and will not let it be picked", () => {
    expect(text).toContain("No price: blocked");
    expect(html).toMatch(
      /<option value="openai:gpt-test" disabled=""[^>]*>gpt-test[^<]*No price: blocked/,
    );
    expect(html).toMatch(/<option value="openai:gpt-6.1-sol">gpt-6.1-sol<\/option>/);
    expect(text).toContain("A model with no price is blocked");
  });

  it("warns about blocked models that have work, with a link on AI Home", () => {
    const blocked = [
      { model: "openai:gpt-test", label: "gpt-test (OpenAI)", where: ["Questions and answers"] },
    ];
    const home = renderToStaticMarkup(createElement(BlockedModels, { blocked, link: true }));
    expect(home).toContain('role="alert"');
    expect(home).toContain("gpt-test (OpenAI)");
    expect(home).toContain("Questions and answers");
    expect(home).toContain('href="/ai/models#ai-prices-heading"');
    expect(renderToStaticMarkup(createElement(BlockedModels, { blocked: [] }))).toBe("");
  });
});

describe("the price form (v6.4.1 C4)", () => {
  const m = screen();
  const rowOf = (ref: string) =>
    m.priceSections.flatMap((x) => x.rows).find((r) => r.model === ref)!;
  const form = (now: PriceRow | undefined, pickModel = false) =>
    renderToStaticMarkup(
      createElement(PriceFormFields, {
        m,
        now,
        pickModel,
        day: () => "16 Oct 2026",
        fieldError: () => undefined,
      }),
    );
  const valueOf = (html: string, name: string) =>
    new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1] ?? "";

  it("starts from the prices that hold now, long-prompt ones included, so one change keeps the rest", () => {
    const html = form(rowOf("claude-haiku-5-5"));
    expect(valueOf(html, "input")).toBe("0.1");
    expect(valueOf(html, "cacheRead")).toBe("0.01");
    expect(valueOf(html, "batchOutput")).toBe("0.25");
    expect(valueOf(html, "longAbove")).toBe("100000");
    expect(valueOf(html, "longInput")).toBe("0.5");
    expect(valueOf(html, "longOutput")).toBe("2.5");
    expect(valueOf(html, "longCacheWrite")).toBe("0.625");
    expect(html).toContain("Long prompts over, tokens");
    expect(html).toContain("Long input, $ per million");
  });

  it("asks where the price came from, empty for a new one", () => {
    const html = form(rowOf("claude-opus-5-5"));
    expect(html).toContain('name="source"');
    expect(valueOf(html, "source")).toBe("");
    expect(html).toContain("Where from");
    expect(html).toContain("Empty: typed by you, with today&#x27;s date.");
    // The owner's price says who set it, when, and where from.
    expect(html).toContain(
      "Your price, set by Mehadi Hasan on 16 Oct 2026 (from: https://platform.claude.com/docs/en/about-claude/pricing#opus).",
    );
  });

  it("starts empty for a model with no price, and lets the model be picked", () => {
    const html = form(undefined, true);
    expect(html).toContain('name="model"');
    expect(valueOf(html, "input")).toBe("");
    expect(valueOf(html, "longAbove")).toBe("");
  });
});
