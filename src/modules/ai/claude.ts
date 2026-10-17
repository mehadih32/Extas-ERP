import Anthropic from "@anthropic-ai/sdk";
import type { AiSettings } from "@prisma/client";

import { AppError } from "@/lib/errors";

import { agentKeyOf, aiAgents } from "./agents";
import type { AiRecord } from "./control.service";
import { type AiTaskKey, taskInfo } from "./models";
import { blockedText, priceBook, priceFor, warnBlocked } from "./prices.service";
import { callGemini, callOpenAI, ProviderError } from "./provider-calls";
import { modelLabel, parseModel, type ProviderId, providerInfo, providerOf } from "./providers";
import {
  aiSettingsOf,
  keyFor,
  modelForWork,
  offReason,
  OFF_TEXT,
  readModelsOf,
} from "./settings.service";
import { agentSkillsText } from "./skills-prompt";
import {
  CHEAPER_MODEL,
  checkBudget,
  type CostEstimate,
  estimateCost,
  logUsage,
  type UsageLine,
} from "./usage.service";

/*
 * The one door to the AI: every AI feature of the ERP calls it here, so the
 * company's switch, pause, keys and model per task and per agent apply
 * everywhere (and, with the cost log, what each call cost). Nothing is called
 * while AI is off; the caller then uses its own non-AI way. Claude is called
 * through the official Anthropic SDK; OpenAI and Gemini models get the same
 * request turned into theirs (provider-calls.ts), so every tool and safety
 * rule is the same on every provider. Tests put a stand-in in its place
 * (standInForClaude).
 *
 * Each call writes its cost line (who asked, the task, why, the record, the
 * model, the tokens and the cost), and the budget and limits are checked
 * before it (AI Center > Budget & Costs). A model with no price is never
 * called (v6.4 A7): its cost could not be counted.
 */

export type ClaudeRequest = {
  task: AiTaskKey;
  /** Plain text, or blocks (a long book marked for the prompt cache). */
  system?: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  tools?: Anthropic.Tool[];
  /** Why the AI is asked, in a line ("Tech pack notes for EX-PL-001"). */
  why: string;
  /** The record it is about (a tech pack, an order). */
  record?: AiRecord;
  /** The person who asked, or null when the system did. */
  userId?: string | null;
  /** Who did it: "Mehedi 2.0", an expert (X01–X25) or a work agent. */
  agent?: string;
  timeoutMs?: number;
  /** How hard it thinks: "low" for short wording, the model's own default otherwise. */
  effort?: "low" | "medium" | "high";
  /** The person saw the estimate (AiAskFirst) and said go on. */
  costOk?: boolean;
  /** This model instead of the task's (a model's test on AI Center > Models). */
  model?: string;
  /** The screen it was asked on ("/ai/chat", "/help") or "bot", for Budget & Costs. */
  screen?: string;
  /** A skill being tested: it goes into the agent's instructions even while off. */
  withSkill?: string;
  /** A skill's test runs while its agent is switched off. */
  evenIfAgentOff?: boolean;
};

export type ClaudeAnswer = { message: Anthropic.Message; model: string };

/** One call: the provider, its key, and the request in Claude's form (the provider's own model id). */
type Transport = (call: {
  provider: ProviderId;
  apiKey: string;
  body: Anthropic.MessageCreateParamsNonStreaming;
  timeoutMs: number;
}) => Promise<Anthropic.Message>;

const realTransport: Transport = ({ provider, apiKey, body, timeoutMs }) => {
  if (provider === "openai") return callOpenAI({ apiKey, body, timeoutMs });
  if (provider === "google") return callGemini({ apiKey, body, timeoutMs });
  return new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs }).messages.create(body);
};

let transport: Transport = realTransport;

/** Tests answer for the AI, any provider (null puts the real one back). */
export function standInForClaude(stand: Transport | null) {
  transport = stand ?? realTransport;
}

export type AiReady =
  { on: true; settings: AiSettings } | { on: false; settings: AiSettings; text: string };

/** Whether the company's AI may be called now: switched on, not paused, with a key. */
export async function aiReady(companyId: string): Promise<AiReady> {
  const settings = await aiSettingsOf(companyId);
  const off = offReason(settings);
  if (off) return { on: false, settings, text: OFF_TEXT[off] };
  return { on: true, settings };
}

/** Whether AI works in the company now (for the "Write with AI" buttons). */
export async function aiOn(companyId: string): Promise<boolean> {
  return (await aiReady(companyId)).on;
}

/**
 * The owner wants to be asked before this call (above "Ask before a task
 * above", or big work without a monthly budget): nothing was sent to Claude.
 * The caller shows the estimate and asks again with costOk once agreed.
 */
