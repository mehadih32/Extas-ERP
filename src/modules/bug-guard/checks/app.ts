import { slowQueriesSince } from "@/lib/slow-queries";
import { type HealthCheck, runChecks } from "@/modules/ai/health/checks";

import type { Check, CheckContext, Found, Severity } from "../types";

/*
 * Bug Guard, screens and server (area APP): the errors people met on screens,
 * the API and background jobs since the last run, the slow database calls, the
 * jobs and messages that failed, the server's memory, disk and database, and
 * what the last Full check found (every screen, PDF and the layout checks at
 * four widths, run on GitHub: the runner asks for it).
 */

const n = (value: number) => value.toLocaleString("en-US");

/** The server's own checks (Server Health), once per run, for the checks below. */
let health: { at: number; checks: HealthCheck[] } | null = null;

export async function healthChecks(now: Date): Promise<HealthCheck[]> {
  if (health && Math.abs(health.at - now.getTime()) < 60_000) return health.checks;
  const checks = await runChecks(undefined, now);
  health = { at: now.getTime(), checks };
  return checks;
}

/** Forget the cached server checks (tests). */
export function forgetHealth() {
  health = null;
}

const ROUTE_TYPE_BN: Record<string, string> = {
  render: "স্ক্রিন খুলতে",
  action: "কোনো বোতাম চাপলে",
  route: "ডাউনলোড বা ডেটা আনতে",
  api: "ডাউনলোড বা ডেটা আনতে",
  proxy: "স্ক্রিন খুলতে",
  job: "পেছনের কাজে",
};

/** Errors people met since the last run, one finding per screen and error. */
const serverErrors: Check = {
  key: "app.server-errors",
  area: "APP",
  label: "Server errors",
  async run(ctx) {
    const rows = await ctx.db.serverError.groupBy({
      by: ["routeType", "path", "errorName"],
      where: {
        at: { gte: ctx.since },
        OR: [{ companyId: ctx.companyId }, ...(ctx.platform ? [{ companyId: null }] : [])],
      },
      _count: { _all: true },
      _max: { at: true },
      orderBy: { _count: { routeType: "desc" } },
      take: 30,
    });
    const out: Found[] = [];
    for (const row of rows) {
      const times = row._count._all;
      const latest = await ctx.db.serverError.findFirst({
        where: {
          routeType: row.routeType,
          path: row.path,
          errorName: row.errorName,
          at: { gte: ctx.since },
        },
        orderBy: { at: "desc" },
        select: { method: true, stack: true, message: true, errorId: true },
      });
      const job = row.routeType === "job";
      const severity: Severity = times >= 20 || row.routeType === "render" ? "URGENT" : "IMPORTANT";
      out.push({
        key: `app.error:${row.routeType}:${row.path}:${row.errorName}`,
        area: "APP",
        severity,
        title: job
          ? `পেছনের কাজ “${row.path}” ${n(times)} বার ব্যর্থ হয়েছে (${row.errorName})।`
          : `${row.path} এ ${ROUTE_TYPE_BN[row.routeType] ?? "কাজ করতে"} গিয়ে ${n(times)} বার এরর হয়েছে (${row.errorName})।`,
        href: job ? "/ai/health" : row.path.includes("[") ? null : row.path,
        place: row.path,
        why: job
          ? "এই কাজটা না হলে কিছু জিনিস (পিডিএফ, বার্তা, হিসাব) পেছনে আটকে থাকে।"
          : "মানুষ এখানে কাজ শেষ করতে পারছে না, এবং একই ভুল আবার হবে।",
        fix: "Fix চাপলে Claude Code এই ভুলের কারণ খুঁজে একটা টেস্টসহ Pull Request বানাবে। আপনি PIN দিয়ে merge করলে নিরাপদ আপডেট চলবে, তারপর Bug Guard আবার দেখবে।",
        fixKind: "CODE",
        evidence: [
          { label: "কতবার", value: n(times) },
          {
            label: "শেষবার",
            value: row._max.at?.toISOString().slice(0, 16).replace("T", " ") ?? "-",
          },
          { label: "ভুলের ধরন", value: row.errorName },
          ...(latest?.message ? [{ label: "বার্তা", value: latest.message }] : []),
          ...(latest?.errorId ? [{ label: "এরর কোড", value: latest.errorId }] : []),
        ],
        code: {
          route: row.path,
          method: latest?.method ?? null,
          status: job ? null : 500,
          errorType: row.errorName,
          stack: latest?.stack ?? [],
          times,
        },
      });
    }
    return out;
  },
};

