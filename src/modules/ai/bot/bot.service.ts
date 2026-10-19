import { Prisma, type AiBotChannel, type AiBotLink } from "@prisma/client";
import { randomInt } from "node:crypto";
import { z } from "zod";

import { decryptSecret, derivedSecret, encryptSecret, hashText } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import {
  aiSettingsOf,
  BOT_PIN_DAY_MINUTES,
  BOT_PIN_SUBJECT,
  offReason,
  OFF_TEXT,
} from "../settings.service";
import { BotApiError, type BotSender } from "./channel";
import {
  TELEGRAM_TOKEN,
  telegramBotKey,
  telegramDeleteWebhook,
  telegramMe,
  telegramSender,
  telegramSetWebhook,
} from "./telegram";
import { PHONE_NUMBER_ID, whatsappNumber, whatsappSender } from "./whatsapp";

/*
 * AI Center > Bot: the owner connects a Telegram bot (now) or the WhatsApp
 * Business number (later, no code change), then links their own account with
 * a one-time code. From then on only that chat is heard; anyone else gets
 * nothing. Tokens and secrets are sealed and never shown again. Each store
 * (company) has its own connection; stores that share one bot are picked by
 * the name at the start of a message ("EXTAS: আজকের সেল রিপোর্ট").
 */

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner sets up the bot.");
  }
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export const webhookUrl = (channel: AiBotChannel) =>
  `${appUrl()}/api/bot/${channel === "TELEGRAM" ? "telegram" : "whatsapp"}/webhook`;

export const BOT_NAMES: Record<AiBotChannel, string> = {
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
};

/** The secret Telegram sends back on every update: the same for every store sharing the bot. */
export const telegramSecret = (token: string) => derivedSecret("telegram-webhook", token);

/** How a provider's own words read to the owner (the token never appears in them). */
const plain = (error: unknown) =>
  error instanceof BotApiError ? error.description.slice(0, 300) : "it could not be reached";

/** The sender for a connection: Telegram or WhatsApp, with its own token. */
export function senderFor(link: Pick<AiBotLink, "channel" | "botKey" | "tokenSealed">): BotSender {
  const token = decryptSecret(link.tokenSealed);
  return link.channel === "TELEGRAM" ? telegramSender(token) : whatsappSender(link.botKey, token);
}

async function linkOf(ctx: CompanyContext, channel: AiBotChannel) {
  return prisma.aiBotLink.findUnique({
    where: { companyId_channel: { companyId: ctx.company.id, channel } },
  });
}

// ---------------------------------------------------------------- Telegram

export const telegramSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(TELEGRAM_TOKEN, "Paste the whole token from @BotFather, like 123456789:AA…"),
});

/** Connects a Telegram bot: checks the token, points the bot's webhook here and keeps the token sealed. */
export async function saveTelegram(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  checkRateLimit(`bot-save:${ctx.company.id}`, 10, 10 * 60_000);
  const { token } = telegramSchema.parse(input);
  let me: Awaited<ReturnType<typeof telegramMe>>;
  try {
    me = await telegramMe(token);
  } catch (error) {
    if (error instanceof BotApiError && error.status < 500) {
      throw new AppError(
        "VALIDATION",
        "Telegram did not accept this token. Copy it again from @BotFather.",
        {
          token: ["Telegram did not accept this token"],
        },
      );
    }
    throw new AppError(
      "UNAVAILABLE",
      `Telegram could not be reached (${plain(error)}). Try again.`,
    );
  }
  const secret = telegramSecret(token);
  let webhookError: string | null = null;
  try {
    await telegramSetWebhook(token, webhookUrl("TELEGRAM"), secret);
  } catch (error) {
    // Telegram only calls https addresses: on a test computer the bot cannot be reached.
    webhookError = `Telegram could not set the address (${plain(error)}). The site needs https.`;
  }
  const botKey = telegramBotKey(token);
  const botName = me.username ? `@${me.username}` : me.first_name;
  const before = await linkOf(ctx, "TELEGRAM");
  const fields = {
    botKey,
    botName,
    tokenSealed: encryptSecret(token),
    webhookKey: hashText(secret),
    webhookError,
    updatedById: ctx.user.id,
  };
  // Another bot: the owner links their account to it again.
  const unlinked = {
    chatId: null,
    chatName: null,
    linkedAt: null,
    pending: Prisma.DbNull,
    pendingUntil: null,
  };
  await prisma.aiBotLink.upsert({
    where: { companyId_channel: { companyId: ctx.company.id, channel: "TELEGRAM" } },
    create: { companyId: ctx.company.id, channel: "TELEGRAM", ...fields },
    update: { ...fields, ...(before?.botKey === botKey ? {} : unlinked) },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiBotLink",
    entityId: ctx.company.id,
    summary: `Bot: Telegram ${botName} connected`,
  });
  return { botName, webhookError };
}

