import type { AiChannel, AiDraftKind } from "@prisma/client";

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import { orderCheck } from "@/modules/costing/costing.service";
import { readStoredFile } from "@/modules/files/file.service";
import { sendMail } from "@/modules/mail/mail.service";
import { METRIC_INFO } from "@/modules/reports/catalog";
import { generateReport } from "@/modules/reports/export.service";

import { asAi } from "../account";
import { aiMay } from "../control.service";
import { getMonthCost, getCosts } from "../costs.service";
import { BUYER_KINDS, DRAFT_ACTION } from "../draft-templates";
import { makeAiDraft } from "../drafts.service";
import { proposeHouseRule } from "../house-rules.service";
import { BOOK_CODES, testStanding } from "../knowledge";
import { askDeletion, askPermission } from "../requests.service";
import { aiLabel, aiSettingsOf, offReason, OFF_TEXT, setAiPaused } from "../settings.service";
import type { ChatCard } from "./cards";
import { COMMAND_HELP, type Intent, type ReportKind, type ReportPeriod } from "./intents";

/*
 * Mehedi 2.0's answers to the chat's commands (intents.ts), the same on the
 * ERP chat and on the bot. Reading follows Control: a view cell set to Off
 * becomes a permission request (Only this task / For today / Always / No).
 * Changes come back as change cards the owner applies; deleting is only ever a
 * Deletion request; what goes to a buyer is only ever a draft the owner sends.
 */

export type Turn = {
  ctx: CompanyContext;
  meta?: RequestMeta;
  /** The owner's words, as written. */
  said: string;
  channel: AiChannel;
};

export type Reply = { text: string; cards: ChatCard[] };

const reply = (text: string, ...cards: ChatCard[]): Reply => ({ text, cards });

/** The record a reference names, among the ones this person may open. */
export type Found = {
  type: "SalesOrder" | "OrderCosting" | "PurchaseOrder" | "ProductionProject";
  id: string;
  label: string;
  href: string;
  /** The Control cell that reads it. */
  view: string;
};

const contains = (ref: string) => ({ contains: ref, mode: "insensitive" as const });

/** Finds an order, costing sheet, booking or purchase order, or project by its number. */
export async function findRecord(ctx: CompanyContext, ref: string): Promise<Found | null> {
  const [order, costing, purchase, project] = await Promise.all([
    ctx.can("sales.view")
      ? ctx.db.salesOrder.findFirst({
          where: { number: contains(ref) },
          select: { id: true, number: true },
        })
      : null,
    ctx.can("costing.view")
      ? ctx.db.orderCosting.findFirst({
          where: { number: contains(ref) },
          select: { id: true, number: true, title: true },
        })
      : null,
    ctx.can("materials.view") || ctx.can("production.bookings.view")
      ? ctx.db.purchaseOrder.findFirst({
          where: { number: contains(ref) },
          select: { id: true, number: true, booking: { select: { id: true } } },
        })
      : null,
    ctx.can("production.view")
      ? ctx.db.productionProject.findFirst({
          where: { OR: [{ code: contains(ref) }, { name: contains(ref) }] },
          select: { id: true, code: true, name: true },
        })
      : null,
  ]);
  if (order) {
    return {
      type: "SalesOrder",
      id: order.id,
      label: order.number,
      href: `/sales/orders/${order.id}`,
      view: "sales.view",
    };
  }
  if (costing) {
    return {
      type: "OrderCosting",
      id: costing.id,
      label: `${costing.number} ${costing.title}`,
      href: `/production/costing/${costing.id}`,
      view: "costing.view",
    };
  }
  if (purchase) {
    return purchase.booking && ctx.can("production.bookings.view")
      ? {
          type: "PurchaseOrder",
          id: purchase.id,
          label: `Booking ${purchase.number}`,
          href: `/production/bookings/${purchase.booking.id}`,
          view: "production.bookings.view",
        }
      : {
          type: "PurchaseOrder",
          id: purchase.id,
          label: purchase.number,
          href: `/materials/orders/${purchase.id}`,
          view: "materials.view",
        };
  }
  if (project) {
    return {
      type: "ProductionProject",
      id: project.id,
      label: `${project.code} ${project.name}`,
      href: `/production/projects/${project.id}`,
      view: "production.view",
    };
  }
  return null;
}

