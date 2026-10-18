import { type AiBotChannel, type AiBotLink, type BackgroundJob, Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { decryptSecret, hashText } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { tenantDb } from "@/lib/tenant-db";
import { unlockSignIn } from "@/modules/auth/auth.service";
import type { CompanyContext } from "@/modules/auth/context";
import { readStoredFile } from "@/modules/files/file.service";
import { enqueueJob } from "@/modules/jobs/queue";
import { kickJobWorker } from "@/modules/jobs/worker";

import type { CardStatus, ChatCard } from "../chat/cards";
import { applyCard, cancelCard, sendChat } from "../chat/chat.service";
import { storePrefix, westernDigits } from "../chat/intents";
import { discardDraft, PRICE_DRAFTS, sendDraft } from "../drafts.service";
import { decideHouseRule } from "../house-rules.service";
import { cardPinReason } from "../chat/chat.service";
import { answerDeletion, answerPermission, needsPin } from "../requests.service";
import {
  aiSettingsOf,
  BOT_PIN_ALARM_FROM,
  BOT_PIN_LOCK_AFTER,
  BOT_PIN_LOCKED,
  checkBotPin,
  PIN_CHECKED,
} from "../settings.service";
import { logBot, senderFor } from "./bot.service";
import { botOwner } from "./owner";
import type { Incoming } from "./channel";
import { type BotOut, type ButtonPress, draftVersion, readButton, renderAnswer } from "./render";
import { readTelegramUpdate } from "./telegram";
import { PIN_TEXT } from "./pin-scrub";
import { readWhatsAppPayload, whatsappSignatureOk } from "./whatsapp";
import { pinCandidates } from "../pin-tries";

/*
 * What reaches the bot. The webhook only checks who is calling (Telegram's
 * secret token, Meta's signature), keeps the message once (a repeated delivery
 * is dropped) and hands it to the background worker, so the provider gets its
 * answer at once. The worker then:
 *   - links the owner's account when the one-time code arrives;
 *   - answers only the linked owner's own private chat (anyone else: nothing
 *     is sent back, and the message is only logged);
 *   - picks the store: the name at the start ("EXTAS: ..."), else the only
 *     store linked to this chat, else one question; the message is kept in
 *     that store's log (stores sharing one bot each see only their own);
 *   - passes the words to Mehedi 2.0's chat (the same commands, Control and
 *     log as in the ERP) and sends the answers back with their buttons;
 *   - for money, prices, locked cells and Deletion requests asks for the PIN,
 *     takes it from the next message and removes that message from the chat
 *     (tried again a few times; when it cannot be removed the owner is told to
 *     delete it). The PIN is checked the moment it arrives and never kept: the
 *     log, the background job and AI Center > Bot only ever see "[PIN]". From
 *     the 5th wrong PIN in a day the owner is alarmed; after 20, PIN actions on
 *     the bot stop until the owner unlocks them in the ERP (v6.4.2);
 *   - hides every other message with a number that could be a PIN, unchecked,
 *     always the same way, so its answer never tells whether it was the PIN.
 */

const PIN_MINUTES = 5;
/** "bug guard", "bug guard now", "বাগ গার্ড": Bug Guard runs now. */
const GUARD_WORDS = /^\s*(bug ?guard|বাগ ?গার্ড)(\s+(now|run|চালাও|এখন))?\s*[.!]?\s*$/i;
const CODE = /^(?:\/start\s+)?([A-Z2-9]{8})$/;
/** "unlock", "/unlock", "unlock sign-in", "আনলক": the owner's sign-in, with the PIN (v6.4.1 B5). */
const UNLOCK_WORDS = /^\s*\/?(unlock( my)?( sign[- ]?in)?|আনলক)\s*[.!]?\s*$/i;

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const described = (m: Incoming) =>
  m.text ?? (m.callback ? `[button] ${m.callback.data}` : m.media ? `[${m.media}]` : "[other]");

/** A provider's unique message id was seen already (a repeated delivery). */
const isRepeat = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** What the log, the job and the screen keep instead of a PIN. */
export { PIN_TEXT };

const STOP_WORDS = /^(cancel|stop|বাতিল|না)$/i;

/** A PIN check made as the message arrived: per waiting store, right, wrong, or why not. */
type PinChecks = Record<string, { right: boolean; problem?: string; wrongToday?: number }>;

/**
 * The PIN a waiting store asked for, checked now (so it is never written
 * anywhere): null when no store of this chat waits for one, or the owner wrote
 * "বাতিল".
 */
async function checkPinNow(mine: AiBotLink[], m: Incoming, now: Date): Promise<PinChecks | null> {
  const text = m.text?.trim() ?? "";
  if (!text || m.callback || STOP_WORDS.test(text)) return null;
  const waiting = mine.filter((l) => l.pending && l.pendingUntil && l.pendingUntil > now);
  if (waiting.length === 0) return null;
  const checks: PinChecks = {};
  for (const link of waiting) {
    try {
      checks[link.id] = await checkBotPin(
        link.companyId,
        westernDigits(text),
        link.ownerId ?? link.id,
      );
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      checks[link.id] = { right: false, problem: error.message };
    }
  }
  return checks;
}

/** A message that looks like a PIN: 4 to 8 digits and nothing else. */
const LOOKS_LIKE_PIN = /^\s*\d{4,8}\s*$/;

/** A PIN request that ran out this long ago still makes digits a (late) PIN. */
const LATE_PIN_MINUTES = 60;

/**
 * Digits that may be a PIN although no store waits for one now (v6.4 A5), so
 * they are hidden everywhere too: "late" when a store asked for the PIN and
 * the five minutes ran out (in the last hour), "stray" for any other message
 * of the linked owner's own chat with a number that could be a PIN (pinCandidates:
 * 4 to 8 digits, alone or among words, Bengali digits too; not a document
 * number like PO4501 or CS-2026-0001). A stray number is never checked against
 * the PIN (v6.4.2): every one is hidden the same way and with the same words,
 * so the bot's answer never tells whether it was the PIN, however many numbers
 * are sent.
 */
function hiddenPin(mine: AiBotLink[], m: Incoming, now: Date): "late" | "stray" | null {
  const text = westernDigits(m.text ?? "");
  if (m.callback) return null;
  const since = now.getTime() - LATE_PIN_MINUTES * 60_000;
  if (
    LOOKS_LIKE_PIN.test(text) &&
    mine.some((l) => l.pending && l.pendingUntil && l.pendingUntil.getTime() > since)
  ) {
    return "late";
  }
  return pinCandidates(text).length > 0 ? "stray" : null;
}

/** The store a message is for, when it can be told now; null when the worker must ask. */
async function storeOfMessage(mine: AiBotLink[], m: Incoming) {
  if (mine.length === 0) return null;
  if (m.callback) {
    const press = readButton(m.callback.data);
    return press ? storeOfPress(mine, press) : null;
  }
  const picked = await storeFor(mine, m.text?.trim() ?? "");
  return "ask" in picked ? null : picked;
}

/** Keeps one incoming message and queues its handling; a stranger's is only logged. */
async function keep(links: AiBotLink[], channel: AiBotChannel, botKey: string, m: Incoming) {
  const first = links[0]!;
  const now = new Date();
  const mine = links.filter((l) => l.linkedAt && l.chatId === m.chatId);
  const code = CODE.exec(m.text?.trim() ?? "")?.[1];
  const linking = code
    ? links.find(
        (l) => l.linkCodeHash === hashText(code) && l.linkCodeUntil && l.linkCodeUntil > now,
      )
    : undefined;
  // Only the linked chat, or someone sending a link code while one is waiting, gets as far as the worker.
  const known =
    mine.length > 0 ||
    (code !== undefined && links.some((l) => l.linkCodeUntil && l.linkCodeUntil > now));
  // A stranger is never answered; past a few messages an hour they are not even logged.
  if (!known && !strangerAllowed(first.id, m.chatId)) return;
  // A repeated delivery (Telegram sends an update again when its answer was
  // late, at times at the same moment) is dropped before any PIN check, so one
  // wrong PIN counts once: the delivery is claimed first, on the unique key of
  // the channel and the delivery id, with no text yet (nothing of a PIN).
  const providerId = `${botKey}:${m.updateId}`;
  let claim: { id: string };
  try {
    claim = await prisma.aiBotMessage.create({
      data: {
        companyId: first.companyId,
        linkId: first.id,
        channel,
        direction: "IN",
        providerId,
        chatId: m.chatId,
        text: "",
        status: "IGNORED",
      },
      select: { id: true },
    });
  } catch (error) {
    if (isRepeat(error)) return;
    throw error;
  }
  try {
    const pin = known ? await checkPinNow(mine, m, now) : null;
    // A link code is a command, never a PIN.
    const hidden = known && !pin && !linking ? hiddenPin(mine, m, now) : null;
    // Kept in the store it is for (the worker moves it if it can only tell later).
    const store = hidden
      ? (mine.find((l) => l.pending) ?? mine[0]!)
      : (linking ?? (known ? await storeOfMessage(mine, m) : null) ?? mine[0] ?? first);
    const incoming: Incoming = pin || hidden ? { ...m, text: PIN_TEXT } : m;
    await prisma.$transaction(async (tx) => {
      const row = await tx.aiBotMessage.update({
        where: { id: claim.id },
        data: {
          companyId: store.companyId,
          linkId: store.id,
          text: described(incoming).slice(0, known ? 2000 : 200),
          status: known ? "RECEIVED" : "IGNORED",
        },
      });
      if (known) {
        await enqueueJob(tx, {
          kind: "ai.bot.incoming",
          companyId: store.companyId,
          payload: {
            messageId: row.id,
            channel,
            botKey,
            incoming,
            ...(pin ? { pin } : {}),
            ...(hidden ? { hidden } : {}),
          } as unknown as Prisma.InputJsonObject,
          maxAttempts: 1,
        });
      }
    });
  } catch (error) {
    // Not kept: the claim goes (it never held the message), so Telegram's next try is handled.
    await prisma.aiBotMessage.deleteMany({ where: { id: claim.id, text: "" } });
    throw error;
  }
  if (known) kickJobWorker();
}

/** A webhook call from Telegram. "unknown": no bot here has this secret. */
export async function receiveTelegram(secret: string, raw: unknown): Promise<"ok" | "unknown"> {
  const links = await prisma.aiBotLink.findMany({
    where: { channel: "TELEGRAM", webhookKey: hashText(secret) },
    orderBy: { createdAt: "asc" },
  });
  if (links.length === 0) return "unknown";
  const m = readTelegramUpdate(raw);
  if (m) await keep(links, "TELEGRAM", links[0]!.botKey, m);
  return "ok";
}

/** Meta's webhook check: the challenge back when the verify token is one of ours. */
export async function verifyWhatsApp(token: string): Promise<boolean> {
  return (
    (await prisma.aiBotLink.count({
      where: { channel: "WHATSAPP", webhookKey: hashText(token) },
    })) > 0
  );
}

/** A webhook call from Meta, checked against the app secret of the number it came to. */
export async function receiveWhatsApp(
  rawBody: string,
  signature: string | null,
): Promise<"ok" | "unknown" | "bad-signature"> {
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return "bad-signature";
  }
  const numbers = new Set<string>();
  for (const entry of (
    raw as {
      entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> }>;
    }
  )?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) numbers.add(id);
    }
  }
  if (numbers.size === 0) return "unknown";
  const messages = readWhatsAppPayload(raw);
  for (const phoneNumberId of numbers) {
    const links = await prisma.aiBotLink.findMany({
      where: { channel: "WHATSAPP", botKey: phoneNumberId },
      orderBy: { createdAt: "asc" },
    });
    if (links.length === 0) return "unknown";
    const signed = links.some(
      (l) =>
        l.appSecretSealed &&
        whatsappSignatureOk(rawBody, signature, decryptSecret(l.appSecretSealed)),
    );
    if (!signed) return "bad-signature";
    for (const m of messages.filter((x) => x.phoneNumberId === phoneNumberId)) {
      await keep(links, "WHATSAPP", phoneNumberId, m);
    }
  }
  return "ok";
}

