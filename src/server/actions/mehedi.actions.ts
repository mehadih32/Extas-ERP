"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import * as chat from "@/modules/ai/chat/chat.service";
import * as drafts from "@/modules/ai/drafts.service";
import * as rules from "@/modules/ai/house-rules.service";
import * as knowledge from "@/modules/ai/knowledge.service";
import * as mehedi from "@/modules/ai/mehedi.service";
import * as settings from "@/modules/ai/settings.service";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as mail from "@/modules/mail/mail.service";

/*
 * Mehedi 2.0 Server Actions (AI Center > Mehedi 2.0, Chat, Drafts, Books &
 * tests, and the email part of Settings). Each returns { ok: true, data } or
 * { ok: false, error }.
 *   ai.view     see his profile, the drafts and follow-ups, the books and tests
 *   ai.manage   chat with him, teach and approve House Rules, write, send and
 *               discard drafts, set follow-ups, change books, run the tests,
 *               the company's mailbox and the reply reminder (the owner's)
 * The AI itself holds neither.
 */

const view = () => requireAnyPermission("ai.view", "ai.manage");
const manage = () => requirePermission("ai.manage");

const DRAFT_LISTS: readonly string[] = ["waiting", "sent", "discarded"];

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const out = await work();
    revalidatePath("/", "layout");
    return out;
  });

// ---------------------------------------------------------------- profile and teach

export const getMehediAction = async () => runAction(async () => mehedi.getMehedi(await view()));

export const proposeHouseRuleAction = async (input: unknown) =>
  change(async () => {
    const row = await rules.proposeHouseRule(await manage(), input, await getRequestMeta());
    return { id: row.id };
  });

export const decideHouseRuleAction = async (ruleId: string, input: unknown) =>
  change(async () => rules.decideHouseRule(await manage(), ruleId, input, await getRequestMeta()));

export const retireHouseRuleAction = async (ruleId: string) =>
  change(async () => rules.retireHouseRule(await manage(), ruleId, await getRequestMeta()));

// ---------------------------------------------------------------- chat

export const getChatAction = async () => runAction(async () => chat.getChat(await manage()));

export const sendChatAction = async (input: unknown) =>
  change(async () => {
    await chat.sendChat(await manage(), input, await getRequestMeta());
    return null;
  });

export const applyCardAction = async (messageId: string) =>
  change(async () => chat.applyCard(await manage(), messageId, await getRequestMeta()));

export const cancelCardAction = async (messageId: string) =>
  change(async () => chat.cancelCard(await manage(), messageId));

// ---------------------------------------------------------------- drafts and follow-ups

export const getDraftsAction = async (list?: string) =>
  runAction(async () =>
    drafts.getDrafts(
      await view(),
      list && DRAFT_LISTS.includes(list) ? (list as drafts.DraftList) : "waiting",
    ),
  );

export const createDraftAction = async (input: unknown) =>
  change(async () => {
    const row = await drafts.createDraft(await manage(), input, await getRequestMeta());
    return { id: row.id };
  });

export const writeDraftWithAiAction = async (input: unknown) =>
  runAction(async () => drafts.writeDraftWithAi(await manage(), input));

export const updateDraftAction = async (draftId: string, input: unknown) =>
  change(async () => drafts.updateDraft(await manage(), draftId, input, await getRequestMeta()));

export const sendDraftAction = async (draftId: string) =>
  change(async () => drafts.sendDraft(await manage(), draftId, await getRequestMeta()));

export const discardDraftAction = async (draftId: string) =>
  change(async () => drafts.discardDraft(await manage(), draftId, await getRequestMeta()));

export const setFollowUpAction = async (input: unknown) =>
  change(async () => {
    const row = await drafts.setFollowUp(await manage(), input, await getRequestMeta());
    return { id: row.id };
  });

export const closeFollowUpAction = async (followUpId: string, done: boolean) =>
  change(async () =>
    drafts.closeFollowUp(
      await manage(),
      followUpId,
      done ? "DONE" : "CANCELLED",
      await getRequestMeta(),
    ),
  );

// ---------------------------------------------------------------- books and tests

export const getKnowledgeAction = async () =>
  runAction(async () => knowledge.getKnowledge(await view()));

export const getBookAction = async (code: string) =>
  runAction(async () => knowledge.getBook(await view(), String(code).slice(0, 8)));

export const saveBookAction = async (code: string, input: unknown) =>
  change(async () => knowledge.saveBook(await manage(), code, input, await getRequestMeta()));

export const resetBookAction = async (code: string) =>
  change(async () => knowledge.resetBook(await manage(), code, await getRequestMeta()));

export const startTestsAction = async (input: unknown) =>
  change(async () => knowledge.startTests(await manage(), input, await getRequestMeta()));

// ---------------------------------------------------------------- email and reminders

export const getMailSettingsAction = async () =>
  runAction(async () => mail.getMailSettings(await manage()));

export const saveMailSettingsAction = async (input: unknown) =>
  change(async () => mail.saveMailSettings(await manage(), input, await getRequestMeta()));

export const removeMailSettingsAction = async () =>
  change(async () => mail.removeMailSettings(await manage(), await getRequestMeta()));

export const sendTestMailAction = async () => change(async () => mail.sendTestMail(await manage()));

export const setReplyRemindHoursAction = async (input: unknown) =>
  change(async () => settings.setReplyRemindHours(await manage(), input, await getRequestMeta()));
