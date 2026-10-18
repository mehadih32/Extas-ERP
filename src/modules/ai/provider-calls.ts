import Anthropic from "@anthropic-ai/sdk";

import { AppError } from "@/lib/errors";

import type { ProviderId, ReadModel } from "./providers";

/*
 * Calling OpenAI and Gemini (v6.3) the way the ERP calls Claude. Every AI
 * feature builds a Claude Messages request (claude.ts); for a model of another
 * provider it is turned into that provider's request here (OpenAI Chat
 * Completions, Gemini generateContent) and the answer back into a Claude
 * message, so every feature, tool and safety rule works the same on every
 * provider. Plain HTTPS with the company's key; nothing else is sent. Also
 * reads each provider's list of models, for AI Center > Models.
 *   OPENAI_BASE_URL (https://api.openai.com/v1) and GEMINI_BASE_URL
 *   (https://generativelanguage.googleapis.com/v1beta) point elsewhere only in tests.
 * A restore drill copy (test mode) never calls a provider (refuseOnDrill).
 */

/** No provider call from a restore drill copy (backups/standby.ts): a plain reason instead. */
export async function refuseOnDrill() {
  const { DRILL_NO_AI, onDrill } = await import("@/modules/backups/standby");
  if (await onDrill()) throw new AppError("UNAVAILABLE", DRILL_NO_AI);
}

/** A provider's own refusal or failure, with its HTTP status (0: not reached). */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const openaiBase = () =>
  (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
const geminiBase = () =>
  (
    process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/, "");

type Body = Anthropic.MessageCreateParamsNonStreaming;
type Json = Record<string, unknown>;

/** Room for a thinking model's own reasoning, on top of the answer's limit (billed only if used). */
const THINKING_ROOM = 8_192;

/** OpenAI's reasoning models take reasoning_effort; the others refuse it. */
export const openaiReasons = (model: string) => /^(o\d|gpt-5)/.test(model) && !/chat/.test(model);

/** Gemini 2.5 and later think before they answer. */
export const geminiThinks = (model: string) => /^gemini-(2\.5|[3-9])/.test(model);

function systemText(system: Body["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

type Block = { type: string } & Json;

const blocksOf = (content: Anthropic.MessageParam["content"]): Block[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : (content as unknown as Block[]);

/** The text of a tool result (its text blocks; a picture is named, not sent). */
function resultText(block: Block): string {
  const content = block.content as string | Block[] | undefined;
  if (typeof content === "string") return content;
  return (content ?? [])
    .map((b) => (b.type === "text" ? String(b.text ?? "") : `[${b.type}]`))
    .join("\n");
}

type Source = { type: string; media_type?: string; data?: string; url?: string };

// ---------------------------------------------------------------- OpenAI

/** A Claude request as an OpenAI Chat Completions request. */
export function toOpenAI(body: Body): Json {
  const messages: Json[] = [];
  const system = systemText(body.system);
  if (system) messages.push({ role: "system", content: system });
  for (const m of body.messages) {
    const blocks = blocksOf(m.content);
    if (m.role === "assistant") {
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => String(b.text))
        .join("\n");
      const calls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: String(b.id),
          type: "function",
          function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
        }));
      messages.push({
        role: "assistant",
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // Tool results first (they answer the calls just before), then what the person adds.
    for (const b of blocks.filter((x) => x.type === "tool_result")) {
      messages.push({
        role: "tool",
        tool_call_id: String(b.tool_use_id),
        content: (b.is_error ? "Error: " : "") + resultText(b),
      });
    }
    const parts: Json[] = [];
    for (const b of blocks) {
      if (b.type === "text") parts.push({ type: "text", text: String(b.text) });
      else if (b.type === "image") {
        const s = b.source as Source;
        const url = s.type === "url" ? s.url : `data:${s.media_type};base64,${s.data}`;
        parts.push({ type: "image_url", image_url: { url } });
      } else if (b.type === "document") {
        const s = b.source as Source;
        if (s.type === "text") parts.push({ type: "text", text: String(s.data ?? "") });
        else if (s.type === "base64") {
          parts.push({
            type: "file",
            file: {
              filename: String(b.title ?? "document.pdf"),
              file_data: `data:${s.media_type ?? "application/pdf"};base64,${s.data}`,
            },
          });
        }
      }
    }
    if (parts.length) {
      messages.push({
        role: "user",
        content: parts.every((p) => p.type === "text")
          ? parts.map((p) => p.text).join("\n\n")
          : parts,
      });
    }
  }
  const reasons = openaiReasons(body.model);
  const effort = (body as { output_config?: { effort?: string } }).output_config?.effort;
  return {
    model: body.model,
    messages,
    max_completion_tokens: body.max_tokens + (reasons ? THINKING_ROOM : 0),
    ...(reasons ? { reasoning_effort: effort === "low" ? "low" : "medium" } : {}),
    ...(body.tools?.length
      ? {
          tools: (body.tools as Anthropic.Tool[]).map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description ?? "",
              parameters: t.input_schema,
            },
          })),
        }
      : {}),
  };
}