// ---------------------------------------------------------------- WhatsApp

export const whatsappSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(PHONE_NUMBER_ID, "The phone number ID from Meta (digits only)"),
  token: z.string().trim().max(1000).optional(),
  appSecret: z.string().trim().max(200).optional(),
});

/**
 * Connects the WhatsApp Business number (the plug ready for later): checks the
 * number with the token and keeps the token and app secret sealed. Empty
 * fields keep what was saved before.
 */
export async function saveWhatsApp(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  checkRateLimit(`bot-save:${ctx.company.id}`, 10, 10 * 60_000);
  const data = whatsappSchema.parse(input);
  const before = await linkOf(ctx, "WHATSAPP");
  const token = data.token || (before ? decryptSecret(before.tokenSealed) : "");
  const appSecret =
    data.appSecret || (before?.appSecretSealed ? decryptSecret(before.appSecretSealed) : "");
  if (token.length < 20) {
    throw new AppError("VALIDATION", "Paste the access token from Meta.", {
      token: ["Paste the access token"],
    });
  }
  if (appSecret.length < 16) {
    throw new AppError("VALIDATION", "Paste the app secret from Meta.", {
      appSecret: ["Paste the app secret"],
    });
  }
  let number: Awaited<ReturnType<typeof whatsappNumber>>;
  try {
    number = await whatsappNumber(data.phoneNumberId, token);
  } catch (error) {
    if (error instanceof BotApiError && error.status < 500) {
      throw new AppError(
        "VALIDATION",
        "Meta did not accept the number ID or the token. Check both.",
        {
          phoneNumberId: ["Check the number ID and the token"],
        },
      );
    }
    throw new AppError("UNAVAILABLE", `Meta could not be reached (${plain(error)}). Try again.`);
  }
  const verifyToken = before?.verifyTokenSealed
    ? decryptSecret(before.verifyTokenSealed)
    : derivedSecret("whatsapp-verify", `${ctx.company.id}:${Date.now()}`);
  const fields = {
    botKey: data.phoneNumberId,
    botName: number.display_phone_number ?? number.verified_name ?? data.phoneNumberId,
    tokenSealed: encryptSecret(token),
    appSecretSealed: encryptSecret(appSecret),
    verifyTokenSealed: encryptSecret(verifyToken),
    webhookKey: hashText(verifyToken),
    webhookError: null,
    updatedById: ctx.user.id,
  };
  await prisma.aiBotLink.upsert({
    where: { companyId_channel: { companyId: ctx.company.id, channel: "WHATSAPP" } },
    create: { companyId: ctx.company.id, channel: "WHATSAPP", ...fields },
    update: {
      ...fields,
      ...(before?.botKey === data.phoneNumberId
        ? {}
        : {
            chatId: null,
            chatName: null,
            linkedAt: null,
            pending: Prisma.DbNull,
            pendingUntil: null,
          }),
    },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiBotLink",
    entityId: ctx.company.id,
    summary: `Bot: WhatsApp ${fields.botName} connected`,
  });
  return { botName: fields.botName };
}

