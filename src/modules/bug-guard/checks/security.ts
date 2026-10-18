import { readFile } from "node:fs/promises";
import path from "node:path";

import { createHash } from "node:crypto";

import { isCloudflareAddress } from "@/lib/cloudflare-ips";
import { resolvePermissions } from "@/modules/rbac/resolve";

import { BLOCK_AFTER_FAILURES, BLOCK_WINDOW_MS, isKnownPlace, isOwnersPlace } from "../security";
import type { Check, Found, Severity } from "../types";
import { healthChecks } from "./app";

/*
 * Bug Guard, security (area SECURITY): who holds the powerful permissions and
 * anything unusual about them, failed sign-ins and the places they come from,
 * sign-ins from new places, accounts nobody uses, a missing PIN, packages with
 * known weaknesses, secrets in messages or logs, the https certificate, the
 * backups and the server's pending updates. It reads only; the steps it may
 * take (security.ts) are separate and never touch the owner's own sign-in.
 */

const n = (value: number) => value.toLocaleString("en-US");
const DAY = 86_400_000;

/** Permissions that move money, change who may do what, or run the ERP itself. */
export const POWERFUL = [
  "accounts.receipts.record",
  "accounts.payments.record",
  "accounts.manage",
  "expenses.manage",
  "hr.payroll.approve",
  "company.members.manage",
  "company.roles.manage",
  "backups.manage",
  "ai.manage",
  "production.bookings.override",
] as const;