const STOP: Record<string, Anthropic.Message["stop_reason"]> = {
  tool_calls: "tool_use",
  function_call: "tool_use",
  length: "max_tokens",
  MAX_TOKENS: "max_tokens",
};

function message(
  id: string,
  model: string,
  content: Anthropic.ContentBlock[],
  stop: Anthropic.Message["stop_reason"],
  use: { input: number; output: number; cacheRead: number },
): Anthropic.Message {
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: use.input,
      output_tokens: use.output,
      cache_read_input_tokens: use.cacheRead,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

const textBlock = (text: string) =>
  ({ type: "text", text, citations: null }) as unknown as Anthropic.ContentBlock;
const toolBlock = (id: string, name: string, input: unknown) =>
  ({ type: "tool_use", id, name, input }) as unknown as Anthropic.ContentBlock;

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/** An OpenAI answer as a Claude message. */
export function fromOpenAI(json: Json, model: string): Anthropic.Message {
  const choice = (json.choices as Json[] | undefined)?.[0];
  if (!choice) throw new ProviderError("openai", 502, "OpenAI sent no answer.");
  const m = (choice.message ?? {}) as Json;
  const content: Anthropic.ContentBlock[] = [];
  const text = typeof m.content === "string" ? m.content : "";
  if (text.trim()) content.push(textBlock(text));
  else if (typeof m.refusal === "string" && m.refusal) content.push(textBlock(m.refusal));
  for (const call of (m.tool_calls as Json[] | undefined) ?? []) {
    const fn = (call.function ?? {}) as Json;
    content.push(toolBlock(String(call.id), String(fn.name), parseArguments(fn.arguments)));
  }
  const usage = (json.usage ?? {}) as Json;
  const prompt = Number(usage.prompt_tokens ?? 0);
  const cached = Number((usage.prompt_tokens_details as Json | undefined)?.cached_tokens ?? 0);
  return message(
    String(json.id ?? "openai"),
    String(json.model ?? model),
    content,
    STOP[String(choice.finish_reason)] ??
      (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
    {
      input: Math.max(0, prompt - cached),
      output: Number(usage.completion_tokens ?? 0),
      cacheRead: cached,
    },
  );
}

// ---------------------------------------------------------------- Gemini

/** The JSON Schema words Gemini's function declarations take; the rest is left out. */
const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "items",
  "minItems",
  "maxItems",
  "properties",
  "required",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "anyOf",
  "propertyOrdering",
]);

/** A tool's input schema as Gemini takes it ($schema, additionalProperties, ["x","null"] types removed). */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Json = {};
  for (const [key, value] of Object.entries(schema as Json)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "type" && Array.isArray(value)) {
      const kinds = value.filter((v) => v !== "null");
      out.type = kinds[0] ?? "string";
      if (kinds.length < value.length) out.nullable = true;
    } else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Json).map(([k, v]) => [k, geminiSchema(v)]),
      );
    } else if (key === "enum" && Array.isArray(value)) {
      out.enum = value.filter((v) => v !== null).map(String);
    } else {
      out[key] = geminiSchema(value);
    }
  }
  return out;
}