/** Database calls over a second since the server started (or the last run). */
const slowQueries: Check = {
  key: "app.slow-queries",
  area: "APP",
  label: "Slow database calls",
  platform: true,
  async run(ctx) {
    const slow = slowQueriesSince(ctx.since);
    const groups = new Map<
      string,
      { model: string; operation: string; times: number; max: number }
    >();
    for (const q of slow) {
      const key = `${q.model}.${q.operation}`;
      const g = groups.get(key) ?? { model: q.model, operation: q.operation, times: 0, max: 0 };
      g.times += 1;
      g.max = Math.max(g.max, q.ms);
      groups.set(key, g);
    }
    return [...groups.values()]
      .sort((a, b) => b.max * b.times - a.max * a.times)
      .slice(0, 10)
      .map((g) => ({
        key: `app.slow-query:${g.model}.${g.operation}`,
        area: "APP" as const,
        severity: (g.max >= 5000 || g.times >= 20 ? "IMPORTANT" : "LATER") as Severity,
        title: `ডেটাবেসের একটা কাজ ধীর: ${g.model} (${g.operation}) ${n(g.times)} বার 1 সেকেন্ডের বেশি নিয়েছে, সবচেয়ে বেশি ${(g.max / 1000).toFixed(1)} সেকেন্ড।`,
        href: "/ai/health",
        place: `${g.model}.${g.operation}`,
        why: "ধীর কাজের কারণে স্ক্রিন দেরিতে খোলে; ডেটা বাড়লে আরও ধীর হবে।",
        fix: "Fix চাপলে Claude Code কারণ খুঁজবে (যেমন index বা একসাথে অনেক খোঁজা) এবং টেস্টসহ Pull Request বানাবে।",
        fixKind: "CODE" as const,
        evidence: [
          { label: "কতবার", value: n(g.times) },
          { label: "সবচেয়ে ধীর", value: `${n(g.max)} ms` },
        ],
        code: {
          route: `database: ${g.model}.${g.operation}`,
          errorType: "SlowQuery",
          times: g.times,
        },
      }));
  },
};

const LEVEL_SEVERITY = { ERROR: "URGENT", WARN: "IMPORTANT" } as const;

/** The server itself: memory, disk, database speed, stuck jobs (Server Health's checks). */
const server: Check = {
  key: "app.server",
  area: "APP",
  label: "Server memory, disk and database",
  platform: true,
  async run(ctx) {
    const checks = await healthChecks(ctx.now);
    return checks
      .filter((c) => ["memory", "disk", "database", "jobs"].includes(c.key))
      .filter((c) => c.level === "WARN" || c.level === "ERROR")
      .map((c) => ({
        key: `app.server:${c.key}`,
        area: "APP" as const,
        severity: LEVEL_SEVERITY[c.level as "WARN" | "ERROR"],
        title: c.bn,
        href: "/ai/health",
        place: "AI Center > Server Health",
        why:
          c.key === "disk"
            ? "ডিস্ক ভরে গেলে ব্যাকআপ আর নতুন ফাইল রাখা যাবে না, ERP থেমে যেতে পারে।"
            : c.key === "memory"
              ? "মেমরি ফুরিয়ে গেলে ERP ধীর হয় বা নিজে থেকে আবার চালু হয়।"
              : c.key === "jobs"
                ? "আটকে থাকা কাজ (পিডিএফ, বার্তা) মানুষের কাছে পৌঁছায় না।"
                : "ডেটাবেস ধীর হলে সব স্ক্রিন ধীর হয়।",
        fix:
          c.key === "jobs"
            ? "“Server Health” এ “Run stuck and failed jobs again” চাপুন।"
            : c.key === "disk"
              ? "“Server Health” এ “Run the nightly clean-up now” চাপুন; তাতেও না হলে সার্ভারের ডিস্ক বাড়ান (Azure-এ VM-এর ডিস্ক বড় করুন)।"
              : c.key === "database"
                ? "“Server Health” এ “Refresh the database statistics” চাপুন; বারবার হলে Fix চাপুন।"
                : "সার্ভারের মেমরি বাড়ান (Azure-এ বড় VM সাইজ বেছে নিন), অথবা ডেভেলপারকে জানান।",
        fixKind: "MANUAL" as const,
        evidence: [{ label: "সার্ভার যা বলছে", value: c.detail }],
      }));
  },
};

