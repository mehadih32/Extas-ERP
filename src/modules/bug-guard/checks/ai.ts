import { Prisma } from "@prisma/client";

import type { Check, Found } from "../types";

/*
 * Bug Guard on the AI (area AI): costs out of line with the weeks before,
 * failed AI calls, work stopped because a model has no price, and agents or
 * models failing their tests. It reads only.
 */

const n = (value: number) => value.toLocaleString("en-US");
const DAY = 86_400_000;
const money = (d: Prisma.Decimal | null | undefined) => new Prisma.Decimal(d ?? 0);

const costs: Check = {
  key: "ai.costs",
  area: "AI",
  label: "AI costs out of line",
  async run(ctx) {
    const weekAgo = new Date(ctx.now.getTime() - 7 * DAY);
    const monthBefore = new Date(weekAgo.getTime() - 28 * DAY);
    const [week, before, byTask] = await Promise.all([
      ctx.db.aiUsage.aggregate({
        where: { companyId: ctx.companyId, createdAt: { gte: weekAgo } },
        _sum: { cost: true, costUsd: true },
      }),
      ctx.db.aiUsage.aggregate({
        where: { companyId: ctx.companyId, createdAt: { gte: monthBefore, lt: weekAgo } },
        _sum: { costUsd: true },
      }),
      ctx.db.aiUsage.groupBy({
        by: ["task"],
        where: { companyId: ctx.companyId, createdAt: { gte: weekAgo } },
        _sum: { costUsd: true },
        orderBy: { _sum: { costUsd: "desc" } },
        take: 5,
      }),
    ]);
    const thisWeek = money(week._sum.costUsd);
    const usual = money(before._sum.costUsd).dividedBy(4);
    // Out of line: half again the usual week, and at least 2 USD more.
    if (thisWeek.lessThan(usual.times(1.5)) || thisWeek.minus(usual).lessThan(2)) return [];
    return [
      {
        key: `ai.costs:${weekAgo.toISOString().slice(0, 10)}`,
        area: "AI",
        severity: thisWeek.greaterThan(usual.times(3)) ? "IMPORTANT" : "LATER",
        title: `এই সপ্তাহে এআই-এর খরচ সাধারণ সপ্তাহের চেয়ে অনেক বেশি: ${thisWeek.toFixed(2)} USD (সাধারণত ${usual.toFixed(2)} USD)।`,
        href: "/ai/costs",
        place: "AI Center > Budget & Costs",
        why: "হঠাৎ খরচ বাড়া মানে কোনো কাজ বারবার চলছে বা দামি মডেলে চলছে; মাসের বাজেট তাড়াতাড়ি শেষ হবে।",
        fix: "“Budget & Costs” এ দেখুন কোন কাজে খরচ বেড়েছে; দরকার না হলে সেই কাজের মডেল সস্তা করুন বা কাজটা বন্ধ করুন।",
        fixKind: "MANUAL",
        evidence: [
          { label: "এই সপ্তাহে", value: `${thisWeek.toFixed(2)} USD` },
          { label: "আগের 4 সপ্তাহের গড়", value: `${usual.toFixed(2)} USD` },
          ...byTask.map((t) => ({
            label: t.task,
            value: `${money(t._sum.costUsd).toFixed(2)} USD`,
          })),
        ],
      },
    ];
  },
};

