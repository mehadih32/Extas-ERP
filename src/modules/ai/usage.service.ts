import { type AiBudget, type AiCallResult, Prisma } from "@prisma/client";

import { groupAmount } from "@/lib/display";
import { localDay, startOfDayInZone } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

import { pushToBot } from "./bot/push";
import type { AiRecord } from "./control.service";
import { taskInfo, type TokenUse } from "./models";
import { blockedText, costIn, priceBook } from "./prices.service";
import { modelLabel, PROVIDERS, type ProviderId, providerInfo, providerOf } from "./providers";

/*
 * What the AI spends (AI Center > Budget & Costs). Every call to the AI
 * (Claude, OpenAI or Gemini) writes one line: who asked, the task, why, the
 * record, the model and its provider, the tokens and the cost (at the prices
 * on AI Center > Models; a model with none is blocked since v6.4, and older
 * lines without a price say "price unknown"), in dollars and in the company's
 * money at the rate the owner set.
 * Before a call the budget and limits are checked (all optional, off until
 * set; a monthly limit per provider too): at a limit new work stops, or goes on with the small model when the
 * owner chose that; at the alert percentage the owner is told once a month.
 */

/** The small model, for work that goes on at the limit when the owner chose "cheaper". */
export const CHEAPER_MODEL = "claude-haiku-5-5";

/** The company's budget row, or the defaults (no limits) before anything was set. */
export async function budgetOf(companyId: string, db: Db = prisma): Promise<AiBudget> {
  const row = await db.aiBudget.findUnique({ where: { companyId } });
  return (
    row ?? {
      id: "",
      companyId,
      monthly: null,
      daily: null,
      perOrder: null,
      perStaffMonthly: null,
      perAgentMonthly: null,
      askAbove: null,
      alertPercent: 80,
      atLimit: "STOP",
      usdRate: new Prisma.Decimal(122),
      providerLimits: null,
      alertedMonth: null,
      updatedById: null,
      updatedAt: new Date(0),
    }
  );
}

/** The first instant of the month and of the day `now` falls in, in company time. */
export function periodStarts(now: Date, timeZone: string) {
  const today = localDay(now, timeZone);
  return {
    month: today.slice(0, 7),
    monthStart: startOfDayInZone(`${today.slice(0, 7)}-01`, timeZone),
    dayStart: startOfDayInZone(today, timeZone),
  };
}

/** The monthly limit per provider (company money), as the owner set them. */
export function providerLimitsOf(budget: Pick<AiBudget, "providerLimits">) {
  const raw = budget.providerLimits;
  const out: Partial<Record<ProviderId, Prisma.Decimal>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const p of PROVIDERS) {
    const v = (raw as Record<string, unknown>)[p.id];
    if (typeof v === "string" && /^\d{1,10}(\.\d{1,2})?$/.test(v))
      out[p.id] = new Prisma.Decimal(v);
  }
  return out;
}

/** What was spent (company money) since `from`, for the lines matching `where`. */
async function spentSince(
  companyId: string,
  from: Date | null,
  where: Prisma.AiUsageWhereInput,
  db: Db,
): Promise<Prisma.Decimal> {
  const sum = await db.aiUsage.aggregate({
    where: { companyId, ...(from ? { createdAt: { gte: from } } : {}), ...where },
    _sum: { cost: true },
  });
  return sum._sum.cost ?? new Prisma.Decimal(0);
}

export type BudgetCheck =
  { go: true; cheaper: boolean; why: string | null } | { go: false; why: string };

const taka = (value: Prisma.Decimal, currency: string) =>
  `${currency} ${groupAmount(value.toFixed(2), currency)}`;

/**
 * Before a call: whether the budget and limits let it go, and whether it must
 * use the small model. A person's, an order's limit always stops; the company's
 * month, day and agent limits stop or go cheaper, as the owner chose.
 */