/** Background jobs that gave up, and messages (e-mail, the bot) that did not go. */
const failedWork: Check = {
  key: "app.failed-work",
  area: "APP",
  label: "Failed jobs and messages",
  async run(ctx) {
    const [jobs, messages, bot] = await Promise.all([
      ctx.db.backgroundJob.groupBy({
        by: ["kind"],
        where: {
          status: "FAILED",
          finishedAt: { gte: ctx.since },
          OR: [{ companyId: ctx.companyId }, ...(ctx.platform ? [{ companyId: null }] : [])],
        },
        _count: { _all: true },
      }),
      ctx.db.notificationLog.groupBy({
        by: ["channel"],
        where: { companyId: ctx.companyId, status: "FAILED", createdAt: { gte: ctx.since } },
        _count: { _all: true },
      }),
      ctx.db.aiBotMessage.count({
        where: { companyId: ctx.companyId, status: "FAILED", createdAt: { gte: ctx.since } },
      }),
    ]);
    const out: Found[] = [];
    for (const j of jobs) {
      out.push({
        key: `app.job-failed:${j.kind}`,
        area: "APP",
        severity: "IMPORTANT",
        title: `পেছনের কাজ “${j.kind}” ${n(j._count._all)} বার শেষ পর্যন্ত ব্যর্থ হয়েছে।`,
        href: "/ai/health",
        place: "AI Center > Server Health",
        why: "এই কাজগুলোর ফল (পিডিএফ, বার্তা, হিসাব) কারও কাছে পৌঁছায়নি।",
        fix: "“Server Health” এ “Run stuck and failed jobs again” চাপুন। আবার ব্যর্থ হলে এর এরর এই তালিকায় আলাদা করে আসবে, তখন Fix চাপুন।",
        fixKind: "MANUAL",
        evidence: [{ label: "কতবার", value: n(j._count._all) }],
      });
    }
    for (const m of messages) {
      const email = m.channel === "EMAIL";
      out.push({
        key: `app.message-failed:${m.channel}`,
        area: "APP",
        severity: "IMPORTANT",
        title: `${n(m._count._all)}টি ${email ? "ইমেইল" : `${m.channel} বার্তা`} পাঠানো যায়নি।`,
        href: email ? "/ai/settings" : "/settings",
        place: email ? "AI Center > Settings" : "Settings",
        why: "যাদের জানার কথা ছিল (রিমাইন্ডার, রিপোর্ট) তারা জানতে পারেনি।",
        fix: email
          ? "“AI Center > Settings” এ ইমেইলের ঠিকানা ও পাসওয়ার্ড ঠিক আছে কি না দেখুন, তারপর একটা পরীক্ষার ইমেইল পাঠান।"
          : "যেখান থেকে বার্তা যায় সেই সেটিং ঠিক আছে কি না দেখুন।",
        fixKind: "MANUAL",
        evidence: [{ label: "কতবার", value: n(m._count._all) }],
      });
    }
    if (bot > 0) {
      out.push({
        key: "app.message-failed:BOT",
        area: "APP",
        severity: bot >= 10 ? "IMPORTANT" : "LATER",
        title: `বটের ${n(bot)}টি বার্তা পাঠানো বা পড়া যায়নি।`,
        href: "/ai/bot",
        place: "AI Center > Bot",
        why: "Telegram-এ আপনার কাছে খবর না পৌঁছালে জরুরি জিনিস চোখ এড়িয়ে যাবে।",
        fix: "“AI Center > Bot” এ বটটি এখনও যুক্ত আছে কি না দেখুন; দরকার হলে আবার যুক্ত করুন।",
        fixKind: "MANUAL",
        evidence: [{ label: "কতবার", value: n(bot) }],
      });
    }
    return out;
  },
};

const KIND_SEVERITY: Record<string, Severity> = {
  ERROR: "URGENT",
  PDF: "URGENT",
  SCRIPT: "IMPORTANT",
  FAILED_REQUEST: "IMPORTANT",
  BROKEN_LINK: "IMPORTANT",
  SIGNED_OUT: "IMPORTANT",
  LAYOUT: "IMPORTANT",
  SLOW: "LATER",
};

