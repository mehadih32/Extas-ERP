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
import { ModelsTable } from "@/components/ai/models-table";
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
        notes: priceNotes(m),
        sourceUrl: m.sourceUrl,
        checkedOn: m.checkedOn,
        setBy: null,
        setAt: null,
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
    notes: [],
    sourceUrl: null,
    checkedOn: null,
    setBy: null,
    setAt: null,
  });
  priceSections[0]!.rows[1] = {
    ...priceSections[0]!.rows[1]!,
    state: "owner",
    input: "3",
    setBy: "Mehadi Hasan",
    setAt: new Date("2026-10-16T05:00:00Z"),
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
    expect(text).toContain("checked on 16 Oct 2026");
    // The second Claude row with the owner's input price; "—" where a provider has no such price.
    expect(text).toMatch(/Opus 5\.5.*\$3.*\$20.*\$0\.20.*\$5.*\$2.*\$10/);
    expect(text).toContain("—");
    // The owner's own price says so, and who set it.
    expect(text).toContain("Your price (Mehadi Hasan)");
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
