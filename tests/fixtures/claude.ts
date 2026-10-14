import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";

import type { Ask, ClaudeRequest } from "@/modules/ai/claude";

/*
 * Stand-ins for Claude in tests: an answer shaped like the Messages API's, and
 * an `Ask` that records what it was asked and answers with it.
 */

export function claudeMessage(
  content: Anthropic.ContentBlock[] | string,
  model = "claude-sonnet-5-5",
  usage: Partial<Anthropic.Usage> = {},
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content:
      typeof content === "string"
        ? [{ type: "text", text: content, citations: null } as Anthropic.TextBlock]
        : content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ...usage,
    } as Anthropic.Usage,
  } as Anthropic.Message;
}

/** An Ask that answers every request with `answer` (or throws it), recording each request. */
export function fakeAsk(answer: Anthropic.Message | string | Error) {
  const asked: ClaudeRequest[] = [];
  const ask = vi.fn<Ask>(async (request) => {
    asked.push(request);
    if (answer instanceof Error) throw answer;
    const message = typeof answer === "string" ? claudeMessage(answer) : answer;
    return { message, model: message.model };
  });
  return { ask, asked };
}