/**
 * May the AI read or do this for the owner now? Off: it asks for permission
 * and says so (the owner answers in AI Home or on the bot). Ask and Do: the
 * owner's own command is the go-ahead.
 */
async function mayOrAsk(
  turn: Turn,
  key: string,
  task: string,
  record?: Found,
): Promise<Reply | null> {
  const may = await aiMay(
    turn.ctx.company.id,
    key,
    record ? { type: record.type, id: record.id, label: record.label } : undefined,
  );
  if (may.state !== "OFF") return null;
  await askPermission(turn.ctx.company.id, {
    key,
    task,
    why: `You asked in the chat: "${turn.said.slice(0, 300)}"`,
    record: record ? { type: record.type, id: record.id, label: record.label } : undefined,
    channel: turn.channel,
  });
  return reply(
    `I may not do this now (${may.why}). I asked you for permission: answer it in AI Home (Only this task, For today, Always or No).`,
    { type: "requests", count: 1, what: "Permission request", href: "/ai" },
  );
}

// ---------------------------------------------------------------- the answers

async function status(turn: Turn): Promise<Reply> {
  const { ctx } = turn;
  const settings = await aiSettingsOf(ctx.company.id);
  const off = offReason(settings);
  const [standing, month, drafts, requests, rules] = await Promise.all([
    testStanding(ctx.company.id, new Date()),
    getMonthCost(ctx),
    ctx.db.aiDraft.count({ where: { status: { in: ["DRAFT", "FAILED"] } } }),
    Promise.all([
      ctx.db.aiPermissionRequest.count({ where: { status: "PENDING" } }),
      ctx.db.aiDeletionRequest.count({ where: { status: "PENDING" } }),
    ]),
    ctx.db.houseRule.count({ where: { status: "PROPOSED" } }),
  ]);
  const passed = BOOK_CODES.filter((c) => standing[c].state === "PASSED").length;
  return reply(off ? OFF_TEXT[off] : "I am on and working.", {
    type: "facts",
    title: aiLabel(settings),
    rows: [
      { label: "Tests passed", value: `${passed} of ${BOOK_CODES.length}`, href: "/ai/knowledge" },
      {
        label: "AI cost this month",
        value: `${month.currency} ${month.spent}${month.budget ? ` of ${month.budget}` : ""}`,
        href: "/ai/costs",
      },
      { label: "Drafts waiting for you", value: String(drafts), href: "/ai/drafts" },
      { label: "Requests waiting for you", value: String(requests[0] + requests[1]), href: "/ai" },
      { label: "House Rules to approve", value: String(rules), href: "/ai/mehedi#teach" },
    ],
  });
}

