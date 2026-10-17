import { addDays, localDay } from "@/lib/dates";
import { HELP_SECTIONS } from "@/modules/help";

import type { Check, CheckContext, Found } from "../types";

/*
 * Bug Guard as a product manager (area PRODUCT), from how the ERP is used
 * (usage.ts counts, server-errors.ts): screens where people meet errors or
 * leave forms half done, features nobody opens, words people look for in Help
 * and do not find, screens without a guide, and a short list of improvements
 * ranked by value. Nothing here changes anything: it says what to improve.
 */

const n = (value: number) => value.toLocaleString("en-US");
/** "/sales/orders/[orderId]" and "/sales/orders/[id]" are the same screen. */
const sameRoute = (route: string) => route.replace(/\[[^\]]+\]/g, "[id]");

/** Every feature with a guide: its title and screens. */
function features() {
  return HELP_SECTIONS.flatMap((section) =>
    section.articles.map((a) => ({
      title: a.title,
      section: section.title,
      routes: a.routes.map(sameRoute),
    })),
  );
}

type Counts = Map<string, number>;

async function countsOf(ctx: CheckContext, kind: "VIEW" | "ABANDONED" | "HELP_MISS", days: number) {
  const from = addDays(localDay(ctx.now, "Asia/Dhaka"), -days);
  const rows = await ctx.db.usageCount.groupBy({
    by: ["subject"],
    where: { companyId: ctx.companyId, kind, day: { gte: from } },
    _sum: { count: true },
  });
  const out: Counts = new Map();
  for (const r of rows) out.set(r.subject, r._sum.count ?? 0);
  return out;
}

/** How many days of usage there are (unused features are judged only after two weeks). */
async function daysCounted(ctx: CheckContext) {
  const first = await ctx.db.usageCount.findFirst({
    where: { companyId: ctx.companyId, kind: "VIEW" },
    orderBy: { day: "asc" },
    select: { day: true },
  });
  if (!first) return 0;
  return Math.round(
    (Date.parse(localDay(ctx.now, "Asia/Dhaka")) - Date.parse(first.day)) / 86_400_000,
  );
}

const abandoned: Check = {
  key: "product.abandoned",
  area: "PRODUCT",
  label: "Forms left half done",
  async run(ctx) {
    const [left, views] = await Promise.all([
      countsOf(ctx, "ABANDONED", 14),
      countsOf(ctx, "VIEW", 14),
    ]);
    const out: Found[] = [];
    for (const [route, times] of [...left].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      const seen = views.get(route) ?? times;
      if (times < 3 || times / Math.max(seen, 1) < 0.2) continue;
      out.push({
        key: `product.abandoned:${route}`,
        area: "PRODUCT",
        severity: times >= 10 ? "IMPORTANT" : "LATER",
        title: `${route} এ মানুষ ফর্ম অর্ধেক পূরণ করে ছেড়ে যাচ্ছে (শেষ 14 দিনে ${n(times)} বার, ${n(seen)} বার খোলার মধ্যে)।`,
        href: route.includes("[") ? null : route,
        place: route,
        why: "ফর্ম ছেড়ে যাওয়া মানে কোনো ঘর বোঝা যাচ্ছে না, কোনো তথ্য হাতে নেই, বা কোথাও এরর আসছে; কাজটা পরে হয় না বা ভুলভাবে হয়।",
        fix: "স্ক্রিনটা খুলে কাউকে দিয়ে একবার পূরণ করিয়ে দেখুন কোথায় আটকায়। কোনো ঘর কঠিন হলে “Ask Claude Code” দিয়ে সহজ করতে বলুন।",
        fixKind: "MANUAL",
        evidence: [
          { label: "অর্ধেক ছেড়ে যাওয়া", value: n(times) },
          { label: "খোলা হয়েছে", value: n(seen) },
        ],
      });
    }
    return out;
  },
};

