import type Anthropic from "@anthropic-ai/sdk";

import { type AiTaskKey, AI_TASKS } from "./models";

/*
 * The test each AI task gives a model before that model may do the task on
 * Do (AI Center > Models, "Run the test"). Tool use, sums and Bengali differ
 * between providers, so a model that is not one of the ERP's own Claude
 * models must first answer its task's questions right: every question, every
 * time it is chosen anew (a pass counts while the test stays the same). The
 * questions are the ERP's everyday work in small (a booking check, an FOB, a
 * Bengali note to the factory, a packing list, a bot message), each marked by
 * the ERP itself, not by another AI. Plain data and functions.
 */

export type TestAsk = {
  system?: string;
  prompt: string;
  tools?: Anthropic.Tool[];
  maxTokens: number;
};

export type TestMark = { ok: boolean; why: string; answer: string };

export type TestCase = {
  id: string;
  title: string;
  ask: TestAsk;
  mark: (message: Anthropic.Message) => TestMark;
};

const textOf = (m: Anthropic.Message) =>
  m.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();

function toolCall(m: Anthropic.Message, name: string): Record<string, unknown> | null {
  const call = m.content.find((b) => b.type === "tool_use" && b.name === name);
  return call && call.type === "tool_use" && call.input && typeof call.input === "object"
    ? (call.input as Record<string, unknown>)
    : null;
}

const shown = (value: unknown) => JSON.stringify(value).slice(0, 300);

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);

const near = (v: unknown, want: number, within: number) => Math.abs(num(v) - want) <= within;

/** Share of letters that are Bengali (Bangla script). */
function bengaliShare(text: string) {
  let bengali = 0;
  let letters = 0;
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      letters += 1;
      if (/[ঀ-৿]/.test(ch)) bengali += 1;
    }
  }
  return letters ? bengali / letters : 0;
}

const BENGALI_DIGITS = /[০-৯]/;

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required = Object.keys(properties),
): Anthropic.Tool => ({
  name,
  description,
  input_schema: { type: "object", properties, required } as Anthropic.Tool.InputSchema,
});

function byTool(
  name: string,
  test: (input: Record<string, unknown>) => string | null,
): TestCase["mark"] {
  return (m) => {
    const input = toolCall(m, name);
    if (!input) {
      return { ok: false, why: `It did not call ${name}.`, answer: textOf(m).slice(0, 300) };
    }
    const wrong = test(input);
    return { ok: wrong === null, why: wrong ?? "Right.", answer: shown(input) };
  };
}

const WRITE_BENGALI =
  "Write in Bengali (Bangla script). Write numbers, dates and order numbers in Western digits (0-9), never Bengali digits. Keep codes like EX-101 as they are.";

