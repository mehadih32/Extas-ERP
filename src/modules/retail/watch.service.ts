import { addDays, daysBetween, localDay, localTime, weekday } from "@/lib/dates";
import { groupAmount } from "@/lib/display";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { aiOn, askClaude, textOf } from "@/modules/ai/claude";
import type { CompanyContext } from "@/modules/auth/context";
import { ownerStandIn } from "@/modules/bug-guard/owner";

import { holdOf } from "./account.service";
import { storeDashboard } from "./dashboards.service";
import { assertCanSeeStores } from "./stores.service";
import { alarm } from "./summaries.service";

/*
 * The retail side's notes to the owner (plan v6 sec 13). Every night at 22:00
 * one summary of each store's last day, with its alerts: sales fell, more
 * parcels came back, ads brought less (ROAS), the store goes on hold in 5 days
 * unless it pays, new returned parcels, returned parcels not checked on days
 * 5, 7 and 10, what the store owes on the month's last night, and (on
 * Saturdays) styles lying unsold. These are numbers and alarms: they go to the inbox and Telegram
 * even while the AI is off. Budgets and missing days alarm on their own
 * (summaries.service.ts). On Saturdays, while the AI is on, a short weekly
 * analysis of each store follows: advice only, nothing is changed. Each note
 * goes once (RetailAlert), and the AI analysis button on a store's page asks
 * the same question for any period.
 */

const NIGHT_HOUR = 22;
const SATURDAY = 6;
/** Reminders for returned parcels not checked: on the store's check day, 2 and 5 days later (5, 7, 10). */
const CHECK_STEPS = [0, 2, 5];

type Day = { date: string; net: number; profit: number; ads: number; sent: number; back: number };

const fall = (now: number, before: number) => before > 0 && now < before * 0.7;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The newest version of each of a store's days in [from, to]. */
async function daysOf(storeId: string, from: string, to: string): Promise<Day[]> {
  const rows = await prisma.retailDailySummary.findMany({
    where: {
      storeId,
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
    },
    orderBy: [{ date: "asc" }, { version: "asc" }],
  });
  const newest = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  return [...newest].map(([date, r]) => {
    const s = r.payload as {
      sales?: { net: number };
      deliveries?: { delivered: number; failed: number; returned: number };
      costs: { ads?: Record<string, number> };
    };
    const d = s.deliveries;
    return {
      date,
      net: s.sales?.net ?? 0,
      profit: Number(r.netProfit),
      ads: Object.values(s.costs.ads ?? {}).reduce((a, b) => a + Number(b), 0),
      sent: d ? d.delivered + d.failed + d.returned : 0,
      back: d?.returned ?? 0,
    };
  });
}