async function orderStatus(turn: Turn, ref: string): Promise<Reply> {
  const { ctx } = turn;
  const found = await findRecord(ctx, ref);
  if (!found)
    return reply(
      `I found no order, costing, booking or project numbered "${ref}". Check the number.`,
    );
  const blocked = await mayOrAsk(turn, found.view, `Read ${found.label}`, found);
  if (blocked) return blocked;
  const rows: Array<{ label: string; value: string; href?: string | null }> = [];
  if (found.type === "SalesOrder") {
    const o = await ctx.db.salesOrder.findFirstOrThrow({
      where: { id: found.id },
      select: {
        status: true,
        orderDate: true,
        shipmentDate: true,
        total: true,
        dueAmount: true,
        party: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });
    rows.push(
      { label: "Buyer", value: o.party?.name ?? "Walk-in" },
      { label: "Status", value: o.status.replaceAll("_", " ").toLowerCase() },
      { label: "Ordered", value: localDay(o.orderDate, ctx.company.timezone) },
      { label: "Ships", value: o.shipmentDate ? localDay(o.shipmentDate, "UTC") : "not set" },
      { label: "Lines", value: String(o._count.items) },
    );
    if (ctx.can("sales.view") && ctx.can("accounts.view")) {
      rows.push({
        label: "Due",
        value: `${ctx.company.currency} ${o.dueAmount.toFixed(2)} of ${o.total.toFixed(2)}`,
      });
    }
  } else if (found.type === "OrderCosting") {
    const c = await ctx.db.orderCosting.findFirstOrThrow({
      where: { id: found.id },
      select: {
        decision: true,
        profitPercent: true,
        shipDate: true,
        buyer: { select: { name: true } },
        factory: { select: { name: true } },
        _count: { select: { styles: true } },
      },
    });
    rows.push(
      { label: "Buyer", value: c.buyer?.name ?? "not set" },
      { label: "Factory", value: c.factory?.name ?? "not set" },
      { label: "Styles", value: String(c._count.styles) },
      {
        label: "Profit %",
        value: c.profitPercent ? `${c.profitPercent.toString()}%` : "not set yet (yours to set)",
      },
      { label: "Ships", value: c.shipDate ? localDay(c.shipDate, "UTC") : "not set" },
      {
        label: "Your decision",
        value:
          c.decision === "TAKE" ? "Taken" : c.decision === "DECLINE" ? "Declined" : "Not decided",
      },
    );
  } else if (found.type === "PurchaseOrder") {
    const p = await ctx.db.purchaseOrder.findFirstOrThrow({
      where: { id: found.id },
      select: {
        status: true,
        orderDate: true,
        expectedDate: true,
        supplier: { select: { name: true } },
        booking: { select: { stage: true, revision: true, sentAt: true } },
      },
    });
    rows.push(
      { label: "Supplier", value: p.supplier.name },
      { label: "Status", value: p.status.replaceAll("_", " ").toLowerCase() },
      { label: "Ordered", value: localDay(p.orderDate, "UTC") },
      { label: "Expected in", value: p.expectedDate ? localDay(p.expectedDate, "UTC") : "not set" },
    );
    if (p.booking) {
      rows.push({
        label: "Booking",
        value: `${p.booking.stage.toLowerCase()} R${p.booking.revision}${p.booking.sentAt ? ", sent" : ", not sent"}`,
      });
    }
  } else {
    const p = await ctx.db.productionProject.findFirstOrThrow({
      where: { id: found.id },
      select: { status: true, targetDate: true },
    });
    rows.push(
      { label: "Status", value: p.status.replaceAll("_", " ").toLowerCase() },
      { label: "Target", value: localDay(p.targetDate, ctx.company.timezone) },
    );
  }
  rows.push({ label: "Open it", value: found.label, href: found.href });
  return reply(`${found.label}:`, { type: "facts", title: found.label, rows });
}

const REPORT_TITLES: Record<ReportKind, string> = {
  SALES: "Sales report",
  PROFIT_AND_LOSS: "Profit report",
  STOCK_ALERTS: "Stock report",
  SUMMARY: "Key figures",
};

function reportDays(period: ReportPeriod, today: string) {
  switch (period) {
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    default:
      return { from: today, to: today };
  }
}

async function reportPdf(
  turn: Turn,
  period: ReportPeriod,
  kind: ReportKind,
  email: boolean,
): Promise<Reply> {
  const { ctx } = turn;
  const blocked = await mayOrAsk(turn, "ai.reports.send", "Make a report PDF and send it to you");
  if (blocked) return blocked;
  if (!ctx.can("reports.export"))
    return reply("Your role does not make reports, so I cannot make one for you.");
  const metric = METRIC_INFO[kind].allowed(ctx) ? kind : null;
  if (!metric)
    return reply(`Your role does not see this report (it needs ${METRIC_INFO[kind].needs}).`);
  const today = localDay(new Date(), ctx.company.timezone);
  const days = reportDays(period, today);
  const ai = await asAi(ctx);
  const saved = await generateReport(
    ai,
    { title: REPORT_TITLES[kind], ...days, metrics: [metric], format: "PDF" },
    turn.meta,
  );
  if (saved.status !== "SUCCEEDED")
    return reply("The report could not be made. Try again, or make it in Reports.");
  const href = `/api/reports/exports/${saved.id}/download`;
  let emailed: string | null = null;
  let note = "";
  if (email) {
    try {
      const row = await prisma.reportExport.findFirstOrThrow({
        where: { id: saved.id, companyId: ctx.company.id },
        select: { file: { select: { storagePath: true, fileName: true } } },
      });
      if (!row.file) throw new AppError("NOT_FOUND", "The report file is missing.");
      await sendMail(
        ctx.company.id,
        {
          to: ctx.user.email,
          subject: `${ctx.company.name} | ${REPORT_TITLES[kind]} (${saved.range})`,
          text: `${REPORT_TITLES[kind]} for ${saved.range} is attached.\n\nMade by ${aiLabel(await aiSettingsOf(ctx.company.id))} when you asked in the chat.`,
          attachments: [
            {
              filename: row.file.fileName,
              content: await readStoredFile(row.file),
              contentType: "application/pdf",
            },
          ],
        },
        { userId: ctx.user.id, entityType: "ReportExport", entityId: saved.id },
      );
      emailed = ctx.user.email;
    } catch (error) {
      note = ` I could not email it: ${error instanceof Error ? error.message : "the email failed"}.`;
    }
  }
  return reply(
    `${REPORT_TITLES[kind]} for ${saved.range} is ready.${emailed ? ` I emailed it to ${emailed}.` : ""}${note}`,
    {
      type: "report",
      exportId: saved.id,
      title: REPORT_TITLES[kind],
      range: saved.range,
      href,
      emailed,
    },
  );
}

async function costSummary(turn: Turn, days: number): Promise<Reply> {
  const { ctx } = turn;
  const today = localDay(new Date(), ctx.company.timezone);
  const query =
    days === 1
      ? { period: "today" }
      : days === 7
        ? { period: "7d" }
        : days === 30
          ? { period: "30d" }
          : { period: "custom", from: addDays(today, 1 - days), to: today };
  const costs = await getCosts(ctx, query);
  const period = days === 1 ? "Today" : `Last ${days} days`;
  return reply(
    costs.totals.calls === 0
      ? `${period}: no AI work, no cost.`
      : `${period}: ${costs.currency} ${costs.totals.cost} for ${costs.totals.calls} AI calls.`,
    {
      type: "costs",
      period,
      currency: costs.currency,
      total: costs.totals.cost,
      calls: costs.totals.calls,
      byTask: costs.by.task
        .slice(0, 8)
        .map((s) => ({ label: s.label, cost: s.cost, calls: s.calls })),
      byAgent: costs.by.agent
        .slice(0, 8)
        .map((s) => ({ label: s.label, cost: s.cost, calls: s.calls })),
    },
  );
}

async function costing(turn: Turn, ref: string | null): Promise<Reply> {
  const { ctx } = turn;
  if (!ctx.can("costing.view")) return reply("Costing sheets are not open to your role.");
  const blocked = await mayOrAsk(turn, "costing.view", "Read the costing sheets");
  if (blocked) return blocked;
  if (!ref) {
    const open = await ctx.db.orderCosting.findMany({
      where: { decision: null },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, number: true, title: true },
    });
    if (open.length === 0) {
      return reply(
        "There is no costing sheet waiting. Make one in Production > Costing, then tell me its number.",
      );
    }
    return reply("Which one? Tell me its number:", {
      type: "facts",
      title: "Costing sheets not decided yet",
      rows: open.map((c) => ({
        label: c.number,
        value: c.title,
        href: `/production/costing/${c.id}`,
      })),
    });
  }
  const sheet = await ctx.db.orderCosting.findFirst({
    where: { number: contains(ref) },
    select: { id: true, number: true, title: true, profitPercent: true },
  });
  if (!sheet) return reply(`I found no costing sheet numbered "${ref}".`);
  const rows = await orderCheck(ctx, sheet.id);
  const reds = rows.filter((r) => r.signal === "red").length;
  const yellows = rows.filter((r) => r.signal === "yellow").length;
  return reply(
    `${sheet.number}: ${reds > 0 ? `${reds} red` : "no red"}, ${yellows} yellow. ${
      sheet.profitPercent
        ? `Profit ${sheet.profitPercent.toString()}%.`
        : "The profit % is yours to set."
    } You decide; I only show the card.`,
    {
      type: "check",
      costingId: sheet.id,
      number: sheet.number,
      title: sheet.title,
      href: `/production/costing/${sheet.id}`,
      profitPercent: sheet.profitPercent?.toString() ?? null,
      rows,
    },
  );
}

