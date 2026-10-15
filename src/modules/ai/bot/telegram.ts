import { BotApiError, botCall, type BotSender, type Incoming } from "./channel";

/*
 * The Telegram plug (Bot API, free). The owner makes a bot with @BotFather and
 * pastes its token in AI Center > Bot; the ERP sets the bot's webhook to
 * /api/bot/telegram/webhook with a secret token Telegram sends back on every
 * update, so only Telegram can call it.
 */

const API = "https://api.telegram.org";

export const TELEGRAM_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;

/** The bot's own number, the part of the token before the colon. */
export const telegramBotKey = (token: string) => token.split(":")[0]!;

async function tg<T>(
  token: string,
  method: string,
  payload?: { json?: unknown; form?: FormData },
): Promise<T> {
  const { status, body } = await botCall({
    url: `${API}/bot${token}/${method}`,
    method: "POST",
    json: payload?.form ? undefined : (payload?.json ?? {}),
    form: payload?.form,
  });
  const reply = body as { ok?: boolean; result?: T; description?: string } | null;
  if (!reply?.ok)
    throw new BotApiError(status, reply?.description ?? `Telegram answered ${status}`);
  return reply.result as T;
}

export function telegramMe(token: string) {
  return tg<{ id: number; username?: string; first_name: string }>(token, "getMe");
}

export function telegramSetWebhook(token: string, url: string, secret: string) {
  return tg<boolean>(token, "setWebhook", {
    json: {
      url,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    },
  });
}

export function telegramDeleteWebhook(token: string) {
  return tg<boolean>(token, "deleteWebhook", { json: { drop_pending_updates: true } });
}

const keyboard = (buttons: Array<Array<{ label: string; data: string }>>) =>
  buttons.length > 0
    ? {
        inline_keyboard: buttons.map((row) =>
          row.map((b) => ({ text: b.label, callback_data: b.data })),
        ),
      }
    : undefined;

export function telegramSender(token: string): BotSender {
  return {
    channel: "TELEGRAM",
    async send(chatId, out) {
      const sent = await tg<{ message_id: number }>(token, "sendMessage", {
        json: {
          chat_id: chatId,
          text: out.text,
          reply_markup: keyboard(out.buttons),
          link_preview_options: { is_disabled: true },
        },
      });
      return String(sent.message_id);
    },
    async file(chatId, file, caption) {
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set(
        "document",
        new Blob([new Uint8Array(file.content)], { type: file.type }),
        file.name,
      );
      if (caption) form.set("caption", caption.slice(0, 1000));
      const sent = await tg<{ message_id: number }>(token, "sendDocument", { form });
      return String(sent.message_id);
    },
    async ack(callbackId, text) {
      if (!callbackId) return;
      await tg(token, "answerCallbackQuery", {
        json: { callback_query_id: callbackId, text },
      }).catch(() => undefined);
    },
    async clearButtons(chatId, messageId) {
      if (!messageId) return;
      await tg(token, "editMessageReplyMarkup", {
        json: {
          chat_id: chatId,
          message_id: Number(messageId),
          reply_markup: { inline_keyboard: [] },
        },
      }).catch(() => undefined);
    },
    async remove(chatId, messageId) {
      if (!messageId) return;
      await tg(token, "deleteMessage", {
        json: { chat_id: chatId, message_id: Number(messageId) },
      }).catch(() => undefined);
    },
    async typing(chatId) {
      await tg(token, "sendChatAction", { json: { chat_id: chatId, action: "typing" } }).catch(
        () => undefined,
      );
    },
  };
}

type TgUser = { id?: number; first_name?: string; username?: string };
type TgMessage = {
  message_id?: number;
  chat?: { id?: number; type?: string };
  from?: TgUser;
  text?: string;
  voice?: unknown;
  audio?: unknown;
  photo?: unknown;
  document?: unknown;
  video?: unknown;
};
type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  callback_query?: { id?: string; from?: TgUser; data?: string; message?: TgMessage };
};

/** One update from Telegram, read; null for kinds the bot does not take. */
export function readTelegramUpdate(raw: unknown): Incoming | null {
  const update = raw as TgUpdate | null;
  if (!update || typeof update.update_id !== "number") return null;
  const name = (u?: TgUser) =>
    u ? [u.first_name, u.username ? `@${u.username}` : null].filter(Boolean).join(" ") : null;
  const callback = update.callback_query;
  if (callback?.message?.chat?.id !== undefined && callback.from?.id !== undefined) {
    return {
      updateId: String(update.update_id),
      chatId: String(callback.message.chat.id),
      // In a private chat the chat is the person: a button pressed by anyone else does nothing.
      privateChat:
        callback.message.chat.type === "private" && callback.message.chat.id === callback.from.id,
      fromName: name(callback.from),
      messageId:
        callback.message.message_id !== undefined ? String(callback.message.message_id) : null,
      text: null,
      media: null,
      callback: {
        id: callback.id ?? null,
        data: String(callback.data ?? ""),
        messageId:
          callback.message.message_id !== undefined ? String(callback.message.message_id) : null,
      },
    };
  }
  const message = update.message;
  if (!message?.chat || message.chat.id === undefined) return null;
  return {
    updateId: String(update.update_id),
    chatId: String(message.chat.id),
    privateChat: message.chat.type === "private" && message.from?.id === message.chat.id,
    fromName: name(message.from),
    messageId: message.message_id !== undefined ? String(message.message_id) : null,
    text: typeof message.text === "string" ? message.text : null,
    media:
      message.voice || message.audio
        ? "voice"
        : message.photo || message.document || message.video
          ? "file"
          : null,
    callback: null,
  };
}