// ---------------------------------------------------------------- linking the owner

const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_MINUTES = 10;

export const channelSchema = z.enum(["TELEGRAM", "WHATSAPP"]);

/**
 * A one-time code the owner sends to the bot from their own account (10
 * minutes). Asking for it moves nothing: the bot stays with the chat and the
 * person linked now until the code is sent from the asker's chat (v6.4.1).
 */
export async function startLink(ctx: CompanyContext, rawChannel: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const channel = channelSchema.parse(rawChannel);
  checkRateLimit(`bot-link:${ctx.company.id}`, 10, 10 * 60_000);
  const link = await linkOf(ctx, channel);
  if (!link) throw new AppError("NOT_FOUND", `Connect the ${BOT_NAMES[channel]} bot first.`);
  const code = Array.from({ length: 8 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join(
    "",
  );
  const until = new Date(Date.now() + CODE_MINUTES * 60_000);
  await prisma.aiBotLink.update({
    where: { id: link.id },
    data: { linkCodeHash: hashText(code), linkCodeUntil: until, linkCodeOwnerId: ctx.user.id },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiBotLink",
    entityId: ctx.company.id,
    summary: `Bot: a link code for ${BOT_NAMES[channel]} was made`,
  });
  const digits = link.botName?.replace(/\D/g, "") ?? "";
  return {
    code,
    until,
    open:
      channel === "TELEGRAM"
        ? link.botName?.startsWith("@")
          ? `https://t.me/${link.botName.slice(1)}?start=${code}`
          : null
        : digits
          ? `https://wa.me/${digits}?text=${code}`
          : null,
  };
}

/** Stops hearing the linked account (the bot stays connected). */
export async function unlinkBot(ctx: CompanyContext, rawChannel: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const channel = channelSchema.parse(rawChannel);
  const link = await linkOf(ctx, channel);
  if (!link) throw new AppError("NOT_FOUND", "There is no bot to unlink.");
  await prisma.aiBotLink.update({
    where: { id: link.id },
    data: {
      chatId: null,
      chatName: null,
      linkedAt: null,
      linkCodeHash: null,
      linkCodeUntil: null,
      linkCodeOwnerId: null,
      pending: Prisma.DbNull,
      pendingUntil: null,
    },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiBotLink",
    entityId: ctx.company.id,
    summary: `Bot: ${BOT_NAMES[channel]} unlinked from ${link.chatName ?? "the owner's account"}`,
  });
}

/** Removes the connection and its sealed token (Telegram stops calling, unless another store shares the bot). */
export async function removeBot(ctx: CompanyContext, rawChannel: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const channel = channelSchema.parse(rawChannel);
  const link = await linkOf(ctx, channel);
  if (!link) throw new AppError("NOT_FOUND", "There is no bot to remove.");
  const shared = await prisma.aiBotLink.count({
    where: { channel, botKey: link.botKey, id: { not: link.id } },
  });
  if (channel === "TELEGRAM" && shared === 0) {
    await telegramDeleteWebhook(decryptSecret(link.tokenSealed)).catch(() => undefined);
  }
  await prisma.aiBotLink.delete({ where: { id: link.id } });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiBotLink",
    entityId: ctx.company.id,
    summary: `Bot: ${BOT_NAMES[channel]} ${link.botName ?? ""} removed`,
  });
}

/** Keeps one message in the bot's log. */
export async function logBot(
  link: Pick<AiBotLink, "id" | "companyId" | "channel">,
  row: {
    direction: "IN" | "OUT";
    chatId: string | null;
    text: string;
    status: "SENT" | "FAILED" | "DONE" | "IGNORED" | "RECEIVED";
    error?: string | null;
  },
) {
  await prisma.aiBotMessage
    .create({
      data: {
        companyId: link.companyId,
        linkId: link.id,
        channel: link.channel,
        direction: row.direction,
        chatId: row.chatId,
        text: row.text.slice(0, 2000),
        status: row.status,
        error: row.error?.slice(0, 500) ?? null,
      },
    })
    .catch((error: unknown) => console.error("[bot] log failed", error));
}