/** The members of the company and what they may do. */
async function holders(ctx: Parameters<Check["run"]>[0]) {
  const members = await ctx.db.companyMembership.findMany({
    where: { companyId: ctx.companyId, isActive: true, user: { status: "ACTIVE" } },
    select: {
      id: true,
      user: { select: { id: true, name: true, isSuperAdmin: true, email: true } },
      role: {
        select: {
          name: true,
          systemRole: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
      permissionChanges: { select: { granted: true, permission: { select: { key: true } } } },
    },
  });
  return members.map((m) => {
    const keys = resolvePermissions({
      isPlatformSuperAdmin: m.user.isSuperAdmin,
      systemRole: m.role.systemRole,
      grantedKeys: m.role.permissions.map((p) => p.permission.key),
      changes: m.permissionChanges.map((c) => ({ key: c.permission.key, granted: c.granted })),
    });
    return {
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      owner: m.user.isSuperAdmin || m.role.systemRole === "SUPER_ADMIN",
      role: m.role.name,
      powerful: POWERFUL.filter((k) => keys.has(k)),
      ownGrants: m.permissionChanges
        .filter((c) => c.granted && (POWERFUL as readonly string[]).includes(c.permission.key))
        .map((c) => c.permission.key),
    };
  });
}

const permissions: Check = {
  key: "security.permissions",
  area: "SECURITY",
  label: "Who holds the powerful permissions",
  async run(ctx) {
    const people = await holders(ctx);
    const out: Found[] = [];
    const holding = people.filter((p) => !p.owner && p.powerful.length > 0);
    const list = holding.map((p) => `${p.name} (${p.role}): ${p.powerful.join(", ")}`).sort();
    // Re-reported whenever the list changes.
    const digest = createHash("sha256").update(list.join("\n")).digest("hex").slice(0, 12);
    if (holding.length) {
      out.push({
        key: `security.holders:${digest}`,
        area: "SECURITY",
        severity: "LATER",
        title: `মালিক ছাড়া ${n(holding.length)} জনের টাকা, পারমিশন বা ERP চালানোর ক্ষমতা আছে।`,
        href: "/settings/team",
        place: "Settings > Team",
        why: "কে টাকা লিখতে পারে বা কে অন্যের পারমিশন বদলাতে পারে, তা মালিকের জানা থাকা দরকার।",
        fix: "তালিকাটা দেখুন। কারও কাছে দরকারের বেশি থাকলে “Settings” এ তার রোল বা পারমিশন বদলান। Bug Guard নিজে কখনও পারমিশন বদলায় না।",
        fixKind: "NONE",
        evidence: list.slice(0, 15).map((line) => {
          const [who, keys] = line.split(": ");
          return { label: who!, value: keys ?? "" };
        }),
      });
    }
    for (const p of people.filter((x) => !x.owner && x.ownGrants.length)) {
      out.push({
        key: `security.own-grant:${p.membershipId}:${p.ownGrants.sort().join(",")}`,
        area: "SECURITY",
        severity: "IMPORTANT",
        title: `${p.name} কে তার রোলের বাইরে আলাদা করে ক্ষমতা দেওয়া আছে: ${p.ownGrants.join(", ")}।`,
        href: "/settings/team",
        place: `Settings > Team > ${p.name}`,
        why: "রোলের বাইরে দেওয়া ক্ষমতা সহজে চোখে পড়ে না; ভুল করে দেওয়া হলে কেউ টাকা বা পারমিশনে হাত দিতে পারে।",
        fix: "দরকার হলে রেখে দিন (Ignore চাপুন)। না হলে “Settings” এ তার পারমিশন থেকে এটা তুলে দিন।",
        fixKind: "MANUAL",
        evidence: [
          { label: "রোল", value: p.role },
          { label: "আলাদা করে দেওয়া", value: p.ownGrants.join(", ") },
        ],
      });
    }
    for (const p of people.filter(
      (x) =>
        !x.owner &&
        (x.powerful.includes("company.roles.manage") ||
          x.powerful.includes("company.members.manage")),
    )) {
      out.push({
        key: `security.admin-power:${p.membershipId}`,
        area: "SECURITY",
        severity: "IMPORTANT",
        title: `${p.name} (${p.role}) অন্যদের রোল বা পারমিশন বদলাতে পারে।`,
        href: "/settings/team",
        place: `Settings > Team > ${p.name}`,
        why: "যে পারমিশন বদলাতে পারে সে নিজেকে বা অন্যকে টাকার ক্ষমতাও দিতে পারে।",
        fix: "এটা ইচ্ছা করে দেওয়া হলে Ignore চাপুন; না হলে “Settings” এ তুলে দিন।",
        fixKind: "MANUAL",
      });
    }
    const changes = await ctx.db.auditLog.findMany({
      where: {
        companyId: ctx.companyId,
        createdAt: { gte: ctx.since },
        entityType: { in: ["Role", "CompanyMembership"] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, summary: true, createdAt: true, user: { select: { name: true } } },
    });
    if (changes.length) {
      out.push({
        key: `security.role-changes:${changes[0]!.id}`,
        area: "SECURITY",
        severity: "IMPORTANT",
        title: `শেষ চেকের পর ${n(changes.length)} বার রোল বা কারও পারমিশন বদলানো হয়েছে।`,
        href: "/settings/team",
        place: "Settings > Team",
        why: "পারমিশন বদল আপনার জানা থাকা উচিত; না জানা বদল বিপদের লক্ষণ।",
        fix: "নিচের বদলগুলো আপনার জানা হলে Ignore চাপুন; না জানা হলে “Settings” এ ঠিক করুন ও যে বদলেছে তার সাথে কথা বলুন।",
        fixKind: "MANUAL",
        evidence: changes.map((c) => ({
          label:
            `${c.createdAt.toISOString().slice(0, 16).replace("T", " ")} ${c.user?.name ?? ""}`.trim(),
          value: c.summary ?? "",
        })),
      });
    }
    return out;
  },
};

/** Failed sign-ins since the last run, by place and by account. */
const failedLogins: Check = {
  key: "security.failed-logins",
  area: "SECURITY",
  label: "Failed sign-ins",
  platform: true,
  async run(ctx) {
    const byPlace = await ctx.db.auditLog.groupBy({
      by: ["ipAddress"],
      where: { action: "LOGIN_FAILED", createdAt: { gte: ctx.since }, ipAddress: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { ipAddress: "desc" } },
      take: 20,
    });
    const out: Found[] = [];
    for (const place of byPlace) {
      const source = place.ipAddress!;
      const times = place._count._all;
      if (times < 5) continue;
      const blocked = await ctx.db.loginBlock.findFirst({
        where: { source, liftedAt: null, blockedUntil: { gt: ctx.now } },
        select: { id: true, blockedUntil: true },
      });
      const recent = await ctx.db.auditLog.count({
        where: {
          action: "LOGIN_FAILED",
          ipAddress: source,
          createdAt: { gte: new Date(ctx.now.getTime() - BLOCK_WINDOW_MS) },
        },
      });
      // Cloudflare's own address: many visitors share it, so it is never blocked (v6.4.1 B2).
      if (isCloudflareAddress(source)) {
        out.push({
          key: `security.failed-place:${source}`,
          area: "SECURITY",
          severity: "IMPORTANT",
          title: `${source} (Cloudflare-এর ঠিকানা) থেকে ${n(times)} বার ভুল পাসওয়ার্ড দিয়ে ঢোকার চেষ্টা হয়েছে।`,
          href: "/ai/bug-guard",
          place: source,
          why: "এটা Cloudflare-এর ঠিকানা: অনেক মানুষ এই একই ঠিকানা দিয়ে আসে, তাই কে চেষ্টা করছে তা এখান থেকে বোঝা যায় না।",
          fix: "Cloudflare-এর ঠিকানা কখনো আটকানো হয় না: আটকালে সবাই আটকে যেত। প্রতিটি অ্যাকাউন্টে চেষ্টা নিজে থেকেই ধীর হয়। চেষ্টা চলতে থাকলে পাসওয়ার্ডগুলো বদলান, আর ডেভেলপারকে দেখান কেন আসল ঠিকানা আসছে না।",
          fixKind: "MANUAL",
          evidence: [{ label: "শেষ চেকের পর", value: `${n(times)} বার` }],
        });
        continue;
      }
      const owners = await isOwnersPlace(ctx.db, source, ctx.now);
      const team = !owners && (await isKnownPlace(ctx.db, source, ctx.now));
      const severity: Severity = times >= BLOCK_AFTER_FAILURES ? "URGENT" : "IMPORTANT";
      out.push({
        key: `security.failed-place:${source}`,
        area: "SECURITY",
        severity: blocked ? "IMPORTANT" : severity,
        title: blocked
          ? `${source} থেকে ${n(times)} বার ভুল পাসওয়ার্ড দিয়ে ঢোকার চেষ্টা হয়েছে; Bug Guard এই জায়গাটা আটকে রেখেছে।`
          : `${source} থেকে ${n(times)} বার ভুল পাসওয়ার্ড দিয়ে ঢোকার চেষ্টা হয়েছে।`,
        href: "/ai/bug-guard",
        place: source,
        why: "অনেকবার ভুল পাসওয়ার্ড মানে কেউ পাসওয়ার্ড আন্দাজ করার চেষ্টা করছে হতে পারে।",
        fix: blocked
          ? "কিছু করতে হবে না। নিজের লোক হলে Fix চাপলে (PIN দিয়ে) আটকানো তুলে দেওয়া যাবে।"
          : owners
            ? "এই জায়গা থেকে আপনি নিজে ঢোকেন, তাই Bug Guard এটা নিজে আটকায়নি। আপনার না হলে Fix চাপুন (PIN দিয়ে আটকানো যাবে)।"
            : team
              ? "আপনার দলের লোকেরা এখান থেকে ঢোকে (যেমন অফিসের ইন্টারনেট), তাই Bug Guard নিজে আটকায়নি: আটকালে সবাই আটকে যাবে। দলের কেউ না হলে Fix চাপুন (PIN দিয়ে 24 ঘণ্টা আটকানো যাবে) এবং পাসওয়ার্ড বদলান।"
              : "Fix চাপলে (PIN দিয়ে) এই জায়গা থেকে ঢোকা 24 ঘণ্টা আটকে যাবে।",
        fixKind: "SECURITY",
        evidence: [
          { label: "শেষ চেকের পর", value: `${n(times)} বার` },
          { label: "শেষ 1 ঘণ্টায়", value: `${n(recent)} বার` },
        ],
        action: blocked
          ? { kind: "UNBLOCK_SOURCE", blockId: blocked.id }
          : { kind: "BLOCK_SOURCE", source, failures: times },
      });
    }
    const locked = await ctx.db.auditLog.groupBy({
      by: ["userId"],
      where: {
        action: "LOGIN_FAILED",
        createdAt: { gte: ctx.since },
        userId: { not: null },
        summary: { contains: "locked" },
      },
      _count: { _all: true },
    });
    if (locked.length) {
      const users = await ctx.db.user.findMany({
        where: { id: { in: locked.map((l) => l.userId!) } },
        select: { id: true, name: true },
      });
      out.push({
        key: `security.locked:${locked
          .map((l) => l.userId)
          .sort()
          .join(",")}`,
        area: "SECURITY",
        severity: "LATER",
        title: `${n(locked.length)} জনের অ্যাকাউন্ট ভুল পাসওয়ার্ডের জন্য 15 মিনিট বন্ধ ছিল।`,
        href: "/settings/team",
        place: "Settings > Team",
        why: "নিজে ভুল করলে সমস্যা নেই; কিন্তু তারা নিজে না করলে কেউ তাদের পাসওয়ার্ড আন্দাজ করছে।",
        fix: "তাদের জিজ্ঞেস করুন। তারা না করে থাকলে পাসওয়ার্ড বদলাতে বলুন।",
        fixKind: "MANUAL",
        evidence: users.map((u) => ({ label: u.name, value: "বন্ধ হয়েছিল" })),
      });
    }
    return out;
  },
};

/**
 * The network an address belongs to: addresses next to each other (the same
 * office or the same phone company's block) are one place.
 */
export function networkOf(ip: string): string {
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":");
  const parts = ip.split(".");
  return parts.length === 4 ? parts.slice(0, 3).join(".") : ip;
}

/**
 * Sign-ins from a place the person never signed in from (in 90 days): one
 * finding per person, with every new place, so a phone that changes its
 * address does not fill the report.
 */
const newPlaces: Check = {
  key: "security.new-places",
  area: "SECURITY",
  label: "Sign-ins from new places",
  async run(ctx) {
    const logins = await ctx.db.auditLog.findMany({
      where: {
        action: "LOGIN",
        companyId: ctx.companyId,
        createdAt: { gte: ctx.since },
        ipAddress: { not: null },
        userId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { userId: true, ipAddress: true, entityId: true, createdAt: true },
    });
    const byPerson = new Map<string, typeof logins>();
    for (const login of logins) {
      const list = byPerson.get(login.userId!) ?? [];
      list.push(login);
      byPerson.set(login.userId!, list);
    }
    const out: Found[] = [];
    for (const [userId, theirs] of byPerson) {
      const before = await ctx.db.auditLog.findMany({
        where: {
          action: "LOGIN",
          userId,
          createdAt: { lt: ctx.since, gte: new Date(ctx.since.getTime() - 90 * DAY) },
        },
        select: { ipAddress: true },
        take: 200,
      });
      // Someone new has no old places to compare with.
      if (before.length === 0) continue;
      const known = new Set(before.map((b) => networkOf(b.ipAddress ?? "")));
      const fresh = theirs.filter((l) => !known.has(networkOf(l.ipAddress!)));
      if (fresh.length === 0) continue;
      const ips = [...new Set(fresh.map((l) => l.ipAddress!))];
      const networks = [...new Set(ips.map(networkOf))].sort();
      const user = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { name: true, isSuperAdmin: true },
      });
      const sessionIds = fresh.flatMap((l) => (l.entityId ? [l.entityId] : []));
      const sessions = sessionIds.length
        ? await ctx.db.session.findMany({
            where: { id: { in: sessionIds }, expiresAt: { gt: ctx.now } },
            select: { id: true },
          })
        : [];
      const live = sessionIds.filter((id) => sessions.some((s) => s.id === id));
      const mine = !!user?.isSuperAdmin;
      const shown =
        ips.slice(0, 5).join(", ") + (ips.length > 5 ? ` ও আরও ${ips.length - 5}টি` : "");
      const many = networks.length > 1;
      out.push({
        key: `security.new-place:${userId}:${networks.join("+")}`.slice(0, 300),
        area: "SECURITY",
        severity: "IMPORTANT",
        title: many
          ? `${user?.name ?? "একজন"} ${networks.length}টি নতুন জায়গা থেকে ঢুকেছেন (${shown})।`
          : `${user?.name ?? "একজন"} নতুন জায়গা থেকে ঢুকেছেন (${shown})।`,
        href: "/settings/team",
        place: ips.slice(0, 3).join(", "),
        why: "নতুন জায়গা মানে নতুন ফোন, নতুন ইন্টারনেট বা অন্য কেউ তার পাসওয়ার্ড দিয়ে ঢুকেছে।",
        fix: mine
          ? "আপনি নিজে হলে Ignore চাপুন। আপনি না হলে এখনই পাসওয়ার্ড বদলান।"
          : live.length
            ? `তাকে জিজ্ঞেস করুন। তিনি না হলে Fix চাপুন (PIN দিয়ে): ${live.length > 1 ? "ওই সাইন-ইনগুলো" : "ওই সাইন-ইনটা"} বন্ধ হবে, তারপর তার পাসওয়ার্ড বদলান।`
            : "তাকে জিজ্ঞেস করুন। তিনি না হলে তার পাসওয়ার্ড বদলান।",
        fixKind: !mine && live.length ? "SECURITY" : "MANUAL",
        evidence: [
          { label: "কখন", value: fresh[0]!.createdAt.toISOString().slice(0, 16).replace("T", " ") },
          { label: "কতবার", value: String(fresh.length) },
          {
            label: "আগের জায়গা",
            value: [...new Set(before.map((b) => b.ipAddress ?? "-"))].slice(0, 3).join(", "),
          },
        ],
        action:
          !mine && live.length
            ? { kind: "END_SESSION", sessionId: live[0]!, userId, sessionIds: live.slice(1) }
            : null,
      });
      if (out.length >= 20) break;
    }
    return out;
  },
};

/** Active members who have not signed in for 60 days. */
const unused: Check = {
  key: "security.unused-accounts",
  area: "SECURITY",
  label: "Accounts nobody uses",
  async run(ctx) {
    const cutoff = new Date(ctx.now.getTime() - 60 * DAY);
    const idle = await ctx.db.companyMembership.findMany({
      where: {
        companyId: ctx.companyId,
        isActive: true,
        joinedAt: { lt: cutoff },
        user: {
          status: "ACTIVE",
          isSuperAdmin: false,
          passwordHash: { not: null },
          OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: cutoff } }],
        },
      },
      select: { user: { select: { name: true, lastLoginAt: true } } },
      take: 30,
    });
    if (idle.length === 0) return [];
    return [
      {
        key: `security.unused:${idle
          .map((m) => m.user.name)
          .sort()
          .join(",")}`,
        area: "SECURITY",
        severity: "LATER",
        title: `${n(idle.length)} জন 60 দিনের বেশি ERP-তে ঢোকেননি, কিন্তু তাদের অ্যাকাউন্ট চালু আছে।`,
        href: "/settings/team",
        place: "Settings > Team",
        why: "যে কাজ ছেড়ে গেছে তার চালু অ্যাকাউন্ট অন্য কেউ ব্যবহার করতে পারে।",
        fix: "যারা আর কাজ করেন না, “Settings” এ তাদের অ্যাকাউন্ট বন্ধ (deactivate) করুন। Bug Guard নিজে কাউকে বন্ধ করে না।",
        fixKind: "MANUAL",
        evidence: idle.map((m) => ({
          label: m.user.name,
          value: m.user.lastLoginAt
            ? `শেষবার ${m.user.lastLoginAt.toISOString().slice(0, 10)}`
            : "কখনও ঢোকেননি",
        })),
      },
    ];
  },
};

