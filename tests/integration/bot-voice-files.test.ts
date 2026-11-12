import type Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Voice notes and files on the bot (Release 5), with Telegram and the AI as
 * stand-ins: with the AI off nothing is called and the bot says so; a voice
 * note is written down and answered like typed words (its cost logged as
 * "Voice notes to text"); a buyer PO becomes an order draft in the AI's name;
 * a visiting card a buyer draft that adds nothing until the owner presses
 * Apply; nothing posts by itself.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST as telegramWebhook } from "@/app/api/bot/telegram/webhook/route";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { aiAccountOf } from "@/modules/ai/account";
import { saveTelegram, startLink, telegramSecret } from "@/modules/ai/bot/bot.service";
import { FILES_NEED_AI } from "@/modules/ai/bot/bot-files";
import { type BotCall, standInForBotApi } from "@/modules/ai/bot/channel";
import { standInForClaude } from "@/modules/ai/claude";
import { setAiSwitch, setApiKey } from "@/modules/ai/settings.service";
import { VOICE_NEEDS_MODEL } from "@/modules/ai/voice";
import { runDueJobs } from "@/modules/jobs/worker";

import { claudeMessage } from "../fixtures/claude";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TOKEN = "123456789:AAH_test-token-abcdefghijklmnopqrstuv";
const CHAT = 555001;
const GEMINI = "google:gemini-3.6-flash";

// A JPEG's first bytes, then filler: enough for the type check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const VOICE = Buffer.from("OggS-fake-voice-note");

type Sent = { method: string; url: string; json: Record<string, unknown> };

function botApi() {
  const calls: Sent[] = [];
  let next = 100;
  standInForBotApi(async (call: BotCall) => {
    const file = /^https:\/\/api\.telegram\.org\/file\/bot[^/]+\/(.+)$/.exec(call.url);
    if (file) {
      calls.push({ method: "download", url: call.url, json: {} });
      return { status: 200, body: file[1]!.startsWith("voice") ? VOICE : JPEG };
    }
    const tg = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(call.url);
    if (!tg) throw new Error(`Unexpected call to ${call.url}`);
    const json = (call.json ?? {}) as Record<string, unknown>;
    calls.push({ method: tg[2]!, url: call.url, json });
    if (tg[2] === "getMe") {
      return {
        status: 200,
        body: { ok: true, result: { id: 123456789, username: "extas_ai_bot", first_name: "X" } },
      };
    }
    if (tg[2] === "getFile") {
      const id = String(json.file_id);
      return {
        status: 200,
        body: {
          ok: true,
          result: { file_path: id.startsWith("voice") ? `voice/${id}.oga` : `photos/${id}.jpg` },
        },
      };
    }
    if (tg[2] === "sendMessage") {
      return { status: 200, body: { ok: true, result: { message_id: (next += 1) } } };
    }
    return { status: 200, body: { ok: true, result: true } };
  });
  const sent = () =>
    calls.filter((c) => c.method === "sendMessage" && String(c.json.chat_id) === String(CHAT));
  return {
    calls,
    said: () => sent().map((c) => String(c.json.text)),
    buttons: () => {
      const last = sent()
        .filter((c) => c.json.reply_markup)
        .at(-1);
      const markup = last?.json.reply_markup as
        { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined;
      return (markup?.inline_keyboard ?? []).flat();
    },
  };
}

/** The AI, as a stand-in: each answer in turn, and every request kept. */
function fakeAi(answers: Anthropic.Message[]) {
  const asked: Array<{ provider: string; body: Anthropic.MessageCreateParamsNonStreaming }> = [];
  standInForClaude(async ({ provider, body }) => {
    asked.push({ provider, body });
    const next = answers.shift();
    if (!next) throw new Error("The AI was asked more than expected");
    return next;
  });
  return asked;
}

const toolUse = (name: string, input: Record<string, unknown>) =>
  ({
    ...claudeMessage([{ type: "tool_use", id: "toolu_1", name, input } as Anthropic.ToolUseBlock]),
    stop_reason: "tool_use",
  }) as Anthropic.Message;

let updateId = 9000;
const message = (extra: Record<string, unknown>) => ({
  update_id: (updateId += 1),
  message: {
    message_id: updateId,
    chat: { id: CHAT, type: "private" },
    from: { id: CHAT, first_name: "Mehadi" },
    ...extra,
  },
});
const voiceNote = () => message({ voice: { file_id: `voice${updateId}`, mime_type: "audio/ogg" } });
const photo = (caption?: string) =>
  message({
    photo: [
      { file_id: `small${updateId}`, file_size: 100 },
      { file_id: `photo${updateId}`, file_size: JPEG.length },
    ],
    ...(caption ? { caption } : {}),
  });
const press = (data: string) => ({
  update_id: (updateId += 1),
  callback_query: {
    id: `cb${updateId}`,
    from: { id: CHAT, first_name: "Mehadi" },
    data,
    message: { message_id: 777, chat: { id: CHAT, type: "private" } },
  },
});

async function telegram(update: unknown) {
  const response = await telegramWebhook(
    new Request("https://erp.test/api/bot/telegram/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": telegramSecret(TOKEN),
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    }),
  );
  await runDueJobs();
  return response.status;
}

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const user = await makeUser("owner@extas.test");
  await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
  const owner = await contextFor(user.id, company.id);
  await saveTelegram(owner, { token: TOKEN });
  const { code } = await startLink(owner, "TELEGRAM");
  expect(await telegram(message({ text: `/start ${code}` }))).toBe(200);
  return { company, owner };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** AI on with a Claude key; with `voice`, a priced Gemini model picked for voice notes. */