/**
 * Gemini 3 signs each tool call; the signature must come back with the call
 * on the next turn. Kept here for the length of a chat (the history itself is
 * in Claude's form); a lost one is replaced by Gemini's documented stand-in.
 */
const signatures = new Map<string, { signature: string; at: number }>();
const SIGNATURE_LIFE_MS = 6 * 3_600_000;

function keepSignature(id: string, signature: string) {
  const now = Date.now();
  if (signatures.size > 2_000) {
    for (const [k, v] of signatures) if (now - v.at > SIGNATURE_LIFE_MS) signatures.delete(k);
  }
  signatures.set(id, { signature, at: now });
}

/** A Claude request as a Gemini generateContent request. */
export function toGemini(body: Body): Json {
  const names = new Map<string, string>();
  const contents: Json[] = [];
  for (const m of body.messages) {
    const parts: Json[] = [];
    for (const b of blocksOf(m.content)) {
      if (b.type === "text") parts.push({ text: String(b.text) });
      else if (b.type === "image" || b.type === "document") {
        const s = b.source as Source;
        if (s.type === "base64") {
          parts.push({ inlineData: { mimeType: s.media_type, data: s.data } });
        } else if (s.type === "text") parts.push({ text: String(s.data ?? "") });
        else if (s.type === "url") parts.push({ text: `File: ${s.url}` });
      } else if (b.type === "tool_use") {
        names.set(String(b.id), String(b.name));
        const kept = signatures.get(String(b.id))?.signature;
        const signature =
          kept ?? (/^gemini-[3-9]/.test(body.model) ? "skip_thought_signature_validator" : null);
        parts.push({
          functionCall: { name: String(b.name), args: b.input ?? {} },
          ...(signature ? { thoughtSignature: signature } : {}),
        });
      } else if (b.type === "tool_result") {
        const name = names.get(String(b.tool_use_id)) ?? "tool";
        parts.push({
          functionResponse: {
            name,
            response: b.is_error ? { error: resultText(b) } : { content: resultText(b) },
          },
        });
      }
    }
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  const system = systemText(body.system);
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      maxOutputTokens: body.max_tokens + (geminiThinks(body.model) ? THINKING_ROOM : 0),
    },
    ...(body.tools?.length
      ? {
          tools: [
            {
              functionDeclarations: (body.tools as Anthropic.Tool[]).map((t) => ({
                name: t.name,
                description: t.description ?? "",
                parameters: geminiSchema(t.input_schema),
              })),
            },
          ],
        }
      : {}),
  };
}

let calls = 0;

/** A Gemini answer as a Claude message. */
export function fromGemini(json: Json, model: string): Anthropic.Message {
  const candidate = (json.candidates as Json[] | undefined)?.[0];
  if (!candidate) {
    const blocked = (json.promptFeedback as Json | undefined)?.blockReason;
    throw new ProviderError(
      "google",
      400,
      blocked ? `Gemini refused the request (${String(blocked)}).` : "Gemini sent no answer.",
    );
  }
  const content: Anthropic.ContentBlock[] = [];
  const parts = ((candidate.content as Json | undefined)?.parts as Json[] | undefined) ?? [];
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.text === "string" && part.text.trim()) content.push(textBlock(part.text));
    const call = part.functionCall as Json | undefined;
    if (call) {
      const id = `toolu_gemini_${Date.now().toString(36)}_${(calls++).toString(36)}`;
      if (typeof part.thoughtSignature === "string") keepSignature(id, part.thoughtSignature);
      content.push(toolBlock(id, String(call.name), call.args ?? {}));
    }
  }
  const usage = (json.usageMetadata ?? {}) as Json;
  const prompt = Number(usage.promptTokenCount ?? 0);
  const cached = Number(usage.cachedContentTokenCount ?? 0);
  return message(
    String(json.responseId ?? "gemini"),
    String(json.modelVersion ?? model),
    content,
    content.some((b) => b.type === "tool_use")
      ? "tool_use"
      : (STOP[String(candidate.finishReason)] ?? "end_turn"),
    {
      input: Math.max(0, prompt - cached),
      output: Number(usage.candidatesTokenCount ?? 0) + Number(usage.thoughtsTokenCount ?? 0),
      cacheRead: cached,
    },
  );
}