/** Claims one note (kind and key): false when it already went. */
async function claim(
  companyId: string,
  storeId: string | null,
  kind: string,
  key: string,
  text: string,
) {
  try {
    await prisma.retailAlert.create({ data: { companyId, storeId, kind, key, text } });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}

/** One store's line for the night and its new alerts. */
async function storeNight(ctx: CompanyContext, store: StoreRow, today: string, now: Date) {
  const cur = ctx.company.currency;
  const money = (v: number) => `${cur} ${groupAmount(v.toFixed(2), cur)}`;
  const yesterday = addDays(today, -1);
  const days = await daysOf(store.id, addDays(yesterday, -7), yesterday);
  const y = days.find((d) => d.date === yesterday);
  const before = days.filter((d) => d.date !== yesterday);
  const lines: string[] = [];
  const alerts: Array<{ kind: string; text: string }> = [];
  if (y) {
    const roas = y.ads > 0 ? (y.net / y.ads).toFixed(2) : "-";
    const back = y.sent > 0 ? `${Math.round((y.back / y.sent) * 100)}%` : "-";
    lines.push(
      `${store.name}, ${yesterday}: net sales ${money(y.net)}, profit ${money(y.profit)}, ROAS ${roas}, came back ${back}.`,
    );
    if (before.length >= 3) {
      const avgNet = mean(before.map((d) => d.net));
      if (fall(y.net, avgNet)) {
        alerts.push({
          kind: "SALES_FELL",
          text: `${store.name}: sales fell to ${money(y.net)} (the 7 days before: ${money(avgNet)} a day).`,
        });
      }
      const rate = (d: Day) => (d.sent > 0 ? d.back / d.sent : 0);
      const avgRate = mean(before.map(rate));
      if (rate(y) >= 0.1 && rate(y) >= avgRate * 1.5) {
        alerts.push({
          kind: "RETURNS_UP",
          text: `${store.name}: ${Math.round(rate(y) * 100)}% of parcels came back (before: ${Math.round(avgRate * 100)}%).`,
        });
      }
      const withAds = before.filter((d) => d.ads > 0);
      const avgRoas = mean(withAds.map((d) => d.net / d.ads));
      if (y.ads > 0 && withAds.length >= 3 && fall(y.net / y.ads, avgRoas)) {
        alerts.push({
          kind: "ROAS_FELL",
          text: `${store.name}: ads brought less, ROAS ${(y.net / y.ads).toFixed(2)} (before: ${avgRoas.toFixed(2)}).`,
        });
      }
    }
  } else {
    lines.push(`${store.name}: the figures of ${yesterday} are not in yet.`);
  }
  const hold = await holdOf(ctx, store, now);
  if (!hold.onHold && hold.holdsOn && daysBetween(today, hold.holdsOn) <= 5) {
    alerts.push({
      kind: "HOLD_SOON",
      text: `${store.name} goes on hold on ${hold.holdsOn} unless it pays: it owes ${money(Number(hold.balance))}.`,
    });
  }
  if (addDays(today, 1).endsWith("-01") && hold.balance.gt(0)) {
    const waiting = hold.waitingCheck.gt(0)
      ? `, of which ${money(Number(hold.waitingCheck))} is returns waiting for the check`
      : "";
    alerts.push({
      kind: "MONTH_END",
      text: `${store.name} owes ${money(Number(hold.balance))} at the end of the month${waiting}.`,
    });
  }
  const late = await checkReminders(ctx, store, today);
  const parcels = await prisma.retailReturnParcel.count({
    where: {
      companyId: ctx.company.id,
      order: { storeId: store.id },
      createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) },
    },
  });
  if (parcels > 0) {
    alerts.push({
      kind: "NEW_RETURNS",
      text: `${store.name}: ${parcels} returned parcel${parcels === 1 ? "" : "s"} came in to check (Business > Returns).`,
    });
  }
  if (weekday(today) === SATURDAY) {
    const { lyingStyles } = await storeDashboard(ctx, store.id, { period: "month" });
    if (lyingStyles.length > 0) {
      alerts.push({
        kind: "LYING",
        text: `${store.name}: styles lying unsold for 30 days: ${lyingStyles.join(", ")}.`,
      });
    }
  }
  const fresh = [];
  for (const a of alerts) {
    if (await claim(ctx.company.id, store.id, a.kind, `${store.id}:${today}`, a.text))
      fresh.push(a.text);
  }
  return { lines, alerts: [...fresh, ...late] };
}

/**
 * Returned parcels the owner has not checked yet (plan v6 sec 8.8): one
 * reminder per parcel on the store's check day (5 by default), 2 days later
 * and 5 days later, when it turns red. A parcel first seen late gets only its
 * latest reminder. One line per step for the store.
 */
async function checkReminders(ctx: CompanyContext, store: StoreRow, today: string) {
  const open = await prisma.retailReturnParcel.findMany({
    where: {
      companyId: ctx.company.id,
      state: { in: ["HOLD", "IN_RETURN_STOCK"] },
      list: { storeId: store.id },
    },
    select: { id: true, list: { select: { handedBackAt: true } } },
  });
  const due = new Map<number, number>();
  for (const p of open) {
    const days = daysBetween(localDay(p.list.handedBackAt, ctx.company.timezone), today);
    const step = CHECK_STEPS.map((s) => store.checkDays + s)
      .filter((d) => days >= d)
      .pop();
    if (step === undefined) continue;
    if (await claim(ctx.company.id, store.id, "CHECK_LATE", `${p.id}:${step}`, `${days} days`)) {
      due.set(step, (due.get(step) ?? 0) + 1);
    }
  }
  const red = store.checkDays + CHECK_STEPS[CHECK_STEPS.length - 1]!;
  return [...due]
    .sort(([a], [b]) => a - b)
    .map(
      ([step, n]) =>
        `${store.name}: ${n} returned parcel${n === 1 ? "" : "s"} not checked ${step} days after the courier handed ${n === 1 ? "it" : "them"} back${step >= red ? " (now red)" : ""}: check ${n === 1 ? "it" : "them"} in Business > Returns, the courier's claim window is short.`,
    );
}

type StoreRow = {
  id: string;
  name: string;
  companyId: string;
  partyId: string;
  holdReleasedUntil: Date | null;
  holdReleaseReason: string | null;
  checkDays: number;
};

const ANALYSIS_SYSTEM = (company: string) =>
  [
    `You are Mehedi 2.0, the assistant of ${company}, a garment business that also runs retail stores.`,
    "You get one store's figures as JSON. Give at most 5 short points of advice: what to buy again (styles selling fast), which reserve or styles to free (lying unsold), where costs can come down (ads, delivery, returns), and anything worrying.",
    "Use only the numbers given; never guess. This is advice only: you change nothing. Answer in simple English.",
  ].join(" ");

