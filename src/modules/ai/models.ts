/*
 * Which model does which task (the ERP's own Claude models here; OpenAI and
 * Gemini models, read from the providers, in providers.ts). The owner's rule: the big model only for
 * thinking work, smaller ones for everything else; Fable 5.1 stays off until
 * the owner allows it for a very hard problem. The system's choices below can
 * be changed per task on AI Center > Models. Prices are US dollars per million
 * tokens, from the Claude price list (October 2026).
 */

export const AI_MODELS = [
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    size: "Big",
    input: 4,
    output: 20,
    cacheRead: 0.2,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    size: "Medium",
    input: 2,
    output: 10,
    cacheRead: 0.2,
  },
  {
    id: "claude-haiku-5-5",
    label: "Haiku 5.5",
    size: "Small",
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
  },
  {
    id: "claude-fable-5-1",
    label: "Fable 5.1",
    size: "Largest (off unless you allow it)",
    input: 10,
    output: 50,
    cacheRead: 0.25,
  },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]["id"];

export const MODEL_IDS = AI_MODELS.map((m) => m.id) as unknown as readonly [
  AiModelId,
  ...AiModelId[],
];

export const modelInfo = (id: string) => AI_MODELS.find((m) => m.id === id) ?? null;

/** Writing to the prompt cache costs a quarter more than plain input. */
export const CACHE_WRITE_FACTOR = 1.25;

/**
 * Haiku 5.5 costs more when a prompt is over 100K tokens ($0.50 / $2.50).
 * The ERP's prompts stay far below that; the higher price is used above it.
 */
const HAIKU_LONG = { above: 100_000, input: 0.5, output: 2.5 };

export type TokenUse = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/** What a call cost in US dollars, from its token counts. */
export function costUsd(model: string, use: TokenUse): number {
  const m = modelInfo(model);
  if (!m) return 0;
  const prompt = use.input + (use.cacheRead ?? 0) + (use.cacheWrite ?? 0);
  const long = m.id === "claude-haiku-5-5" && prompt > HAIKU_LONG.above;
  const input = long ? HAIKU_LONG.input : m.input;
  const output = long ? HAIKU_LONG.output : m.output;
  const dollars =
    use.input * input +
    use.output * output +
    (use.cacheRead ?? 0) * m.cacheRead +
    (use.cacheWrite ?? 0) * input * CACHE_WRITE_FACTOR;
  return dollars / 1_000_000;
}

export type AiTask = {
  key: string;
  label: string;
  /** The system's choice; the owner may change it on Models. */
  model: AiModelId;
  /** The ERP area it belongs to, for the cost breakdown. */
  module: string;
};

/** Every task the ERP gives the AI, in the order Models shows them. */
export const AI_TASKS = [
  // Thinking work: the big model.
  { key: "order.plan", label: "Order plan", model: "claude-opus-5-5", module: "Production" },
  { key: "decision.hard", label: "Hard decisions", model: "claude-opus-5-5", module: "AI" },
  {
    key: "techpack.draft",
    label: "Tech pack draft and design",
    model: "claude-opus-5-5",
    module: "Production",
  },
  {
    key: "booking.check",
    label: "Fabric and accessories booking checks",
    model: "claude-opus-5-5",
    module: "Production",
  },
  {
    key: "costing",
    label: "Costing and pricing",
    model: "claude-opus-5-5",
    module: "Production",
  },
  { key: "review.final", label: "Final review as CEO", model: "claude-opus-5-5", module: "AI" },
  // Writing: the medium model.
  {
    key: "message.draft",
    label: "Email and message drafts",
    model: "claude-sonnet-5-5",
    module: "Sales",
  },
  { key: "report.daily", label: "Daily report", model: "claude-sonnet-5-5", module: "AI" },
  {
    key: "text.write",
    label: "Report and document text (tech pack notes, contracts, summaries)",
    model: "claude-sonnet-5-5",
    module: "Reports",
  },
  { key: "chat", label: "Questions and answers", model: "claude-sonnet-5-5", module: "AI" },
  {
    key: "server.health",
    label: "Server Health report",
    model: "claude-sonnet-5-5",
    module: "AI",
  },
  {
    key: "knowledge.test",
    label: "Book tests (K1–K5 and X26)",
    model: "claude-sonnet-5-5",
    module: "AI",
  },
  // Small work: the small model.
  {
    key: "read.documents",
    label: "Reading forms, photos and packing lists",
    model: "claude-haiku-5-5",
    module: "Production",
  },
  {
    key: "read.updates",
    label: "Reading staff updates",
    model: "claude-haiku-5-5",
    module: "HR",
  },
  {
    key: "bot.command",
    label: "Understanding bot commands",
    model: "claude-haiku-5-5",
    module: "AI",
  },
  {
    key: "data.gather",
    label: "Gathering data and small checks",
    model: "claude-haiku-5-5",
    module: "AI",
  },
  {
    key: "help.answer",
    label: "Help questions",
    model: "claude-haiku-5-5",
    module: "AI",
  },
] as const satisfies readonly AiTask[];

export type AiTaskKey = (typeof AI_TASKS)[number]["key"];

export const TASK_KEYS = AI_TASKS.map((t) => t.key) as unknown as readonly [
  AiTaskKey,
  ...AiTaskKey[],
];

export const taskInfo = (key: string): AiTask | null => AI_TASKS.find((t) => t.key === key) ?? null;

/** A model the owner may pick: one of the ERP's own, or another provider's ("openai:…", modules/ai/providers.ts). */
const PICKABLE =
  /^((anthropic|openai|google):[A-Za-z0-9][A-Za-z0-9._\-/:@]{0,119}|claude-[A-Za-z0-9._\-]{1,100})$/;

/** The model a task runs on: the owner's choice (any provider), else the system's. */
export function modelFor(
  task: AiTaskKey,
  chosen: Readonly<Record<string, string>> | null | undefined,
  fableAllowed: boolean,
): string {
  const pick = chosen?.[task];
  const model = pick && (modelInfo(pick) || PICKABLE.test(pick)) ? pick : taskInfo(task)!.model;
  // Fable 5.1 only runs while the owner allows it; otherwise the task's own default.
  if (model === "claude-fable-5-1" && !fableAllowed) return taskInfo(task)!.model;
  return model;
}