// ---------------------------------------------------------------- the worker

type IncomingJob = {
  messageId: string;
  channel: AiBotChannel;
  botKey: string;
  incoming: Incoming;
  /** The PIN's check, made when it arrived (the PIN itself is not here). */
  pin?: PinChecks;
  /** A PIN typed after its five minutes, or a number that may be one when nothing asked (hiddenPin). */
  hidden?: "late" | "stray";
};

/** Moves a kept message to the store it turned out to be for. */
async function keepUnder(messageId: string, link: AiBotLink) {
  await prisma.aiBotMessage.updateMany({
    where: { id: messageId, NOT: { linkId: link.id } },
    data: { companyId: link.companyId, linkId: link.id },
  });
}

/** The owner, as the bot works for them: their own permissions in the store, never more. */
async function ownerContext(link: AiBotLink): Promise<CompanyContext | null> {
  const owner = await botOwner(link);
  if (!owner) return null;
  const { user, access } = owner;
  const now = new Date();
  return {
    // Not a sign-in: a stand-in for this one message, never saved.
    session: {
      id: `bot-${link.id}`,
      userId: user.id,
      token: "",
      activeCompanyId: link.companyId,
      userAgent: `${link.channel === "TELEGRAM" ? "Telegram" : "WhatsApp"} bot`,
      ipAddress: null,
      expiresAt: new Date(now.getTime() + 60_000),
      lastSeenAt: now,
      createdAt: now,
      checkRoleId: null,
      checkPlatform: false,
    },
    user,
    ...access,
    db: tenantDb(link.companyId),
    can: (permission) => access.permissions.has(permission),
  };
}

