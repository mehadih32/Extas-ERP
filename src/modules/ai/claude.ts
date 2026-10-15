import Anthropic from "@anthropic-ai/sdk";
import type { AiSettings } from "@prisma/client";

import { AppError } from "@/lib/errors";

import type { AiRecord } from "./control.service";
import type { AiTaskKey } from "./models";
import { aiSettingsOf, apiKeyOf, companyModelFor, offReason, OFF_TEXT } from "./settings.service";
import {
  CHEAPER_MODEL,
  checkBudget,
  type CostEstimate,
  estimateCost,
  logUsage,
  type UsageLine,
} from "./usage.service";

/*
 * The one door to Claude: every AI feature of the ERP calls it here, so the
 * company's switch, pause, key and model per task apply everywhere (and, with
 * the cost log, what each call cost). Nothing is called while AI is off; the
 * caller then uses its own non-AI way. Calls go through the official
 * Anthropic SDK; tests put a stand-in in its place (standInForClaude).
 *
 * Each call writes its cost line (who asked, the task, why, the record, the
 * model, the tokens and the cost), and the budget and limits are checked
 * before it (AI Center > Budget & Costs).
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
};

export type ClaudeAnswer = { message: Anthropic.Message; model: string };

type Transport = (call: {
  apiKey: string;
  body: Anthropic.MessageCreateParamsNonStreaming;
  timeoutMs: number;
}) => Promise<Anthropic.Message>;

const sdkTransport: Transport = ({ apiKey, body, timeoutMs }) =>
  new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs }).messages.create(body);

let transport: Transport = sdkTransport;

/** Tests answer for Claude (null puts the real one back). */
export function standInForClaude(stand: Transport | null) {
  transport = stand ?? sdkTransport;
}

export type AiReady =
  | { on: true; settings: AiSettings; apiKey: string }
  | { on: false; settings: AiSettings; text: string };

/** Whether the company's AI may be called now: switched on, not paused, with a key. */
export async function aiReady(companyId: string): Promise<AiReady> {
  const settings = await aiSettingsOf(companyId);
  const off = offReason(settings);
  if (off) return { on: false, settings, text: OFF_TEXT[off] };
  return { on: true, settings, apiKey: apiKeyOf(settings)! };
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
 * Asks Claude, on the model the company chose for the task, within the
 * budget and limits. Throws UNAVAILABLE (with a line people can read) when AI
 * is off, a limit is reached or the call fails, and AiAskFirst when the owner
 * wants to see the estimate first.
 */
export async function askClaude(companyId: string, request: ClaudeRequest): Promise<ClaudeAnswer> {
  const ready = await aiReady(companyId);
  if (!ready.on) throw new AppError("UNAVAILABLE", ready.text);
  const line = {
    userId: request.userId ?? null,
    agent: request.agent ?? ready.settings.assistantName,
    task: request.task,
    why: request.why,
    record: request.record,
  };
  const chosen = companyModelFor(ready.settings, request.task);
  let model: string = chosen;
  let atLimit: string | null = null;
  try {
    const budget = await checkBudget(companyId, line);
    if (!budget.go) {
      await costLine(companyId, {
        ...line,
        model: chosen,
        durationMs: 0,
        result: "STOPPED",
        note: budget.why,
      });
      throw new AppError("UNAVAILABLE", budget.why);
    }
    if (budget.cheaper) model = CHEAPER_MODEL;
    atLimit = budget.why;
    if (!request.costOk) {
      const estimate = await estimateCost(companyId, model, request);
      if (estimate.askFirst) throw new AiAskFirst(estimate);
    }
  } catch (error) {
    throw friendly(error);
  }

  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: request.maxTokens,
    messages: request.messages,
    ...(request.system ? { system: request.system } : {}),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.effort ? { output_config: { effort: request.effort } } : {}),
  };
  const started = Date.now();
  let message: Anthropic.Message;
  try {
    message = await transport({
      apiKey: ready.apiKey,
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
    note: atLimit,
  });
  return { message, model: message.model ?? model };
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
