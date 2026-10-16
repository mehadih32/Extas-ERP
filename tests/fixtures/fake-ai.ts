import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * Stand-ins for the AI providers' HTTP APIs in tests (OPENAI_BASE_URL,
 * GEMINI_BASE_URL and ANTHROPIC_BASE_URL point here): the model lists, OpenAI
 * Chat Completions and Gemini generateContent, with the answers each test
 * queues. Every request is recorded with its headers and body.
 */

export type FakeCall = {
  method: string;
  path: string;
  auth: string | null;
  body: Record<string, unknown> | null;
};

type Answer = { status?: number; json: unknown };

export type FakeAi = {
  url: string;
  calls: FakeCall[];
  /** Keys each provider accepts. */
  keys: { openai: string; google: string; anthropic: string };
  /** The next answers to give, per provider, in order (else a plain text answer). */
  answers: { openai: Answer[]; google: Answer[] };
  close: () => Promise<void>;
};

async function bodyOf(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const openaiText = (
  text: string,
  usage = { prompt_tokens: 1000, completion_tokens: 200 },
) => ({
  json: {
    id: "chatcmpl-test",
    model: "gpt-test-2026",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
    usage: { ...usage, prompt_tokens_details: { cached_tokens: 0 } },
  },
});

export const openaiTool = (name: string, input: unknown, id = "call_1") => ({
  json: {
    id: "chatcmpl-tool",
    model: "gpt-test-2026",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(input) } },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 800,
      completion_tokens: 60,
      prompt_tokens_details: { cached_tokens: 200 },
    },
  },
});

export const geminiText = (text: string) => ({
  json: {
    responseId: "gem-1",
    modelVersion: "gemini-test",
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 100, thoughtsTokenCount: 50 },
  },
});

export const geminiTool = (name: string, args: unknown, signature?: string) => ({
  json: {
    responseId: "gem-2",
    modelVersion: "gemini-test",
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { functionCall: { name, args }, ...(signature ? { thoughtSignature: signature } : {}) },
          ],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 40 },
  },
});

export async function startFakeAi(): Promise<FakeAi> {
  const fake = {
    calls: [] as FakeCall[],
    keys: {
      openai: "sk-proj-openaitestkey0123456789",
      google: "AIzaSyTestGeminiKey0123456789abcdefg",
      anthropic: "sk-ant-api03-test0123456789abcdWXYZ",
    },
    answers: { openai: [] as Answer[], google: [] as Answer[] },
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const body = req.method === "POST" ? await bodyOf(req) : null;
    const auth =
      (req.headers.authorization as string | undefined) ??
      (req.headers["x-goog-api-key"] as string | undefined) ??
      (req.headers["x-api-key"] as string | undefined) ??
      null;
    fake.calls.push({ method: req.method ?? "GET", path: url.pathname, auth, body });
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    const refuse = () => send(401, { error: { message: "Incorrect API key provided." } });

    // OpenAI
    if (url.pathname.startsWith("/openai/")) {
      if (auth !== `Bearer ${fake.keys.openai}`) return refuse();
      if (url.pathname === "/openai/models" && req.method === "GET") {
        return send(200, {
          data: [
            "gpt-test",
            "gpt-test-mini",
            "text-embedding-3-small",
            "whisper-1",
            "gpt-test-audio",
          ].map((id) => ({ id, object: "model", owned_by: "openai" })),
        });
      }
      if (url.pathname === "/openai/chat/completions") {
        const next: Answer = fake.answers.openai.shift() ?? openaiText("Answered by OpenAI.");
        return send(next.status ?? 200, next.json);
      }
    }
    // Gemini
    if (url.pathname.startsWith("/gemini/")) {
      if (auth !== fake.keys.google) {
        return send(400, {
          error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" },
        });
      }
      if (url.pathname === "/gemini/models" && req.method === "GET") {
        return send(200, {
          models: [
            {
              name: "models/gemini-test",
              displayName: "Gemini Test",
              supportedGenerationMethods: ["generateContent", "countTokens"],
            },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          ],
        });
      }
      if (/^\/gemini\/models\/[^/]+:generateContent$/.test(url.pathname)) {
        const next: Answer = fake.answers.google.shift() ?? geminiText("Answered by Gemini.");
        return send(next.status ?? 200, next.json);
      }
    }
    // Claude's model list
    if (url.pathname === "/v1/models") {
      if (auth !== fake.keys.anthropic) {
        return send(401, {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        });
      }
      return send(200, {
        data: [
          {
            type: "model",
            id: "claude-sonnet-5-5",
            display_name: "Claude Sonnet 5.5",
            created_at: "2026-01-01T00:00:00Z",
          },
          {
            type: "model",
            id: "claude-test-next",
            display_name: "Claude Test Next",
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
        has_more: false,
        first_id: "claude-sonnet-5-5",
        last_id: "claude-test-next",
      });
    }
    send(404, { error: { message: `No route ${url.pathname}` } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    ...fake,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