/** Sends one message and logs it; a refusal is logged, never thrown at the owner's work. */
async function say(link: AiBotLink, chatId: string, out: BotOut) {
  try {
    await senderFor(link).send(chatId, { text: out.text, buttons: out.buttons });
    await logBot(link, { direction: "OUT", chatId, text: out.text, status: "SENT" });
  } catch (error) {
    console.error("[bot] send failed", error instanceof Error ? error.message : error);
    await logBot(link, {
      direction: "OUT",
      chatId,
      text: out.text,
      status: "FAILED",
      error: error instanceof Error ? error.message : "Not sent",
    });
  }
}

const words = (text: string): BotOut => ({ text, buttons: [] });

/** The report PDF itself, after the words. */
async function sendReport(link: AiBotLink, chatId: string, exportId: string) {
  const row = await prisma.reportExport.findFirst({
    where: { id: exportId, companyId: link.companyId },
    select: {
      title: true,
      file: { select: { storagePath: true, fileName: true, mimeType: true } },
    },
  });
  if (!row?.file) return;
  try {
    await senderFor(link).file(
      chatId,
      { name: row.file.fileName, content: await readStoredFile(row.file), type: row.file.mimeType },
      row.title,
    );
    await logBot(link, {
      direction: "OUT",
      chatId,
      text: `[file] ${row.file.fileName}`,
      status: "SENT",
    });
  } catch (error) {
    await logBot(link, {
      direction: "OUT",
      chatId,
      text: `[file] ${row.file.fileName}`,
      status: "FAILED",
      error: error instanceof Error ? error.message : "Not sent",
    });
  }
}

