import type Anthropic from "@anthropic-ai/sdk";
import type { AiChannel, Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { setProfitPercent } from "@/modules/costing/costing.service";
import { createTask } from "@/modules/reminders/task.service";

import { askerFor, type Ask, textOf } from "../claude";
import { applyPreset, setControlCell } from "../control.service";
import { DRAFT_KINDS } from "../draft-templates";
import { setFollowUp } from "../drafts.service";
import { expertById, expertPrompt } from "../experts";
import { searchBooks } from "../knowledge";
import { mehediSystem } from "../persona";
import { aiLabel, aiSettingsOf, offReason, OFF_TEXT } from "../settings.service";
import {
  answerIntent,
  costingAnswer,
  costSummary,
  deletion,
  followUpCard,
  orderStatus,
  type Reply,
  reportPdf,
  taskCard,
  teach,
  type Turn,
  writeDraft,
} from "./answers";
import type { CardStatus, ChatCard } from "./cards";
import { COMMAND_HELP, type Intent, readIntent, storePrefix } from "./intents";

/*
 * Chat with Mehedi 2.0 (AI Center > Chat; the bot uses the same door). The
 * owner's (ai.manage) conversation: commands are read by rules first
 * (intents.ts) and answered in answers.ts; free questions go to Claude with a
 * few read-only tools and tools that propose (change cards, drafts, House
 * Rules, Deletion requests), never ones that change anything themselves.
 * Switched off, he answers nothing but "help" and "status"; paused, only
 * "আবার চালু করো"; on without a key, the commands work and free questions wait.
 */

const MAX_TEXT = 2000;
const HISTORY = 12;
const TOOL_ROUNDS = 5;

export const chatSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Write something")
    .max(MAX_TEXT, `Use at most ${MAX_TEXT} characters`),
});

function assertOwner(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner chats with Mehedi 2.0.");
  }
}

type Saved = Awaited<ReturnType<typeof prisma.aiChatMessage.create>>;

async function saveAi(
  ctx: CompanyContext,
  channel: AiChannel,
  text: string,
  card: ChatCard | null,
  intent: string | null,
) {
  return prisma.aiChatMessage.create({
    data: {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      channel,
      role: "AI",
      text: text.slice(0, 8000),
      intent,
      card: (card ?? undefined) as Prisma.InputJsonValue | undefined,
      cardStatus: card?.type === "change" ? "PROPOSED" : null,
    },
  });
}

/** Whether he may answer this now (switched off, paused, without a key). */
function gate(intent: Intent, off: ReturnType<typeof offReason>): string | null {
  if (intent.kind === "help" || intent.kind === "status") return null;
  if (off === "switched-off") {
    return intent.kind === "ai.stop_all"
      ? "I am switched off already: nothing runs."
      : "I am switched off. The owner turns me on in AI Center > AI Home.";
  }
  if (off === "paused" && intent.kind !== "ai.resume" && intent.kind !== "ai.stop_all") {
    return 'I am paused. Say "আবার চালু করো" (or press Resume in AI Home) and ask again.';
  }
  if (off === "no-key" && (intent.kind === "free" || intent.kind === "expert")) {
    return `I need the Claude key for questions like this (AI Center > Settings). These work now: ${COMMAND_HELP.slice(
      0,
      6,
    )
      .map((c) => `"${c.say}"`)
      .join(", ")}, and "help" for the rest.`;
  }
  return null;
}

/**
 * The owner writes to Mehedi 2.0: the message is kept, read and answered. The
 * answers (words, and any cards) are returned and kept too.
 */
export async function sendChat(
  ctx: CompanyContext,
  input: unknown,
  meta?: RequestMeta,
  channel: AiChannel = "ERP",
): Promise<Saved[]> {
  assertOwner(ctx);
  checkRateLimit(`ai-chat:${ctx.user.id}`, 30, 60_000);
  const { text } = chatSchema.parse(input);
  // "EXTAS: ..." from a shared bot: only this company's own name is read off.
  const { store, rest } = storePrefix(text);
  const said =
    store && ctx.company.name.toLowerCase().startsWith(store.toLowerCase()) ? rest : text;
  const intent = readIntent(said);
  await prisma.aiChatMessage.create({
    data: {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      channel,
      role: "OWNER",
      text,
      intent: intent.kind,
    },
  });
  const settings = await aiSettingsOf(ctx.company.id);
  const turn: Turn = { ctx, meta, said, channel };
  const closed = gate(intent, offReason(settings));
  let answer: Reply;
  if (closed) {
    answer = { text: closed, cards: [] };
  } else {
    try {
      answer =
        intent.kind === "free"
          ? await askMehedi(turn)
          : intent.kind === "expert"
            ? await askExpert(turn, intent.expert, intent.question)
            : await answerIntent(turn, intent);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      answer = { text: `I could not do that: ${error.message}`, cards: [] };
    }
  }
  const saved: Saved[] = [];
  const [first, ...more] = answer.cards;
  saved.push(await saveAi(ctx, channel, answer.text, first ?? null, intent.kind));
  for (const card of more) saved.push(await saveAi(ctx, channel, "", card, intent.kind));
  return saved;
}

