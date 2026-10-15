"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import * as bot from "@/modules/ai/bot/bot.service";
import { requirePermission } from "@/modules/auth/context";

/*
 * AI Center > Bot Server Actions (ai.manage only: the bot works in the
 * owner's name, and its tokens are the owner's). Each returns
 * { ok: true, data } or { ok: false, error }.
 */

const manage = () => requirePermission("ai.manage");

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const out = await work();
    revalidatePath("/ai/bot");
    return out;
  });

export const getBotAction = async () => runAction(async () => bot.getBot(await manage()));

export const saveTelegramAction = async (input: unknown) =>
  change(async () => bot.saveTelegram(await manage(), input, await getRequestMeta()));

export const saveWhatsAppAction = async (input: unknown) =>
  change(async () => bot.saveWhatsApp(await manage(), input, await getRequestMeta()));

export const startLinkAction = async (channel: string) =>
  change(async () => bot.startLink(await manage(), channel, await getRequestMeta()));

export const unlinkBotAction = async (channel: string) =>
  change(async () => bot.unlinkBot(await manage(), channel, await getRequestMeta()));

export const removeBotAction = async (channel: string) =>
  change(async () => bot.removeBot(await manage(), channel, await getRequestMeta()));

export const testBotAction = async (channel: string) =>
  change(async () => bot.testBot(await manage(), channel));