/** The background job: one message or button press from a bot. */
export async function runBotIncomingJob(job: BackgroundJob) {
  const {
    messageId,
    channel,
    botKey,
    incoming: m,
    pin,
    hidden,
  } = job.payload as unknown as IncomingJob;
  const done = (status: "DONE" | "IGNORED", error?: string) =>
    prisma.aiBotMessage.update({
      where: { id: messageId },
      data: { status, error: error ?? null },
    });
  const links = await prisma.aiBotLink.findMany({
    where: { channel, botKey },
    orderBy: { createdAt: "asc" },
  });
  if (!m.privateChat || links.length === 0) return void (await done("IGNORED"));

  // The one-time code from AI Center > Bot links this chat to the owner.
  const code = CODE.exec(m.text?.trim() ?? "")?.[1];
  if (code) {
    const now = new Date();
    const link = links.find(
      (l) => l.linkCodeHash === hashText(code) && l.linkCodeUntil && l.linkCodeUntil > now,
    );
    if (link) {
      // The code is used once: claimed first, so two copies of it never both link.
      const claimed = await prisma.aiBotLink.updateMany({
        where: { id: link.id, linkCodeHash: link.linkCodeHash },
        data: { linkCodeHash: null, linkCodeUntil: null },
      });
      if (claimed.count === 1) {
        const company = await prisma.company.findUniqueOrThrow({
          where: { id: link.companyId },
          select: { name: true },
        });
        // Whoever asked for the code becomes the owner only now (a code made
        // before v6.4.1 has no asker kept: the owner it set then).
        const ownerId = link.linkCodeOwnerId ?? link.ownerId;
        await tellPreviousChat(link, m.chatId, ownerId, company.name);
        await prisma.aiBotLink.update({
          where: { id: link.id },
          data: {
            ownerId,
            linkCodeOwnerId: null,
            chatId: m.chatId,
            chatName: m.fromName?.slice(0, 120) ?? null,
            linkedAt: now,
            lastInboundAt: now,
            // A PIN request of the person before never carries over.
            pending: Prisma.DbNull,
            pendingUntil: null,
          },
        });
        await prisma.auditLog.create({
          data: {
            companyId: link.companyId,
            userId: ownerId,
            action: "UPDATE",
            entityType: "AiBotLink",
            entityId: link.companyId,
            summary: `Bot: ${channel === "TELEGRAM" ? "Telegram" : "WhatsApp"} linked to ${m.fromName ?? "the owner's account"}`,
          },
        });
        await say(
          link,
          m.chatId,
          words(
            `Linked: this chat now talks to Mehedi 2.0 for ${company.name}. Messages from anyone else get no answer. Write "help" to see what you can say.`,
          ),
        );
        return void (await done("DONE"));
      }
    }
  }

  const mine = links.filter((l) => l.linkedAt && l.chatId === m.chatId);
  if (mine.length === 0) return void (await done("IGNORED"));
  await prisma.aiBotLink.updateMany({
    where: { id: { in: mine.map((l) => l.id) } },
    data: { lastInboundAt: new Date() },
  });

  try {
    if (m.callback) await pressed(mine, m, messageId);
    else if (hidden) await hidePin(mine, m, hidden);
    else await wrote(mine, m, messageId, pin ?? null);
    await done("DONE");
  } catch (error) {
    console.error("[bot] message failed", error);
    await done("DONE", error instanceof Error ? error.message.slice(0, 300) : "Failed");
    await say(
      mine[0]!,
      m.chatId,
      words("Something went wrong on my side. Try again, or use the ERP."),
    );
  }
}

