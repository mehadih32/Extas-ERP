import type { AiBotChannel } from "@prisma/client";

import type { BotButton } from "./render";

/*
 * The bot connection layer (v6.1): one way to talk to the owner, with two
 * plugs, Telegram (now) and WhatsApp (ready for when the owner adds the
 * number and key). The plugs differ only in how a message travels; the
 * commands, Control, the PIN and the log are the same (incoming.ts).
 * Every call to Telegram or Meta goes through one transport, which tests
 * replace with a stand-in (standInForBotApi).
 */

export type BotFile = { name: string; content: Buffer; type: string };

/** One message the owner wrote or a button they pressed, read from either plug. */
export type Incoming = {
  /** The provider's id of the update (Telegram) or message (WhatsApp). */
  updateId: string;
  /** Who it came from: the chat (Telegram) or the number (WhatsApp). */
  chatId: string;
  /** Only a private chat with the owner is ever answered. */
  privateChat: boolean;
  fromName: string | null;
  messageId: string | null;
  text: string | null;
  /** A voice note, photo or file instead of text. */
  media: "voice" | "file" | null;
  callback: { id: string | null; data: string; messageId: string | null } | null;
};

export interface BotSender {
  readonly channel: AiBotChannel;
  /** Sends words with buttons under them; the provider's message id comes back. */
  send(chatId: string, out: { text: string; buttons: BotButton[][] }): Promise<string | null>;
  file(chatId: string, file: BotFile, caption?: string): Promise<string | null>;
  /** Stops the spinner on a pressed button (Telegram). */
  ack(callbackId: string | null, text?: string): Promise<void>;
  /** Takes the buttons off a message once it is answered (Telegram). */
  clearButtons(chatId: string, messageId: string | null): Promise<void>;
  /** Removes a message (the PIN the owner typed), where the provider allows it. */
  remove(chatId: string, messageId: string | null): Promise<void>;
  typing(chatId: string): Promise<void>;
}

export type BotCall = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  json?: unknown;
  form?: FormData;
};

export type BotReply = { status: number; body: unknown };

type Transport = (call: BotCall) => Promise<BotReply>;

const fetchTransport: Transport = async (call) => {
  const response = await fetch(call.url, {
    method: call.method,
    headers: {
      ...(call.json !== undefined ? { "content-type": "application/json" } : {}),
      ...call.headers,
    },
    body: call.json !== undefined ? JSON.stringify(call.json) : call.form,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: kept as the text.
  }
  return { status: response.status, body };
};

let transport: Transport = fetchTransport;

/** Tests talk to a stand-in (null puts the real one back). */
export function standInForBotApi(stand: Transport | null) {
  transport = stand ?? fetchTransport;
}

export const botCall = (call: BotCall) => transport(call);

/** A provider's refusal, with its own words for the log (never the token). */
export class BotApiError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(description);
    this.name = "BotApiError";
  }
}