async function profitSet(turn: Turn, ref: string | null, percent: number): Promise<Reply> {
  const { ctx } = turn;
  if (!ref)
    return reply(
      'Which costing sheet? Say its number with the profit, like "CS-2026-0001 profit 12%".',
    );
  if (!ctx.can("costing.manage")) return reply("Changing costing sheets is not part of your role.");
  const sheet = await ctx.db.orderCosting.findFirst({
    where: { number: contains(ref) },
    select: { id: true, number: true, title: true, profitPercent: true },
  });
  if (!sheet) return reply(`I found no costing sheet numbered "${ref}".`);
  if (!(percent >= 0 && percent <= 80)) return reply("Give a profit % from 0 to 80.");
  return reply(`Press Apply to set the profit of ${sheet.number} to ${percent}%.`, {
    type: "change",
    action: "profit.set",
    title: `Profit % of ${sheet.number}`,
    page: "Production > Costing",
    href: `/production/costing/${sheet.id}`,
    lines: [
      {
        label: "Profit %",
        before: sheet.profitPercent ? `${sheet.profitPercent.toString()}%` : "not set",
        after: `${percent}%`,
      },
    ],
    params: { costingId: sheet.id, percent },
  });
}

async function deletion(
  turn: Turn,
  intent: Extract<Intent, { kind: "delete" }>,
  given?: { why: string; ifKept: string },
): Promise<Reply> {
  const { ctx } = turn;
  const why = given?.why ?? `You asked in the chat: "${turn.said.slice(0, 300)}"`;
  if (intent.oldDraftBookings) {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const drafts = await ctx.db.booking.findMany({
      where: { stage: "DRAFT", revision: 0, createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, order: { select: { id: true, number: true } } },
    });
    if (drafts.length === 0)
      return reply("There are no draft bookings older than 30 days. Nothing to ask.");
    for (const b of drafts) {
      await askDeletion(ctx.company.id, {
        what: `Draft booking ${b.order.number}`,
        recordType: "PurchaseOrder",
        recordId: b.order.id,
        href: `/production/bookings/${b.id}`,
        why: given?.why ?? "A draft booking older than 30 days that was never approved.",
        ifKept: given?.ifKept ?? "It stays in the bookings list as a draft; nothing else changes.",
        channel: turn.channel,
      });
    }
    return reply(
      `I never delete anything. I sent you ${drafts.length} Deletion request${drafts.length > 1 ? "s" : ""}: ${drafts
        .map((b) => b.order.number)
        .join(", ")}. Decide them in AI Home (your PIN is asked).`,
      { type: "requests", count: drafts.length, what: "Deletion requests", href: "/ai" },
    );
  }
  if (!intent.ref) {
    return reply(
      "I never delete anything myself. Tell me the record's number and I will send you a Deletion request with my reasons.",
    );
  }
  const found = await findRecord(ctx, intent.ref);
  if (!found) return reply(`I found no record numbered "${intent.ref}".`);
  await askDeletion(ctx.company.id, {
    what: found.label,
    recordType: found.type,
    recordId: found.id,
    href: found.href,
    why,
    ifKept: given?.ifKept ?? "It stays as it is; nothing else changes.",
    channel: turn.channel,
  });
  return reply(
    `I never delete anything. I sent you a Deletion request for ${found.label}: decide it in AI Home (your PIN is asked).`,
    {
      type: "requests",
      count: 1,
      what: "Deletion request",
      href: "/ai",
    },
  );
}