export const TEST_CASES: Record<string, TestCase> = {
  "tool-booking": {
    id: "tool-booking",
    title: "Fabric booking check with a tool",
    ask: {
      prompt:
        "Order EX-101 has 1,200 pieces. Fabric use is 0.25 kg per piece, plus 5% wastage. The fabric booking is for 300 kg. Work out the fabric needed in kg and whether the booking is enough. Answer only by calling record_check.",
      tools: [
        tool("record_check", "Records a fabric booking check.", {
          fabricKgNeeded: { type: "number", description: "Fabric needed, in kg" },
          enough: { type: "boolean", description: "Whether the booking covers it" },
        }),
      ],
      maxTokens: 600,
    },
    mark: byTool("record_check", (i) =>
      !near(i.fabricKgNeeded, 315, 0.5)
        ? `Fabric needed should be 315 kg, not ${shown(i.fabricKgNeeded)}.`
        : i.enough !== false
          ? "300 kg is not enough for 315 kg."
          : null,
    ),
  },
  "tool-lookup": {
    id: "tool-lookup",
    title: "Looks a record up instead of guessing",
    ask: {
      system:
        "You work inside an apparel ERP. Never guess facts about records: look them up with the tools.",
      prompt: "When is order PO-2026-00042 due for delivery?",
      tools: [
        tool("find_order", "Finds a sales or production order by its number.", {
          number: { type: "string", description: "The order number, like PO-2026-00001" },
        }),
        tool("find_party", "Finds a buyer or supplier by name.", {
          name: { type: "string" },
        }),
      ],
      maxTokens: 400,
    },
    mark: byTool("find_order", (i) =>
      String(i.number ?? "").includes("PO-2026-00042")
        ? null
        : `It looked up ${shown(i.number)}, not PO-2026-00042.`,
    ),
  },
  "numbers-fob": {
    id: "numbers-fob",
    title: "FOB price from fabric, CM, trims and profit",
    ask: {
      prompt:
        "Fabric costs USD 2.80 per kg and each piece uses 0.32 kg. CM is USD 0.55 per piece and trims are USD 0.12 per piece. Profit is 12% on the cost. What is the FOB price per piece in USD? Call answer with the price rounded to 2 decimals.",
      tools: [tool("answer", "Gives the answer.", { fobPerPiece: { type: "number" } })],
      maxTokens: 800,
    },
    mark: byTool("answer", (i) =>
      near(i.fobPerPiece, 1.75, 0.011) ? null : `FOB should be 1.75, not ${shown(i.fobPerPiece)}.`,
    ),
  },
  "numbers-cm": {
    id: "numbers-cm",
    title: "CM per piece and for the order",
    ask: {
      prompt:
        "The factory's CM is USD 6.60 per dozen. The order has 3,000 pieces. What is the CM per piece and the CM for the whole order, in USD? Call answer.",
      tools: [
        tool("answer", "Gives the answer.", {
          perPieceUsd: { type: "number" },
          totalUsd: { type: "number" },
        }),
      ],
      maxTokens: 800,
    },
    mark: byTool("answer", (i) =>
      !near(i.perPieceUsd, 0.55, 0.005)
        ? `CM per piece should be 0.55, not ${shown(i.perPieceUsd)}.`
        : !near(i.totalUsd, 1650, 1)
          ? `The order's CM should be 1650, not ${shown(i.totalUsd)}.`
          : null,
    ),
  },
  "bengali-factory": {
    id: "bengali-factory",
    title: "A Bengali note to the factory",
    ask: {
      system: WRITE_BENGALI,
      prompt:
        "Write two short sentences to the factory: the fabric for order EX-101 arrives on 20 October, and cutting can start on 22 October.",
      maxTokens: 600,
    },
    mark: (m) => {
      const text = textOf(m);
      const why =
        bengaliShare(text) < 0.5
          ? "It is not written in Bengali."
          : BENGALI_DIGITS.test(text)
            ? "It used Bengali digits; the ERP writes Western digits."
            : !text.includes("EX-101")
              ? "The order number EX-101 is missing."
              : !/\b20\b/.test(text) || !/\b22\b/.test(text)
                ? "The dates 20 and 22 are missing."
                : null;
      return { ok: why === null, why: why ?? "Right.", answer: text.slice(0, 300) };
    },
  },
  "english-buyer": {
    id: "english-buyer",
    title: "A short, exact email to a buyer",
    ask: {
      system: "Write plain, short business English. Say only what you are asked to say.",
      prompt:
        "Write a two-sentence email to the buyer: the shipment of order PO-2026-00042 leaves Chittagong on 5 November. Do not promise anything else.",
      maxTokens: 600,
    },
    mark: (m) => {
      const text = textOf(m);
      const why =
        bengaliShare(text) > 0.1
          ? "It is not in English."
          : !text.includes("PO-2026-00042")
            ? "The order number is missing."
            : !/\b5\b/.test(text) || !/November/i.test(text)
              ? "The date 5 November is missing."
              : text.length > 700
                ? "It is far longer than two sentences."
                : null;
      return { ok: why === null, why: why ?? "Right.", answer: text.slice(0, 300) };
    },
  },
  "reading-packing": {
    id: "reading-packing",
    title: "Reads a packing list",
    ask: {
      prompt: [
        "Read this packing list and record the number of cartons and the total pieces.",
        "",
        "PACKING LIST - Order EX-205",
        "Carton 1-10: 24 pcs each (S 6, M 6, L 6, XL 6)",
        "Carton 11-15: 20 pcs each (S 5, M 5, L 5, XL 5)",
        "Carton 16: 13 pcs (mixed sizes)",
      ].join("\n"),
      tools: [
        tool("record_packing", "Records a packing list.", {
          cartons: { type: "number" },
          totalPieces: { type: "number" },
        }),
      ],
      maxTokens: 600,
    },
    mark: byTool("record_packing", (i) =>
      num(i.cartons) !== 16
        ? `Cartons should be 16, not ${shown(i.cartons)}.`
        : num(i.totalPieces) !== 353
          ? `Total pieces should be 353, not ${shown(i.totalPieces)}.`
          : null,
    ),
  },
  "reading-invoice": {
    id: "reading-invoice",
    title: "Reads a supplier's invoice",
    ask: {
      prompt:
        "Invoice INV-77 from Rahim Trims: 5,000 buttons at BDT 0.80 each and 2,000 care labels at BDT 1.50 each. Record the supplier and the invoice total in BDT.",
      tools: [
        tool("record_invoice", "Records a supplier invoice.", {
          supplier: { type: "string" },
          totalBdt: { type: "number" },
        }),
      ],
      maxTokens: 600,
    },
    mark: byTool("record_invoice", (i) =>
      !/rahim/i.test(String(i.supplier ?? ""))
        ? `The supplier should be Rahim Trims, not ${shown(i.supplier)}.`
        : !near(i.totalBdt, 7000, 0.5)
          ? `The total should be 7000, not ${shown(i.totalBdt)}.`
          : null,
    ),
  },
  "reading-update": {
    id: "reading-update",
    title: "Reads a staff update in Bengali",
    ask: {
      prompt:
        'A staff member wrote: "অর্ডার EX-101 এর আজ 450 পিস সেলাই হয়েছে, 30 পিস রিজেক্ট।" Record the order, the pieces sewn and the pieces rejected.',
      tools: [
        tool("record_update", "Records a production update.", {
          order: { type: "string" },
          sewn: { type: "number" },
          rejected: { type: "number" },
        }),
      ],
      maxTokens: 600,
    },
    mark: byTool("record_update", (i) =>
      !String(i.order ?? "").includes("EX-101")
        ? `The order should be EX-101, not ${shown(i.order)}.`
        : num(i.sewn) !== 450
          ? `Sewn should be 450, not ${shown(i.sewn)}.`
          : num(i.rejected) !== 30
            ? `Rejected should be 30, not ${shown(i.rejected)}.`
            : null,
    ),
  },
  "intent-sales": {
    id: "intent-sales",
    title: "Understands a bot question",
    ask: {
      system:
        "You sort the owner's bot messages. sales_today: today's sales; stock: stock levels; send_draft: send a prepared draft; pause_ai: stop the AI; other: anything else.",
      prompt: 'Bot message: "আজকের বিক্রি কত?"',
      tools: [
        tool("pick_intent", "Picks what the message asks for.", {
          intent: {
            type: "string",
            enum: ["sales_today", "stock", "send_draft", "pause_ai", "other"],
          },
        }),
      ],
      maxTokens: 300,
    },
    mark: byTool("pick_intent", (i) =>
      i.intent === "sales_today" ? null : `It should be sales_today, not ${shown(i.intent)}.`,
    ),
  },
  "intent-stop": {
    id: "intent-stop",
    title: 'Understands "stop everything" on the bot',
    ask: {
      system:
        "You sort the owner's bot messages. sales_today: today's sales; stock: stock levels; send_draft: send a prepared draft; pause_ai: stop the AI; other: anything else.",
      prompt: 'Bot message: "সব বন্ধ করো, AI এখন কিছু করবে না"',
      tools: [
        tool("pick_intent", "Picks what the message asks for.", {
          intent: {
            type: "string",
            enum: ["sales_today", "stock", "send_draft", "pause_ai", "other"],
          },
        }),
      ],
      maxTokens: 300,
    },
    mark: byTool("pick_intent", (i) =>
      i.intent === "pause_ai" ? null : `It should be pause_ai, not ${shown(i.intent)}.`,
    ),
  },
  "grading-wrong": {
    id: "grading-wrong",
    title: "Marks a wrong answer wrong",
    ask: {
      prompt:
        "Expected answer: CM is fixed per style with the factory. Answer given: CM is worked out from the SMV times the minute rate. Does the answer given say the same as the expected one? Call grade.",
      tools: [tool("grade", "Marks the answer.", { right: { type: "boolean" } })],
      maxTokens: 400,
    },
    mark: byTool("grade", (i) => (i.right === false ? null : "That answer is wrong.")),
  },
  "grading-right": {
    id: "grading-right",
    title: "Marks a right answer right",
    ask: {
      prompt:
        "Expected answer: Profit % is set per order. Answer given: The profit percentage is decided for each order on its own. Does the answer given say the same as the expected one? Call grade.",
      tools: [tool("grade", "Marks the answer.", { right: { type: "boolean" } })],
      maxTokens: 400,
    },
    mark: byTool("grade", (i) => (i.right === true ? null : "That answer is right.")),
  },
  "bengali-help": {
    id: "bengali-help",
    title: "Answers a help question in Bengali",
    ask: {
      system: `You answer questions about the ERP from its guide. ${WRITE_BENGALI} Quote the ERP's button names in English as they are.`,
      prompt:
        'Guide: "Open Parties, press New party, pick Buyer, fill in the name and press Save." Question: How do I add a new buyer?',
      maxTokens: 600,
    },
    mark: (m) => {
      const text = textOf(m);
      const why =
        bengaliShare(text) < 0.4
          ? "It is not written in Bengali."
          : !text.includes("Save")
            ? "It does not name the Save button."
            : !text.includes("New party")
              ? "It does not name New party."
              : null;
      return { ok: why === null, why: why ?? "Right.", answer: text.slice(0, 300) };
    },
  },
};

