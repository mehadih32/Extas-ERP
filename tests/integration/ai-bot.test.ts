import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
import { sendChat } from "@/modules/ai/chat/chat.service";
import { setAiSwitch, setPin } from "@/modules/ai/settings.service";
import * as costing from "@/modules/costing/costing.service";
import { setFollowUp } from "@/modules/ai/drafts.service";
import { runDueJobs } from "@/modules/jobs/worker";
import { saveMailSettings, standInForMail } from "@/modules/mail/mail.service";
import * as parties from "@/modules/parties/party.service";
import { createRole } from "@/modules/rbac/role.service";
import { getBotAction, saveTelegramAction } from "@/server/actions/bot.actions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TOKEN = "123456789:AAH_test-token-abcdefghijklmnopqrstuv";
const OWNER_CHAT = 555001;
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

/** Telegram calls the webhook; the worker then answers. */
async function telegram(update: unknown, secret = telegramSecret(TOKEN)) {
  const response = await telegramWebhook(
    new Request("https://erp.test/api/bot/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": secret, "content-type": "application/json" },
      body: JSON.stringify(update),
    }),
  );
  await runDueJobs();
  return response.status;
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
      'Send your PIN to set the profit %. (Write "বাতিল" to stop.)',
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
    // The PIN never reaches the chat's log.
    expect(await prisma.aiChatMessage.count({ where: { text: { contains: "2468" } } })).toBe(0);

    // A Deletion request asked in the ERP chat reaches the bot with its buttons.
    await sendChat(env.owner, { text: `delete ${number}` });
    await runDueJobs();
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Deletion request: .*Pique polos/);
    const [approve] = api.buttons(OWNER_CHAT);
    expect(approve).toMatchObject({
      text: "Approve",
      callback_data: expect.stringMatching(/^dr:.+:y$/),
    });
    await telegram(press(OWNER_CHAT, approve!.callback_data));
    await telegram(typed(OWNER_CHAT, "2468"));
    expect(await prisma.aiDeletionRequest.findFirstOrThrow()).toMatchObject({ status: "APPROVED" });
    // Approving deletes nothing by itself.
    expect(await prisma.orderCosting.count()).toBe(1);
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Approved\. Nothing is deleted by itself/);
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
    await setAiSwitch(env.owner, true);
    await telegram(typed(OWNER_CHAT, "নিয়ম: Nordic Wear-এর কলার সবসময় 3 1/4 ইঞ্চি"));
    const [approve] = api.buttons(OWNER_CHAT);
    await telegram(press(OWNER_CHAT, approve!.callback_data));
    expect(await prisma.houseRule.findFirstOrThrow()).toMatchObject({
      status: "APPROVED",
      source: "Bot",
    });
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
