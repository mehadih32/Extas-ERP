import { createHash } from "node:crypto";

/*
 * Short texts worded by the Claude API (a tech pack's making notes, a supplier
 * report card's summary) when an AI key is set: AI_API_KEY with AI_SUMMARY_MODEL,
 * or the intake model. Only the facts given are sent, the answer is capped, the
 * same facts are never asked about twice while the app runs, and any failure
 * returns null so the caller falls back to its own wording.
 */

type Options = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/** Answers kept while the app runs; the oldest goes first past this many. */
const KEPT = 200;
const kept = new Map<string, string>();

function keep(key: string, text: string) {
  kept.delete(key);
  kept.set(key, text);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
}

function aiConfig(options: Options) {
  // Settings left empty in .env arrive as "" and mean "not set".
  const apiKey = (options.apiKey ?? process.env.AI_API_KEY)?.trim();
  const model =
    options.model?.trim() ||
    process.env.AI_SUMMARY_MODEL?.trim() ||
    process.env.AI_INTAKE_MODEL?.trim();
  return apiKey && model ? { apiKey, model } : null;
}

/** Whether texts are worded by AI (an AI key and model are set). */
export function aiTextOn(options: Options = {}): boolean {
  return aiConfig(options) !== null;
}

/**
 * The AI's answer to `facts` under `instructions`, at most `maxChars` long, or
 * null when AI is not set up or does not answer.
 */
export async function aiText(
  request: { instructions: string; facts: unknown; maxTokens?: number; maxChars?: number },
  options: Options = {},
): Promise<string | null> {
  const config = aiConfig(options);
  if (!config) return null;
  const facts = JSON.stringify(request.facts);
  const key = createHash("sha256")
    .update(`${config.model}\n${request.instructions}\n${facts}`)
    .digest("hex");
  const known = kept.get(key);
  if (known) return known;
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const maxChars = request.maxChars ?? 1200;
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens ?? 300,
        temperature: 0.2,
        system: request.instructions,
        messages: [{ role: "user", content: facts }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.error(`[ai-text] ${response.status}`, (await response.text()).slice(0, 300));
      return null;
    }
    const json = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!.trim())
      .join("\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxChars);
    if (!text) return null;
    keep(key, text);
    return text;
  } catch (error) {
    console.error("[ai-text] request failed", error);
    return null;
  }
}