export class AiAskFirst extends AppError {
  readonly estimate: CostEstimate;
  constructor(estimate: CostEstimate) {
    // The screens read `aiAskFirst` to offer "Go on" (and send costOk with it).
    super("CONFLICT", estimate.askFirst ?? "The AI asks before this task.", {
      aiAskFirst: [`${estimate.currency} ${estimate.cost}`],
    });
    this.name = "AiAskFirst";
    this.estimate = estimate;
  }
}

function friendly(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ProviderError) {
    const name = providerInfo(error.provider).label;
    if (error.status === 401 || error.status === 403) {
      return new AppError(
        "UNAVAILABLE",
        `${name} refused the key. The owner checks it in AI Center > Settings.`,
      );
    }
    if (error.status === 404) {
      return new AppError(
        "UNAVAILABLE",
        `${name} does not offer this model to the key. Pick another on AI Center > Models.`,
      );
    }
    if (error.status === 429) {
      return new AppError(
        "UNAVAILABLE",
        `${name} is busy or the key is out of credit. Try again in a minute.`,
      );
    }
    if (error.status === 0) {
      return new AppError("UNAVAILABLE", `${name} could not be reached. Try again.`);
    }
    if (error.status >= 500) {
      return new AppError("UNAVAILABLE", `${name} is busy. Try again in a minute.`);
    }
    return new AppError(
      "UNAVAILABLE",
      `${name} could not take the request: ${error.message.slice(0, 200)}`,
    );
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AppError(
      "UNAVAILABLE",
      "Claude refused the key. The owner checks it in AI Center > Settings.",
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AppError(
      "UNAVAILABLE",
      "Claude does not offer this model to the key. Pick another on AI Center > Models.",
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError("UNAVAILABLE", "The AI is busy. Try again in a minute.");
  }
  if (error instanceof Anthropic.APIError && error.status === 529) {
    return new AppError("UNAVAILABLE", "The AI is busy. Try again in a minute.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AppError("UNAVAILABLE", "The AI could not be reached. Try again.");
  }
  return new AppError("UNAVAILABLE", "The AI could not answer. Try again.");
}

/** Writes a cost line; a line that cannot be written never breaks the call. */
async function costLine(companyId: string, line: UsageLine) {
  try {
    await logUsage(companyId, line);
  } catch (error) {
    console.error("[ai] cost line not written", error instanceof Error ? error.message : error);
  }
}

const tokensOf = (message: Anthropic.Message) => ({
  input: message.usage?.input_tokens ?? 0,
  output: message.usage?.output_tokens ?? 0,
  cacheRead: message.usage?.cache_read_input_tokens ?? 0,
  cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
});

/**
 * Refuses work on a model with no price (v6.4 A7), before anything is sent:
 * the plain line, and a notice to the owner (once a day per model). Returns
 * the line for the caller's cost line; null when the model has a price.
 */
export async function blockIfUnpriced(
  companyId: string,
  settings: Pick<AiSettings, "providerModels">,
  model: string,
  work: string,
): Promise<string | null> {
  if (priceFor(await priceBook(companyId), model)) return null;
  const label = modelLabel(model, readModelsOf(settings)[providerOf(model)]?.models);
  await warnBlocked(companyId, model, { label, work });
  return blockedText(label);
}

const noKeyText = (provider: ProviderId) =>
  provider === "anthropic"
    ? "AI has no Claude key yet. The owner adds it in AI Center > Settings."
    : `AI has no ${providerInfo(provider).label} key. The owner adds it in AI Center > Settings.`;

/**
 * Asks the AI, on the model the company chose for the task (or the agent),
 * of whichever provider, within the budget and limits. A model whose
 * provider's key was removed runs on the task's own Claude model, and the
 * cost line says so. Throws UNAVAILABLE (with a line people can read) when AI
 * is off, a limit is reached or the call fails, and AiAskFirst when the owner
 * wants to see the estimate first.
 */
export async function askClaude(companyId: string, request: ClaudeRequest): Promise<ClaudeAnswer> {
  const ready = await aiReady(companyId);
  if (!ready.on) throw new AppError("UNAVAILABLE", ready.text);
  const settings = ready.settings;
  const line = {
    userId: request.userId ?? null,
    agent: request.agent ?? settings.assistantName,
    task: request.task,
    why: request.why,
    record: request.record,
    screen: request.screen,
  };
  // The agent: switched off on AI Center > Agents, it does nothing (Mehedi 2.0
  // follows the main switch); its skills join its instructions.
  const agentKey = agentKeyOf(line.agent, settings.assistantName);
  if (
    agentKey &&
    agentKey !== "mehedi" &&
    settings.agentsOff.includes(agentKey) &&
    !request.evenIfAgentOff
  ) {
    const name = aiAgents(settings.assistantName).find((a) => a.key === agentKey)?.name;
    throw new AppError(
      "UNAVAILABLE",
      `${name ?? line.agent} is switched off. The owner turns it on in AI Center > Agents.`,
    );
  }
  const skills =
    agentKey && request.task !== "knowledge.test"
      ? await agentSkillsText(companyId, agentKey, request.withSkill)
      : null;
  const system = withSkills(request.system, skills);
  const chosen = request.model ?? modelForWork(settings, request.task, line.agent);
  let model: string = chosen;
  let swapped: string | null = null;
  if (!keyFor(settings, providerOf(model)) && !request.model) {
    const own = taskInfo(request.task)?.model ?? CHEAPER_MODEL;
    swapped = `No ${providerInfo(providerOf(model)).label} key: ran on ${modelLabel(own)} instead of ${modelLabel(model)}`;
    model = own;
  }
  if (!keyFor(settings, providerOf(model))) {
    throw new AppError("UNAVAILABLE", noKeyText(providerOf(model)));
  }
  let atLimit: string | null = null;
  try {
    const budget = await checkBudget(companyId, { ...line, provider: providerOf(model) });
    if (!budget.go) {
      await costLine(companyId, {
        ...line,
        model,
        durationMs: 0,
        result: "STOPPED",
        note: budget.why,
      });
      throw new AppError("UNAVAILABLE", budget.why);
    }
    if (budget.cheaper) {
      if (!keyFor(settings, "anthropic")) throw new AppError("UNAVAILABLE", budget.why!);
      model = CHEAPER_MODEL;
    }
    atLimit = budget.why;
    const blocked = await blockIfUnpriced(
      companyId,
      settings,
      model,
      `"${taskInfo(request.task)?.label ?? request.task}" work by ${line.agent}`,
    );
    if (blocked) {
      await costLine(companyId, {
        ...line,
        model,
        durationMs: 0,
        result: "STOPPED",
        note: blocked,
      });
      throw new AppError("UNAVAILABLE", blocked);
    }
    if (!request.costOk) {
      const estimate = await estimateCost(companyId, model, { ...request, system });
      if (estimate.askFirst) throw new AiAskFirst(estimate);
    }
  } catch (error) {
    throw friendly(error);
  }

  const provider = providerOf(model);
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: parseModel(model)?.id ?? model,
    max_tokens: request.maxTokens,
    messages: request.messages,
    ...(system ? { system } : {}),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.effort ? { output_config: { effort: request.effort } } : {}),
  };
  const started = Date.now();
  let message: Anthropic.Message;
  try {
    message = await transport({
      provider,
      apiKey: keyFor(settings, provider)!,
      body,
      timeoutMs: request.timeoutMs ?? 60_000,
    });
  } catch (error) {
    console.error(`[ai] ${request.task} failed`, error instanceof Error ? error.message : error);
    const plain = friendly(error);
    await costLine(companyId, {
      ...line,
      model,
      durationMs: Date.now() - started,
      result: "FAILED",
      note: plain.message,
    });
    throw plain;
  }
  await costLine(companyId, {
    ...line,
    model,
    tokens: tokensOf(message),
    durationMs: Date.now() - started,
    result: "OK",
    note: [swapped, atLimit].filter(Boolean).join(". ") || null,
  });
  return { message, model: provider === "anthropic" ? (message.model ?? model) : model };
}

/** The instructions with the agent's skills after them (cached book blocks stay first). */
function withSkills(
  system: ClaudeRequest["system"],
  skills: string | null,
): ClaudeRequest["system"] {
  if (!skills) return system;
  if (!system) return skills;
  if (typeof system === "string") return `${system}\n\n${skills}`;
  return [...system, { type: "text", text: skills }];
}

/** A way to ask Claude: the company's (askerFor), or a stand-in in tests. */
export type Ask = (request: ClaudeRequest) => Promise<ClaudeAnswer>;

/** The company's way to ask Claude, or null while its AI is off (the caller then works without). */
export async function askerFor(companyId: string, userId?: string | null): Promise<Ask | null> {
  const ready = await aiReady(companyId);
  if (!ready.on) return null;
  return (request) => askClaude(companyId, { userId: userId ?? null, ...request });
}

/** The answer's text, tidied: blocks joined, runs of spaces and blank lines closed up. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((b) => (b.type === "text" ? [b.text.trim()] : []))
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The input of the first call to this tool, if the answer made one. */
export function toolInputOf(message: Anthropic.Message, tool: string): unknown {
  const call = message.content.find((b) => b.type === "tool_use" && b.name === tool);
  return call && call.type === "tool_use" ? call.input : undefined;
}
