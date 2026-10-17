import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { ChatCard } from "../chat/cards";
import { isNode, type NodeRef, pathText } from "../control-tree";
import { BUYER_KINDS } from "../draft-templates";
import { logBot, senderFor } from "./bot.service";
import { type BotPush, isAlarm, ownersLinks, type QueuedPush } from "./push";
import { type BotOut, renderDeletion, renderDraft, renderPermission } from "./render";
import { type FindingText, renderCorrection, renderFinding } from "@/modules/bug-guard/bot-texts";
import type { CorrectionPlan } from "@/modules/bug-guard/types";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/*
 * Sends a push (push.ts) to each linked bot of a company; an alarm (Bug
 * Guard, backups, Server Health) only to those an active platform owner of the
 * company linked. A draft is also kept
 * in the owner's chat, so "পাঠাও" shows exactly it again and its Send button
 * sends exactly it. A
 * request already answered is not pushed. A push that fails is logged and not
 * tried again: everything it says is waiting in the ERP too.
 */
export async function sendPush(companyId: string, push: QueuedPush) {
  const links = await prisma.aiBotLink.findMany({
    where: {
      companyId,
      linkedAt: { not: null },
      chatId: { not: null },
      ...(isAlarm(push) ? ownersLinks(companyId) : {}),
    },
  });
  for (const link of links) {
    const out = await render(link.ownerId, companyId, push);
    if (!out) continue;
    try {
      await senderFor(link).send(link.chatId!, out);
      await logBot(link, { direction: "OUT", chatId: link.chatId, text: out.text, status: "SENT" });
    } catch (error) {
      await logBot(link, {
        direction: "OUT",
        chatId: link.chatId,
        text: out.text,
        status: "FAILED",
        error: error instanceof Error ? error.message : "Not sent",
      });
    }
  }
}

async function render(
  ownerId: string | null,
  companyId: string,
  push: BotPush,
): Promise<BotOut | null> {
  switch (push.kind) {
    case "text":
      return { text: push.text, buttons: push.buttons ?? [] };
    case "permission": {
      const request = await prisma.aiPermissionRequest.findFirst({
        where: { id: push.requestId, companyId, status: "PENDING" },
      });
      if (!request) return null;
      return renderPermission({
        id: request.id,
        task: request.task,
        why: request.why,
        path: isNode(request.node) ? pathText(request.node as NodeRef) : request.node,
      });
    }
    case "deletion": {
      const request = await prisma.aiDeletionRequest.findFirst({
        where: { id: push.requestId, companyId, status: "PENDING" },
      });
      if (!request) return null;
      return renderDeletion(request);
    }
    case "guard": {
      const f = await prisma.bugGuardFinding.findFirst({
        where: { id: push.findingId, companyId, status: "OPEN" },
      });
      if (!f) return null;
      return renderFinding(
        {
          ...f,
          evidence: (f.evidence as FindingText["evidence"]) ?? null,
          correction: (f.correction as CorrectionPlan | null) ?? null,
        },
        appUrl(),
      );
    }
    case "guard-correction": {
      const c = await prisma.bugGuardCorrection.findFirst({
        where: { id: push.correctionId, companyId, status: { in: ["PREPARED", "APPLIED"] } },
        include: { finding: { select: { title: true } } },
      });
      if (!c) return null;
      return renderCorrection({ ...c, title: c.finding.title }, appUrl());
    }
    case "draft": {
      const draft = await prisma.aiDraft.findFirst({
        where: { id: push.draftId, companyId, status: { in: ["DRAFT", "FAILED"] } },
        include: { party: { select: { name: true } } },
      });
      if (!draft) return null;
      const card: ChatCard = {
        type: "draft",
        draftId: draft.id,
        subject: draft.subject,
        to: draft.toAddress,
        party: draft.party?.name ?? null,
        forBuyer: BUYER_KINDS.has(draft.kind),
        body: draft.body,
      };
      if (ownerId) {
        await prisma.aiChatMessage.create({
          data: {
            companyId,
            userId: ownerId,
            channel: "BOT",
            role: "AI",
            text: push.text,
            intent: "push.draft",
            card: card as unknown as Prisma.InputJsonValue,
          },
        });
      }
      const shown = renderDraft(card);
      return { ...shown, text: `${push.text}\n\n${shown.text}` };
    }
  }
}