const failed: Check = {
  key: "ai.failed-calls",
  area: "AI",
  label: "Failed AI calls",
  async run(ctx) {
    const rows = await ctx.db.aiUsage.groupBy({
      by: ["task", "result"],
      where: {
        companyId: ctx.companyId,
        createdAt: { gte: ctx.since },
        result: { in: ["FAILED", "STOPPED", "OK"] },
      },
      _count: { _all: true },
    });
    const tasks = new Map<string, { failed: number; stopped: number; all: number }>();
    for (const r of rows) {
      const t = tasks.get(r.task) ?? { failed: 0, stopped: 0, all: 0 };
      t.all += r._count._all;
      if (r.result === "FAILED") t.failed += r._count._all;
      if (r.result === "STOPPED") t.stopped += r._count._all;
      tasks.set(r.task, t);
    }
    const out: Found[] = [];
    for (const [task, t] of tasks) {
      if (t.failed >= 3 && t.failed / t.all >= 0.1) {
        out.push({
          key: `ai.failed:${task}`,
          area: "AI",
          severity: t.failed >= 20 || t.failed / t.all >= 0.5 ? "IMPORTANT" : "LATER",
          title: `এআই-এর “${task}” কাজটা ${n(t.failed)} বার ব্যর্থ হয়েছে (মোট ${n(t.all)} বারের মধ্যে)।`,
          href: "/ai/logs",
          place: "AI Center > Logs",
          why: "ব্যর্থ কাজের ফল কারও কাছে পৌঁছায়নি; বারবার হলে কাজটাই হচ্ছে না।",
          fix: "“AI Center > Logs” এ কারণ দেখুন। চাবি (API key) বা মডেলের সমস্যা হলে “AI Center > Models” এ ঠিক করুন; কোডের ভুল হলে এরর তালিকায় আলাদা Fix আসবে।",
          fixKind: "MANUAL",
          evidence: [
            { label: "ব্যর্থ", value: n(t.failed) },
            { label: "মোট", value: n(t.all) },
          ],
        });
      }
      if (t.stopped > 0) {
        out.push({
          key: `ai.stopped:${task}`,
          area: "AI",
          severity: "IMPORTANT",
          title: `এআই-এর “${task}” কাজটা ${n(t.stopped)} বার থামানো হয়েছে (বাজেট শেষ বা মডেলের দাম নেই)।`,
          href: "/ai/models",
          place: "AI Center > Models",
          why: "থেমে থাকা কাজ হচ্ছে না; দাম না থাকা মডেলের খরচ হিসাব করা যায় না বলে ERP তা আটকে রাখে।",
          fix: "“AI Center > Models” এ মডেলের দাম দিন বা কাজটার জন্য অন্য মডেল বেছে নিন; বাজেট শেষ হলে “Budget & Costs” এ বাজেট দেখুন।",
          fixKind: "MANUAL",
          evidence: [{ label: "থামানো", value: n(t.stopped) }],
        });
      }
    }
    return out;
  },
};

const tests: Check = {
  key: "ai.tests",
  area: "AI",
  label: "Agents failing their tests",
  async run(ctx) {
    const [models, books] = await Promise.all([
      ctx.db.aiModelTest.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { createdAt: "desc" },
        distinct: ["task", "model"],
        select: {
          task: true,
          model: true,
          passed: true,
          right: true,
          total: true,
          createdAt: true,
        },
        take: 100,
      }),
      ctx.db.aiTestRun.findMany({
        where: { companyId: ctx.companyId, status: { not: "RUNNING" } },
        orderBy: { createdAt: "desc" },
        distinct: ["book"],
        select: { book: true, passed: true, right: true, total: true, model: true },
        take: 50,
      }),
    ]);
    const out: Found[] = [];
    for (const m of models.filter((x) => !x.passed)) {
      out.push({
        key: `ai.model-test:${m.task}:${m.model}`,
        area: "AI",
        severity: "IMPORTANT",
        title: `“${m.task}” কাজের মডেল ${m.model} তার শেষ পরীক্ষায় পাশ করেনি (${n(m.right)}/${n(m.total)})।`,
        href: "/ai/models",
        place: "AI Center > Models",
        why: "পরীক্ষায় ফেল করা মডেল এই কাজে ভুল উত্তর দিতে পারে।",
        fix: "“AI Center > Models” এ এই কাজের জন্য পাশ করা মডেল বেছে নিন, বা পরীক্ষাটা আবার চালান।",
        fixKind: "MANUAL",
      });
    }
    for (const b of books.filter((x) => !x.passed)) {
      out.push({
        key: `ai.book-test:${b.book}`,
        area: "AI",
        severity: "IMPORTANT",
        title: `এআই “${b.book}” বইয়ের শেষ পরীক্ষায় পাশ করেনি (${n(b.right)}/${n(b.total)})।`,
        href: "/ai/knowledge",
        place: "AI Center > Books & tests",
        why: "যে বইয়ের পরীক্ষায় পাশ করেনি, সেই বিষয়ে এআই-এর উত্তরে ভরসা করা যায় না।",
        fix: "“Books & tests” এ ভুল উত্তরগুলো দেখুন, বই ঠিক করুন বা ভালো মডেল দিয়ে আবার পরীক্ষা চালান।",
        fixKind: "MANUAL",
      });
    }
    return out;
  },
};

export const AI_CHECKS: Check[] = [costs, failed, tests];