const pin: Check = {
  key: "security.pin",
  area: "SECURITY",
  label: "The owner's PIN",
  async run(ctx) {
    const settings = await ctx.db.aiSettings.findUnique({
      where: { companyId: ctx.companyId },
      select: { pinHash: true },
    });
    if (settings?.pinHash) return [];
    return [
      {
        key: "security.pin:missing",
        area: "SECURITY",
        severity: "IMPORTANT",
        title: "আপনার PIN এখনও ঠিক করা হয়নি।",
        href: "/ai/settings",
        place: "AI Center > Settings",
        why: "PIN ছাড়া টাকা, দাম, Bug Guard-এর সংশোধন আর Merge কিছুই করা যায় না; PIN-ই নিশ্চিত করে যে কাজটা আপনি নিজে করছেন।",
        fix: "“AI Center > Settings” এ 4 থেকে 8 অঙ্কের একটা PIN ঠিক করুন, যা শুধু আপনি জানেন।",
        fixKind: "MANUAL",
      },
    ];
  },
};

type AuditReport = {
  metadata?: { vulnerabilities?: Record<string, number> };
  vulnerabilities?: Record<string, { severity?: string; name?: string }>;
};

/** Where the build left `npm audit`'s report (the Docker image; deploy/Dockerfile). */
export const auditReportPath = () =>
  process.env.NPM_AUDIT_REPORT || path.join(process.cwd(), "npm-audit.json");