export async function checkBudget(
  companyId: string,
  call: { userId?: string | null; agent: string; record?: AiRecord; provider?: ProviderId },
  now: Date = new Date(),
  db: Db = prisma,
): Promise<BudgetCheck> {
  const budget = await budgetOf(companyId, db);
  const limits = [
    budget.monthly,
    budget.daily,
    budget.perOrder,
    budget.perStaffMonthly,
    budget.perAgentMonthly,
  ];
  const providerLimit = call.provider ? (providerLimitsOf(budget)[call.provider] ?? null) : null;
  if (limits.every((l) => l === null) && !providerLimit) {
    return { go: true, cheaper: false, why: null };
  }
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, currency: true },
  });
  const { monthStart, dayStart } = periodStarts(now, company.timezone);
  const money = (v: Prisma.Decimal) => taka(v, company.currency);

  // Limits that always stop: one person's month, one order's whole AI cost.
  if (budget.perStaffMonthly && call.userId) {
    const spent = await spentSince(companyId, monthStart, { userId: call.userId }, db);
    if (spent.gte(budget.perStaffMonthly)) {
      return {
        go: false,
        why: `Your AI use this month has reached its limit (${money(budget.perStaffMonthly)}). The owner can raise it on AI Center > Budget & Costs.`,
      };
    }
  }
  if (budget.perOrder && call.record) {
    const spent = await spentSince(
      companyId,
      null,
      { recordType: call.record.type, recordId: call.record.id },
      db,
    );
    if (spent.gte(budget.perOrder)) {
      return {
        go: false,
        why: `AI work on ${call.record.label ?? "this record"} has reached its limit (${money(budget.perOrder)}).`,
      };
    }
  }

  // The company's limits: stop, or go on with the small model.
  const reached: string[] = [];
  if (budget.monthly && (await spentSince(companyId, monthStart, {}, db)).gte(budget.monthly)) {
    reached.push(`this month's budget (${money(budget.monthly)})`);
  }
  if (budget.daily && (await spentSince(companyId, dayStart, {}, db)).gte(budget.daily)) {
    reached.push(`today's limit (${money(budget.daily)})`);
  }
  if (
    budget.perAgentMonthly &&
    (await spentSince(companyId, monthStart, { agent: call.agent }, db)).gte(budget.perAgentMonthly)
  ) {
    reached.push(`${call.agent}'s limit for the month (${money(budget.perAgentMonthly)})`);
  }
  if (
    providerLimit &&
    (await spentSince(companyId, monthStart, { provider: call.provider }, db)).gte(providerLimit)
  ) {
    reached.push(
      `the ${providerInfo(call.provider!).label} limit for the month (${money(providerLimit)})`,
    );
  }
  if (reached.length === 0) return { go: true, cheaper: false, why: null };
  const what = `The AI has used ${reached.join(" and ")}.`;
  return budget.atLimit === "CHEAPER"
    ? { go: true, cheaper: true, why: `${what} Small work goes on with the small model.` }
    : {
        go: false,
        why: `${what} New AI work stops until the owner raises it on AI Center > Budget & Costs.`,
      };
}

/** A screen's address as kept on a cost line: "/…" without the query, or "bot". */
export function screenOf(screen: string | null | undefined): string | null {
  if (screen === "bot") return "bot";
  if (!screen?.startsWith("/") || screen.startsWith("//")) return null;
  return screen.split(/[?#]/)[0]!.slice(0, 300) || null;
}

export type UsageLine = {
  userId?: string | null;
  agent: string;
  task: string;
  why: string;
  record?: AiRecord;
  /** The screen it was asked on, or "bot". */
  screen?: string | null;
  model: string;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  durationMs: number;
  result: AiCallResult;
  note?: string | null;
};

/**
 * After a call: writes its cost line, and tells the owner (in the inbox) once a
 * month when the month's spending passes the alert percentage of the budget.
 */
export async function logUsage(
  companyId: string,
  line: UsageLine,
  now: Date = new Date(),
  db: Db = prisma,
) {
  const [budget, book] = await Promise.all([budgetOf(companyId, db), priceBook(companyId, db)]);
  const tokens = line.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const priced = costIn(book, line.model, tokens);
  const usd = new Prisma.Decimal(priced.usd.toFixed(6));
  const cost = usd.times(budget.usdRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const row = await db.aiUsage.create({
    data: {
      companyId,
      userId: line.userId ?? null,
      agent: line.agent.slice(0, 60),
      task: line.task,
      module: taskInfo(line.task)?.module ?? "AI",
      why: line.why.slice(0, 500),
      recordType: line.record?.type ?? null,
      recordId: line.record?.id ?? null,
      recordLabel: line.record?.label?.slice(0, 200) ?? null,
      screen: screenOf(line.screen),
      model: line.model,
      provider: providerOf(line.model),
      costKnown: priced.known,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      costUsd: usd,
      cost,
      usdRate: budget.usdRate,
      durationMs: Math.max(0, Math.round(line.durationMs)),
      result: line.result,
      note: line.note?.slice(0, 500) ?? null,
      createdAt: now,
    },
  });
  if (budget.monthly && cost.gt(0)) await alertOnce(companyId, budget, now, db);
  return row;
}

/** The alert at the budget's percentage, once a month, to the people who manage the AI. */
async function alertOnce(companyId: string, budget: AiBudget, now: Date, db: Db) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, currency: true },
  });
  const { month, monthStart } = periodStarts(now, company.timezone);
  if (budget.alertedMonth === month) return;
  const spent = await spentSince(companyId, monthStart, {}, db);
  const line = budget.monthly!.times(budget.alertPercent).dividedBy(100);
  if (spent.lt(line)) return;
  // Claim the month, so two calls at once send one alert.
  const claimed = await db.aiBudget.updateMany({
    where: { companyId, OR: [{ alertedMonth: null }, { alertedMonth: { not: month } }] },
    data: { alertedMonth: month },
  });
  if (claimed.count === 0) return;
  const owners = membersWith(await activeMembers(companyId, db), ["ai.manage"]);
  const percent = spent.dividedBy(budget.monthly!).times(100).toDecimalPlaces(0).toString();
  const subject = `AI has used ${percent}% of this month's budget`;
  const body = `${taka(spent, company.currency)} of ${taka(budget.monthly!, company.currency)} is spent. ${
    budget.atLimit === "CHEAPER"
      ? "At the budget, small work goes on with the small model."
      : "At the budget, new AI work stops."
  } See AI Center > Budget & Costs.`;
  await sendInApp(
    db,
    companyId,
    owners.map((userId) => ({ userId })),
    { subject, body, entityType: "AiBudget", entityId: companyId },
    now,
  );
  await pushToBot(companyId, { kind: "text", text: `${subject}. ${body}` });
}

