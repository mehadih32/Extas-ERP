import Anthropic from "@anthropic-ai/sdk";
import type { AiSettings } from "@prisma/client";

import { AppError } from "@/lib/errors";

import type { AiRecord } from "./control.service";
import type { AiTaskKey } from "./models";
import { aiSettingsOf, apiKeyOf, companyModelFor, offReason, OFF_TEXT } from "./settings.service";

/*
 * The one door to Claude: every AI feature of the ERP calls it here, so the
 * company's switch, pause, key and model per task apply everywhere (and, with
 * the cost log, what each call cost). Nothing is called while AI is off; the
 * caller then uses its own non-AI way. Calls go through the official
 * Anthropic SDK; tests put a stand-in in its place (standInForClaude).
 */

export type ClaudeRequest = {
  task: AiTaskKey;
  system?: string;
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

/**
 * Asks Claude, on the model the company chose for the task. Throws
 * UNAVAILABLE (with a line people can read) when AI is off or the call fails.
 */
export async function askClaude(companyId: string, request: ClaudeRequest): Promise<ClaudeAnswer> {
  const ready = await aiReady(companyId);
  if (!ready.on) throw new AppError("UNAVAILABLE", ready.text);
  const model = companyModelFor(ready.settings, request.task);
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: request.maxTokens,
    messages: request.messages,
    ...(request.system ? { system: request.system } : {}),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.effort ? { output_config: { effort: request.effort } } : {}),
  };
  try {
    const message = await transport({
      apiKey: ready.apiKey,
      body,
      timeoutMs: request.timeoutMs ?? 60_000,
    });
    return { message, model: message.model ?? model };
  } catch (error) {
    console.error(`[ai] ${request.task} failed`, error instanceof Error ? error.message : error);
    throw friendly(error);
  }
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