const packages: Check = {
  key: "security.packages",
  area: "SECURITY",
  label: "Packages with known weaknesses",
  platform: true,
  async run() {
    let report: AuditReport;
    try {
      report = JSON.parse(await readFile(auditReportPath(), "utf8")) as AuditReport;
    } catch {
      return [];
    }
    const counts = report.metadata?.vulnerabilities ?? {};
    const critical = counts.critical ?? 0;
    const high = counts.high ?? 0;
    if (critical + high === 0) return [];
    const names = Object.entries(report.vulnerabilities ?? {})
      .filter(([, v]) => v.severity === "critical" || v.severity === "high")
      .map(([name]) => name)
      .sort();
    return [
      {
        key: `security.packages:${names.join(",")}`,
        area: "SECURITY",
        severity: critical > 0 ? "URGENT" : "IMPORTANT",
        title: `ERP যে প্যাকেজগুলো ব্যবহার করে তার ${n(critical + high)}টিতে জানা দুর্বলতা আছে${critical ? ` (${n(critical)}টি খুব গুরুতর)` : ""}।`,
        href: "/ai/full-check",
        place: "package.json",
        why: "জানা দুর্বলতা দিয়ে বাইরের কেউ ঢোকার চেষ্টা করতে পারে।",
        fix: "Fix চাপলে Claude Code প্যাকেজগুলো নিরাপদ সংস্করণে তুলবে এবং সব টেস্ট চালিয়ে Pull Request বানাবে; আপনি PIN দিয়ে merge করবেন।",
        fixKind: "CODE",
        evidence: names
          .slice(0, 12)
          .map((name) => ({ label: name, value: report.vulnerabilities![name]!.severity! })),
        code: { route: "package.json", errorType: "VulnerablePackages", times: critical + high },
      },
    ];
  },
};