/** The AI's advice on one store's figures (the button on its page and the weekly note). */
async function analyse(
  ctx: CompanyContext,
  storeId: string,
  period: unknown,
  userId: string | null,
) {
  const store = await ctx.db.retailStore.findUnique({
    where: { id: storeId },
    select: { name: true },
  });
  if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
  const d = await storeDashboard(ctx, storeId, period);
  const { message } = await askClaude(ctx.company.id, {
    task: "report.daily",
    userId,
    screen: userId ? "/business/retail/stores/[storeId]" : undefined,
    why: `Retail analysis of ${store.name} (${d.period.from} to ${d.period.to})`,
    record: { type: "RetailStore", id: storeId, label: store.name },
    system: ANALYSIS_SYSTEM(ctx.company.name),
    messages: [{ role: "user", content: JSON.stringify(d) }],
    maxTokens: 900,
    effort: "low",
    timeoutMs: 60_000,
  });
  return { store: store.name, period: d.period, text: textOf(message).trim() };
}

/** "AI analysis" on a store's page: advice on the period shown. Needs the AI on. */
export async function storeAnalysis(ctx: CompanyContext, storeId: string, period: unknown = {}) {
  assertCanSeeStores(ctx);
  checkRateLimit(`retail-ai:${ctx.user.id}`, 5, 60_000);
  if (!(await aiOn(ctx.company.id))) {
    throw new AppError("UNAVAILABLE", "The AI is off. Turn it on in AI Center > Settings.");
  }
  return analyse(ctx, storeId, period, ctx.user.id);
}

/** With the shop clock: the night summary, its alerts and the Saturday analysis, once each. */
export async function retailWatch(now: Date = new Date()) {
  const stores = await prisma.retailStore.findMany({
    where: { closedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      companyId: true,
      partyId: true,
      holdReleasedUntil: true,
      holdReleaseReason: true,
      checkDays: true,
    },
  });
  const byCompany = new Map<string, StoreRow[]>();
  for (const s of stores) byCompany.set(s.companyId, [...(byCompany.get(s.companyId) ?? []), s]);
  let sent = 0;
  for (const [companyId, list] of byCompany) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true, isActive: true },
    });
    if (!company?.isActive) continue;
    if (Number(localTime(now, company.timezone).slice(0, 2)) < NIGHT_HOUR) continue;
    const today = localDay(now, company.timezone);
    if (!(await claim(companyId, null, "NIGHT", today, ""))) continue;
    const ctx = await ownerStandIn(companyId, null, "Retail watch");
    if (!ctx) continue;
    const lines: string[] = [];
    const alerts: string[] = [];
    for (const store of list) {
      const night = await storeNight(ctx, store, today, now);
      lines.push(...night.lines);
      alerts.push(...night.alerts);
    }
    const body = [...lines, ...(alerts.length ? ["", "Look at:", ...alerts] : [])].join("\n");
    await prisma.retailAlert.update({
      where: { companyId_kind_key: { companyId, kind: "NIGHT", key: today } },
      data: { text: body },
    });
    await alarm({ id: list[0]!.id, companyId, name: list[0]!.name }, "Retail tonight", body);
    sent++;

    if (weekday(today) === SATURDAY && (await aiOn(companyId))) {
      for (const store of list) {
        if (!(await claim(companyId, store.id, "WEEKLY", `${store.id}:${today}`, ""))) continue;
        try {
          const a = await analyse(
            ctx,
            store.id,
            { from: addDays(today, -28), to: addDays(today, -1) },
            null,
          );
          await prisma.retailAlert.update({
            where: {
              companyId_kind_key: { companyId, kind: "WEEKLY", key: `${store.id}:${today}` },
            },
            data: { text: a.text },
          });
          const { sendInApp } = await import("@/modules/reminders/notification.service");
          const { activeMembers } = await import("@/modules/reminders/audience");
          const to = (await activeMembers(companyId)).filter((m) =>
            m.permissions.has("retail.manage"),
          );
          await sendInApp(prisma, companyId, to, {
            subject: `${store.name}: the week's advice`,
            body: a.text,
            entityType: "RetailStore",
            entityId: store.id,
          });
          const { pushToBot } = await import("@/modules/ai/bot/push");
          await pushToBot(companyId, {
            kind: "text",
            text: `${store.name}: the week's advice\n${a.text}`,
          });
        } catch (error) {
          console.error(
            "[retail] weekly analysis failed",
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
  }
  return sent;
}