// ---------------------------------------------------------------- free questions

/** The last messages, as Claude reads them (owner = user, Mehedi = assistant). */
async function historyOf(ctx: CompanyContext): Promise<Anthropic.MessageParam[]> {
  const rows = await prisma.aiChatMessage.findMany({
    where: { companyId: ctx.company.id, userId: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY,
    select: { role: true, text: true },
  });
  const turns: Anthropic.MessageParam[] = [];
  for (const row of rows.reverse()) {
    if (!row.text.trim()) continue;
    const role = row.role === "OWNER" ? "user" : "assistant";
    const last = turns.at(-1);
    if (last && last.role === role) last.content = `${String(last.content)}\n\n${row.text}`;
    else turns.push({ role, content: row.text });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_books",
    description:
      "Look things up in your books (K1–K5, X26): returns the sections that match the words.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "A few words to look for." } },
      required: ["query"],
    },
  },
  {
    name: "order_status",
    description:
      "The status of an order, costing sheet, booking or production project, by its number.",
    input_schema: {
      type: "object",
      properties: { number: { type: "string" } },
      required: ["number"],
    },
  },
  {
    name: "costing_check",
    description:
      "A costing sheet's Order check card (price, time, factory, payment, risks), by its number.",
    input_schema: {
      type: "object",
      properties: { number: { type: "string" } },
      required: ["number"],
    },
  },
  {
    name: "ai_cost",
    description: "What the AI cost over the last few days, by task and agent.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
      required: ["days"],
    },
  },
  {
    name: "report_pdf",
    description: "Make a report PDF for the owner (and email it when asked).",
    input_schema: {
      type: "object",
      properties: {
        report: { type: "string", enum: ["SALES", "PROFIT_AND_LOSS", "STOCK_ALERTS", "SUMMARY"] },
        period: { type: "string", enum: ["today", "yesterday", "7d", "month"] },
        email: { type: "boolean" },
      },
      required: ["report", "period"],
    },
  },
  {
    name: "propose_house_rule",
    description:
      "Write down a standing rule the owner gave as a House Rule proposal (it counts only once the owner approves it).",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The rule in one clear sentence." },
        scope: { type: "string", enum: ["ALL", "BUYER", "BRAND", "ITEM"] },
        scope_value: { type: "string", description: "The buyer, brand or item it is for." },
      },
      required: ["text", "scope"],
    },
  },
  {
    name: "draft_message",
    description:
      "Draft an email for the owner to check and send (buyers: replies, follow-ups, payment reminders, claims, quotations, invoices; or suppliers and factories). Never sends.",
    input_schema: {
      type: "object",
      properties: {
        party: { type: "string", description: "The buyer's or supplier's name." },
        kind: { type: "string", enum: [...DRAFT_KINDS] },
        about: { type: "string" },
        points: { type: "string", description: "The owner's points, one per line." },
      },
      required: ["party", "kind"],
    },
  },
  {
    name: "ask_deletion",
    description:
      "Ask the owner to delete a record (you never delete): a Deletion request with your reasons.",
    input_schema: {
      type: "object",
      properties: {
        number: { type: "string" },
        why: { type: "string" },
        if_kept: { type: "string", description: "What happens if it is kept." },
      },
      required: ["number", "why", "if_kept"],
    },
  },
  {
    name: "propose_task",
    description: "Propose a task for an employee as a change card the owner applies.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        employee: { type: "string" },
        due: { type: "string", description: "YYYY-MM-DD, or +N for N days from today." },
      },
      required: ["title"],
    },
  },
  {
    name: "propose_follow_up",
    description: "Propose a follow-up date with a buyer as a change card the owner applies.",
    input_schema: {
      type: "object",
      properties: {
        buyer: { type: "string" },
        due: { type: "string", description: "YYYY-MM-DD, or +N for N days from today." },
        about: { type: "string" },
      },
      required: ["buyer", "due"],
    },
  },
];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Runs one tool for Claude: its words for Claude, its cards for the owner. */
async function runTool(turn: Turn, name: string, input: Record<string, unknown>): Promise<Reply> {
  switch (name) {
    case "read_books": {
      const sections = await searchBooks(turn.ctx.company.id, str(input.query), {
        limit: 3,
        maxChars: 2000,
      });
      return {
        text: sections.length
          ? sections.map((s) => `[${s.book}] ${s.heading}\n${s.text}`).join("\n\n")
          : "Nothing in the books matches those words.",
        cards: [],
      };
    }
    case "order_status":
      return orderStatus(turn, str(input.number).toUpperCase());
    case "costing_check":
      return costingAnswer(turn, str(input.number).toUpperCase() || null);
    case "ai_cost":
      return costSummary(turn, Math.min(Math.max(Number(input.days) || 7, 1), 90));
    case "report_pdf":
      return reportPdf(
        turn,
        (["today", "yesterday", "7d", "month"] as const).find((p) => p === input.period) ?? "today",
        (["SALES", "PROFIT_AND_LOSS", "STOCK_ALERTS", "SUMMARY"] as const).find(
          (k) => k === input.report,
        ) ?? "SUMMARY",
        input.email === true,
      );
    case "propose_house_rule": {
      const scope =
        (["ALL", "BUYER", "BRAND", "ITEM"] as const).find((s) => s === input.scope) ?? "ALL";
      return teach(turn, str(input.text), { scope, value: str(input.scope_value) || null }, true);
    }
    case "draft_message": {
      const kind = DRAFT_KINDS.find((k) => k === input.kind) ?? null;
      return writeDraft(turn, {
        party: str(input.party),
        about: str(input.about) || null,
        points: str(input.points) || null,
        kind,
      });
    }
    case "ask_deletion":
      return deletion(
        turn,
        {
          kind: "delete",
          what: turn.said,
          ref: str(input.number).toUpperCase() || null,
          oldDraftBookings: false,
        },
        { why: str(input.why), ifKept: str(input.if_kept) },
      );
    case "propose_task":
      return taskCard(turn, str(input.title), str(input.employee) || null, str(input.due) || null);
    case "propose_follow_up":
      return followUpCard(turn, str(input.buyer), str(input.due) || "+1", str(input.about) || null);
    default:
      return { text: "There is no such tool.", cards: [] };
  }
}

