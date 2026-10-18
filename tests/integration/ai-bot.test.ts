import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * The bot (part 9 of v6.2): Telegram now, WhatsApp ready for later. Only the
 * owner's own linked chat is answered, with the same commands, Control and log
 * as the ERP chat; buttons apply change cards and answer requests; the PIN is
 * asked for money, prices and Deletion requests; tokens stay sealed.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  const ctx = () => signedIn.ctx as import("@/modules/auth/context").CompanyContext;
  return {
    ...real,
    requirePermission: async (...keys: string[]) => {
      if (keys.some((k) => !ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
    requireAnyPermission: async (...keys: string[]) => {
      if (!keys.some((k) => ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
  };
});

import { POST as telegramWebhook } from "@/app/api/bot/telegram/webhook/route";
import {
  GET as whatsappVerify,
  POST as whatsappWebhook,
} from "@/app/api/bot/whatsapp/webhook/route";
import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import { aiAccountOf } from "@/modules/ai/account";
import { runAiReminders } from "@/modules/ai/ai-reminders";
import {
  getBot,
  saveTelegram,
  saveWhatsApp,
  startLink,
  telegramSecret,
  testBot,
  unlinkBot,
} from "@/modules/ai/bot/bot.service";
import { type BotCall, standInForBotApi } from "@/modules/ai/bot/channel";
import { pinScrubReport } from "@/modules/ai/bot/pin-scrub";
import { PIN_HIDDEN_TEXT, sendChat } from "@/modules/ai/chat/chat.service";
import {
  checkPin,
  PIN_TRIES,
  PIN_TRIES_USED,
  setAiSwitch,
  setPin,
} from "@/modules/ai/settings.service";
import { login, MAX_FAILED_LOGINS } from "@/modules/auth/auth.service";
import * as costing from "@/modules/costing/costing.service";
import { pushToBot } from "@/modules/ai/bot/push";
import { makeAiDraft, setFollowUp, updateDraft } from "@/modules/ai/drafts.service";
import { runDueJobs } from "@/modules/jobs/worker";
import { saveMailSettings, standInForMail } from "@/modules/mail/mail.service";
import * as parties from "@/modules/parties/party.service";
import { createProject } from "@/modules/production/project.service";
import { createRole } from "@/modules/rbac/role.service";
import { getBotAction, saveTelegramAction } from "@/server/actions/bot.actions";

import { addToCompany, contextFor, makeCompany, makeUser, PASSWORD, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TOKEN = "123456789:AAH_test-token-abcdefghijklmnopqrstuv";
const OWNER_CHAT = 555001;
/** What the bot says after hiding a number that could be the PIN: never whether it was. */
const HID_NUMBER =
  "A number in your message could be your PIN, so the message was hidden and nothing was done. Send your PIN only when the bot asks for it. If it was not your PIN, write it again in 15 minutes, or use the ERP.";
const STRANGER = 999002;
const WA_NUMBER_ID = "109876543210";
const WA_TOKEN = "EAAG-test-access-token-0123456789";
const WA_SECRET = "app-secret-0123456789abcdef";
const OWNER_WA = "8801711000000";

async function expectAppError(promise: Promise<unknown>, code: string, message?: string | RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

type Sent = {
  method: string;
  token: string | null;
  json: Record<string, unknown>;
  form?: FormData;
};

/** Telegram and Meta, as stand-ins that record every call. */
function botApi(options: { refuseToken?: boolean } = {}) {
  const calls: Sent[] = [];
  let next = 100;
  standInForBotApi(async (call: BotCall) => {
    const tg = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(call.url);
    if (tg) {
      calls.push({
        method: tg[2]!,
        token: tg[1]!,
        json: (call.json ?? {}) as Record<string, unknown>,
        form: call.form,
      });
      if (tg[2] === "getMe") {
        return options.refuseToken
          ? { status: 401, body: { ok: false, description: "Unauthorized" } }
          : {
              status: 200,
              body: {
                ok: true,
                result: { id: 123456789, username: "extas_ai_bot", first_name: "Extas AI" },
              },
            };
      }
      if (tg[2] === "sendMessage" || tg[2] === "sendDocument") {
        return { status: 200, body: { ok: true, result: { message_id: (next += 1) } } };
      }
      return { status: 200, body: { ok: true, result: true } };
    }
    const wa = /^https:\/\/graph\.facebook\.com\/v[\d.]+\/(.+)$/.exec(call.url);
    if (wa) {
      calls.push({
        method: `wa:${wa[1]!.split("?")[0]}`,
        token: call.headers?.authorization ?? null,
        json: (call.json ?? {}) as Record<string, unknown>,
        form: call.form,
      });
      if (call.method === "GET") {
        return {
          status: 200,
          body: { display_phone_number: "+880 1711-999999", verified_name: "Extas" },
        };
      }
      if (wa[1]!.endsWith("/media")) return { status: 200, body: { id: "media-1" } };
      return { status: 200, body: { messages: [{ id: `wamid.out${(next += 1)}` }] } };
    }
    throw new Error(`Unexpected call to ${call.url}`);
  });
  return {
    calls,
    /** What was sent to a chat (sendMessage texts), in order. */
    said: (chat: number | string) =>
      calls
        .filter((c) => c.method === "sendMessage" && String(c.json.chat_id) === String(chat))
        .map((c) => String(c.json.text)),
    /** The buttons under the last message to a chat. */
    buttons: (chat: number | string) => {
      const last = calls
        .filter((c) => c.method === "sendMessage" && String(c.json.chat_id) === String(chat))
        .at(-1);
      const markup = last?.json.reply_markup as
        { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined;
      return (markup?.inline_keyboard ?? []).flat();
    },
  };
}

let updateId = 1000;
const typed = (chat: number, text: string) => ({
  update_id: (updateId += 1),
  message: {
    message_id: updateId,
    chat: { id: chat, type: "private" },
    from: { id: chat, first_name: chat === OWNER_CHAT ? "Mehadi" : "Someone" },
    text,
  },
});
const press = (chat: number, data: string, messageId = 777) => ({
  update_id: (updateId += 1),
  callback_query: {
    id: `cb${updateId}`,
    from: { id: chat, first_name: "Mehadi" },
    data,
    message: { message_id: messageId, chat: { id: chat, type: "private" } },
  },
});

/** Telegram calls the webhook; the worker has not answered yet. */
async function delivered(update: unknown, secret = telegramSecret(TOKEN)) {
  const response = await telegramWebhook(
    new Request("https://erp.test/api/bot/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": secret, "content-type": "application/json" },
      body: JSON.stringify(update),
    }),
  );
  return response.status;
}

/** Telegram calls the webhook; the worker then answers. */
async function telegram(update: unknown, secret = telegramSecret(TOKEN)) {
  const status = await delivered(update, secret);
  await runDueJobs();
  return status;
}

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const join = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const watcherRole = await createRole(owner, {
    name: "AI Watcher",
    permissions: ["dashboard.view", "ai.view"],
  });
  const buyer = (
    await parties.createParty(owner, {
      kind: "BUYER",
      name: "Nordic Wear AB",
      email: "orders@nordicwear.test",
    })
  ).party;
  const mill = (await parties.createParty(owner, { kind: "SUPPLIER", name: "Narayanganj Fabrics" }))
    .party;
  return { company, roles, owner, watcher: await join(watcherRole.id, "watcher"), buyer, mill };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Fifteen minutes later: PIN tries and number checks count again (they are kept in the database). */
async function fifteenMinutesLater() {
  resetRateLimits();
  await prisma.aiPinTry.updateMany({ data: { windowStart: new Date(Date.now() - 16 * 60_000) } });
}

/** The owner connects the bot and links their Telegram chat. */
async function linkOwner(env: Env, chat = OWNER_CHAT) {
  await saveTelegram(env.owner, { token: TOKEN });
  const { code } = await startLink(env.owner, "TELEGRAM");
  expect(await telegram(typed(chat, `/start ${code}`))).toBe(200);
}

run("The bot", () => {
  let env: Env;
  let uploads: string;
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-ai-bot-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    await resetDb();
    env = await setup();
  });
  afterEach(async () => {
    standInForBotApi(null);
    standInForMail(null);
    signedIn.ctx = null;
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("connects a Telegram bot with its token sealed, and links only the owner's own chat", async () => {
    const api = botApi();
    await expectAppError(saveTelegram(env.watcher, { token: TOKEN }), "FORBIDDEN");
    await expect(saveTelegram(env.owner, { token: "not-a-token" })).rejects.toBeInstanceOf(
      ZodError,
    );

    const saved = await saveTelegram(env.owner, { token: TOKEN });
    expect(saved).toEqual({ botName: "@extas_ai_bot", webhookError: null });
    expect(api.calls.find((c) => c.method === "setWebhook")?.json).toMatchObject({
      url: "https://erp.test/api/bot/telegram/webhook",
      secret_token: telegramSecret(TOKEN),
      allowed_updates: ["message", "callback_query"],
    });
    const row = await prisma.aiBotLink.findFirstOrThrow();
    expect(row.tokenSealed).not.toContain(TOKEN.split(":")[1]);
    const screen = await getBot(env.owner);
    expect(JSON.stringify(screen)).not.toContain(TOKEN.split(":")[1]);
    expect(screen.telegram).toMatchObject({ botName: "@extas_ai_bot", linked: false });

    // A call without our secret is refused and kept nowhere.
    expect(await telegram(typed(OWNER_CHAT, "help"), "wrong-secret")).toBe(401);
    expect(await prisma.aiBotMessage.count()).toBe(0);
    // Before the link nobody is answered.
    expect(await telegram(typed(OWNER_CHAT, "help"))).toBe(200);
    expect(api.said(OWNER_CHAT)).toEqual([]);

    const { code, open } = await startLink(env.owner, "TELEGRAM");
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(open).toBe(`https://t.me/extas_ai_bot?start=${code}`);
    // Someone else with a wrong code: nothing.
    expect(await telegram(typed(STRANGER, "/start ABCDEFGH"))).toBe(200);
    expect(api.said(STRANGER)).toEqual([]);

    const linking = typed(OWNER_CHAT, `/start ${code}`);
    expect(await telegram(linking)).toBe(200);
    expect(api.said(OWNER_CHAT)).toEqual([
      expect.stringMatching(/^Linked: this chat now talks to Mehedi 2.0 for Extas\./),
    ]);
    expect(await prisma.aiBotLink.findFirstOrThrow()).toMatchObject({
      chatId: String(OWNER_CHAT),
      ownerId: env.owner.user.id,
      linkCodeHash: null,
    });
    // The same update delivered twice is handled once.
    expect(await telegram(linking)).toBe(200);
    expect(api.said(OWNER_CHAT)).toHaveLength(1);
    // The code works once.
    expect(await telegram(typed(STRANGER, `/start ${code}`))).toBe(200);
    expect(api.said(STRANGER)).toEqual([]);

    // A stranger writing to the linked bot: nothing is sent back, the message is only logged.
    expect(await telegram(typed(STRANGER, "আজকের সেল রিপোর্ট PDF দাও"))).toBe(200);
    expect(api.said(STRANGER)).toEqual([]);
    expect(await prisma.aiChatMessage.count()).toBe(0);
    expect(
      await prisma.aiBotMessage.findFirstOrThrow({
        where: { chatId: String(STRANGER), direction: "IN" },
        orderBy: { createdAt: "desc" },
      }),
    ).toMatchObject({ status: "IGNORED" });

    await testBot(env.owner, "TELEGRAM");
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Test from Extas ERP/);
    await unlinkBot(env.owner, "TELEGRAM");
    expect(await telegram(typed(OWNER_CHAT, "help"))).toBe(200);
    expect(api.said(OWNER_CHAT)).toHaveLength(2);
  });

  it("refuses a token Telegram does not know", async () => {
    botApi({ refuseToken: true });
    await expectAppError(saveTelegram(env.owner, { token: TOKEN }), "VALIDATION", /did not accept/);
    expect(await prisma.aiBotLink.count()).toBe(0);
  });

  it("answers the owner's commands like the ERP chat, under the same switch", async () => {
    const api = botApi();
    await linkOwner(env);
    await telegram(typed(OWNER_CHAT, "আজকের সেল রিপোর্ট PDF দাও"));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      "I am switched off. The owner turns me on in AI Center > AI Home.",
    );
    await telegram(typed(OWNER_CHAT, "help"));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^You can say:\n\n• সব থামাও/);

    await setAiSwitch(env.owner, true);
    await telegram(typed(OWNER_CHAT, "শেষ ৭ দিনের খরচ"));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Last 7 days: no AI work, no cost\./);

    await telegram(typed(OWNER_CHAT, "আজকের সেল রিপোর্ট PDF দাও"));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Sales report for .+ is ready\./);
    const doc = api.calls.find((c) => c.method === "sendDocument");
    expect(doc?.form?.get("chat_id")).toBe(String(OWNER_CHAT));
    expect((doc?.form?.get("document") as File).type).toBe("application/pdf");

    // The bot's conversation is the owner's chat, marked as from the bot.
    const lines = await prisma.aiChatMessage.findMany({ where: { channel: "BOT" } });
    expect(lines.filter((l) => l.role === "OWNER")).toHaveLength(4);
    expect(lines.every((l) => l.userId === env.owner.user.id)).toBe(true);

    await telegram({
      update_id: (updateId += 1),
      message: {
        message_id: 9,
        chat: { id: OWNER_CHAT, type: "private" },
        from: { id: OWNER_CHAT },
        voice: { file_id: "v" },
      },
    });
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^I read typed words for now/);
    // A group chat is never answered, even with the owner in it.
    await telegram({
      update_id: (updateId += 1),
      message: {
        message_id: 10,
        chat: { id: -100123, type: "group" },
        from: { id: OWNER_CHAT },
        text: "help",
      },
    });
    expect(api.said(-100123)).toEqual([]);
  });

  it("applies change cards with a button, and asks the PIN for prices and deletions", async () => {
    const api = botApi();
    await linkOwner(env);
    await setAiSwitch(env.owner, true);

    await telegram(typed(OWNER_CHAT, "আজকের জন্য Accounts খুলে দাও"));
    const [apply, cancel] = api.buttons(OWNER_CHAT);
    expect(apply).toMatchObject({ text: "Apply", callback_data: expect.stringMatching(/^ap:/) });
    expect(cancel).toMatchObject({ text: "Cancel", callback_data: expect.stringMatching(/^cx:/) });
    expect(await prisma.aiGrant.count()).toBe(0);
    await telegram(press(OWNER_CHAT, apply!.callback_data));
    expect(await prisma.aiGrant.findFirstOrThrow()).toMatchObject({
      node: "b:accounts",
      grantedById: env.owner.user.id,
    });
    expect(api.calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(api.calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
    expect(api.said(OWNER_CHAT).at(-1)).toBe("Done.");
    // Pressed again: already done.
    await telegram(press(OWNER_CHAT, apply!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      "Not done: This card was applied or cancelled already.",
    );
    // A stranger's press does nothing.
    await telegram(press(STRANGER, cancel!.callback_data));
    expect(api.said(STRANGER)).toEqual([]);

    // The profit % is a price: the PIN first.
    const { id, number } = await costing.createCosting(env.owner, {
      title: "Pique polos",
      buyerId: env.buyer.id,
      factoryId: env.mill.id,
      currency: "USD",
      exchangeRate: "120",
      profitPercent: "8",
      sourceTaxPercent: "",
      bankChargePercent: "",
      commissionPercent: "",
      shipDate: addDays(localDay(new Date(), "Asia/Dhaka"), 120),
      fabricDays: "",
      makingDays: "",
      risks: [],
      notes: "",
    });
    await telegram(typed(OWNER_CHAT, `${number} profit 12.5%`));
    const [profit] = api.buttons(OWNER_CHAT);
    await telegram(press(OWNER_CHAT, profit!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Set your PIN first/);

    await setPin(env.owner, { pin: "2468" });
    await telegram(press(OWNER_CHAT, profit!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      'Send your PIN to set the profit % (a price). (Write "বাতিল" to stop.)',
    );
    const wrong = typed(OWNER_CHAT, "1111");
    await telegram(wrong);
    expect(api.calls.filter((c) => c.method === "deleteMessage").at(-1)?.json).toMatchObject({
      message_id: wrong.message.message_id,
    });
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      "The PIN is not right. Press the button again to try again.",
    );
    expect(
      (await prisma.orderCosting.findUniqueOrThrow({ where: { id } })).profitPercent?.toString(),
    ).toBe("8");

    await telegram(press(OWNER_CHAT, profit!.callback_data));
    await telegram(typed(OWNER_CHAT, "2468"));
    expect(
      (await prisma.orderCosting.findUniqueOrThrow({ where: { id } })).profitPercent?.toString(),
    ).toBe("12.5");
    expect(api.said(OWNER_CHAT).at(-1)).toBe("Done.");
    // The PIN is never kept: not in the chat, the bot's log, the job or AI Center > Bot.
    for (const pin of ["2468", "1111"]) {
      expect(await prisma.aiChatMessage.count({ where: { text: { contains: pin } } })).toBe(0);
      expect(await prisma.aiBotMessage.count({ where: { text: { contains: pin } } })).toBe(0);
      const jobs = await prisma.backgroundJob.findMany({ where: { kind: "ai.bot.incoming" } });
      expect(JSON.stringify(jobs.map((j) => j.payload))).not.toContain(pin);
      expect(JSON.stringify(await getBot(env.owner))).not.toContain(pin);
    }
    expect(await prisma.aiBotMessage.count({ where: { text: "[PIN]", direction: "IN" } })).toBe(2);

    // A costing sheet is never deleted: Mehedi says so, nothing is asked.
    await sendChat(env.owner, { text: `delete ${number}` });
    expect(await prisma.aiDeletionRequest.count()).toBe(0);

    // A Deletion request asked in the ERP chat reaches the bot with its buttons.
    const project = await createProject(env.owner, {
      name: "Old sample polo",
      factoryName: "Own sewing floor",
      targetDate: addDays(localDay(new Date(), "Asia/Dhaka"), 30),
      targetQuantity: 50,
      status: "PLANNED",
    });
    await sendChat(env.owner, { text: `delete ${project.code}` });
    await runDueJobs();
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Deletion request: .*Old sample polo/);
    const [approve] = api.buttons(OWNER_CHAT);
    expect(approve).toMatchObject({
      text: "Approve",
      callback_data: expect.stringMatching(/^dr:.+:y$/),
    });
    await telegram(press(OWNER_CHAT, approve!.callback_data));
    await telegram(typed(OWNER_CHAT, "2468"));
    expect(await prisma.aiDeletionRequest.findFirstOrThrow()).toMatchObject({
      status: "APPROVED",
      doneAt: expect.any(Date),
    });
    // Approving runs the order's own delete (a cancel) in the owner's name.
    expect(
      await prisma.productionProject.findUniqueOrThrow({ where: { id: project.id } }),
    ).toMatchObject({ status: "CANCELLED" });
    expect(api.said(OWNER_CHAT).at(-1)).toBe("Approved: it is deleted (cancelled) in your name.");
  });

  it("sends a typed পাঠাও only after the owner presses Send under the exact draft, with the PIN for a price", async () => {
    const api = botApi();
    await linkOwner(env);
    await setAiSwitch(env.owner, true);
    const mail: string[] = [];
    standInForMail(async (_config, m) => {
      mail.push(m.subject);
      return { messageId: "<m1@mail.test>" };
    });
    await saveMailSettings(env.owner, {
      host: "smtp.gmail.com",
      port: "587",
      secure: false,
      username: "owner@extas.test",
      password: "app-pass-word-1234",
      fromAddress: "owner@extas.test",
    });
    // Two drafts wait: the quotation was shown on the bot (the one the owner is
    // looking at); a newer one was never shown, and is never picked.
    const quote = await makeAiDraft(env.company.id, {
      kind: "QUOTATION",
      partyId: env.buyer.id,
      about: "pique polos",
    });
    await pushToBot(env.company.id, {
      kind: "draft",
      draftId: quote.id,
      text: "A quotation is ready.",
    });
    await runDueJobs();
    await prisma.aiDraft.create({
      data: {
        companyId: env.company.id,
        kind: "BUYER_REPLY",
        partyId: env.buyer.id,
        toAddress: "orders@nordicwear.test",
        subject: "The newest draft",
        body: "Hello",
      },
    });

    await telegram(typed(OWNER_CHAT, "পাঠাও"));
    expect(mail).toEqual([]);
    expect(api.said(OWNER_CHAT).at(-1)).toContain(
      `Send this one? To Nordic Wear AB (orders@nordicwear.test): "${quote.subject}". Press Send under it to send it (it has a price, so your PIN is asked).`,
    );
    const [send] = api.buttons(OWNER_CHAT);
    expect(send).toMatchObject({
      text: "Send",
      callback_data: expect.stringMatching(new RegExp(`^sd:${quote.id}:[a-f0-9]{12}$`)),
    });
    await telegram(press(OWNER_CHAT, send!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Set your PIN first/);
    await setPin(env.owner, { pin: "1357" });
    await telegram(press(OWNER_CHAT, send!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      'Send your PIN to send the price to the buyer. (Write "বাতিল" to stop.)',
    );
    await telegram(typed(OWNER_CHAT, "1357"));
    expect(mail).toEqual([quote.subject]);
    expect(await prisma.aiDraft.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({
      status: "SENT",
    });
    expect(
      (await prisma.aiDraft.findFirstOrThrow({ where: { subject: "The newest draft" } })).status,
    ).toBe("DRAFT");
  });

  it("brings drafts to the owner and sends one only when the owner presses Send", async () => {
    const api = botApi();
    await linkOwner(env);
    const mail: string[] = [];
    standInForMail(async (_config, m) => {
      mail.push(m.to);
      return { messageId: "<m1@mail.test>" };
    });
    await saveMailSettings(env.owner, {
      host: "smtp.gmail.com",
      port: "587",
      secure: false,
      username: "owner@extas.test",
      password: "app-pass-word-1234",
      fromAddress: "owner@extas.test",
    });
    const follow = await setFollowUp(env.owner, {
      partyId: env.buyer.id,
      dueOn: localDay(new Date(), env.company.timezone),
      recordLabel: "PO 4501",
    });
    // With the AI off nothing is drafted and nothing reaches the bot.
    await runAiReminders(new Date(), { companyId: env.company.id });
    await pushToBot(env.company.id, { kind: "text", text: "Should not go" });
    await runDueJobs();
    expect(api.said(OWNER_CHAT).some((t) => t.startsWith("Follow up"))).toBe(false);
    expect(api.said(OWNER_CHAT)).not.toContain("Should not go");
    await setAiSwitch(env.owner, true);
    await runAiReminders(new Date(), { companyId: env.company.id });
    await runDueJobs();
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(
      /^Follow up with Nordic Wear AB today: Mehedi 2\.0 \(AI\) drafted it for you\.\n\nDraft for the buyer: Nordic Wear AB/,
    );
    const [send] = api.buttons(OWNER_CHAT);
    expect(send).toMatchObject({ text: "Send", callback_data: expect.stringMatching(/^sd:/) });
    expect(mail).toEqual([]);
    await telegram(press(OWNER_CHAT, send!.callback_data));
    expect(mail).toEqual(["orders@nordicwear.test"]);
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Sent ".+" to orders@nordicwear\.test\.$/);
    expect((await prisma.aiFollowUp.findUniqueOrThrow({ where: { id: follow.id } })).status).toBe(
      "DONE",
    );

    // A rule taught on the bot is approved with its button.
    await telegram(typed(OWNER_CHAT, "নিয়ম: Nordic Wear-এর কলার সবসময় 3 1/4 ইঞ্চি"));
    const [approve] = api.buttons(OWNER_CHAT);
    await telegram(press(OWNER_CHAT, approve!.callback_data));
    expect(await prisma.houseRule.findFirstOrThrow()).toMatchObject({
      status: "APPROVED",
      source: "Bot",
    });
  });

  it("hides a PIN typed after its five minutes, or when nothing asked for it, everywhere, and does nothing with it", async () => {
    const api = botApi();
    await linkOwner(env);
    await setAiSwitch(env.owner, true);
    await setPin(env.owner, { pin: "2468" });
    const { id, number } = await costing.createCosting(env.owner, {
      title: "Pique polos",
      buyerId: env.buyer.id,
      factoryId: env.mill.id,
      currency: "USD",
      exchangeRate: "120",
      profitPercent: "8",
      sourceTaxPercent: "",
      bankChargePercent: "",
      commissionPercent: "",
      shipDate: addDays(localDay(new Date(), "Asia/Dhaka"), 120),
      fabricDays: "",
      makingDays: "",
      risks: [],
      notes: "",
    });
    await telegram(typed(OWNER_CHAT, `${number} profit 12.5%`));
    const [profit] = api.buttons(OWNER_CHAT);
    await telegram(press(OWNER_CHAT, profit!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Send your PIN to set the profit %/);
    // Six minutes later the owner types the PIN: too late, but it is hidden all the same.
    await prisma.aiBotLink.updateMany({
      data: { pendingUntil: new Date(Date.now() - 60_000) },
    });
    const late = typed(OWNER_CHAT, "2468");
    await telegram(late);
    expect(api.calls.filter((c) => c.method === "deleteMessage").at(-1)?.json).toMatchObject({
      message_id: late.message.message_id,
    });
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      "The PIN request ran out after 5 minutes, so nothing was done and your PIN was hidden. Press the button again.",
    );
    expect(
      (await prisma.orderCosting.findUniqueOrThrow({ where: { id } })).profitPercent?.toString(),
    ).toBe("8");
    expect((await prisma.aiBotLink.findFirstOrThrow()).pending).toBeNull();

    // The PIN typed when nothing asked for it: hidden too, and never sent to the AI.
    const stray = typed(OWNER_CHAT, " 2468 ");
    await telegram(stray);
    expect(api.calls.filter((c) => c.method === "deleteMessage").at(-1)?.json).toMatchObject({
      message_id: stray.message.message_id,
    });
    expect(api.said(OWNER_CHAT).at(-1)).toBe(HID_NUMBER);
    // An order number is not a PIN: it goes to Mehedi 2.0 as typed.
    await telegram(typed(OWNER_CHAT, "4501"));
    expect(await prisma.aiBotMessage.count({ where: { text: "4501", direction: "IN" } })).toBe(1);

    for (const where of [
      prisma.aiChatMessage.count({ where: { text: { contains: "2468" } } }),
      prisma.aiBotMessage.count({ where: { text: { contains: "2468" } } }),
    ]) {
      expect(await where).toBe(0);
    }
    const jobs = await prisma.backgroundJob.findMany({ where: { kind: "ai.bot.incoming" } });
    expect(JSON.stringify(jobs.map((j) => j.payload))).not.toContain("2468");
    expect(JSON.stringify(await getBot(env.owner))).not.toContain("2468");
    expect(await prisma.aiBotMessage.count({ where: { text: "[PIN]", direction: "IN" } })).toBe(2);
    // The report after an update counts only what the v6.3 wipe hid, never these PINs.
    expect(await pinScrubReport()).toMatchObject({ hidden: 0, notAfterRequest: 0 });
  });

  it("hides a PIN typed by mistake, even inside words or in Bengali digits, and never says a number was the PIN (v6.4.1 B6)", async () => {
    const api = botApi();
    await linkOwner(env);
    await setAiSwitch(env.owner, true);
    await setPin(env.owner, { pin: "2468" });
    const deletes = () => api.calls.filter((c) => c.method === "deleteMessage");
    // Order numbers are checked and go to Mehedi 2.0 as typed; one checked already costs no try.
    for (let i = 0; i < 8; i++) await telegram(typed(OWNER_CHAT, `PO ${4500 + i} is late`));
    for (let i = 0; i < 12; i++) await telegram(typed(OWNER_CHAT, "PO 4500 is late"));
    expect(await prisma.aiBotMessage.count({ where: { text: "PO 4500 is late" } })).toBe(13);
    expect(await prisma.aiBotMessage.count({ where: { text: "PO 4507 is late" } })).toBe(1);
    // Digits that only hold the PIN inside a longer number are not it.
    await telegram(typed(OWNER_CHAT, "order 124689 shipped"));
    expect(await prisma.aiBotMessage.count({ where: { text: "order 124689 shipped" } })).toBe(1);
    expect(deletes()).toHaveLength(0);
    // The PIN on its own, inside words, or in Bengali digits: hidden, and never sent to the AI.
    const hides = async (text: string) => {
      const message = typed(OWNER_CHAT, text);
      await telegram(message);
      expect(deletes().at(-1)?.json).toMatchObject({ message_id: message.message.message_id });
      expect(api.said(OWNER_CHAT).at(-1)).toBe(HID_NUMBER);
    };
    await hides("2468");
    await fifteenMinutesLater();
    for (const text of ["my pin is 2468, ok?", "PIN:2468", "২৪৬৮"]) await hides(text);
    expect(api.said(OWNER_CHAT).join("\n")).not.toMatch(/was your PIN/i);
    expect(await prisma.aiBotMessage.count({ where: { text: "[PIN]", direction: "IN" } })).toBe(4);

    // Ten new numbers in 15 minutes used up the checks: a new number is now hidden unchecked,
    // the same way and with the same words as the PIN, so sending numbers can never tell
    // which one is the PIN.
    for (let i = 0; i < 7; i++) await telegram(typed(OWNER_CHAT, `PO ${9800 + i} is late`));
    expect(await prisma.aiBotMessage.count({ where: { text: "PO 9806 is late" } })).toBe(1);
    await hides("PO 9901 is late");
    expect(await prisma.aiBotMessage.count({ where: { text: { contains: "9901" } } })).toBe(0);
    expect(await prisma.aiBotMessage.count({ where: { text: "[PIN]", direction: "IN" } })).toBe(5);
    // A number already found not to be the PIN still goes through, and words without numbers too.
    await telegram(typed(OWNER_CHAT, "PO 4503 is late"));
    expect(await prisma.aiBotMessage.count({ where: { text: "PO 4503 is late" } })).toBe(2);
    await telegram(typed(OWNER_CHAT, "status"));
    expect(await prisma.aiBotMessage.count({ where: { text: "status" } })).toBe(1);
    // The bot's checks never use up the owner's PIN tries in the ERP.
    expect(await checkPin(env.company.id, "2468", env.owner.user.id)).toBe(true);
    // After the 15 minutes, new numbers are checked again.
    await fifteenMinutesLater();
    await telegram(typed(OWNER_CHAT, "PO 9902 is late"));
    expect(await prisma.aiBotMessage.count({ where: { text: "PO 9902 is late" } })).toBe(1);

    const pinAlone = { contains: "2468", not: { contains: "124689" } };
    for (const where of [
      prisma.aiChatMessage.count({ where: { text: pinAlone } }),
      prisma.aiBotMessage.count({ where: { text: pinAlone } }),
      prisma.aiChatMessage.count({ where: { text: { contains: "২৪৬৮" } } }),
      prisma.aiBotMessage.count({ where: { text: { contains: "২৪৬৮" } } }),
    ]) {
      expect(await where).toBe(0);
    }
    const jobs = await prisma.backgroundJob.findMany({ where: { kind: "ai.bot.incoming" } });
    const payloads = JSON.stringify(jobs.map((j) => j.payload)).replaceAll("124689", "");
    expect(payloads).not.toContain("2468");
    expect(payloads).not.toContain("২৪৬৮");
  });

  it("takes a PIN asked for in Bengali digits", async () => {
    const api = botApi();
    await linkOwner(env);
    await setPin(env.owner, { pin: "2468" });
    const here = { ipAddress: "198.51.100.21" };
    const signIn = (password = PASSWORD) => login({ email: env.owner.user.email, password }, here);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await signIn("not-the-password").catch(() => 0);
    resetRateLimits();
    await telegram(typed(OWNER_CHAT, "unlock"));
    await telegram(typed(OWNER_CHAT, "২৪৬৮"));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Unlocked: /);
  });

  it("unlocks the owner's sign-in when the owner writes unlock and sends the PIN, with AI off too (v6.4.1 B5)", async () => {
    const api = botApi();
    await linkOwner(env);
    await setPin(env.owner, { pin: "2468" });
    const here = { ipAddress: "198.51.100.20" };
    const signIn = (password = PASSWORD) => login({ email: env.owner.user.email, password }, here);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await signIn("not-the-password").catch(() => 0);
    resetRateLimits();
    await expect(signIn()).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });

    await telegram(typed(OWNER_CHAT, "unlock"));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Send your PIN to unlock your sign-in/);
    await telegram(typed(OWNER_CHAT, "1357"));
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/PIN is not right/);
    await expect(signIn()).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });

    await telegram(typed(OWNER_CHAT, "/unlock"));
    const pin = typed(OWNER_CHAT, "2468");
    await telegram(pin);
    expect(api.calls.filter((c) => c.method === "deleteMessage").map((c) => c.json)).toContainEqual(
      expect.objectContaining({ message_id: pin.message.message_id }),
    );
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Unlocked: /);
    expect((await signIn()).token).toBeTruthy();
    expect(
      await prisma.auditLog.count({
        where: { entityType: "SignInUnlock", summary: { contains: "bot" } },
      }),
    ).toBe(1);
  });

  it("hid every 4 to 8 digit bot message at the v6.3 update, and reports only those that did not follow a PIN request", async () => {
    botApi();
    await linkOwner(env);
    const link = await prisma.aiBotLink.findFirstOrThrow();
    // The v6.3 update ran the wipe (prisma/migrations/20261124090000_hide_bot_pins) once;
    // these messages came before it, the last ones after it.
    const [wipe] = await prisma.$queryRawUnsafe<Array<{ finishedAt: Date }>>(
      `SELECT finished_at AS "finishedAt" FROM "_prisma_migrations"
       WHERE migration_name = '20261124090000_hide_bot_pins' AND finished_at IS NOT NULL`,
    );
    const finishedAt = wipe!.finishedAt;
    const before = (m: number) => new Date(finishedAt.getTime() - m * 60_000);
    const after = (m: number) => new Date(finishedAt.getTime() + m * 60_000);
    const keep = (text: string, n: number, at: Date, direction: "IN" | "OUT" = "IN") =>
      prisma.aiBotMessage.create({
        data: {
          companyId: env.company.id,
          linkId: link.id,
          channel: "TELEGRAM",
          direction,
          providerId: `old:${n}`,
          chatId: String(OWNER_CHAT),
          text,
          status: "DONE",
          createdAt: at,
        },
      });
    // The bot asked for the PIN, and it came a minute later.
    await keep(
      'Send your PIN to set the profit % (a price). (Write "বাতিল" to stop.)',
      0,
      before(60),
      "OUT",
    );
    const pin = await keep("4321", 1, before(59));
    await keep("status", 2, before(30));
    await keep("PO 4501 is late", 3, before(20));
    // An order number typed long after any PIN request: the v6.3 wipe took it all the same.
    const order = await keep("98765", 4, before(10));
    for (const [message, text] of [
      [pin, "4321"],
      [order, " 98765 "],
    ] as const) {
      await prisma.backgroundJob.create({
        data: {
          kind: "ai.bot.incoming",
          companyId: env.company.id,
          status: "SUCCEEDED",
          payload: { messageId: message.id, incoming: { chatId: "1", text } },
        },
      });
    }
    for (const [channel, text] of [
      ["BOT", "2468"],
      ["BOT", "55012"],
      ["ERP", "2026"],
    ] as const) {
      await prisma.aiChatMessage.create({
        data: {
          companyId: env.company.id,
          userId: env.owner.user.id,
          channel,
          role: "OWNER",
          text,
          createdAt: before(5),
        },
      });
    }
    // The wipe as the v6.3 update shipped it: never changed since (it ran on the live site).
    const sql = await readFile(
      path.join(process.cwd(), "prisma/migrations/20261124090000_hide_bot_pins/migration.sql"),
      "utf8",
    );
    for (const statement of sql
      .replace(/--.*$/gm, "")
      .split(";")
      .filter((x) => x.trim())) {
      await prisma.$executeRawUnsafe(statement);
    }
    const texts = (
      await prisma.aiBotMessage.findMany({
        where: { providerId: { startsWith: "old:" }, direction: "IN" },
        orderBy: { providerId: "asc" },
      })
    ).map((m) => m.text);
    expect(texts).toEqual(["[PIN]", "status", "PO 4501 is late", "[PIN]"]);
    const jobText = async (messageId: string) =>
      (
        (
          await prisma.backgroundJob.findFirstOrThrow({
            where: { kind: "ai.bot.incoming", payload: { path: ["messageId"], equals: messageId } },
          })
        ).payload as { incoming: { text: string } }
      ).incoming.text;
    expect(await jobText(pin.id)).toBe("[PIN]");
    expect(await jobText(order.id)).toBe("[PIN]");
    // Only what came from the bot: a number typed in the ERP chat stays.
    const chat = await prisma.aiChatMessage.findMany({ select: { channel: true, text: true } });
    expect(chat).toEqual(
      expect.arrayContaining([
        { channel: "BOT", text: "[PIN]" },
        { channel: "ERP", text: "2026" },
      ]),
    );
    expect(chat.filter((c) => c.text === "[PIN]")).toHaveLength(2);

    // After the update the bot hides a late or stray PIN as it comes (v6.4): those are
    // PINs, never counted as numbers the wipe may have taken.
    await keep("[PIN]", 5, after(3));
    await keep("[PIN]", 6, after(90));
    // The report after each update counts only what the v6.3 wipe hid: of those, the
    // ones that did not follow a PIN request may have been order numbers.
    const report = await pinScrubReport();
    expect(report).toMatchObject({ hidden: 2, afterRequest: 1, notAfterRequest: 1 });
    expect(report.notAfterRequestDates).toEqual([before(10)]);
    expect(report.wipedAt).toEqual(finishedAt);
  });

  it("picks the store by its name when stores share one bot", async () => {
    const api = botApi();
    const uttara = await makeCompany("Extas Uttara");
    await addToCompany(env.owner.user.id, uttara.company.id, uttara.roles.SUPER_ADMIN);
    const ownerThere = await contextFor(env.owner.user.id, uttara.company.id);
    await linkOwner(env);
    await saveTelegram(ownerThere, { token: TOKEN });
    const { code } = await startLink(ownerThere, "TELEGRAM");
    await telegram(typed(OWNER_CHAT, code));
    expect(await prisma.aiBotLink.count({ where: { chatId: String(OWNER_CHAT) } })).toBe(2);

    await telegram(typed(OWNER_CHAT, "status"));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      'Which store? Start with its name, like "Extas: status". Linked here: Extas, Extas Uttara.',
    );
    await telegram(typed(OWNER_CHAT, "Extas Uttara: status"));
    expect(
      await prisma.aiChatMessage.count({ where: { companyId: uttara.company.id, role: "OWNER" } }),
    ).toBe(1);
    expect(await prisma.aiChatMessage.count({ where: { companyId: env.company.id } })).toBe(0);
    // Each message is kept in its own store's bot log, not the oldest store's.
    const kept = async (text: string) =>
      prisma.aiBotMessage.findFirstOrThrow({ where: { direction: "IN", text } });
    expect((await kept("Extas Uttara: status")).companyId).toBe(uttara.company.id);
    expect((await kept(code)).companyId).toBe(uttara.company.id);
    await telegram(typed(OWNER_CHAT, "Extas: status"));
    expect((await kept("Extas: status")).companyId).toBe(env.company.id);
    const screen = await getBot(ownerThere);
    expect(screen.messages.map((m) => m.text)).toContain("Extas Uttara: status");
    expect(screen.messages.map((m) => m.text)).not.toContain("Extas: status");
  });

  it("has the WhatsApp plug ready: Meta's calls are checked and only the owner's number is answered", async () => {
    const api = botApi();
    await expectAppError(
      saveWhatsApp(env.owner, { phoneNumberId: WA_NUMBER_ID, token: WA_TOKEN }),
      "VALIDATION",
      /app secret/,
    );
    await saveWhatsApp(env.owner, {
      phoneNumberId: WA_NUMBER_ID,
      token: WA_TOKEN,
      appSecret: WA_SECRET,
    });
    const screen = await getBot(env.owner);
    expect(screen.whatsapp).toMatchObject({ botName: "+880 1711-999999", linked: false });
    expect(JSON.stringify(screen)).not.toContain(WA_TOKEN);
    expect(JSON.stringify(screen)).not.toContain(WA_SECRET);
    const verify = screen.whatsapp!.verifyToken!;

    const check = (token: string) =>
      whatsappVerify(
        new Request(
          `https://erp.test/api/bot/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`,
        ),
      );
    expect((await check("wrong")).status).toBe(403);
    const ok = await check(verify);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");

    const meta = async (messages: unknown[], secret = WA_SECRET) => {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: WA_NUMBER_ID },
                  contacts: [{ wa_id: OWNER_WA, profile: { name: "Mehadi" } }],
                  messages,
                },
              },
            ],
          },
        ],
      });
      const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      const response = await whatsappWebhook(
        new Request("https://erp.test/api/bot/whatsapp/webhook", {
          method: "POST",
          headers: { "x-hub-signature-256": signature },
          body,
        }),
      );
      await runDueJobs();
      return response.status;
    };
    let n = 0;
    const text = (body: string) => ({
      id: `wamid.in${(n += 1)}`,
      from: OWNER_WA,
      type: "text",
      text: { body },
    });

    const { code } = await startLink(env.owner, "WHATSAPP");
    expect(await meta([text(code)], "not-the-secret")).toBe(401);
    expect(await meta([text(code)])).toBe(200);
    expect(
      await prisma.aiBotLink.findFirstOrThrow({ where: { channel: "WHATSAPP" } }),
    ).toMatchObject({
      chatId: OWNER_WA,
      chatName: "Mehadi",
    });
    const messages = api.calls.filter((c) => c.method === `wa:${WA_NUMBER_ID}/messages`);
    expect(messages.at(-1)?.json).toMatchObject({ to: OWNER_WA, type: "text" });
    expect(messages.at(-1)?.token).toBe(`Bearer ${WA_TOKEN}`);

    await setAiSwitch(env.owner, true);
    await meta([text("আজকের জন্য Accounts খুলে দাও")]);
    const card = api.calls.filter((c) => c.method === `wa:${WA_NUMBER_ID}/messages`).at(-1)!.json;
    expect(card).toMatchObject({ type: "interactive", interactive: { type: "button" } });
    const buttons = (
      card.interactive as { action: { buttons: Array<{ reply: { id: string; title: string } }> } }
    ).action.buttons;
    expect(buttons.map((b) => b.reply.title)).toEqual(["Apply", "Cancel"]);
    await meta([
      {
        id: `wamid.in${(n += 1)}`,
        from: OWNER_WA,
        type: "interactive",
        interactive: { button_reply: { id: buttons[0]!.reply.id } },
      },
    ]);
    expect(await prisma.aiGrant.count()).toBe(1);

    // Another number writing to the business number: nothing.
    const before = api.calls.length;
    await meta([
      { id: `wamid.in${(n += 1)}`, from: "8801900000000", type: "text", text: { body: "help" } },
    ]);
    expect(api.calls.length).toBe(before);
  });

  it("moves the bot to another person only when their code comes from their chat, and tells the chat before (v6.4.1)", async () => {
    const api = botApi();
    await linkOwner(env);
    const partnerRole = await createRole(env.owner, {
      name: "Partner",
      permissions: ["dashboard.view", "ai.manage"],
    });
    const partnerUser = await makeUser("partner@extas.test");
    await addToCompany(partnerUser.id, env.company.id, partnerRole.id);
    const partner = await contextFor(partnerUser.id, env.company.id);
    const PARTNER_CHAT = 555777;

    // The partner presses Link and never sends the code: nothing moves.
    const { code } = await startLink(partner, "TELEGRAM");
    expect(await prisma.aiBotLink.findFirstOrThrow()).toMatchObject({
      ownerId: env.owner.user.id,
      chatId: String(OWNER_CHAT),
      linkCodeOwnerId: partnerUser.id,
    });
    await telegram(typed(OWNER_CHAT, "status"));
    const asked = await prisma.aiChatMessage.findFirstOrThrow({
      where: { role: "OWNER" },
      orderBy: { createdAt: "desc" },
    });
    expect(asked.userId).toBe(env.owner.user.id);

    // The code from the partner's own chat: the owner's chat is told first, then it moves.
    const before = api.calls.length;
    await telegram(typed(PARTNER_CHAT, `/start ${code}`));
    const sent = api.calls
      .slice(before)
      .filter((c) => c.method === "sendMessage")
      .map((c) => [String(c.json.chat_id), String(c.json.text)]);
    expect(sent).toEqual([
      [
        String(OWNER_CHAT),
        "Extas: the bot was linked to partner's account in another chat. This chat gets no more messages or answers for Extas.",
      ],
      [String(PARTNER_CHAT), expect.stringMatching(/^Linked: this chat now talks to Mehedi 2.0/)],
    ]);
    expect(await prisma.aiBotLink.findFirstOrThrow()).toMatchObject({
      ownerId: partnerUser.id,
      chatId: String(PARTNER_CHAT),
      linkCodeOwnerId: null,
      linkCodeHash: null,
    });
    // The owner's chat is no longer heard.
    const heard = api.said(OWNER_CHAT).length;
    await telegram(typed(OWNER_CHAT, "status"));
    expect(api.said(OWNER_CHAT)).toHaveLength(heard);
  });

  it("pushes briefs and requests only to a person who may still run the AI; alarms still reach the owner (v6.4.1)", async () => {
    const api = botApi();
    const partnerRole = await createRole(env.owner, {
      name: "Partner",
      permissions: ["dashboard.view", "ai.manage"],
    });
    const partnerUser = await makeUser("partner@extas.test");
    const membership = await addToCompany(partnerUser.id, env.company.id, partnerRole.id);
    const partner = await contextFor(partnerUser.id, env.company.id);
    await setAiSwitch(env.owner, true);
    await saveTelegram(partner, { token: TOKEN });
    const { code } = await startLink(partner, "TELEGRAM");
    await telegram(typed(OWNER_CHAT, `/start ${code}`));
    const pushes = () => prisma.backgroundJob.count({ where: { kind: "ai.bot.push" } });
    const brief = async (text: string) => {
      await pushToBot(env.company.id, { kind: "text", text });
      await runDueJobs();
      return api.said(OWNER_CHAT).includes(text);
    };
    expect(await brief("Morning brief 1")).toBe(true);

    // Queued while allowed, sent after the person was suspended: not sent.
    await pushToBot(env.company.id, { kind: "text", text: "Morning brief 2" });
    await prisma.user.update({ where: { id: partnerUser.id }, data: { status: "SUSPENDED" } });
    await runDueJobs();
    expect(api.said(OWNER_CHAT)).not.toContain("Morning brief 2");
    // Nothing more is even queued for them.
    const queued = await pushes();
    expect(await brief("Morning brief 3")).toBe(false);
    expect(await pushes()).toBe(queued);

    // Out of the team, or without ai.manage: nothing either.
    await prisma.user.update({ where: { id: partnerUser.id }, data: { status: "ACTIVE" } });
    expect(await brief("Morning brief 4")).toBe(true);
    await prisma.companyMembership.update({
      where: { id: membership.id },
      data: { isActive: false },
    });
    expect(await brief("Morning brief 5")).toBe(false);
    await prisma.companyMembership.update({
      where: { id: membership.id },
      data: { isActive: true },
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: partnerRole.id, permission: { key: "ai.manage" } },
    });
    expect(await brief("Morning brief 6")).toBe(false);

    // The platform owner's alarm (AI off too) still reaches the owner's linked chat.
    await prisma.user.update({ where: { id: env.owner.user.id }, data: { isSuperAdmin: true } });
    await setAiSwitch(env.owner, false);
    const { code: ownerCode } = await startLink(env.owner, "TELEGRAM");
    await telegram(typed(555002, `/start ${ownerCode}`));
    await pushToBot(env.company.id, { kind: "text", text: "Backup failed" }, { alarm: true });
    await runDueJobs();
    expect(api.said(555002)).toContain("Backup failed");
  });

  it("hides a PIN sent twice, or read after its five minutes, and never passes it to the chat (v6.4.1)", async () => {
    const api = botApi();
    await linkOwner(env);
    await setAiSwitch(env.owner, true);
    await setPin(env.owner, { pin: "2468" });
    const deleted = () =>
      api.calls.filter((c) => c.method === "deleteMessage").map((c) => c.json.message_id);
    const NOT_WAITED =
      "Your PIN was hidden. Nothing was waiting for it any more (it was used already, or its 5 minutes ran out), so nothing was done. Press the button again if you still need it.";

    // The same PIN twice, quickly: both arrive while the request waits.
    await telegram(typed(OWNER_CHAT, "unlock"));
    const first = typed(OWNER_CHAT, "2468");
    const second = typed(OWNER_CHAT, "2468");
    await delivered(first);
    await delivered(second);
    await runDueJobs();
    expect(deleted()).toEqual([first.message.message_id, second.message.message_id]);
    expect(api.said(OWNER_CHAT).at(-2)).toMatch(/^Unlocked: /);
    expect(api.said(OWNER_CHAT).at(-1)).toBe(NOT_WAITED);

    // A PIN that arrived in time but was read after the five minutes.
    await telegram(typed(OWNER_CHAT, "unlock"));
    const late = typed(OWNER_CHAT, "2468");
    await delivered(late);
    await prisma.aiBotLink.updateMany({ data: { pendingUntil: new Date(Date.now() - 1000) } });
    await runDueJobs();
    expect(deleted().at(-1)).toBe(late.message.message_id);
    expect(api.said(OWNER_CHAT).at(-1)).toBe(NOT_WAITED);
    expect((await prisma.aiBotLink.findFirstOrThrow()).pending).toBeNull();

    // Neither ever reached the chat with Mehedi 2.0.
    expect(await prisma.aiChatMessage.count({ where: { role: "OWNER", text: "[PIN]" } })).toBe(0);
    expect(await prisma.aiChatMessage.count({ where: { text: { contains: "2468" } } })).toBe(0);
  });

  it("tells the owner when the PIN tries run out, keeps the count over a restart, and never counts a right PIN (v6.4.1)", async () => {
    const api = botApi();
    await prisma.user.update({ where: { id: env.owner.user.id }, data: { isSuperAdmin: true } });
    await linkOwner(env);
    await setPin(env.owner, { pin: "2468" });
    const userId = env.owner.user.id;
    const alarms = (subject: string) =>
      prisma.notificationLog.count({ where: { userId, subject } });

    // Right PINs never use up the tries.
    for (let i = 0; i < PIN_TRIES + 3; i++) {
      expect(await checkPin(env.company.id, "2468", userId)).toBe(true);
    }
    // Ten wrong ones: the tenth tells the owner (the inbox and the bot, AI off too).
    for (let i = 0; i < PIN_TRIES; i++) {
      expect(await checkPin(env.company.id, "1111", userId)).toBe(false);
    }
    expect(await alarms("Too many wrong PINs")).toBe(1);
    await runDueJobs();
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(
      /^Too many wrong PINs\. owner: a wrong PIN was given 10 times in 15 minutes/,
    );
    await expectAppError(checkPin(env.company.id, "2468", userId), "RATE_LIMITED", PIN_TRIES_USED);
    // A restart (the memory cleared) does not give new tries; the owner is told once.
    resetRateLimits();
    await expectAppError(checkPin(env.company.id, "2468", userId), "RATE_LIMITED", PIN_TRIES_USED);
    expect(await alarms("Too many wrong PINs")).toBe(1);
    // Fifteen minutes later the PIN works again.
    await fifteenMinutesLater();
    expect(await checkPin(env.company.id, "2468", userId)).toBe(true);
    const tries = await prisma.aiPinTry.findMany({ select: { kind: true, count: true } });
    expect(JSON.stringify(tries)).not.toContain("2468");

    // Numbers sent to the bot: past ten new ones the owner is told too.
    for (let i = 0; i < 11; i++) await telegram(typed(OWNER_CHAT, `PO ${7100 + i} is late`));
    expect(await alarms("Many numbers sent to the bot")).toBe(1);
  });

  it("does not take numbers inside codes like CS-2026-0001 for a PIN (v6.4.1)", async () => {
    botApi();
    await linkOwner(env);
    await setAiSwitch(env.owner, true);
    await setPin(env.owner, { pin: "2468" });
    for (let i = 0; i < 15; i++) {
      await telegram(typed(OWNER_CHAT, `CS-2026-${String(i + 1).padStart(4, "0")} status`));
    }
    expect(await prisma.aiPinTry.count({ where: { kind: "NUMBER" } })).toBe(0);
    expect(await prisma.aiBotMessage.count({ where: { text: "[PIN]" } })).toBe(0);
    // A number on its own is still checked.
    await telegram(typed(OWNER_CHAT, "PO 4501 is late"));
    expect(await prisma.aiPinTry.findFirstOrThrow({ where: { kind: "NUMBER" } })).toMatchObject({
      count: 1,
    });
  });

  it("hides the PIN typed into the ERP's own chat: never kept, never sent to the AI (v6.4.1)", async () => {
    await setAiSwitch(env.owner, true);
    await setPin(env.owner, { pin: "2468" });
    const rows = await sendChat(env.owner, { text: "my pin is ২৪৬৮ please approve" });
    expect(rows.map((r) => r.text)).toEqual([PIN_HIDDEN_TEXT]);
    expect(await prisma.aiChatMessage.count({ where: { text: { contains: "2468" } } })).toBe(0);
    expect(await prisma.aiChatMessage.count({ where: { text: { contains: "২৪৬৮" } } })).toBe(0);
    expect(await prisma.aiChatMessage.findFirstOrThrow({ where: { role: "OWNER" } })).toMatchObject(
      { text: "[PIN]", intent: "pin.hidden" },
    );
    // An ordinary number goes through as typed.
    await sendChat(env.owner, { text: "status of PO 4501" });
    expect(await prisma.aiChatMessage.count({ where: { text: "status of PO 4501" } })).toBe(1);
  });

  it("saves an AI draft under the AI's account, and sends from the bot only the draft as it was shown (v6.4.1)", async () => {
    const api = botApi();
    await linkOwner(env);
    await setAiSwitch(env.owner, true);
    const mail: string[] = [];
    standInForMail(async (_config, m) => {
      mail.push(m.subject);
      return { messageId: "<m1@mail.test>" };
    });
    await saveMailSettings(env.owner, {
      host: "smtp.gmail.com",
      port: "587",
      secure: false,
      username: "owner@extas.test",
      password: "app-pass-word-1234",
      fromAddress: "owner@extas.test",
    });
    const draft = await makeAiDraft(env.company.id, {
      kind: "BUYER_FOLLOW_UP",
      partyId: env.buyer.id,
      about: "pique polos",
    });
    expect(draft.createdById).toBe((await aiAccountOf(env.company.id)).id);

    await pushToBot(env.company.id, { kind: "draft", draftId: draft.id, text: "A follow-up." });
    await runDueJobs();
    const [shown] = api.buttons(OWNER_CHAT);
    expect(shown?.text).toBe("Send");
    // Changed in the ERP after the bot showed it: that Send sends nothing.
    await updateDraft(env.owner, draft.id, {
      toAddress: "orders@nordicwear.test",
      subject: draft.subject,
      body: `${draft.body}\nP.S. We can ship a week earlier.`,
    });
    await telegram(press(OWNER_CHAT, shown!.callback_data));
    expect(mail).toEqual([]);
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      'This draft was changed after that message showed it, so nothing was sent. Write "পাঠাও" to see it as it is now, then press Send under it.',
    );
    // A button from before v6.4.1 (no version) cannot tell, so it is refused too.
    await telegram(press(OWNER_CHAT, `sd:${draft.id}`));
    expect(mail).toEqual([]);
    // Shown again as it is now: its Send sends it.
    await telegram(typed(OWNER_CHAT, "পাঠাও"));
    const [again] = api.buttons(OWNER_CHAT);
    expect(again!.callback_data).not.toBe(shown!.callback_data);
    await telegram(press(OWNER_CHAT, again!.callback_data));
    expect(mail).toEqual([draft.subject]);
  });

  it("is set up only by the owner", async () => {
    botApi();
    signedIn.ctx = env.watcher;
    const refused = await getBotAction();
    expect(refused.ok || refused.error.code).toBe("FORBIDDEN");
    const save = await saveTelegramAction({ token: TOKEN });
    expect(save.ok || save.error.code).toBe("FORBIDDEN");
    expect(await prisma.aiBotLink.count()).toBe(0);
    signedIn.ctx = env.owner;
    expect((await saveTelegramAction({ token: TOKEN })).ok).toBe(true);
    const seen = await getBotAction();
    expect(seen.ok && seen.data.telegram?.botName).toBe("@extas_ai_bot");
  });
});