// ---------------------------------------------------------------- HTTP

async function send(
  provider: ProviderId,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown; timeoutMs: number },
): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...init.headers,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (error) {
    throw new ProviderError(
      provider,
      0,
      error instanceof Error ? error.message : "The provider could not be reached.",
    );
  }
  const text = await response.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    const error = (json.error ?? {}) as Json;
    const said = typeof error.message === "string" ? error.message : text.slice(0, 300);
    throw new ProviderError(provider, response.status, said || `HTTP ${response.status}`);
  }
  return json;
}

export type ProviderCall = { apiKey: string; body: Body; timeoutMs: number };

export async function callOpenAI({ apiKey, body, timeoutMs }: ProviderCall) {
  await refuseOnDrill();
  const json = await send("openai", `${openaiBase()}/chat/completions`, {
    headers: { authorization: `Bearer ${apiKey}` },
    body: toOpenAI(body),
    timeoutMs,
  });
  return fromOpenAI(json, body.model);
}

export async function callGemini({ apiKey, body, timeoutMs }: ProviderCall) {
  await refuseOnDrill();
  const json = await send(
    "google",
    `${geminiBase()}/models/${encodeURIComponent(body.model)}:generateContent`,
    { headers: { "x-goog-api-key": apiKey }, body: toGemini(body), timeoutMs },
  );
  return fromGemini(json, body.model);
}

/** OpenAI models that are not for chat (sound, pictures, search, embeddings and the like). */
const OPENAI_NOT_CHAT =
  /(audio|realtime|transcribe|tts|whisper|image|dall-e|embedding|moderation|search|instruct|computer-use|codex|davinci|babbage)/;
const GEMINI_NOT_CHAT = /(embedding|aqa|imagen|veo|tts|native-audio|live|image)/;

/**
 * The models a provider offers the key, read from the provider (nothing is
 * hard-coded): chat models only, newest names first. Also how a key is tested.
 */
export async function listModels(
  provider: ProviderId,
  apiKey: string,
  timeoutMs = 20_000,
): Promise<ReadModel[]> {
  await refuseOnDrill();
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs });
    const out: ReadModel[] = [];
    try {
      for await (const m of client.models.list({ limit: 100 })) {
        out.push({ id: m.id, label: m.display_name || m.id });
        if (out.length >= 500) break;
      }
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? (error.status ?? 0) : 0;
      throw new ProviderError(
        "anthropic",
        status,
        error instanceof Error ? error.message : "Claude could not be reached.",
      );
    }
    return out;
  }
  if (provider === "openai") {
    const json = await send("openai", `${openaiBase()}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      timeoutMs,
    });
    return ((json.data as Json[] | undefined) ?? [])
      .map((m) => String(m.id))
      .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !OPENAI_NOT_CHAT.test(id))
      .sort((a, b) => b.localeCompare(a))
      .map((id) => ({ id, label: id }));
  }
  const out: ReadModel[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const json = await send(
      "google",
      `${geminiBase()}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      { headers: { "x-goog-api-key": apiKey }, timeoutMs },
    );
    for (const m of (json.models as Json[] | undefined) ?? []) {
      const id = String(m.name ?? "").replace(/^models\//, "");
      const methods = (m.supportedGenerationMethods as string[] | undefined) ?? [];
      if (!id || !methods.includes("generateContent") || GEMINI_NOT_CHAT.test(id)) continue;
      out.push({ id, label: String(m.displayName ?? id) });
    }
    pageToken = typeof json.nextPageToken === "string" ? json.nextPageToken : "";
    if (!pageToken) break;
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}
