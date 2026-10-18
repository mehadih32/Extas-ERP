import { createHmac, timingSafeEqual } from "node:crypto";

import { BotApiError, botCall, type BotSender, type Incoming } from "./channel";
import { clip } from "./render";

/*
 * The WhatsApp plug (Meta WhatsApp Business Platform, Cloud API). It is ready
 * and waits for the owner: it works once the business number's phone number
 * ID, its access token and the app secret are entered in AI Center > Bot, and
 * the webhook (/api/bot/whatsapp/webhook, with the verify token shown there)
 * is added in the Meta app. No code change is needed.
 *   - Meta signs every call with the app secret (X-Hub-Signature-256).
 *   - Up to 3 answers go as reply buttons, more as a list.
 *   - A file is uploaded to Meta first, then sent as a document.
 *   - Meta lets a business write freely only within 24 hours of the person's
 *     last message; outside that a push may be refused (it is logged).
 */

const GRAPH = "https://graph.facebook.com/v23.0";

/** Meta's phone number ID (digits only). */
export const PHONE_NUMBER_ID = /^\d{6,25}$/;

async function graph<T>(
  token: string,
  path: string,
  init: { method?: "GET" | "POST"; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const { status, body } = await botCall({
    url: `${GRAPH}/${path}`,
    method: init.method ?? "POST",
    headers: { authorization: `Bearer ${token}` },
    json: init.json,
    form: init.form,
  });
  if (status >= 400) {
    const error = (body as { error?: { message?: string; code?: number } } | null)?.error;
    throw new BotApiError(status, error?.message ?? `WhatsApp answered ${status}`);
  }
  return body as T;
}

/** The number behind a phone number ID, which also proves the token works. */
export function whatsappNumber(phoneNumberId: string, token: string) {
  return graph<{ display_phone_number?: string; verified_name?: string }>(
    token,
    `${phoneNumberId}?fields=display_phone_number,verified_name`,
    { method: "GET" },
  );
}

/** Meta's signature on a webhook call: "sha256=<hex of HMAC-SHA256(app secret, raw body)>". */
export function whatsappSignatureOk(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function whatsappSender(phoneNumberId: string, token: string): BotSender {
  const message = (to: string, content: Record<string, unknown>) =>
    graph<{ messages?: Array<{ id?: string }> }>(token, `${phoneNumberId}/messages`, {
      json: { messaging_product: "whatsapp", recipient_type: "individual", to, ...content },
    }).then((r) => r.messages?.[0]?.id ?? null);
  return {
    channel: "WHATSAPP",
    async send(chatId, out) {
      const buttons = out.buttons.flat();
      if (buttons.length === 0) {
        return message(chatId, {
          type: "text",
          text: { body: clip(out.text, 4000), preview_url: false },
        });
      }
      // An interactive message carries at most 1024 characters: longer words go first.
      let body = out.text;
      if (body.length > 1000) {
        await message(chatId, {
          type: "text",
          text: { body: clip(out.text, 4000), preview_url: false },
        });
        body = "Choose:";
      }
      const action =
        buttons.length <= 3
          ? {
              type: "button",
              action: {
                buttons: buttons.map((b) => ({
                  type: "reply",
                  reply: { id: b.data, title: b.label.slice(0, 20) },
                })),
              },
            }
          : {
              type: "list",
              action: {
                button: "Answer",
                sections: [
                  {
                    title: "Answers",
                    rows: buttons.map((b) => ({ id: b.data, title: b.label.slice(0, 24) })),
                  },
                ],
              },
            };
      return message(chatId, {
        type: "interactive",
        interactive: { body: { text: body }, ...action },
      });
    },
    async file(chatId, file, caption) {
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      form.set("type", file.type);
      form.set("file", new Blob([new Uint8Array(file.content)], { type: file.type }), file.name);
      const uploaded = await graph<{ id?: string }>(token, `${phoneNumberId}/media`, { form });
      if (!uploaded.id) throw new BotApiError(500, "WhatsApp did not take the file");
      return message(chatId, {
        type: "document",
        document: {
          id: uploaded.id,
          filename: file.name,
          ...(caption ? { caption: caption.slice(0, 1000) } : {}),
        },
      });
    },
    // WhatsApp has no spinner to stop, no buttons to take off and no deleting of the owner's message.
    async ack() {},
    async clearButtons() {},
    canRemove: false,
    async remove() {
      return false;
    },
    async typing() {},
  };
}

type WaMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } };
  button?: { payload?: string };
};
type WaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: WaMessage[];
      };
    }>;
  }>;
};

/** The owner's messages in one webhook call, with the business number each came to. */
export function readWhatsAppPayload(raw: unknown): Array<Incoming & { phoneNumberId: string }> {
  const out: Array<Incoming & { phoneNumberId: string }> = [];
  for (const entry of (raw as WaPayload | null)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const m of value?.messages ?? []) {
        if (!m.id || !m.from) continue;
        const name = value?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const pressed =
          m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.button?.payload;
        out.push({
          phoneNumberId,
          updateId: m.id,
          chatId: m.from,
          privateChat: true,
          fromName: name,
          messageId: m.id,
          text: m.type === "text" ? (m.text?.body ?? null) : null,
          media:
            m.type === "audio"
              ? "voice"
              : m.type && ["image", "document", "video", "sticker"].includes(m.type)
                ? "file"
                : null,
          callback: pressed ? { id: null, data: pressed, messageId: null } : null,
        });
      }
    }
  }
  return out;
}