/**
 * Before a link moves to another chat or another person, the chat linked until
 * now is told in one plain line (it then gets nothing more from this store).
 */
async function tellPreviousChat(
  link: AiBotLink,
  newChatId: string,
  newOwnerId: string | null,
  store: string,
) {
  if (!link.linkedAt || !link.chatId) return;
  const sameChat = link.chatId === newChatId;
  if (sameChat && link.ownerId === newOwnerId) return;
  const person = newOwnerId
    ? await prisma.user.findUnique({ where: { id: newOwnerId }, select: { name: true } })
    : null;
  const who = person?.name ?? "another person";
  await say(
    link,
    link.chatId,
    words(
      sameChat
        ? `${store}: this chat is now linked to ${who}'s account, and works with their permissions from now on.`
        : `${store}: the bot was linked to ${who}'s account in another chat. This chat gets no more messages or answers for ${store}.`,
    ),
  );
}

/** What the bot says after hiding a number it did not ask for: the same whatever the number. */
export const NUMBER_HIDDEN_TEXT =
  "Your message had a number of 4 to 8 digits, so it was hidden and nothing was done. The bot hides every such number when it did not ask for your PIN, so nobody can learn your PIN from its answers. Send your PIN only when the bot asks for it. Write an order or document number with its letters (like PO4501), or use the ERP.";

/** Said when a message with the PIN (or what may be it) could not be taken out of the chat. */
export const PIN_NOT_REMOVED_TEXT =
  "I could not delete your message from this chat, and it may hold your PIN. Delete it yourself now: press and hold it, then Delete.";

/** Waits between the tries to delete a message with the PIN (three tries in all). */
const REMOVE_WAITS_MS = [1_000, 2_000];

/**
 * Takes a message that may hold the PIN out of the chat: tried again after a
 * short wait when the provider refuses or cannot be reached; when it still
 * cannot be removed (or never can be, as on WhatsApp), the owner is told to
 * delete it.
 */