async function aiOn(env: Env, voice = false) {
  await setApiKey(env.owner, { key: "sk-ant-api03-test0123456789abcdWXYZ" });
  await setAiSwitch(env.owner, true);
  if (voice) {
    await prisma.aiSettings.update({
      where: { companyId: env.company.id },
      data: {
        geminiKeySealed: encryptSecret("AIzaSy-test-gemini-key-0123456789"),
        models: { "voice.text": GEMINI },
      },
    });
  }
}

run("Voice notes and files on the bot", () => {
  let env: Env;
  let uploads: string;
  beforeEach(async () => {
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("AI_API_KEY", "");
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-bot-files-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    await resetDb();
    botApi();
    env = await setup();
  });
  afterEach(async () => {
    standInForBotApi(null);
    standInForClaude(null);
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("says plainly that voice notes and files need AI while it is off, and calls nothing", async () => {
    const api = botApi();
    const asked = fakeAi([]);
    await telegram(voiceNote());
    expect(api.said().at(-1)).toBe(FILES_NEED_AI);
    await telegram(photo("PO"));
    expect(api.said().at(-1)).toBe(FILES_NEED_AI);
    // Nothing was fetched from Telegram, nothing sent to the AI, nothing kept.
    expect(api.calls.filter((c) => c.method === "getFile" || c.method === "download")).toEqual([]);
    expect(asked).toEqual([]);
    expect(await prisma.fileAsset.count()).toBe(0);
    expect(await prisma.aiUsage.count()).toBe(0);
  });

  it("asks for a model that can hear before it calls the AI for a voice note", async () => {
    const api = botApi();
    await aiOn(env);
    const asked = fakeAi([]);
    await telegram(voiceNote());
    expect(api.said().at(-1)).toBe(VOICE_NEEDS_MODEL);
    expect(asked).toEqual([]);
  });

  it("writes a voice note down and answers it like typed words, with its cost logged", async () => {
    const api = botApi();
    await aiOn(env, true);
    const asked = fakeAi([claudeMessage([{ type: "text", text: "help" } as Anthropic.TextBlock])]);
    await telegram(voiceNote());
    expect(asked).toHaveLength(1);
    expect(asked[0]!.provider).toBe("google");
    // The voice note itself went to the AI, as sound.
    expect(JSON.stringify(asked[0]!.body.messages)).toContain(VOICE.toString("base64"));
    const said = api.said();
    expect(said).toContain('I heard: "help"');
    // Then "help" is answered exactly as when typed.
    expect(said.at(-1)).toMatch(/^You can say:|status/);
    const usage = await prisma.aiUsage.findFirstOrThrow({ where: { task: "voice.text" } });
    expect(usage).toMatchObject({ screen: "bot", why: "A voice note on the bot" });
  });

  it("hides a spoken number that could be the PIN, the same as a typed one", async () => {
    const api = botApi();
    await aiOn(env, true);
    fakeAi([claudeMessage([{ type: "text", text: "my pin is 2468" } as Anthropic.TextBlock])]);
    const note = voiceNote();
    await telegram(note);
    expect(api.said().at(-1)).toMatch(/hid|hidden/i);
    expect(api.said().some((t) => t.includes("2468"))).toBe(false);
    expect(api.calls.filter((c) => c.method === "deleteMessage").at(-1)?.json).toMatchObject({
      message_id: note.message.message_id,
    });
  });

  it("turns a buyer's PO into an order draft in the AI's name that waits for the owner, and posts nothing", async () => {
    const api = botApi();
    await aiOn(env);
    fakeAi([
      toolUse("record_order", {
        buyer: "Nordic Wear AB",
        po: "NW-4501",
        lines: [{ style: "PQ-01", colour: "Navy", size: "M", quantity: 1200 }],
        quantity: 1200,
        ship_date: "2027-03-01",
      }),
    ]);
    await telegram(photo("PO from Nordic"));
    const ai = await aiAccountOf(env.company.id);
    const run = await prisma.aiOrderRun.findFirstOrThrow();
    expect(run).toMatchObject({ createdById: ai.id, startedVia: "BOT", status: "INTAKE" });
    expect(run.fileIds).toHaveLength(1);
    expect(run.fields).toMatchObject({ buyer: "Nordic Wear AB", po: "NW-4501", quantity: 1200 });
    expect(api.said().at(-1)).toMatch(new RegExp(`^Order draft ${run.number} made from your file`));
    // The file is kept in the AI's name.
    expect(await prisma.fileAsset.findFirstOrThrow()).toMatchObject({ uploadedById: ai.id });
    // Nothing else was made: no sales order, no costing, no buyer, no message to anyone.
    expect(await prisma.salesOrder.count()).toBe(0);
    expect(await prisma.orderCosting.count()).toBe(0);
    expect(await prisma.party.count({ where: { name: "Nordic Wear AB" } })).toBe(0);
    expect(await prisma.aiDraft.count()).toBe(0);
  });

  it("asks what a file is, and a visiting card adds the buyer only when the owner presses Apply", async () => {
    const api = botApi();
    await aiOn(env);
    fakeAi([
      toolUse("record_visiting_card", {
        company: "Bergen Textiles AS",
        person: "Ingrid Larsen",
        email: "ingrid@bergen.test",
        phone: "+47 22 33 44 55",
        country: "Norway",
      }),
    ]);
    await telegram(photo());
    expect(api.said().at(-1)).toMatch(/What is it\?$/);
    const card = api.buttons().find((b) => b.callback_data.endsWith(":c"))!;
    expect(card.text).toBe("Visiting card: make a buyer draft");
    await telegram(press(card.callback_data));
    expect(api.said().at(-1)).toMatch(/^Buyer draft from the visiting card/);
    expect(await prisma.party.count({ where: { name: "Bergen Textiles AS" } })).toBe(0);
    const ai = await aiAccountOf(env.company.id);
    expect(
      await prisma.auditLog.count({ where: { userId: ai.id, summary: { contains: "Bergen" } } }),
    ).toBe(1);

    const [apply] = api.buttons();
    expect(apply).toMatchObject({ text: "Apply" });
    await telegram(press(apply!.callback_data));
    const buyer = await prisma.party.findFirstOrThrow({ where: { name: "Bergen Textiles AS" } });
    expect(buyer).toMatchObject({
      kind: "BUYER",
      contactPerson: "Ingrid Larsen",
      email: "ingrid@bergen.test",
      country: "Norway",
    });
    // Added in the owner's name, approved by the owner.
    expect(
      await prisma.auditLog.count({
        where: { userId: env.owner.user.id, summary: { contains: "approved by owner" } },
      }),
    ).toBe(1);
  });
});
