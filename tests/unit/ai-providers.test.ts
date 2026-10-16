import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { AI_TASKS, costUsd } from "@/modules/ai/models";
import { TASK_TESTS, TEST_CASES, tasksFor, testVersion } from "@/modules/ai/model-tests";
import { costIn, type PriceBook } from "@/modules/ai/prices.service";
import {
  fromGemini,
  fromOpenAI,
  geminiSchema,
  ProviderError,
  toGemini,
  toOpenAI,
} from "@/modules/ai/provider-calls";
import { isBuiltIn, modelLabel, modelRef, parseModel, providerOf } from "@/modules/ai/providers";

import { claudeMessage } from "../fixtures/claude";

/*
 * v6.3 D: Claude, OpenAI and Gemini behind one door. Model names, the
 * translation of a Claude request to OpenAI's and Gemini's and of their answers
 * back, the prices ("price unknown", never a guess) and the model tests'
 * marking.
 */

const BOOK: PriceBook = new Map([
  ["claude-sonnet-5-5", { input: 2, output: 10, cacheRead: 0.2, from: "erp" as const }],
  ["openai:gpt-test", { input: 1.25, output: 10, cacheRead: null, from: "owner" as const }],
]);

describe("model names", () => {
  it("names every model by one string, the ERP's own Claude models bare", () => {
    expect(parseModel("claude-sonnet-5-5")).toEqual({
      provider: "anthropic",
      id: "claude-sonnet-5-5",
    });
    expect(parseModel("openai:gpt-5")).toEqual({ provider: "openai", id: "gpt-5" });
    expect(parseModel("google:gemini-2.5-pro")).toEqual({
      provider: "google",
      id: "gemini-2.5-pro",
    });
    expect(parseModel("anthropic:claude-x")).toEqual({ provider: "anthropic", id: "claude-x" });
    expect(parseModel("mistral:large")).toBeNull();
    expect(parseModel("gpt-5")).toBeNull();
    expect(parseModel("openai:bad name")).toBeNull();
    expect(modelRef("anthropic", "claude-test-next")).toBe("claude-test-next");
    expect(modelRef("openai", "gpt-5")).toBe("openai:gpt-5");
    expect(providerOf("google:gemini-x")).toBe("google");
    expect(providerOf("claude-opus-5-5")).toBe("anthropic");
    expect(isBuiltIn("claude-haiku-5-5")).toBe(true);
    expect(isBuiltIn("claude-test-next")).toBe(false);
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("openai:gpt-5")).toBe("gpt-5 (OpenAI)");
    expect(modelLabel("google:gemini-test", [{ id: "gemini-test", label: "Gemini Test" }])).toBe(
      "Gemini Test (Gemini)",
    );
  });
});

const BODY: Anthropic.MessageCreateParamsNonStreaming = {
  model: "gpt-test",
  max_tokens: 500,
  system: [{ type: "text", text: "Book one.", cache_control: { type: "ephemeral" } }],
  tools: [
    {
      name: "record_check",
      description: "Records a check.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        $schema: "http://json-schema.org/draft-07/schema#",
        properties: {
          kg: { type: "number" },
          note: { type: ["string", "null"] },
          kind: { type: "string", enum: ["a", "b", null] },
        },
        required: ["kg"],
      } as unknown as Anthropic.Tool.InputSchema,
    },
  ],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Check this." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0K" } },
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: "JVBERi0" },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Looking." },
        { type: "tool_use", id: "toolu_1", name: "record_check", input: { kg: 315 } },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [{ type: "text", text: "Saved." }],
        },
        { type: "text", text: "Now say done." },
      ],
    },
  ],
};

