import { createHash } from "node:crypto";

import { type Ask, askerFor, textOf } from "./claude";
import type { AiRecord } from "./control.service";
import type { AiTaskKey } from "./models";

/*
 * Short texts worded by Claude (a tech pack's making notes, a contract's
 * clauses, a supplier report card's summary) while the company's AI is on.
 * Only the facts given are sent, the answer is capped, the same facts are not
 * asked about twice while the app runs, and any failure gives null, so the
 * caller keeps its own wording. With AI off nothing is sent.
 */

export type TextRequest = {
  instructions: string;
  facts: unknown;
  /** Why it is asked, for the AI log ("Making notes for EX-PL-001"). */
  why: string;
  record?: AiRecord;
  task?: AiTaskKey;
  maxTokens?: number;
  maxChars?: number;
};

/** Answers kept while the app runs; the oldest goes first past this many. */
const KEPT = 200;
const kept = new Map<string, string>();

function keep(key: string, text: string) {
  kept.delete(key);
  kept.set(key, text);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
}

/** The text Claude words for `facts` under `instructions`, or null. */
export async function wordWithAi(ask: Ask, request: TextRequest): Promise<string | null> {
  const facts = JSON.stringify(request.facts);
  const key = createHash("sha256")
    .update(`${request.task ?? "text.write"}\n${request.instructions}\n${facts}`)
    .digest("hex");
  const known = kept.get(key);
  if (known) return known;
  try {
    const { message } = await ask({
      task: request.task ?? "text.write",
      why: request.why,
      record: request.record,
      system: request.instructions,
      // Room for the model's thinking as well as the words asked for.
      maxTokens: Math.max(request.maxTokens ?? 300, 1024),
      messages: [{ role: "user", content: facts }],
      effort: "low",
      timeoutMs: 30_000,
    });
    const text = textOf(message).slice(0, request.maxChars ?? 1200);
    if (!text) return null;
    keep(key, text);
    return text;
  } catch (error) {
    console.error("[ai-text]", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The company's AI wording, or null while its AI is off or does not answer. */
export async function aiText(
  companyId: string,
  request: TextRequest,
  userId?: string | null,
): Promise<string | null> {
  const ask = await askerFor(companyId, userId);
  return ask ? wordWithAi(ask, request) : null;
}

/** Forget kept answers (tests). */
export function forgetAiTexts() {
  kept.clear();
}