/** The questions of each task's test. */
export const TASK_TESTS: Record<AiTaskKey, readonly string[]> = {
  "order.plan": ["tool-booking", "numbers-fob"],
  "decision.hard": ["tool-lookup", "numbers-fob"],
  "techpack.draft": ["tool-booking", "tool-lookup"],
  "booking.check": ["tool-booking", "reading-packing"],
  costing: ["numbers-fob", "numbers-cm"],
  "review.final": ["tool-booking", "grading-wrong"],
  "message.draft": ["bengali-factory", "english-buyer"],
  "report.daily": ["bengali-factory", "english-buyer"],
  "text.write": ["english-buyer", "bengali-factory"],
  chat: ["tool-lookup", "bengali-factory"],
  "server.health": ["tool-lookup", "english-buyer"],
  "knowledge.test": ["grading-wrong", "grading-right"],
  "read.documents": ["reading-packing", "reading-invoice"],
  "read.updates": ["reading-update", "intent-sales"],
  "bot.command": ["intent-sales", "intent-stop"],
  "data.gather": ["tool-lookup", "reading-packing"],
  "help.answer": ["bengali-help", "bengali-factory"],
};

/** The test's version: a pass counts while its questions stay the same. */
export const testVersion = (task: AiTaskKey) => `v1:${TASK_TESTS[task].join(",")}`;