async function draftSend(turn: Turn): Promise<Reply> {
  const { ctx } = turn;
  const last = await ctx.db.aiChatMessage.findMany({
    where: { userId: ctx.user.id, role: "AI", card: { not: { equals: null } } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { card: true },
  });
  const shown = last.map((m) => m.card as ChatCard | null).find((c) => c?.type === "draft");
  if (!shown || shown.type !== "draft")
    return reply("There is no draft in this chat to send. Open Drafts to send one.");
  const { sendDraft } = await import("../drafts.service");
  try {
    await sendDraft(ctx, shown.draftId, turn.meta);
  } catch (error) {
    if (error instanceof AppError) return reply(`Not sent: ${error.message}`);
    throw error;
  }
  return reply(`Sent "${shown.subject}"${shown.to ? ` to ${shown.to}` : ""}.`);
}

/** A party named in the chat (any kind), the closest match first. */
async function partyNamed(ctx: CompanyContext, name: string, buyersOnly = false) {
  return ctx.db.party.findFirst({
    where: {
      OR: [{ name: contains(name) }, { code: contains(name) }],
      ...(buyersOnly ? { kind: { in: ["BUYER", "BOTH"] } } : {}),
      status: "ACTIVE",
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, email: true },
  });
}

/** Drafts a message; for a buyer it waits for the owner's Send (or "পাঠাও"). */
export async function writeDraft(
  turn: Turn,
  input: { party: string; about: string | null; points?: string | null; kind?: AiDraftKind | null },
): Promise<Reply> {
  const { ctx } = turn;
  const party = await partyNamed(ctx, input.party);
  if (!party) return reply(`I found no buyer or supplier called "${input.party}".`);
  const buyer = party.kind === "BUYER" || party.kind === "BOTH";
  const kind: AiDraftKind =
    input.kind ??
    (buyer
      ? /reply|উত্তর/i.test(turn.said)
        ? "BUYER_REPLY"
        : /payment|পেমেন্ট|টাকা/i.test(turn.said)
          ? "BUYER_CHASE"
          : "BUYER_FOLLOW_UP"
      : "SUPPLIER");
  const key = DRAFT_ACTION[kind];
  if (key) {
    const blocked = await mayOrAsk(turn, key, `Draft a message for ${party.name}`);
    if (blocked) return blocked;
  }
  const draft = await makeAiDraft(
    ctx.company.id,
    { kind, partyId: party.id, about: input.about, points: input.points ?? null },
    { userId: ctx.user.id },
  );
  const forBuyer = BUYER_KINDS.has(kind);
  return reply(
    `${forBuyer ? "A draft for the buyer: nothing goes until you send it." : "A draft for you to check."} Say "পাঠাও" to send it${
      draft.toAddress ? ` to ${draft.toAddress}` : " (add the email address in Drafts first)"
    }, or change it in Drafts.`,
    {
      type: "draft",
      draftId: draft.id,
      subject: draft.subject,
      to: draft.toAddress,
      party: party.name,
      forBuyer,
      body: draft.body,
    },
  );
}

async function teach(
  turn: Turn,
  text: string,
  scope?: { scope: "ALL" | "BUYER" | "BRAND" | "ITEM"; value: string | null },
  byAi = false,
): Promise<Reply> {
  const rule = await proposeHouseRule(
    turn.ctx,
    { text, scope: scope?.scope ?? "ALL", scopeValue: scope?.value ?? null },
    turn.meta,
    { said: turn.said, byAi, source: turn.channel === "BOT" ? "Bot" : "Chat" },
  );
  return reply(
    "I wrote it down as a House Rule proposal. It counts once you approve it on Mehedi 2.0 > Teach.",
    {
      type: "rule",
      ruleId: rule.id,
      text: rule.text,
      scope:
        rule.scope === "ALL"
          ? "Everything"
          : `${rule.scope.toLowerCase()}: ${rule.scopeValue ?? ""}`,
    },
  );
}

function dayFrom(due: string | null, today: string): string | null {
  if (!due) return null;
  if (due.startsWith("+")) return addDays(today, Number(due.slice(1)));
  return due;
}

export async function taskCard(
  turn: Turn,
  title: string,
  who: string | null,
  due: string | null,
): Promise<Reply> {
  const { ctx } = turn;
  if (!ctx.can("reminders.manage")) return reply("Giving tasks is not part of your role.");
  const today = localDay(new Date(), ctx.company.timezone);
  const dueOn = dayFrom(due, today);
  const person = who
    ? await ctx.db.employee.findFirst({
        where: {
          name: contains(who.replace(/কে$/, "").trim()),
          status: { in: ["ACTIVE", "ON_LEAVE"] },
        },
        select: { id: true, name: true },
      })
    : null;
  if (who && !person)
    return reply(`I found no employee called "${who}". Say the name as it is in HR.`);
  return reply("Press Apply to make the task.", {
    type: "change",
    action: "task.create",
    title: `New task: ${title}`,
    page: "Planner > Tasks",
    href: "/planner/tasks",
    lines: [
      { label: "Task", after: title },
      { label: "For", after: person?.name ?? "nobody yet" },
      { label: "Due", after: dueOn ?? "no date" },
    ],
    params: { title: title.slice(0, 200), assigneeId: person?.id ?? null, dueAt: dueOn },
  });
}

export async function followUpCard(
  turn: Turn,
  partyName: string,
  due: string,
  about: string | null,
): Promise<Reply> {
  const { ctx } = turn;
  const party = await partyNamed(ctx, partyName, true);
  if (!party) return reply(`I found no buyer called "${partyName}".`);
  const today = localDay(new Date(), ctx.company.timezone);
  const dueOn = dayFrom(due, today)!;
  if (dueOn < today) return reply("Pick today or a later day.");
  return reply(
    `Press Apply: on ${dueOn} I draft the follow-up and remind you. Nothing goes to ${party.name} until you send it.`,
    {
      type: "change",
      action: "followup.set",
      title: `Follow-up with ${party.name}`,
      page: "AI Center > Drafts",
      href: "/ai/drafts#follow-ups",
      lines: [
        { label: "Buyer", after: party.name },
        { label: "On", after: dueOn },
        { label: "About", after: about ?? "not given" },
      ],
      params: { partyId: party.id, dueOn, recordLabel: about },
    },
  );
}

/** Answers a command read by the rules (anything but a free question). */
export async function answerIntent(
  turn: Turn,
  intent: Exclude<Intent, { kind: "free" | "expert" }>,
): Promise<Reply> {
  const { ctx } = turn;
  switch (intent.kind) {
    case "ai.stop_all": {
      const settings = await aiSettingsOf(ctx.company.id);
      if (settings.pausedAt)
        return reply('Everything is stopped already. Say "আবার চালু করো" to start again.');
      await setAiPaused(ctx, true, turn.meta);
      return reply(
        'Stopped. No AI work runs until you say "আবার চালু করো" or press Resume in AI Home.',
      );
    }
    case "ai.resume": {
      const settings = await aiSettingsOf(ctx.company.id);
      if (!settings.enabled)
        return reply("The main switch is off: turn the AI on in AI Home first.");
      if (!settings.pausedAt) return reply("I am not paused.");
      await setAiPaused(ctx, false, turn.meta);
      return reply("Working again.");
    }
    case "help":
      return reply("You can say:", { type: "help", rows: COMMAND_HELP });
    case "status":
      return status(turn);
    case "order.new":
      return reply(
        "Open AI Center > Orders and press New order, then attach the buyer's PO, order sheet or photos. I read them, ask for what is missing, check the order and write the plan for your Approve.",
      );
    case "order.status":
      return orderStatus(turn, intent.ref);
    case "report.pdf":
      return reportPdf(turn, intent.period, intent.report, intent.email);
    case "cost.summary":
      return costSummary(turn, intent.days);
    case "control.accounts_today":
      return reply(
        "Press Apply to open Accounts for me until the end of today. Money still waits for you.",
        {
          type: "change",
          action: "accounts.today",
          title: "Accounts open today",
          page: "AI Center > Control",
          href: "/ai/control",
          lines: [
            {
              label: "Accounts",
              before: "as set in Control",
              after: "Do until the end of today (money stays Ask)",
            },
          ],
          params: {},
        },
      );
    case "costing":
      return costing(turn, intent.ref);
    case "profit.set":
      return profitSet(turn, intent.ref, intent.percent);
    case "delete":
      return deletion(turn, intent);
    case "messaging.mode":
      return reply(
        intent.supplier === "send"
          ? "Press Apply and I send messages to suppliers and mills myself. Buyers always get drafts that you send (v6.2)."
          : "Press Apply and I ask you before every message to a supplier. Buyers always get drafts that you send.",
        {
          type: "change",
          action: "control.cell",
          title: "Messages to suppliers and mills",
          page: "AI Center > Control",
          href: "/ai/control",
          lines: [
            {
              label: "Suppliers and mills",
              after: intent.supplier === "send" ? "Do (sends itself)" : "Ask (asks you first)",
            },
            { label: "Buyers", after: "Draft only, you send" },
          ],
          params: {
            node: "k:ai.production.message.supplier",
            state: intent.supplier === "send" ? "DO" : "ASK",
          },
        },
      );
    case "draft.send":
      return draftSend(turn);
    case "draft.write":
      return writeDraft(turn, { party: intent.party, about: intent.about });
    case "teach":
      return teach(turn, intent.text);
    case "task":
      return taskCard(turn, intent.title, intent.who, intent.due);
    case "follow_up":
      return followUpCard(turn, intent.party, intent.due, intent.about);
  }
}

export {
  costing as costingAnswer,
  costSummary,
  deletion,
  orderStatus,
  reportPdf,
  status as statusAnswer,
  teach,
};