const KIND_BN: Record<string, string> = {
  ERROR: "স্ক্রিনে এরর দেখাচ্ছে",
  PDF: "পিডিএফ খুলছে না",
  SCRIPT: "স্ক্রিনে স্ক্রিপ্টের ভুল",
  FAILED_REQUEST: "স্ক্রিনের একটা অংশ লোড হয়নি",
  BROKEN_LINK: "একটা লিংক ভুল জায়গায় যাচ্ছে",
  SIGNED_OUT: "স্ক্রিন খুলতে গিয়ে সাইন-ইনে পাঠিয়ে দিচ্ছে",
  LAYOUT: "লেখা কেটে যাচ্ছে বা স্ক্রিনে আঁটছে না",
  SLOW: "স্ক্রিন ধীরে খুলছে",
};

/** What the newest Full check found that is not with Claude Code yet. */
const fullCheck: Check = {
  key: "app.full-check",
  area: "APP",
  label: "Screens, PDFs and layout (Full check)",
  async run(ctx) {
    const run = await ctx.db.fullCheckRun.findFirst({
      where: { companyId: ctx.companyId, status: "DONE" },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    });
    const out: Found[] = [];
    ctx.observed?.(run?.startedAt ?? new Date(0));
    const old = !run || ctx.now.getTime() - run.startedAt.getTime() > 14 * 86_400_000;
    if (old) {
      const github = await ctx.db.aiSettings.findUnique({
        where: { companyId: ctx.companyId },
        select: { githubRepo: true, githubTokenSealed: true },
      });
      out.push({
        key: "app.full-check:old",
        area: "APP",
        severity: "IMPORTANT",
        title: run
          ? "শেষ Full check 14 দিনের বেশি পুরোনো: সব স্ক্রিন, পিডিএফ ও লেআউট অনেক দিন দেখা হয়নি।"
          : "এখনও কোনো Full check হয়নি: সব স্ক্রিন, পিডিএফ ও লেআউট একবারও পরীক্ষা হয়নি।",
        href: "/ai/full-check",
        place: "AI Center > Full check",
        why: "Full check-ই প্রতিটা স্ক্রিন সব রোল হিসেবে খুলে দেখে কোথায় ভাঙছে; এটা না চললে স্ক্রিনের ভুল ধরা পড়বে না।",
        fix:
          github?.githubRepo && github.githubTokenSealed
            ? "Bug Guard প্রতিবার Full check চালাতে বলে; GitHub থেকে উত্তর না এলে “AI Center > Full check” এ “Test the connection” চাপুন।"
            : "“AI Center > Full check” এ GitHub যুক্ত করুন (repository ও token)। তারপর থেকে Bug Guard প্রতিবার নিজেই Full check চালাবে।",
        fixKind: "MANUAL",
      });
    }
    if (!run) return out;
    const problems = await ctx.db.fullCheckProblem.findMany({
      where: { runId: run.id, requestId: null },
      orderBy: { createdAt: "asc" },
      take: 60,
      select: { id: true, kind: true, screen: true, pattern: true, role: true, ms: true },
    });
    const groups = new Map<string, typeof problems>();
    for (const p of problems) {
      const where = p.pattern ?? p.screen.split("?")[0]!;
      const key = `${p.kind}:${where}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    for (const [key, list] of groups) {
      const first = list[0]!;
      const where = first.pattern ?? first.screen.split("?")[0]!;
      out.push({
        key: `app.screen:${key}`,
        area: "APP",
        severity: KIND_SEVERITY[first.kind] ?? "IMPORTANT",
        title: `${where}: ${KIND_BN[first.kind] ?? "সমস্যা পাওয়া গেছে"} (${[...new Set(list.map((p) => p.role))].join(", ")})।`,
        href: first.screen,
        place: where,
        why:
          first.kind === "SLOW"
            ? "ধীর স্ক্রিনে মানুষের সময় নষ্ট হয়, আর অনেকে অপেক্ষা না করে চলে যায়।"
            : "এই স্ক্রিনে মানুষ কাজ করতে পারছে না বা ভুল দেখছে।",
        fix: "Fix চাপলে Claude Code স্ক্রিনটা ঠিক করে টেস্টসহ Pull Request বানাবে; আপনি PIN দিয়ে merge করবেন। স্ক্রিনশট “AI Center > Full check” এ আছে।",
        fixKind: "CODE",
        evidence: [
          { label: "কোন রোলে", value: [...new Set(list.map((p) => p.role))].join(", ") },
          ...(first.ms ? [{ label: "সময়", value: `${(first.ms / 1000).toFixed(1)} s` }] : []),
        ],
        code: { route: where, problemIds: list.map((p) => p.id), times: list.length },
      });
    }
    return out;
  },
};

export const APP_CHECKS: Check[] = [fullCheck, serverErrors, failedWork, slowQueries, server];

export type { CheckContext };