/** A free question: Claude answers as Mehedi 2.0, with the tools above. */
async function askMehedi(turn: Turn, ask?: Ask | null): Promise<Reply> {
  const { ctx } = turn;
  const asker = ask === undefined ? await askerFor(ctx.company.id, ctx.user.id) : ask;
  if (!asker)
    return {
      text: OFF_TEXT[offReason(await aiSettingsOf(ctx.company.id)) ?? "switched-off"],
      cards: [],
    };
  const messages = await historyOf(ctx);
  const system = await mehediSystem(ctx.company.id, {
    extra:
      "You are in the owner's chat. Use the tools for numbers and records; never guess them. A tool that proposes (a change card, a draft, a House Rule, a Deletion request) only shows it to the owner: say so plainly. Answer in the owner's language, short.",
  });
  const cards: ChatCard[] = [];
  for (let round = 0; round < TOOL_ROUNDS; round += 1) {
    const { message } = await asker({
      task: "chat",
      system,
      messages,
      tools: TOOLS,
      maxTokens: 2000,
      why: `Chat: ${turn.said.slice(0, 80)}`,
      agent: "Mehedi 2.0",
    });
    const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (uses.length === 0 || message.stop_reason !== "tool_use") {
      return { text: textOf(message) || "Done.", cards };
    }
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      try {
        const out = await runTool(turn, use.name, (use.input ?? {}) as Record<string, unknown>);
        cards.push(...out.cards);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: out.text.slice(0, 6000),
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: error instanceof AppError ? error.message : "The tool failed.",
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "That took too many steps: ask me in smaller parts.", cards };
}

/** "@X07 ...": only that expert answers. */
async function askExpert(turn: Turn, id: string, question: string): Promise<Reply> {
  const { ctx } = turn;
  const expert = expertById(id);
  if (!expert) return { text: `There is no expert ${id}: they are X01 to X25.`, cards: [] };
  const ask = await askerFor(ctx.company.id, ctx.user.id);
  if (!ask)
    return {
      text: OFF_TEXT[offReason(await aiSettingsOf(ctx.company.id)) ?? "switched-off"],
      cards: [],
    };
  const { message } = await ask({
    task: "chat",
    system: expertPrompt(expert, ctx.company.name),
    messages: [{ role: "user", content: question }],
    maxTokens: 1500,
    why: `${expert.id} asked in the chat`,
    agent: expert.id,
  });
  return { text: `${expert.id} · ${expert.name}: ${textOf(message)}`, cards: [] };
}

// ---------------------------------------------------------------- change cards

async function cardMessage(ctx: CompanyContext, messageId: string) {
  const row = await ctx.db.aiChatMessage.findFirst({
    where: { id: messageId, userId: ctx.user.id, role: "AI" },
  });
  const card = row?.card as ChatCard | null | undefined;
  if (!row || !card || card.type !== "change")
    throw new AppError("NOT_FOUND", "This card is not there any more.");
  return { row, card };
}

const p = (params: Record<string, unknown>, key: string) => params[key] ?? null;

/** Apply on a change card: the change is made in the owner's name, then said in the chat. */
export async function applyCard(ctx: CompanyContext, messageId: string, meta?: RequestMeta) {
  assertOwner(ctx);
  const { row, card } = await cardMessage(ctx, messageId);
  const claimed = await prisma.aiChatMessage.updateMany({
    where: { id: row.id, companyId: ctx.company.id, cardStatus: "PROPOSED" },
    data: { cardStatus: "APPLIED", cardDoneAt: new Date() },
  });
  if (claimed.count === 0)
    throw new AppError("CONFLICT", "This card was applied or cancelled already.");
  try {
    switch (card.action) {
      case "accounts.today":
        await applyPreset(ctx, "accounts-today", meta);
        break;
      case "control.cell":
        await setControlCell(
          ctx,
          { node: p(card.params, "node"), state: p(card.params, "state") },
          meta,
        );
        break;
      case "profit.set":
        await setProfitPercent(
          ctx,
          String(p(card.params, "costingId")),
          { percent: p(card.params, "percent") },
          meta,
        );
        break;
      case "task.create":
        if (!ctx.can("reminders.manage"))
          throw new AppError("FORBIDDEN", "Giving tasks is not part of your role.");
        await createTask(
          ctx,
          {
            title: p(card.params, "title"),
            assigneeId: p(card.params, "assigneeId"),
            dueAt: p(card.params, "dueAt"),
          },
          meta,
        );
        break;
      case "followup.set":
        await setFollowUp(
          ctx,
          {
            partyId: p(card.params, "partyId"),
            dueOn: p(card.params, "dueOn"),
            recordLabel: p(card.params, "recordLabel"),
          },
          meta,
        );
        break;
    }
  } catch (error) {
    await prisma.aiChatMessage.update({
      where: { id: row.id },
      data: { cardStatus: "PROPOSED", cardDoneAt: null },
    });
    throw error;
  }
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiChat",
    entityId: row.id,
    summary: `${card.title} (AI Chat, approved by owner)`,
  });
  await saveAi(ctx, row.channel, `Done: ${card.title}.`, null, "card.applied");
}