describe("OpenAI", () => {
  it("turns a Claude request into a Chat Completions request", () => {
    const out = toOpenAI(BODY) as Record<string, unknown>;
    expect(out).toMatchObject({ model: "gpt-test", max_completion_tokens: 500 });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.messages).toEqual([
      { role: "system", content: "Book one." },
      {
        role: "user",
        content: [
          { type: "text", text: "Check this." },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0K" } },
          {
            type: "file",
            file: { filename: "document.pdf", file_data: "data:application/pdf;base64,JVBERi0" },
          },
        ],
      },
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [
          {
            id: "toolu_1",
            type: "function",
            function: { name: "record_check", arguments: '{"kg":315}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "toolu_1", content: "Saved." },
      { role: "user", content: "Now say done." },
    ]);
    expect((out.tools as Array<{ function: { name: string } }>)[0]!.function.name).toBe(
      "record_check",
    );
    // Reasoning models get their own room to think, and the effort.
    const reasoning = toOpenAI({
      ...BODY,
      model: "gpt-5",
      output_config: { effort: "low" },
    } as Anthropic.MessageCreateParamsNonStreaming) as Record<string, unknown>;
    expect(reasoning).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 500 + 8192 });
  });

  it("turns an OpenAI answer into a Claude message", () => {
    const message = fromOpenAI(
      {
        id: "chatcmpl-1",
        model: "gpt-test-2026",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "Checking.",
              tool_calls: [
                {
                  id: "call_9",
                  type: "function",
                  function: { name: "record_check", arguments: '{"kg":315}' },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 80,
          prompt_tokens_details: { cached_tokens: 400 },
        },
      },
      "gpt-test",
    );
    expect(message.stop_reason).toBe("tool_use");
    expect(message.content).toEqual([
      { type: "text", text: "Checking.", citations: null },
      { type: "tool_use", id: "call_9", name: "record_check", input: { kg: 315 } },
    ]);
    expect(message.usage).toMatchObject({
      input_tokens: 600,
      output_tokens: 80,
      cache_read_input_tokens: 400,
    });
    expect(() => fromOpenAI({ choices: [] }, "gpt-test")).toThrow(ProviderError);
  });
});

describe("Gemini", () => {
  it("turns a Claude request into a generateContent request", () => {
    const out = toGemini({ ...BODY, model: "gemini-test" }) as Record<string, unknown>;
    expect(out.systemInstruction).toEqual({ parts: [{ text: "Book one." }] });
    expect(out.generationConfig).toEqual({ maxOutputTokens: 500 });
    expect(out.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "Check this." },
          { inlineData: { mimeType: "image/png", data: "iVBORw0K" } },
          { inlineData: { mimeType: "application/pdf", data: "JVBERi0" } },
        ],
      },
      {
        role: "model",
        parts: [
          { text: "Looking." },
          { functionCall: { name: "record_check", args: { kg: 315 } } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "record_check", response: { content: "Saved." } } },
          { text: "Now say done." },
        ],
      },
    ]);
    const declared = (
      out.tools as Array<{ functionDeclarations: Array<{ parameters: unknown }> }>
    )[0]!.functionDeclarations[0]!.parameters;
    expect(declared).toEqual({
      type: "object",
      properties: {
        kg: { type: "number" },
        note: { type: "string", nullable: true },
        kind: { type: "string", enum: ["a", "b"] },
      },
      required: ["kg"],
    });
    expect(geminiSchema({ type: "object", additionalProperties: true })).toEqual({
      type: "object",
    });
    // Thinking models get room to think; Gemini 3 needs a signature on each call it made.
    const g3 = toGemini({ ...BODY, model: "gemini-3-pro" }) as {
      generationConfig: { maxOutputTokens: number };
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    expect(g3.generationConfig.maxOutputTokens).toBe(500 + 8192);
    expect(g3.contents[1]!.parts[1]!.thoughtSignature).toBe("skip_thought_signature_validator");
  });

  it("turns a Gemini answer into a Claude message, keeping the call's signature", () => {
    const message = fromGemini(
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "thinking…", thought: true },
                { text: "Checking." },
                {
                  functionCall: { name: "record_check", args: { kg: 315 } },
                  thoughtSignature: "sig-abc",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 900,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 50,
          cachedContentTokenCount: 300,
        },
      },
      "gemini-3-pro",
    );
    expect(message.stop_reason).toBe("tool_use");
    expect(message.content[0]).toMatchObject({ type: "text", text: "Checking." });
    const call = message.content[1] as Anthropic.ToolUseBlock;
    expect(call).toMatchObject({ type: "tool_use", name: "record_check", input: { kg: 315 } });
    expect(message.usage).toMatchObject({
      input_tokens: 600,
      output_tokens: 150,
      cache_read_input_tokens: 300,
    });
    // The signature goes back with the call on the next turn.
    const next = toGemini({
      model: "gemini-3-pro",
      max_tokens: 100,
      messages: [
        { role: "user", content: "Check." },
        { role: "assistant", content: [call] },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: call.id, content: "Saved." }],
        },
      ],
    }) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    expect(next.contents[1]!.parts[0]!.thoughtSignature).toBe("sig-abc");
    expect(next.contents[2]!.parts[0]).toEqual({
      functionResponse: { name: "record_check", response: { content: "Saved." } },
    });
    expect(() => fromGemini({ promptFeedback: { blockReason: "SAFETY" } }, "gemini-test")).toThrow(
      /refused the request \(SAFETY\)/,
    );
  });
});

describe("prices", () => {
  it("uses the price list for the ERP's own models, the owner's for others, and never guesses", () => {
    const use = { input: 10_000, output: 2_000, cacheRead: 5_000 };
    expect(costIn(BOOK, "claude-sonnet-5-5", use)).toEqual({
      usd: costUsd("claude-sonnet-5-5", use),
      known: true,
    });
    // 10,000 × 1.25 + 2,000 × 10 + 5,000 × 1.25 (cache read as reading) per million.
    expect(costIn(BOOK, "openai:gpt-test", use).usd).toBeCloseTo(0.03875, 8);
    expect(costIn(BOOK, "google:gemini-x", use)).toEqual({ usd: 0, known: false });
    // A failed call used nothing: nothing unknown about it.
    expect(costIn(BOOK, "google:gemini-x", { input: 0, output: 0 })).toEqual({
      usd: 0,
      known: true,
    });
  });
});