/** A test message to the linked account. */
export async function testBot(ctx: CompanyContext, rawChannel: unknown) {
  assertManage(ctx);
  const channel = channelSchema.parse(rawChannel);
  checkRateLimit(`bot-test:${ctx.company.id}`, 5, 10 * 60_000);
  const link = await linkOf(ctx, channel);
  if (!link?.linkedAt || !link.chatId)
    throw new AppError("CONFLICT", "Link your account to the bot first.");
  const text = `Test from ${ctx.company.name} ERP: the bot works. Write "help" to see what you can say.`;
  try {
    await senderFor(link).send(link.chatId, { text, buttons: [] });
  } catch (error) {
    await logBot(link, {
      direction: "OUT",
      chatId: link.chatId,
      text,
      status: "FAILED",
      error: plain(error),
    });
    throw new AppError("UNAVAILABLE", `The test message did not go: ${plain(error)}.`);
  }
  await logBot(link, { direction: "OUT", chatId: link.chatId, text, status: "SENT" });
}

// ---------------------------------------------------------------- the screen

/** AI Center > Bot (the owner's): both plugs, the PIN, the AI's state and the last messages. */
export async function getBot(ctx: CompanyContext) {
  assertManage(ctx);
  const [links, settings, messages, pinTries] = await Promise.all([
    prisma.aiBotLink.findMany({ where: { companyId: ctx.company.id } }),
    aiSettingsOf(ctx.company.id),
    prisma.aiBotMessage.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.aiPinTry.findUnique({
      where: {
        companyId_subjectKey_kind: {
          companyId: ctx.company.id,
          subjectKey: BOT_PIN_SUBJECT,
          kind: "BOT_PIN",
        },
      },
      select: { count: true, windowStart: true },
    }),
  ]);
  const now = new Date();
  const dayStart = now.getTime() - BOT_PIN_DAY_MINUTES * 60_000;
  const shown = (channel: AiBotChannel) => {
    const link = links.find((l) => l.channel === channel);
    if (!link) return null;
    return {
      botName: link.botName,
      botKey: channel === "WHATSAPP" ? link.botKey : null,
      linked: link.linkedAt !== null,
      chatName: link.chatName,
      linkedAt: link.linkedAt,
      codeWaiting: link.linkCodeUntil !== null && link.linkCodeUntil > now && !link.linkedAt,
      webhookError: link.webhookError,
      // Pasted into the Meta app by the owner; only the owner sees this page.
      verifyToken: link.verifyTokenSealed ? decryptSecret(link.verifyTokenSealed) : null,
      updatedAt: link.updatedAt,
    };
  };
  const off = offReason(settings);
  return {
    telegram: shown("TELEGRAM"),
    whatsapp: shown("WHATSAPP"),
    webhooks: { telegram: webhookUrl("TELEGRAM"), whatsapp: webhookUrl("WHATSAPP") },
    pinSet: settings.pinHash !== null,
    // Wrong PINs the bot asked for, in the day; PIN actions stop after 20 (v6.4.2).
    pinLock: {
      lockedAt: settings.botPinLockedAt,
      wrongToday: pinTries && pinTries.windowStart.getTime() > dayStart ? pinTries.count : 0,
    },
    ai: { state: off ?? ("on" as const), text: off ? OFF_TEXT[off] : null },
    messages: messages.map((m) => ({
      id: m.id,
      at: m.createdAt,
      channel: m.channel,
      direction: m.direction,
      text: m.text.length > 300 ? `${m.text.slice(0, 299)}…` : m.text,
      status: m.status,
      error: m.error,
    })),
  };
}

export type BotScreen = Awaited<ReturnType<typeof getBot>>;