const helpMisses: Check = {
  key: "product.help-misses",
  area: "PRODUCT",
  label: "Help searches that found nothing",
  async run(ctx) {
    const misses = [...(await countsOf(ctx, "HELP_MISS", 30))]
      .filter(([, times]) => times >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    if (misses.length === 0) return [];
    const times = misses.reduce((sum, [, t]) => sum + t, 0);
    return [
      {
        key: `product.help-misses:${misses.map(([w]) => w).join("|")}`.slice(0, 300),
        area: "PRODUCT",
        severity: "LATER",
        // The title goes to the bot too: only counts. The words people typed are in
        // the evidence, which the owner sees in the ERP (AI Center > Bug Guard).
        title: `মানুষ Help-এ ${n(misses.length)}টি কথা খুঁজে কিছু পায়নি (শেষ 30 দিনে মোট ${n(times)} বার)। কথাগুলো Bug Guard পাতায় প্রমাণে আছে।`,
        href: "/help",
        place: "Help",
        why: "যে শব্দ মানুষ খোঁজে কিন্তু পায় না, সেখানে হয় গাইড নেই নয়তো ERP-এর শব্দটা অচেনা।",
        fix: "“Ask Claude Code” দিয়ে এই কথাগুলোর জন্য গাইড বা পরিচিত শব্দ যোগ করতে বলুন।",
        fixKind: "MANUAL",
        evidence: misses.map(([words, times]) => ({ label: words, value: `${n(times)} বার` })),
      },
    ];
  },
};

const unused: Check = {
  key: "product.unused",
  area: "PRODUCT",
  label: "Features nobody opens",
  async run(ctx) {
    if ((await daysCounted(ctx)) < 14) return [];
    const views = await countsOf(ctx, "VIEW", 30);
    const opened = new Set([...views.keys()].map(sameRoute));
    const idle = features().filter(
      (f) => f.routes.length && f.routes.every((r) => !r.includes("[") && !opened.has(r)),
    );
    if (idle.length === 0) return [];
    return [
      {
        key: `product.unused:${idle
          .map((f) => f.routes[0])
          .sort()
          .join("|")}`.slice(0, 300),
        area: "PRODUCT",
        severity: "LATER",
        title: `শেষ 30 দিনে কেউ এই ${n(idle.length)}টি জিনিস খোলেনি।`,
        href: "/help",
        place: "Help",
        why: "যা কেউ ব্যবহার করে না, হয় তা কারও জানা নেই, নয়তো দরকার নেই; দরকারি হলে দলকে দেখিয়ে দিন।",
        fix: "দরকারি হলে দলকে Help-এর গাইডটা পাঠান। দরকার না হলে কিছু করার নেই (Ignore চাপুন)।",
        fixKind: "NONE",
        evidence: idle.slice(0, 15).map((f) => ({ label: f.section, value: f.title })),
      },
    ];
  },
};

const missingHelp: Check = {
  key: "product.missing-help",
  area: "PRODUCT",
  label: "Screens without a guide",
  async run(ctx) {
    const views = await countsOf(ctx, "VIEW", 30);
    const guided = new Set(features().flatMap((f) => f.routes));
    const bare = [...views.keys()]
      .map(sameRoute)
      .filter((r) => r !== "/" && !r.startsWith("/help") && !guided.has(r));
    const unique = [...new Set(bare)].slice(0, 15);
    if (unique.length === 0) return [];
    return [
      {
        key: `product.missing-help:${unique.sort().join("|")}`.slice(0, 300),
        area: "PRODUCT",
        severity: "LATER",
        title: `${n(unique.length)}টি ব্যবহার হওয়া স্ক্রিনের Help গাইড নেই।`,
        href: "/help",
        place: "Help",
        why: "গাইড না থাকলে নতুন কেউ স্ক্রিনটা বুঝতে পারে না, ভুল করে।",
        fix: "Fix চাপলে Claude Code এই স্ক্রিনগুলোর বাংলা গাইড লিখে Pull Request বানাবে।",
        fixKind: "CODE",
        evidence: unique.map((route) => ({
          label: route,
          value: `${n(views.get(route) ?? 0)} বার খোলা`,
        })),
        code: { route: unique[0]!, errorType: "MissingHelpGuide", times: unique.length },
      },
    ];
  },
};

/** The short list: screens ranked by what fixing them is worth (errors, half-done forms). */
const improvements: Check = {
  key: "product.improvements",
  area: "PRODUCT",
  label: "Improvements ranked by value",
  async run(ctx) {
    const since = new Date(ctx.now.getTime() - 14 * 86_400_000);
    const [left, views, errors] = await Promise.all([
      countsOf(ctx, "ABANDONED", 14),
      countsOf(ctx, "VIEW", 14),
      ctx.db.serverError.groupBy({
        by: ["path"],
        where: { companyId: ctx.companyId, at: { gte: since }, routeType: { not: "job" } },
        _count: { _all: true },
      }),
    ]);
    const score = new Map<string, { errors: number; left: number; views: number }>();
    const at = (route: string) => {
      const key = sameRoute(route);
      const s = score.get(key) ?? { errors: 0, left: 0, views: 0 };
      score.set(key, s);
      return s;
    };
    for (const e of errors) at(e.path).errors += e._count._all;
    for (const [route, times] of left) at(route).left += times;
    for (const [route, times] of views) at(route).views += times;
    const ranked = [...score.entries()]
      .map(([route, s]) => ({
        route,
        ...s,
        value: s.errors * 3 + s.left * 2 + Math.log10(1 + s.views),
      }))
      .filter((r) => r.errors + r.left > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    if (ranked.length === 0) return [];
    return [
      {
        key: `product.improvements:${ranked.map((r) => r.route).join("|")}`.slice(0, 300),
        area: "PRODUCT",
        severity: "LATER",
        title: "যেগুলো আগে ঠিক করলে সবচেয়ে বেশি লাভ (শেষ 14 দিনের ব্যবহার থেকে):",
        href: ranked[0]!.route.includes("[") ? null : ranked[0]!.route,
        place: ranked[0]!.route,
        why: "যে স্ক্রিন বেশি খোলা হয় আর যেখানে এরর বা অর্ধেক-ছেড়ে-যাওয়া বেশি, সেটা ঠিক করলে সবার সময় বাঁচে।",
        fix: "উপরের থেকে একটা একটা করে “Ask Claude Code” দিয়ে সহজ করতে বলুন; এরর থাকলে এই তালিকায় তার নিজের Fix আছে।",
        fixKind: "NONE",
        evidence: ranked.map((r, i) => ({
          label: `${i + 1}. ${r.route}`,
          value: [
            r.errors ? `${n(r.errors)} এরর` : "",
            r.left ? `${n(r.left)} বার অর্ধেক ছেড়ে যাওয়া` : "",
            `${n(r.views)} বার খোলা`,
          ]
            .filter(Boolean)
            .join(", "),
        })),
      },
    ];
  },
};

export const PRODUCT_CHECKS: Check[] = [improvements, abandoned, helpMisses, missingHelp, unused];