describe("model tests", () => {
  it("gives every task a test of questions the ERP marks itself", () => {
    for (const t of AI_TASKS) {
      expect(TASK_TESTS[t.key].length, t.key).toBeGreaterThanOrEqual(2);
      for (const id of TASK_TESTS[t.key]) expect(TEST_CASES[id], id).toBeDefined();
      expect(testVersion(t.key)).toContain(TASK_TESTS[t.key][0]);
    }
    expect(tasksFor("production.bookings.supplier")).toEqual(
      expect.arrayContaining(["chat", "bot.command", "booking.check", "costing"]),
    );
    expect(tasksFor("ai.buyer.reply")).toContain("message.draft");
    expect(tasksFor("accounts.view")).toContain("read.documents");
    expect(tasksFor("hr.view")).toContain("read.updates");
  });

  const tool = (name: string, input: unknown) =>
    claudeMessage([{ type: "tool_use", id: "t1", name, input } as Anthropic.ContentBlock]);

  const RIGHT: Record<string, Anthropic.Message> = {
    "tool-booking": tool("record_check", { fabricKgNeeded: 315, enough: false }),
    "tool-lookup": tool("find_order", { number: "PO-2026-00042" }),
    "numbers-fob": tool("answer", { fobPerPiece: 1.75 }),
    "numbers-cm": tool("answer", { perPieceUsd: 0.55, totalUsd: 1650 }),
    "bengali-factory": claudeMessage(
      "অর্ডার EX-101 এর ফ্যাব্রিক 20 অক্টোবর পৌঁছাবে। কাটিং 22 অক্টোবর থেকে শুরু করা যাবে।",
    ),
    "english-buyer": claudeMessage(
      "Dear buyer, the shipment of order PO-2026-00042 leaves Chittagong on 5 November. Best regards.",
    ),
    "reading-packing": tool("record_packing", { cartons: 16, totalPieces: 353 }),
    "reading-invoice": tool("record_invoice", { supplier: "Rahim Trims", totalBdt: 7000 }),
    "reading-update": tool("record_update", { order: "EX-101", sewn: 450, rejected: 30 }),
    "intent-sales": tool("pick_intent", { intent: "sales_today" }),
    "intent-stop": tool("pick_intent", { intent: "pause_ai" }),
    "grading-wrong": tool("grade", { right: false }),
    "grading-right": tool("grade", { right: true }),
    "bengali-help": claudeMessage(
      "Parties খুলে New party চাপুন, Buyer বেছে নিন, নাম লিখে Save চাপুন।",
    ),
  };

  const WRONG: Record<string, Anthropic.Message> = {
    "tool-booking": tool("record_check", { fabricKgNeeded: 300, enough: true }),
    "tool-lookup": claudeMessage("It is due on 12 November."),
    "numbers-fob": tool("answer", { fobPerPiece: 1.57 }),
    "numbers-cm": tool("answer", { perPieceUsd: 6.6, totalUsd: 19800 }),
    "bengali-factory": claudeMessage(
      "অর্ডার EX-101 এর ফ্যাব্রিক ২০ অক্টোবর পৌঁছাবে, কাটিং ২২ অক্টোবর।",
    ),
    "english-buyer": claudeMessage("The shipment leaves soon."),
    "reading-packing": tool("record_packing", { cartons: 16, totalPieces: 340 }),
    "reading-invoice": tool("record_invoice", { supplier: "Rahim Trims", totalBdt: 4000 }),
    "reading-update": tool("record_update", { order: "EX-101", sewn: 480, rejected: 30 }),
    "intent-sales": tool("pick_intent", { intent: "stock" }),
    "intent-stop": tool("pick_intent", { intent: "other" }),
    "grading-wrong": tool("grade", { right: true }),
    "grading-right": tool("grade", { right: false }),
    "bengali-help": claudeMessage("Open Parties, press New party and Save."),
  };

  it("marks right answers right and wrong ones wrong, saying why", () => {
    for (const [id, c] of Object.entries(TEST_CASES)) {
      expect(c.mark(RIGHT[id]!), `${id} right`).toMatchObject({ ok: true });
      const wrong = c.mark(WRONG[id]!);
      expect(wrong.ok, `${id} wrong`).toBe(false);
      expect(wrong.why.length).toBeGreaterThan(5);
    }
    expect(TEST_CASES["bengali-factory"]!.mark(WRONG["bengali-factory"]!).why).toMatch(
      /Bengali digits/,
    );
    expect(TEST_CASES["tool-lookup"]!.mark(WRONG["tool-lookup"]!).why).toMatch(
      /did not call find_order/,
    );
  });
});