async function removePin(link: AiBotLink, chatId: string, messageId: string | null) {
  const sender = senderFor(link);
  for (let i = 0; i <= REMOVE_WAITS_MS.length; i++) {
    if (await sender.remove(chatId, messageId)) return;
    const wait = REMOVE_WAITS_MS[i];
    if (wait === undefined || !sender.canRemove) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  await say(link, chatId, words(PIN_NOT_REMOVED_TEXT));
}

/**
 * A PIN that came too late, or a number that may be the PIN when nothing
 * asked for one: taken out of the chat, a request that ran out is ended, and
 * nothing else is done with it.
 */
async function hidePin(mine: AiBotLink[], m: Incoming, hidden: "late" | "stray") {
  const link = mine.find((l) => l.pending) ?? mine[0]!;
  await removePin(link, m.chatId, m.messageId);
  if (hidden === "late") {
    await prisma.aiBotLink.updateMany({
      where: { id: { in: mine.map((l) => l.id) }, pendingUntil: { lte: new Date() } },
      data: { pending: Prisma.DbNull, pendingUntil: null },
    });
    return say(
      link,
      m.chatId,
      words(
        "The PIN request ran out after 5 minutes, so nothing was done and your PIN was hidden. Press the button again.",
      ),
    );
  }
  // Never checked, so never says whether it was the PIN: every such number gets these words.
  return say(link, m.chatId, words(NUMBER_HIDDEN_TEXT));
}

/**
 * A PIN that came when no request waited for it any more (the same PIN sent
 * twice, or read after its five minutes): taken out of the chat, a request
 * that ran out is ended, and nothing is done with it.
 */
async function pinNotWaited(mine: AiBotLink[], m: Incoming, now: Date) {
  const link = mine.find((l) => l.pending) ?? mine[0]!;
  await removePin(link, m.chatId, m.messageId);
  await prisma.aiBotLink.updateMany({
    where: { id: { in: mine.map((l) => l.id) }, pendingUntil: { lte: now } },
    data: { pending: Prisma.DbNull, pendingUntil: null },
  });
  return say(
    link,
    m.chatId,
    words(
      "Your PIN was hidden. Nothing was waiting for it any more (it was used already, or its 5 minutes ran out), so nothing was done. Press the button again if you still need it.",
    ),
  );
}

/** Which store a message is for: the name at its start, else the only store, else one waiting for a PIN. */
async function storeFor(mine: AiBotLink[], text: string) {
  if (mine.length === 1) return mine[0]!;
  const companies = await prisma.company.findMany({
    where: { id: { in: mine.map((l) => l.companyId) } },
    select: { id: true, name: true },
  });
  const { store } = storePrefix(text);
  if (store) {
    const named = companies.find((c) => c.name.toLowerCase().startsWith(store.toLowerCase()));
    if (named) return mine.find((l) => l.companyId === named.id)!;
  }
  const now = new Date();
  const waiting = mine.filter((l) => l.pendingUntil && l.pendingUntil > now);
  if (waiting.length === 1) return waiting[0]!;
  return { ask: companies.map((c) => c.name) };
}

const meta = (link: AiBotLink): RequestMeta => ({
  userAgent: `${link.channel === "TELEGRAM" ? "Telegram" : "WhatsApp"} bot`,
});

/** The owner wrote something: the PIN asked for, or words for Mehedi 2.0. */
async function wrote(mine: AiBotLink[], m: Incoming, messageId: string, pin: PinChecks | null) {
  const text = m.text?.trim() ?? "";
  // A PIN (found when it arrived) that nothing waits for any more: sent twice,
  // or its five minutes ran out before it was read. Hidden, and never the chat's.
  const now = new Date();
  if (
    (pin !== null || text === PIN_TEXT) &&
    !mine.some((l) => l.pending && l.pendingUntil && l.pendingUntil > now)
  ) {
    return pinNotWaited(mine, m, now);
  }
  const picked = await storeFor(mine, text);
  if ("ask" in picked) {
    return say(
      mine[0]!,
      m.chatId,
      words(
        `Which store? Start with its name, like "${picked.ask[0]}: status". Linked here: ${picked.ask.join(", ")}.`,
      ),
    );
  }
  const link = picked;
  await keepUnder(messageId, link);
  const ctx = await ownerContext(link);
  if (!ctx) {
    return say(
      link,
      m.chatId,
      words("This bot is no longer linked to an owner. Link it again in AI Center > Bot."),
    );
  }
  const sender = senderFor(link);

  // A PIN asked for a moment ago (checked when it arrived): take it out of the
  // chat, and do what waited for it.
  if (link.pendingUntil && link.pendingUntil > new Date() && link.pending && text) {
    await prisma.aiBotLink.update({
      where: { id: link.id },
      data: { pending: Prisma.DbNull, pendingUntil: null },
    });
    if (STOP_WORDS.test(text)) {
      await sender.remove(m.chatId, m.messageId);
      return say(link, m.chatId, words("Stopped: nothing changed."));
    }
    await removePin(link, m.chatId, m.messageId);
    const waiting = link.pending as { press: ButtonPress; sourceId: string | null };
    const check = pin?.[link.id];
    if (check?.problem) return say(link, m.chatId, words(check.problem));
    if (!check?.right) {
      const wrong = check?.wrongToday ?? 0;
      return say(
        link,
        m.chatId,
        words(
          wrong >= BOT_PIN_ALARM_FROM
            ? `The PIN is not right (${wrong} wrong PINs today; after ${BOT_PIN_LOCK_AFTER}, PIN actions on the bot stop until you unlock them in the ERP). Press the button again to try again.`
            : "The PIN is not right. Press the button again to try again.",
        ),
      );
    }
    return act(link, ctx, m.chatId, waiting.press, waiting.sourceId, PIN_CHECKED);
  }

  if (m.media) {
    return say(
      link,
      m.chatId,
      words(
        'I read typed words for now: voice notes and files come later. Type what you need, or "help".',
      ),
    );
  }
  if (!text) return;
  if (UNLOCK_WORDS.test(storePrefix(text).rest)) {
    return act(link, ctx, m.chatId, { kind: "unlock", companyId: link.companyId }, null, null);
  }
  if (GUARD_WORDS.test(storePrefix(text).rest)) {
    const { guardPress } = await import("@/modules/bug-guard/bot-actions");
    return say(
      link,
      m.chatId,
      await guardPress(
        ctx,
        { kind: "guard-run", companyId: link.companyId },
        meta(link),
        undefined,
        appUrl(),
      ),
    );
  }
  await sender.typing(m.chatId);
  let rows: Awaited<ReturnType<typeof sendChat>>;
  try {
    rows = await sendChat(ctx, { text }, meta(link), "BOT");
  } catch (error) {
    if (error instanceof AppError) return say(link, m.chatId, words(error.message));
    if (error instanceof ZodError)
      return say(link, m.chatId, words("Write at most 2000 characters at a time."));
    throw error;
  }
  for (const row of rows) {
    const out = renderAnswer(
      {
        id: row.id,
        text: row.text,
        card: (row.card as ChatCard | null) ?? null,
        cardStatus: (row.cardStatus as CardStatus | null) ?? null,
      },
      appUrl(),
    );
    await say(link, m.chatId, out);
    if (out.exportId) await sendReport(link, m.chatId, out.exportId);
  }
}

/** The store a pressed button belongs to: the store whose record it names. */
async function storeOfPress(mine: AiBotLink[], press: ButtonPress) {
  const where = { companyId: { in: mine.map((l) => l.companyId) } };
  const select = { companyId: true } as const;
  let row: { companyId: string } | null;
  switch (press.kind) {
    case "apply":
    case "cancel":
      row = await prisma.aiChatMessage.findFirst({
        where: { id: press.messageId, ...where },
        select,
      });
      break;
    case "send":
    case "discard":
      row = await prisma.aiDraft.findFirst({ where: { id: press.draftId, ...where }, select });
      break;
    case "rule":
      row = await prisma.houseRule.findFirst({ where: { id: press.ruleId, ...where }, select });
      break;
    case "permission":
      row = await prisma.aiPermissionRequest.findFirst({
        where: { id: press.requestId, ...where },
        select,
      });
      break;
    case "deletion":
      row = await prisma.aiDeletionRequest.findFirst({
        where: { id: press.requestId, ...where },
        select,
      });
      break;
    case "guard":
      row = await prisma.bugGuardFinding.findFirst({
        where: { id: press.findingId, ...where },
        select,
      });
      break;
    case "guard-correction":
      row = await prisma.bugGuardCorrection.findFirst({
        where: { id: press.correctionId, ...where },
        select,
      });
      break;
    case "guard-run":
    case "unlock":
      row = mine.some((l) => l.companyId === press.companyId)
        ? { companyId: press.companyId }
        : null;
      break;
  }
  return row ? (mine.find((l) => l.companyId === row.companyId) ?? null) : null;
}

/** The owner pressed a button under a message. */
async function pressed(mine: AiBotLink[], m: Incoming, messageId: string) {
  const press = readButton(m.callback!.data);
  const link = press ? await storeOfPress(mine, press) : null;
  if (!press || !link) {
    await senderFor(mine[0]!).ack(m.callback!.id, "This is not there any more.");
    return;
  }
  await keepUnder(messageId, link);
  await senderFor(link).ack(m.callback!.id);
  const ctx = await ownerContext(link);
  if (!ctx) {
    return say(
      link,
      m.chatId,
      words("This bot is no longer linked to an owner. Link it again in AI Center > Bot."),
    );
  }
  return act(link, ctx, m.chatId, press, m.callback!.messageId, null);
}

/** Whether a press needs the PIN: money, prices, locked cells and Deletion requests. */
async function pinNeeded(ctx: CompanyContext, press: ButtonPress): Promise<string | null> {
  switch (press.kind) {
    case "apply": {
      const row = await ctx.db.aiChatMessage.findFirst({
        where: { id: press.messageId },
        select: { card: true },
      });
      const card = row?.card as ChatCard | null;
      return card?.type === "change" ? cardPinReason(card) : null;
    }
    case "send": {
      const draft = await ctx.db.aiDraft.findFirst({
        where: { id: press.draftId },
        select: { kind: true },
      });
      return draft && PRICE_DRAFTS.has(draft.kind) ? "send the price to the buyer" : null;
    }
    case "permission": {
      if (press.answer === "REFUSED") return null;
      const request = await ctx.db.aiPermissionRequest.findFirst({
        where: { id: press.requestId },
        select: { node: true },
      });
      return request && needsPin(request.node) ? "give this permission (money or prices)" : null;
    }
    case "deletion":
      return press.approve ? "approve the Deletion request" : null;
    case "guard": {
      if (press.choice !== "fix") return null;
      const finding = await ctx.db.bugGuardFinding.findFirst({
        where: { id: press.findingId },
        select: { fixKind: true },
      });
      return finding?.fixKind === "SECURITY" ? "take this security step" : null;
    }
    case "unlock":
      return "unlock your sign-in";
    case "guard-correction":
      return press.choice === "apply"
        ? "apply a data correction"
        : press.choice === "undo"
          ? "undo a data correction"
          : null;
    default:
      return null;
  }
}

/**
 * Whether the draft still says what the pressed message showed (its version
 * on the Send button). A button without one (made before v6.4.1) cannot tell,
 * so it is refused the same way. A draft not found is left to sendDraft.
 */
async function draftAsShown(
  ctx: CompanyContext,
  press: Extract<ButtonPress, { kind: "send" }>,
): Promise<boolean> {
  const draft = await ctx.db.aiDraft.findFirst({
    where: { id: press.draftId },
    select: { subject: true, toAddress: true, body: true },
  });
  if (!draft) return true;
  return (
    press.version !== undefined &&
    press.version ===
      draftVersion({ subject: draft.subject, to: draft.toAddress, body: draft.body })
  );
}

/** Does what a button asks, in the owner's name; the PIN first where it is needed. */
async function act(
  link: AiBotLink,
  ctx: CompanyContext,
  chatId: string,
  press: ButtonPress,
  sourceId: string | null,
  pin: typeof PIN_CHECKED | null,
) {
  const sender = senderFor(link);
  // Send sends only the draft as its message showed it: checked before the PIN
  // is asked and again after it (the draft may change in between).
  if (press.kind === "send" && !(await draftAsShown(ctx, press))) {
    return say(
      link,
      chatId,
      words(
        'This draft was changed after that message showed it, so nothing was sent. Write "পাঠাও" to see it as it is now, then press Send under it.',
      ),
    );
  }
  if (pin === null) {
    const why = await pinNeeded(ctx, press);
    if (why) {
      const settings = await aiSettingsOf(link.companyId);
      if (!settings.pinHash) {
        return say(
          link,
          chatId,
          words(
            "Set your PIN first in AI Center > Settings: the bot asks for it for money, prices, locked cells and Deletion requests.",
          ),
        );
      }
      // After too many wrong PINs the bot asks for none until the owner unlocks it in the ERP.
      if (settings.botPinLockedAt) return say(link, chatId, words(BOT_PIN_LOCKED));
      await prisma.aiBotLink.update({
        where: { id: link.id },
        data: {
          pending: { press, sourceId } as unknown as Prisma.InputJsonObject,
          pendingUntil: new Date(Date.now() + PIN_MINUTES * 60_000),
        },
      });
      return say(link, chatId, words(`Send your PIN to ${why}. (Write "বাতিল" to stop.)`));
    }
  }
  const m = meta(link);
  let result: string;
  try {
    switch (press.kind) {
      case "apply":
        await applyCard(ctx, press.messageId, m, pin ?? undefined);
        result = "Done.";
        break;
      case "cancel":
        await cancelCard(ctx, press.messageId);
        result = "Cancelled: nothing changed.";
        break;
      case "send": {
        const draft = await ctx.db.aiDraft.findFirstOrThrow({
          where: { id: press.draftId },
          select: { subject: true, toAddress: true },
        });
        await sendDraft(ctx, press.draftId, m, pin ?? undefined);
        result = `Sent "${draft.subject}" to ${draft.toAddress}.`;
        break;
      }
      case "discard":
        await discardDraft(ctx, press.draftId, m);
        result = "Discarded: it is kept in Drafts, not sent.";
        break;
      case "rule":
        await decideHouseRule(ctx, press.ruleId, { approve: press.approve }, m);
        result = press.approve
          ? "Approved: the rule counts from now on."
          : "Rejected: the rule does not count.";
        break;
      case "permission":
        await answerPermission(ctx, press.requestId, { answer: press.answer }, m, pin ?? undefined);
        result = press.answer === "REFUSED" ? "Answered: no." : "Answered: he may do it.";
        break;
      case "deletion":
        await answerDeletion(ctx, press.requestId, { approve: press.approve }, m, pin ?? undefined);
        result = press.approve
          ? "Approved: it is deleted (cancelled) in your name."
          : "Refused: it stays.";
        break;
      case "unlock":
        // Only ever with the PIN (pinNeeded), and only the bot's own owner.
        if (pin !== PIN_CHECKED) return;
        await unlockSignIn(ctx.user.id, "through the bot, with the PIN", m);
        result =
          "Unlocked: wrong passwords before now no longer slow down your sign-in. Sign in with your password.";
        break;
      case "guard":
      case "guard-run":
      case "guard-correction": {
        const { guardPress } = await import("@/modules/bug-guard/bot-actions");
        const out = await guardPress(ctx, press, m, pin ?? undefined, appUrl());
        await sender.clearButtons(chatId, sourceId);
        return say(link, chatId, out);
      }
    }
  } catch (error) {
    if (error instanceof AppError) return say(link, chatId, words(`Not done: ${error.message}`));
    throw error;
  }
  await sender.clearButtons(chatId, sourceId);
  await say(link, chatId, words(result));
}

/** A cap on what one stranger can make the log keep (the bot never answers them). */
function strangerAllowed(linkId: string, chatId: string) {
  try {
    checkRateLimit(`bot-stranger:${linkId}:${chatId}`, 20, 60 * 60_000);
    return true;
  } catch {
    return false;
  }
}