/** Things that look like keys or passwords, by kind. */
export const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["GitHub token", /\b(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ["Google key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Telegram bot token", /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
];

/** The kind of secret a text holds, or null. */
export function secretIn(text: string): string | null {
  for (const [kind, pattern] of SECRET_PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

/** Secrets typed into the bot, the chat, messages, notes of the log or the server's errors. */
const secrets: Check = {
  key: "security.secrets",
  area: "SECURITY",
  label: "Secrets in messages and logs",
  async run(ctx) {
    const since = ctx.since;
    const where = { companyId: ctx.companyId, createdAt: { gte: since } };
    const [bot, chat, mail, audit, errors] = await Promise.all([
      ctx.db.aiBotMessage.findMany({ where, select: { id: true, text: true }, take: 2000 }),
      ctx.db.aiChatMessage.findMany({ where, select: { id: true, text: true }, take: 2000 }),
      ctx.db.notificationLog.findMany({ where, select: { id: true, body: true }, take: 2000 }),
      ctx.db.auditLog.findMany({ where, select: { id: true, summary: true }, take: 5000 }),
      ctx.db.serverError.findMany({
        where: {
          at: { gte: since },
          OR: [{ companyId: ctx.companyId }, ...(ctx.platform ? [{ companyId: null }] : [])],
        },
        select: { id: true, message: true },
        take: 2000,
      }),
    ]);
    const places: Array<[string, string, string | null]> = [
      ...bot.map((m): [string, string, string | null] => ["বটের বার্তা", m.id, secretIn(m.text)]),
      ...chat.map((m): [string, string, string | null] => [
        "চ্যাটের বার্তা",
        m.id,
        secretIn(m.text),
      ]),
      ...mail.map((m): [string, string, string | null] => [
        "পাঠানো বার্তা",
        m.id,
        secretIn(m.body),
      ]),
      ...audit.map((m): [string, string, string | null] => [
        "কাজের লগ",
        m.id,
        secretIn(m.summary ?? ""),
      ]),
      ...errors.map((m): [string, string, string | null] => [
        "সার্ভারের এরর",
        m.id,
        secretIn(m.message),
      ]),
    ];
    return places
      .filter(([, , kind]) => kind)
      .slice(0, 20)
      .map(([where, id, kind]) => ({
        key: `security.secret:${id}`,
        area: "SECURITY" as const,
        severity: "URGENT" as const,
        title: `${where}-এ একটা ${kind} লেখা আছে বলে মনে হচ্ছে।`,
        href: "/ai/bug-guard",
        place: where,
        why: "কোনো চাবি (token, key) বার্তায় বা লগে থাকলে যে সেটা দেখতে পায় সে আপনার নামে কাজ করতে পারে।",
        fix: `যেখান থেকে ${kind} পেয়েছেন (যেমন GitHub, Google, Telegram) সেখানে পুরোনোটা বাতিল করে নতুন একটা বানান, তারপর ERP-তে নতুনটা বসান। Bug Guard কোনো বার্তা মোছে না।`,
        fixKind: "MANUAL" as const,
        evidence: [{ label: "কী ধরনের", value: kind! }],
      }));
  },
};

/** The https certificate and the backups (Server Health's checks). */
const certificateAndBackups: Check = {
  key: "security.certificate-backups",
  area: "SECURITY",
  label: "HTTPS certificate and backups",
  platform: true,
  async run(ctx) {
    const checks = await healthChecks(ctx.now);
    return checks
      .filter((c) => c.key === "certificate" || c.key === "backups")
      .filter((c) => c.level === "WARN" || c.level === "ERROR")
      .map((c) => ({
        key: `security.server:${c.key}`,
        area: "SECURITY" as const,
        severity: (c.level === "ERROR" ? "URGENT" : "IMPORTANT") as Severity,
        title: c.bn,
        href: c.key === "backups" ? "/settings/backups" : "/ai/health",
        place: c.key === "backups" ? "Settings > Backups" : "AI Center > Server Health",
        why:
          c.key === "backups"
            ? "সার্ভার হারিয়ে গেলে শেষ ভালো ব্যাকআপ থেকেই সব ফেরত আসে; ব্যাকআপ না চললে সেই দিনগুলোর কাজ হারাবে।"
            : "সার্টিফিকেট শেষ হলে ব্রাউজার ERP খুলতে দেবে না।",
        fix:
          c.key === "backups"
            ? "“Settings > Backups” এ “Back up now” চাপুন; ব্যর্থ হলে সেখানে কারণ লেখা থাকবে।"
            : "সাধারণত নিজে থেকেই নতুন হয়; দুই দিনের মধ্যে ঠিক না হলে ডেভেলপারকে জানান।",
        fixKind: "MANUAL" as const,
        evidence: [{ label: "সার্ভার যা বলছে", value: c.detail }],
      }));
  },
};

type HostStatus = {
  updates?: number;
  security?: number;
  rebootRequired?: boolean;
  checkedAt?: string;
};

/** Where the server writes its own state (deploy/host-status.sh). */
export const hostStatusPath = () =>
  process.env.HOST_STATUS_FILE ||
  path.join(
    process.env.BACKUP_DIR || path.join(process.cwd(), "storage", "backups"),
    "host-status.json",
  );

const hostUpdates: Check = {
  key: "security.host-updates",
  area: "SECURITY",
  label: "Server updates waiting",
  platform: true,
  async run(ctx) {
    let status: HostStatus;
    try {
      status = JSON.parse(await readFile(hostStatusPath(), "utf8")) as HostStatus;
    } catch {
      return [];
    }
    const security = status.security ?? 0;
    const old = status.checkedAt
      ? ctx.now.getTime() - Date.parse(status.checkedAt) > 3 * DAY
      : false;
    if (security === 0 && !status.rebootRequired) return [];
    return [
      {
        key: "security.host-updates",
        area: "SECURITY",
        severity: security >= 10 || old ? "IMPORTANT" : "LATER",
        title: [
          security ? `সার্ভারের ${n(security)}টি নিরাপত্তা আপডেট বসানো বাকি।` : "",
          status.rebootRequired ? "আপডেট শেষ করতে সার্ভার একবার রিস্টার্ট করতে হবে।" : "",
        ]
          .filter(Boolean)
          .join(" "),
        href: "/ai/health",
        place: "Server (Ubuntu)",
        why: "পুরোনো সফটওয়্যারের জানা দুর্বলতা দিয়ে সার্ভারে ঢোকা যায়।",
        fix: "রাতে, কেউ কাজ না করার সময়ে: PuTTY দিয়ে সার্ভারে ঢুকে লিখুন sudo apt update && sudo apt upgrade -y (Enter)। রিস্টার্ট লাগলে sudo reboot লিখুন; 2-3 মিনিটে ERP নিজেই আবার চালু হবে।",
        fixKind: "MANUAL",
        evidence: [
          { label: "সব আপডেট", value: n(status.updates ?? 0) },
          { label: "নিরাপত্তা আপডেট", value: n(security) },
          ...(status.checkedAt
            ? [{ label: "শেষ দেখা", value: status.checkedAt.slice(0, 16).replace("T", " ") }]
            : []),
        ],
      },
    ];
  },
};

export const SECURITY_CHECKS: Check[] = [
  failedLogins,
  newPlaces,
  permissions,
  pin,
  secrets,
  unused,
  packages,
  certificateAndBackups,
  hostUpdates,
];