/** The models that count as big work: their tasks show an estimate first without a budget. */
const BIG_MODELS: readonly string[] = ["claude-opus-5-5", "claude-fable-5-1"];

/**
 * About this many characters of English make one token; Bengali and other
 * scripts take about a token a character. A picture or a PDF page about this many tokens.
 */
const CHARS_PER_TOKEN = 3.5;
const TOKENS_PER_FILE = 1_600;

/** Tokens of a text: Latin script by length, other scripts (Bengali) a token a character. */
function textTokens(text: string): number {
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0x24f && (code < 0x2000 || code > 0x206f)) other += 1;
  }
  return (text.length - other) / CHARS_PER_TOKEN + other;
}

type Countable = {
  system?: string | ReadonlyArray<{ type: string; text?: string }>;
  messages: ReadonlyArray<{ content: unknown }>;
  tools?: ReadonlyArray<unknown>;
  maxTokens: number;
};

/** A rough count of a request's input tokens (text by length, a picture or file at a flat rate). */
export function estimateInputTokens(request: Countable): number {
  const system =
    typeof request.system === "string"
      ? request.system
      : (request.system ?? []).map((b) => b.text ?? "").join("");
  let tokens = textTokens(system) + (request.tools ? textTokens(JSON.stringify(request.tools)) : 0);
  let files = 0;
  for (const m of request.messages) {
    if (typeof m.content === "string") {
      tokens += textTokens(m.content);
      continue;
    }
    for (const block of (m.content ?? []) as Array<{ type?: string; text?: string }>) {
      if (block.type === "text") tokens += textTokens(block.text ?? "");
      else if (block.type === "image" || block.type === "document") files += 1;
      else tokens += textTokens(JSON.stringify(block));
    }
  }
  return Math.ceil(tokens) + files * TOKENS_PER_FILE;
}

export type CostEstimate = {
  model: string;
  usd: string;
  cost: string;
  /** False when the model has no price yet (AI Center > Models): it is blocked. */
  known: boolean;
  currency: string;
  /** Set when the owner wants to be asked first, with the reason. */
  askFirst: string | null;
};

/**
 * What a call may cost at most (its input, and the longest answer it allows),
 * and whether the owner asked to be asked first: above "Ask before a task
 * above", or for big work while no monthly budget is set.
 */
export async function estimateCost(
  companyId: string,
  model: string,
  request: Countable,
  db: Db = prisma,
): Promise<CostEstimate> {
  return estimateUse(
    companyId,
    model,
    { input: estimateInputTokens(request), output: request.maxTokens },
    {},
    db,
  );
}

/**
 * The same for work of many calls, from its token counts (a book test: the
 * books once, then read from the cache). `big` asks first without a monthly
 * budget whatever the model.
 */
export async function estimateUse(
  companyId: string,
  model: string,
  use: TokenUse,
  options: { big?: boolean } = {},
  db: Db = prisma,
): Promise<CostEstimate> {
  const [budget, company, book] = await Promise.all([
    budgetOf(companyId, db),
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } }),
    priceBook(companyId, db),
  ]);
  const priced = costIn(book, model, use);
  const usd = new Prisma.Decimal(priced.usd.toFixed(6));
  const cost = usd.times(budget.usdRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
  const about = `about ${taka(cost, company.currency)}`;
  let askFirst: string | null = null;
  if (!priced.known) {
    // No guess: a model with no price is blocked (askClaude refuses it, v6.4 A7).
    askFirst = blockedText(modelLabel(model));
  } else if (budget.askAbove && cost.gt(budget.askAbove)) {
    askFirst = `This task may cost ${about}, above the ${taka(budget.askAbove, company.currency)} you asked to be asked about.`;
  } else if (!budget.monthly && (options.big || BIG_MODELS.includes(model))) {
    askFirst = `This is big work and may cost ${about}. No monthly budget is set, so the AI asks first.`;
  }
  return {
    model,
    usd: priced.known ? usd.toFixed(4) : "?",
    cost: priced.known ? cost.toFixed(2) : "price unknown",
    known: priced.known,
    currency: company.currency,
    askFirst,
  };
}