export const testCasesOf = (task: AiTaskKey): TestCase[] =>
  TASK_TESTS[task].map((id) => TEST_CASES[id]!);

/**
 * The tasks an action's AI work runs on, whose models must have passed before
 * the action is Do: the chat and the bot for everything (the owner can ask
 * there), and the area's own work.
 */
export function tasksFor(key: string): AiTaskKey[] {
  const base: AiTaskKey[] = ["chat", "bot.command", "decision.hard"];
  if (/^(ai\.production\.|production\.|materials\.|costing\.|inventory\.)/.test(key)) {
    return [...base, "order.plan", "costing", "booking.check", "techpack.draft", "review.final"];
  }
  if (/^(ai\.buyer\.|ai\.sales\.|sales\.|parties\.)/.test(key)) {
    return [...base, "message.draft", "costing"];
  }
  if (/^(accounts\.|expenses\.)/.test(key)) return [...base, "data.gather", "read.documents"];
  if (/^(ai\.hr\.|hr\.)/.test(key)) return [...base, "read.updates", "text.write"];
  if (/^(ai\.reports\.|reports\.)/.test(key)) return [...base, "report.daily", "text.write"];
  return base;
}

export const TASK_LABELS: Record<string, string> = Object.fromEntries(
  AI_TASKS.map((t) => [t.key, t.label]),
);