/** Cancel on a change card: nothing changes. */
export async function cancelCard(ctx: CompanyContext, messageId: string) {
  assertOwner(ctx);
  const { row, card } = await cardMessage(ctx, messageId);
  const claimed = await prisma.aiChatMessage.updateMany({
    where: { id: row.id, companyId: ctx.company.id, cardStatus: "PROPOSED" },
    data: { cardStatus: "CANCELLED", cardDoneAt: new Date() },
  });
  if (claimed.count === 0)
    throw new AppError("CONFLICT", "This card was applied or cancelled already.");
  await saveAi(
    ctx,
    row.channel,
    `Cancelled: ${card.title}. Nothing changed.`,
    null,
    "card.cancelled",
  );
}

// ---------------------------------------------------------------- the screen

/** The owner's chat: the last messages, oldest first, with each draft's state now. */
export async function getChat(ctx: CompanyContext) {
  assertOwner(ctx);
  const [rows, settings] = await Promise.all([
    prisma.aiChatMessage.findMany({
      where: { companyId: ctx.company.id, userId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    aiSettingsOf(ctx.company.id),
  ]);
  const draftIds = rows.flatMap((r) => {
    const card = r.card as ChatCard | null;
    return card?.type === "draft" ? [card.draftId] : [];
  });
  const drafts = draftIds.length
    ? await ctx.db.aiDraft.findMany({
        where: { id: { in: draftIds } },
        select: { id: true, status: true },
      })
    : [];
  const off = offReason(settings);
  return {
    name: settings.assistantName,
    label: aiLabel(settings),
    state: off ?? ("on" as const),
    stateText: off ? OFF_TEXT[off] : null,
    messages: rows.reverse().map((r) => {
      const card = r.card as ChatCard | null;
      return {
        id: r.id,
        role: r.role,
        channel: r.channel,
        text: r.text,
        card,
        cardStatus: (r.cardStatus as CardStatus | null) ?? null,
        draftStatus:
          card?.type === "draft"
            ? (drafts.find((d) => d.id === card.draftId)?.status ?? null)
            : null,
        at: r.createdAt,
      };
    }),
    help: COMMAND_HELP,
  };
}

export type ChatScreen = Awaited<ReturnType<typeof getChat>>;
export type ChatMessage = ChatScreen["messages"][number];

export { askMehedi as askMehediForTests };
