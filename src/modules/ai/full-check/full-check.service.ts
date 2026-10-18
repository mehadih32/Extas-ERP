import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { CHECK_TOKEN_PREFIX } from "@/lib/auth/check-token";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { readStoredFile, writeGeneratedFile } from "@/modules/files/file.service";
import * as github from "@/modules/github/github";
import { verifyActionsToken } from "@/modules/github/oidc";
import { sendInApp } from "@/modules/reminders/notification.service";

import { pushToBot } from "../bot/push";
import { type PinProof, requirePin } from "../settings.service";
import { checkAccountFor } from "./check-account";
import {
  askIssue,
  carefulFiles,
  CHECK_MINUTES,
  FIX_CHECKS_COMMENT,
  fixIssue,
  type GuardFacts,
  guardIssue,
  KIND_LABEL,
  KIND_TEXT,
  PROBLEM_KINDS,
  type ProblemKind,
  pullBody,
  reportMessage,
  requestText,
} from "./texts";

/*
 * AI Center > Full check (the platform owner's, next to Server Health). The
 * button asks GitHub to run .github/workflows/full-check.yml: GitHub's
 * computers open every screen as the owner and as each role, every PDF, every
 * link and every button that changes nothing, and send back the problems with
 * screenshots. The check fetches its sessions with a one-time pass and
 * GitHub's proof that it is the workflow on main, and sends its report with a
 * key of its own. Its sessions belong to its own check accounts, one per role
 * (check-account.ts), never a real person's login; on the live site they can
 * only read (src/proxy.ts, src/lib/read-only.ts). Each problem can go to
 * Claude Code ("Fix with Claude Code", or "Fix all"), and the owner can ask
 * for something new ("Ask Claude Code"): the ERP opens a GitHub issue for the
 * Claude Code GitHub Action (only the screen's route, status code, error type
 * and the ERP's own stack lines: the text, data and screenshots stay here),
 * follows it to the pull request on Claude Code's own branch for that issue,
 * asks Claude Code again when its checks fail, and offers it for merging only
 * when it is Claude Code's own work into main (github.vetPull). The owner sees
 * who opened it and the files it changes, and merges exactly that commit here
 * with the PIN; the Deploy workflow installs it.
 */

/** The pass must be used this soon after the start. */
const PASS_MINUTES = 30;
/** The check's sessions end after this. */
const SESSION_MINUTES = 50;
/** A check that sent no report by then did not finish. */
const REPORT_MINUTES = 60;
/** Screenshots are taken in after the report for this long. */
const SHOT_MINUTES = 20;
export const MAX_SHOT_BYTES = 1_500_000;
const MAX_PROBLEMS = 300;
/** How often the ERP looks on GitHub for a request. */
const LOOK_EVERY_MS = 2 * 60_000;
/** A request with no Claude Code run on GitHub after this stopped. */
const NO_RUN_MINUTES = 20;
/** Times the ERP asks Claude Code to fix failed checks on one pull request. */
const MAX_RETRIES = 2;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function sameHash(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function assertPlatform(ctx: CompanyContext) {
  if (!ctx.user.isSuperAdmin) {
    throw new AppError(
      "FORBIDDEN",
      "Only the platform owner runs the Full check and sends work to Claude Code.",
    );
  }
}

/** "live", or "demo" on the demo site (where the check may also write). */
export const siteOf = () => (process.env.DEMO_SITE === "on" ? "demo" : "live");

function appUrl(): string {
  const url = process.env.APP_URL?.replace(/\/$/, "");
  if (!url)
    throw new AppError("UNAVAILABLE", "The server has no APP_URL, so GitHub cannot reach it.");
  return url;
}

// ---------------------------------------------------------------- GitHub connection

async function settingsOf(companyId: string) {
  return prisma.aiSettings.findUnique({
    where: { companyId },
    select: { githubRepo: true, githubTokenSealed: true, githubTokenHint: true, githubTest: true },
  });
}

/** The company's GitHub connection, or null. */
async function githubOf(companyId: string): Promise<github.GitHub | null> {
  const s = await settingsOf(companyId);
  if (!s?.githubRepo || !s.githubTokenSealed) return null;
  return { repo: s.githubRepo, token: decryptSecret(s.githubTokenSealed) };
}

async function needGitHub(companyId: string): Promise<github.GitHub> {
  const gh = await githubOf(companyId);
  if (!gh) {
    throw new AppError(
      "VALIDATION",
      "Connect GitHub first: the repository and a token, under GitHub on this screen.",
    );
  }
  return gh;
}

export const githubSchema = z.object({
  repo: z
    .string()
    .trim()
    .regex(github.REPO_PATTERN, "Write it as owner/name, e.g. mehadih32/Extas-ERP"),
  /** Left empty to keep the saved token. */
  token: z
    .string()
    .trim()
    .max(400)
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || /^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v), {
      message: "Paste a GitHub token (it starts with github_pat_)",
    }),
});

async function saveGitHubFields(companyId: string, data: Prisma.AiSettingsUpdateInput) {
  await prisma.aiSettings.upsert({
    where: { companyId },
    create: { ...(data as Prisma.AiSettingsUncheckedCreateInput), companyId },
    update: data,
  });
}

/** Saves the repository and the token (sealed; only its last four characters are shown). */
export async function saveGitHub(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertPlatform(ctx);
  const { repo, token } = githubSchema.parse(input);
  const saved = await settingsOf(ctx.company.id);
  if (!token && !saved?.githubTokenSealed) {
    throw new AppError("VALIDATION", "Paste the token too.", { token: ["Paste the token"] });
  }
  await saveGitHubFields(ctx.company.id, {
    githubRepo: repo,
    ...(token ? { githubTokenSealed: encryptSecret(token), githubTokenHint: token.slice(-4) } : {}),
    githubTest: Prisma.DbNull,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Connected GitHub: ${repo}${token ? `, token ending ${token.slice(-4)}` : ""}`,
  });
}

export async function removeGitHub(ctx: CompanyContext, meta?: RequestMeta) {
  assertPlatform(ctx);
  await saveGitHubFields(ctx.company.id, {
    githubRepo: null,
    githubTokenSealed: null,
    githubTokenHint: null,
    githubTest: Prisma.DbNull,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: "Took out the GitHub connection",
  });
}

/** Tests the connection: the repository, the token's rights and the two workflows. */
export async function testGitHubConnection(ctx: CompanyContext) {
  assertPlatform(ctx);
  checkRateLimit(`github-test:${ctx.company.id}`, 6, 60_000);
  const gh = await needGitHub(ctx.company.id);
  const result = await github.testGitHub(gh).catch((error: unknown) => ({
    ok: false,
    notes: [error instanceof AppError ? error.message : "GitHub could not be reached."],
    mainLocked: false,
  }));
  await saveGitHubFields(ctx.company.id, {
    githubTest: {
      ok: result.ok,
      at: new Date().toISOString(),
      notes: result.notes,
      mainLocked: result.mainLocked,
    },
  });
  return result;
}

type GitHubTest = { ok: boolean; at: string; notes: string[]; mainLocked?: boolean };

/**
 * Claude Code works only while the main branch is locked on GitHub (v6.4.1
 * B1): asked of GitHub each time, never taken from the last test; the screen
 * keeps what GitHub said. Throws "Lock main first" until it is.
 */
async function assertMainLocked(companyId: string, gh: github.GitHub) {
  const lock = await github.mainLock(gh);
  const s = await settingsOf(companyId);
  const test = (s?.githubTest as GitHubTest | null) ?? null;
  if (test && test.mainLocked !== lock.locked) {
    await saveGitHubFields(companyId, {
      githubTest: {
        ...test,
        mainLocked: lock.locked,
        ok: lock.locked ? test.ok : false,
      } as Prisma.InputJsonObject,
    });
  }
  if (!lock.locked) throw new AppError("VALIDATION", github.lockMainText(lock.missing));
}

// ---------------------------------------------------------------- running a check

/** Ends checks that never started or never reported, and their sessions. */
export async function finishStale(now: Date = new Date(), companyId?: string) {
  const stale = await prisma.fullCheckRun.findMany({
    where: {
      ...(companyId ? { companyId } : {}),
      OR: [
        {
          status: "STARTING",
          startedAt: { lt: new Date(now.getTime() - PASS_MINUTES * 60_000) },
        },
        {
          status: "RUNNING",
          startedAt: { lt: new Date(now.getTime() - REPORT_MINUTES * 60_000) },
        },
      ],
    },
    select: { id: true, status: true },
  });
  for (const run of stale) {
    await prisma.fullCheckRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: now,
        passHash: null,
        note:
          run.status === "STARTING"
            ? "GitHub did not start the check. Open the run on GitHub to see why, or try again."
            : "No report came back from GitHub in an hour. Open the run on GitHub to see why, or try again.",
      },
    });
    await endSessions(run.id);
  }
  return stale.length;
}

const sessionTag = (runId: string) => `Full check ${runId}`;

async function endSessions(runId: string) {
  await prisma.session.deleteMany({ where: { userAgent: sessionTag(runId) } });
}

/** Asks GitHub to run the Full check now. */
export async function startFullCheck(ctx: CompanyContext, meta?: RequestMeta) {
  assertPlatform(ctx);
  const run = await startFullCheckFor(ctx.company.id, ctx.user.id);
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "FullCheckRun",
    entityId: run.id,
    summary: `Started a Full check of the ${run.site} site`,
  });
  return { id: run.id };
}

/**
 * Asks GitHub for a Full check of a company: the owner's "Run the Full check
 * now", or Bug Guard's run (no one pressing, startedById null).
 */
export async function startFullCheckFor(companyId: string, startedById: string | null) {
  const gh = await needGitHub(companyId);
  const site = appUrl();
  await finishStale(new Date(), companyId);
  const going = await prisma.fullCheckRun.findFirst({
    where: { companyId, status: { in: ["STARTING", "RUNNING"] } },
  });
  if (going) throw new AppError("CONFLICT", "A Full check is running already.");
  const pass = randomBytes(24).toString("base64url");
  const run = await prisma.fullCheckRun.create({
    data: { companyId, site: siteOf(), passHash: sha256(pass), startedById },
  });
  try {
    await github.dispatchFullCheck(gh, { site, run: run.id, pass });
  } catch (error) {
    await prisma.fullCheckRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        passHash: null,
        note: error instanceof AppError ? error.message : "GitHub could not be asked.",
      },
    });
    throw error;
  }
  return { id: run.id, site: run.site };
}

export const beginSchema = z.object({
  run: z.string().min(1).max(40),
  pass: z.string().min(20).max(100),
  /** GitHub's signed token for the run (OpenID Connect, audience = the site). */
  proof: z.string().min(20).max(8000),
});

/**
 * GitHub's side, with the one-time pass and GitHub's proof that it is the
 * company's own Full check workflow asking: a session for the owner who started
 * the check and for one member of every other role, and the report key.
 */
export async function beginCheck(input: unknown, now: Date = new Date()) {
  const { run: runId, pass, proof } = beginSchema.parse(input);
  const run = await prisma.fullCheckRun.findUnique({ where: { id: runId } });
  const fresh = run && now.getTime() - run.startedAt.getTime() < PASS_MINUTES * 60_000;
  if (
    !run ||
    run.status !== "STARTING" ||
    !run.passHash ||
    !fresh ||
    !sameHash(run.passHash, sha256(pass))
  ) {
    throw new AppError(
      "FORBIDDEN",
      "This pass does not open a Full check (used, wrong or too old).",
    );
  }
  const repo = (await settingsOf(run.companyId))?.githubRepo;
  if (!repo) throw new AppError("FORBIDDEN", "GitHub is not connected any more.");
  const claims = await verifyActionsToken(
    proof,
    { repo, workflow: github.FULL_CHECK_WORKFLOW, audience: appUrl(), branch: github.MAIN },
    now,
  );
  const reportKey = randomBytes(32).toString("base64url");
  // Taken at once: a pass works only once.
  const taken = await prisma.fullCheckRun.updateMany({
    where: { id: run.id, status: "STARTING", passHash: run.passHash },
    data: {
      status: "RUNNING",
      passHash: null,
      passUsedAt: now,
      reportHash: sha256(reportKey),
      ...(claims.run_id
        ? { githubRunUrl: `https://github.com/${claims.repository}/actions/runs/${claims.run_id}` }
        : {}),
    },
  });
  if (taken.count !== 1) throw new AppError("FORBIDDEN", "This pass was used already.");

  // Every role of the company, each with its own check account: the owner's
  // view first (the Super Admin role, with the platform owner's screens).
  const allRoles = await prisma.role.findMany({
    where: { companyId: run.companyId },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: { id: true, name: true, systemRole: true },
  });
  const ownerRole = allRoles.find((r) => r.systemRole === "SUPER_ADMIN");
  if (!ownerRole) throw new AppError("NOT_FOUND", "The company has no Super Admin role.");
  const checks = [
    { role: ownerRole, label: "Owner", platform: true },
    ...allRoles
      .filter((r) => r.id !== ownerRole.id)
      .map((r) => ({ role: r, label: r.name, platform: false })),
  ];
  const expiresAt = new Date(now.getTime() + SESSION_MINUTES * 60_000);
  const sessions = [];
  for (const check of checks) {
    const account = await checkAccountFor(check.role, check.label);
    const token = `${CHECK_TOKEN_PREFIX}${generateSessionToken()}`;
    await prisma.session.create({
      data: {
        userId: account.id,
        token: hashSessionToken(token),
        activeCompanyId: run.companyId,
        userAgent: sessionTag(run.id),
        expiresAt,
        checkRoleId: check.role.id,
        checkPlatform: check.platform,
      },
    });
    sessions.push({ role: check.label, member: account.name, cookie: token });
  }
  const notChecked: string[] = [];
  return {
    site: run.site,
    /** On the live site the check only reads. */
    writes: run.site === "demo",
    roles: sessions,
    notChecked,
    reportKey,
    minutes: CHECK_MINUTES,
  };
}

const problemSchema = z.object({
  role: z.string().trim().min(1).max(80),
  kind: z.enum(PROBLEM_KINDS),
  screen: z.string().trim().min(1).max(500),
  pattern: z.string().trim().max(300).nullish(),
  text: z.string().trim().min(1).max(500),
  detail: z.string().max(4000).nullish(),
  ms: z.number().int().min(0).max(3_600_000).nullish(),
  /** The status code the screen or a request answered, the error's type and its stack lines. */
  status: z.number().int().min(100).max(599).nullish(),
  errorType: z.string().trim().max(80).nullish(),
  stack: z.array(z.string().max(300)).max(20).nullish(),
  shot: z.boolean().default(false),
});

export const reportSchema = z.object({
  summary: z.object({
    roles: z
      .array(
        z.object({
          role: z.string().max(80),
          member: z.string().max(120),
          screens: z.number().int().min(0),
          pdfs: z.number().int().min(0),
          skipped: z.number().int().min(0),
          /** Screens and downloads found but not reached in the time; whether the role stopped. */
          notReached: z.number().int().min(0).default(0),
          filesLeft: z.number().int().min(0).default(0),
          stopped: z.boolean().default(false),
          note: z.string().max(300).nullish(),
        }),
      )
      .max(60),
    screens: z.number().int().min(0),
    pdfs: z.number().int().min(0),
    links: z.number().int().min(0),
    seconds: z.number().min(0),
  }),
  problems: z.array(problemSchema).max(MAX_PROBLEMS),
});

/** The run a report key opens (while it may still send). */
async function runOfKey(key: string, now: Date, after: "report" | "shot") {
  if (!key || key.length > 100) throw new AppError("UNAUTHENTICATED", "No report key.");
  const run = await prisma.fullCheckRun.findUnique({ where: { reportHash: sha256(key) } });
  const open =
    run &&
    (after === "report"
      ? run.status === "RUNNING"
      : run.status === "DONE" &&
        run.finishedAt &&
        now.getTime() - run.finishedAt.getTime() < SHOT_MINUTES * 60_000);
  if (!run || !open) throw new AppError("FORBIDDEN", "This key does not send to a Full check now.");
  return run;
}

/** GitHub's report: the problems are kept, the check's sessions end, the owner is told. */
export async function receiveReport(key: string, input: unknown, now: Date = new Date()) {
  const run = await runOfKey(key, now, "report");
  const report = reportSchema.parse(input);
  await endSessions(run.id);
  const made = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const p of report.problems) {
      rows.push(
        await tx.fullCheckProblem.create({
          data: {
            companyId: run.companyId,
            runId: run.id,
            role: p.role,
            kind: p.kind,
            screen: p.screen,
            pattern: p.pattern ?? null,
            text: p.text,
            detail: p.detail ?? null,
            ms: p.ms ?? null,
            status: p.status ?? null,
            errorType: p.errorType || null,
            stack: p.stack ?? [],
          },
          select: { id: true },
        }),
      );
    }
    await tx.fullCheckRun.update({
      where: { id: run.id },
      data: { status: "DONE", finishedAt: now, summary: report.summary as Prisma.InputJsonValue },
    });
    return rows;
  });
  const count = report.problems.length;
  await recordAudit({
    companyId: run.companyId,
    userId: run.startedById,
    action: "UPDATE",
    entityType: "FullCheckRun",
    entityId: run.id,
    summary: `The Full check finished: ${report.summary.screens} screens, ${count} problem${count === 1 ? "" : "s"}`,
  });
  if (run.startedById) {
    const message = {
      ...reportMessage(report.summary, count),
      entityType: "FullCheckRun",
      entityId: run.id,
    };
    await sendInApp(prisma, run.companyId, [{ userId: run.startedById }], message, now);
    if (count > 0)
      await pushToBot(run.companyId, { kind: "text", text: `${message.subject}. ${message.body}` });
  }
  return {
    problems: report.problems.flatMap((p, i) => (p.shot ? [{ index: i, id: made[i]!.id }] : [])),
  };
}

/** One screenshot for a problem of the run (JPEG or PNG). */
export async function receiveShot(
  key: string,
  problemId: string,
  bytes: Buffer,
  now: Date = new Date(),
) {
  const run = await runOfKey(key, now, "shot");
  if (bytes.length === 0 || bytes.length > MAX_SHOT_BYTES) {
    throw new AppError("VALIDATION", "The screenshot is empty or too big.");
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.subarray(0, 4).toString("latin1") === "\x89PNG";
  if (!jpeg && !png) throw new AppError("VALIDATION", "Send a JPEG or PNG screenshot.");
  const problem = await prisma.fullCheckProblem.findFirst({
    where: { id: problemId, runId: run.id },
  });
  if (!problem) throw new AppError("NOT_FOUND", "No such problem in this check.");
  if (problem.shotPath) throw new AppError("CONFLICT", "This problem has its screenshot already.");
  const stored = await writeGeneratedFile(
    run.companyId,
    "full-check",
    jpeg ? ".jpg" : ".png",
    bytes,
  );
  await prisma.fullCheckProblem.update({
    where: { id: problem.id },
    data: { shotPath: stored.storagePath },
  });
}

/** A problem's screenshot, for the platform owner. */
export async function shotOf(ctx: CompanyContext, problemId: string) {
  assertPlatform(ctx);
  const problem = await ctx.db.fullCheckProblem.findFirst({ where: { id: problemId } });
  if (!problem?.shotPath) throw new AppError("NOT_FOUND", "There is no screenshot.");
  const bytes = await readStoredFile({ storagePath: problem.shotPath });
  return {
    bytes,
    mimeType: problem.shotPath.endsWith(".png") ? "image/png" : "image/jpeg",
    fileName: `full-check-${problem.id}${problem.shotPath.endsWith(".png") ? ".png" : ".jpg"}`,
  };
}

// ---------------------------------------------------------------- Claude Code

const when = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

export const fixSchema = z.union([
  z.object({ problemIds: z.array(z.string().min(1).max(40)).min(1).max(40) }),
  z.object({ runId: z.string().min(1).max(40) }),
]);

/** "Fix with Claude Code" (some problems) or "Fix all" (every problem of a check not sent yet). */
export async function sendFix(
  ctx: CompanyContext,
  input: unknown,
  meta?: RequestMeta,
  byGuard = false,
) {
  assertPlatform(ctx);
  checkRateLimit(`claude-code:${ctx.company.id}`, 10, 60 * 60_000);
  const gh = await needGitHub(ctx.company.id);
  const which = fixSchema.parse(input);
  const problems = await ctx.db.fullCheckProblem.findMany({
    where:
      "runId" in which
        ? { runId: which.runId, requestId: null }
        : { id: { in: which.problemIds }, requestId: null },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  if (problems.length === 0) {
    throw new AppError("VALIDATION", "These problems were sent to Claude Code already.");
  }
  const at = when(new Date());
  const issue = (number: number) =>
    fixIssue({
      problems: problems.map((p) => ({ ...p, kind: p.kind as ProblemKind })),
      site: siteOf(),
      at,
      runId: problems[0]!.runId,
      issue: number,
    });
  return openRequest(ctx, gh, {
    kind: "FIX",
    issue,
    text: problems
      .map((p) => `${p.text} (${p.screen})`)
      .join("\n")
      .slice(0, 4000),
    problemIds: problems.map((p) => p.id),
    meta,
    byGuard,
  });
}

export const askSchema = z.object({
  text: z
    .string()
    .trim()
    .min(10, "Say what you want in a sentence or two")
    .max(4000, "Keep it under 4,000 characters"),
});

/** "Ask Claude Code": a new request in plain words, the same way. */
export async function askClaudeCode(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertPlatform(ctx);
  checkRateLimit(`claude-code:${ctx.company.id}`, 10, 60 * 60_000);
  const gh = await needGitHub(ctx.company.id);
  const { text } = askSchema.parse(input);
  const at = when(new Date());
  const issue = (number: number) => askIssue({ text, site: siteOf(), at, issue: number });
  return openRequest(ctx, gh, { kind: "ASK", issue, text, problemIds: [], meta });
}

/**
 * Bug Guard's "Fix" on a finding with a code fix: its Full check problems go
 * as "Fix with Claude Code" does; anything else (a server error, a slow
 * database call, packages, screens without a guide) as an issue with only the
 * safe facts (texts.ts guardIssue).
 */
export async function sendGuardFix(
  ctx: CompanyContext,
  input: { facts: GuardFacts; problemIds?: string[]; summary: string },
  meta?: RequestMeta,
  /** Bug Guard sends it by itself (its "open fixes by itself" option): logged as Bug Guard's. */
  byGuard = false,
) {
  assertPlatform(ctx);
  if (input.problemIds?.length) {
    return sendFix(ctx, { problemIds: input.problemIds }, meta, byGuard);
  }
  checkRateLimit(`claude-code:${ctx.company.id}`, 10, 60 * 60_000);
  const gh = await needGitHub(ctx.company.id);
  const at = when(new Date());
  const issue = (number: number) =>
    guardIssue({ facts: input.facts, site: siteOf(), at, issue: number });
  return openRequest(ctx, gh, {
    kind: "FIX",
    issue,
    text: input.summary.slice(0, 4000),
    problemIds: [],
    meta,
    byGuard,
  });
}

async function openRequest(
  ctx: CompanyContext,
  gh: github.GitHub,
  r: {
    kind: "FIX" | "ASK";
    /** The issue, given its number (0 before GitHub gives one). */
    issue: (number: number) => { title: string; body: string };
    text: string;
    problemIds: string[];
    meta?: RequestMeta;
    /** Sent by Bug Guard by itself: the log says so, never the owner it works for. */
    byGuard?: boolean;
  },
) {
  await assertMainLocked(ctx.company.id, gh);
  // The issue first: if GitHub refuses, nothing is kept.
  const first = r.issue(0);
  const opened = await github.openIssue(gh, first);
  // Then its own number in it (Claude Code's branch carries it). If that fails,
  // the issue still says "this issue's number", which Claude Code knows.
  await github
    .updateIssue(gh, opened.number, r.issue(opened.number).body)
    .catch((error: unknown) =>
      console.error(
        `[full-check] issue #${opened.number} not updated`,
        error instanceof Error ? error.message : error,
      ),
    );
  const request = await prisma.$transaction(async (tx) => {
    const made = await tx.claudeCodeRequest.create({
      data: {
        companyId: ctx.company.id,
        kind: r.kind,
        title: first.title,
        text: r.text,
        issueNumber: opened.number,
        issueUrl: opened.url,
        createdById: ctx.user.id,
      },
    });
    if (r.problemIds.length) {
      await tx.fullCheckProblem.updateMany({
        where: { id: { in: r.problemIds }, companyId: ctx.company.id },
        data: { requestId: made.id },
      });
    }
    return made;
  });
  const summary = `${r.kind === "FIX" ? "Sent to Claude Code" : "Asked Claude Code"}: ${first.title} (issue #${opened.number})`;
  if (r.byGuard) {
    await recordAudit({
      companyId: ctx.company.id,
      userId: null,
      action: "CREATE",
      entityType: "ClaudeCodeRequest",
      entityId: request.id,
      summary: `Bug Guard (automatic): ${summary}`,
    });
  } else {
    await auditInCompany(ctx, r.meta, {
      action: "CREATE",
      entityType: "ClaudeCodeRequest",
      entityId: request.id,
      summary,
    });
  }
  return { id: request.id, issueNumber: opened.number, issueUrl: opened.url };
}

type Request = Awaited<ReturnType<typeof prisma.claudeCodeRequest.findFirstOrThrow>>;

async function tellOwner(r: Request, subject: string, body: string) {
  if (!r.createdById) return;
  await sendInApp(prisma, r.companyId, [{ userId: r.createdById }], {
    subject,
    body,
    entityType: "ClaudeCodeRequest",
    entityId: r.id,
  });
  await pushToBot(r.companyId, { kind: "text", text: `${subject}. ${body}` });
}

/** The files a request's pull request changes, as kept. */
type FixFiles = { files: github.PullFile[]; total: number };

/**
 * Looks on GitHub once for one request and moves it on. A pull request counts
 * only when it is on Claude Code's own branch for the issue; each look checks
 * again that it is Claude Code's own work into main (github.vetPull), and the
 * owner hears "Fix ready" only then.
 */
export async function followRequest(gh: github.GitHub, r: Request, now: Date = new Date()) {
  const data: Prisma.ClaudeCodeRequestUpdateInput = { lookedAt: now };
  let openedByErp = r.prOpenedByErp;
  if (r.state === "SENT" && r.issueNumber) {
    const work = await github.findWork(gh, r.issueNumber);
    let pull = work.pull;
    if (!pull) {
      const runs = (await github.workflowRuns(gh, github.CLAUDE_WORKFLOW, r.createdAt)).filter(
        (run) => run.display_title === r.title,
      );
      const busy = runs.some((run) => run.status !== "completed");
      if (work.branch && !busy && runs.length > 0 && (await github.branchAhead(gh, work.branch))) {
        // Claude Code pushed its branch but did not open the pull request: the ERP does.
        pull = await github.openPull(gh, {
          branch: work.branch,
          title: r.title,
          body: pullBody(r.issueNumber),
        });
        openedByErp = true;
      } else if (!busy && runs.length > 0) {
        const failed = runs.every((run) => run.conclusion !== "success");
        data.state = "STOPPED";
        data.note = failed
          ? `Claude Code stopped without a fix: read its answer on issue #${r.issueNumber}.`
          : `Claude Code answered on issue #${r.issueNumber} without a change.`;
      } else if (
        runs.length === 0 &&
        now.getTime() - r.createdAt.getTime() > NO_RUN_MINUTES * 60_000
      ) {
        data.state = "STOPPED";
        data.note =
          "GitHub did not start Claude Code: check that the Claude GitHub App is installed on the repository and the CLAUDE_CODE_OAUTH_TOKEN secret is set (Help: Full check).";
      }
    }
    if (pull) {
      data.prNumber = pull.number;
      data.prUrl = pull.html_url;
      data.branch = pull.head.ref;
      data.state = "PR_OPEN";
      data.note = null;
      data.prOpenedByErp = openedByErp;
    }
  }
  const prNumber = (data.prNumber as number | undefined) ?? r.prNumber;
  if ((data.state ?? r.state) === "PR_OPEN" && prNumber && r.issueNumber) {
    const pull = await github.getPull(gh, prNumber);
    if (pull.merged_at) {
      data.state = "MERGED";
      data.mergedAt = r.mergedAt ?? new Date(pull.merged_at);
    } else if (pull.state === "closed") {
      data.state = "STOPPED";
      data.note = `PR #${prNumber} was closed without merging.`;
    } else {
      const vet = await github.vetPull(gh, pull, r.issueNumber, openedByErp);
      const checks = await github.checksOf(gh, pull.head.sha);
      Object.assign(data, vetted(vet));
      data.checks = checks;
      data.headSha = pull.head.sha;
      const fresh = r.checks !== "passed" || r.headSha !== pull.head.sha || !r.prVetted;
      if (!vet.ok) {
        if (r.prProblem !== vet.problem) {
          await tellOwner(
            r,
            `PR #${prNumber} cannot be merged here`,
            `${r.title}: ${vet.problem}. Look at it on GitHub; the ERP never merges it.`,
          );
        }
      } else if (checks === "passed" && fresh) {
        data.note = null;
        await tellOwner(
          r,
          `Fix ready: merge PR #${prNumber}`,
          `${r.title}. Its checks passed; look at who made it and the files it changes, then merge it in AI Center > Full check (the PIN is asked).`,
        );
      }
      // Claude Code is asked to fix failed checks only on its own work.
      if (vet.ok && checks === "failed" && r.askedSha !== pull.head.sha) {
        const lock = r.retries < MAX_RETRIES ? await github.mainLock(gh) : null;
        if (lock && !lock.locked) {
          // Not asked again until main is locked; the next look tries again.
          data.note = github.lockMainText(lock.missing);
        } else if (r.retries < MAX_RETRIES) {
          await github.comment(gh, prNumber, FIX_CHECKS_COMMENT);
          data.askedSha = pull.head.sha;
          data.retries = r.retries + 1;
          data.note = null;
        } else {
          data.askedSha = pull.head.sha;
          data.note = `The checks failed on PR #${prNumber} again after ${MAX_RETRIES} fixes: open it on GitHub, or send the problem again.`;
          await tellOwner(r, `Claude Code could not get PR #${prNumber} green`, data.note);
        }
      }
    }
  }
  return prisma.claudeCodeRequest.update({ where: { id: r.id }, data });
}

/** What a look at a pull request keeps: who opened it, whether it may be merged, its files. */
const vetted = (vet: github.Vetted) => ({
  prAuthor: vet.author,
  prVetted: vet.ok,
  prProblem: vet.problem,
  prFiles: { files: vet.files, total: vet.filesTotal } satisfies FixFiles as Prisma.InputJsonValue,
});

/** The clock (every two minutes): checks that never reported end; open requests move on. */
export async function runFullCheckClock(now: Date = new Date()) {
  await finishStale(now);
  const open = await prisma.claudeCodeRequest.findMany({
    where: {
      state: { in: ["SENT", "PR_OPEN"] },
      OR: [
        { lookedAt: null },
        { lookedAt: { lt: new Date(now.getTime() - LOOK_EVERY_MS + 5_000) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const connections = new Map<string, github.GitHub | null>();
  for (const r of open) {
    if (!connections.has(r.companyId)) {
      connections.set(r.companyId, await githubOf(r.companyId).catch(() => null));
    }
    const gh = connections.get(r.companyId);
    if (!gh) continue;
    await followRequest(gh, r, now).catch((error: unknown) =>
      console.error(`[full-check] request ${r.id}`, error instanceof Error ? error.message : error),
    );
  }
}

/** "Look again": every open request of the company, now. */
export async function lookAgain(ctx: CompanyContext) {
  assertPlatform(ctx);
  checkRateLimit(`claude-code-look:${ctx.company.id}`, 6, 60_000);
  const gh = await needGitHub(ctx.company.id);
  const open = await ctx.db.claudeCodeRequest.findMany({
    where: { state: { in: ["SENT", "PR_OPEN"] } },
    take: 20,
  });
  for (const r of open) await followRequest(gh, r);
}

export const mergeSchema = z.object({
  pin: z.string().max(20).optional(),
  /** The commit the owner looked at: only that one is merged. */
  sha: z
    .string()
    .trim()
    .regex(/^[\w-]{1,64}$/, "Look at the fix again before merging"),
});

/**
 * Merges a ready fix (with the PIN): exactly the commit the owner looked at,
 * checked once more as Claude Code's own work into main. The Deploy workflow
 * then installs it safely.
 */
export async function mergeFix(
  ctx: CompanyContext,
  id: string,
  input: unknown,
  meta?: RequestMeta,
  checked?: PinProof,
) {
  assertPlatform(ctx);
  const { pin, sha } = mergeSchema.parse(input);
  await requirePin(ctx, checked ?? pin, "merge a change into the live ERP");
  const gh = await needGitHub(ctx.company.id);
  const r = await ctx.db.claudeCodeRequest.findFirst({ where: { id } });
  if (!r) throw new AppError("NOT_FOUND", "There is no such request.");
  if (r.state !== "PR_OPEN" || !r.prNumber || !r.issueNumber) {
    throw new AppError("VALIDATION", "There is no open pull request to merge for this request.");
  }
  const pull = await github.getPull(gh, r.prNumber);
  if (pull.state !== "open") throw new AppError("CONFLICT", `PR #${r.prNumber} is not open.`);
  if (pull.head.sha !== sha) {
    throw new AppError(
      "CONFLICT",
      "The fix changed since you looked: look at it again before merging.",
    );
  }
  const vet = await github.vetPull(gh, pull, r.issueNumber, r.prOpenedByErp);
  if (!vet.ok) {
    await prisma.claudeCodeRequest.update({
      where: { id: r.id },
      data: { ...vetted(vet), headSha: pull.head.sha },
    });
    throw new AppError("VALIDATION", `PR #${r.prNumber} cannot be merged here: ${vet.problem}.`);
  }
  const checks = await github.checksOf(gh, pull.head.sha);
  if (checks !== "passed") {
    throw new AppError(
      "VALIDATION",
      checks === "running"
        ? "Wait for the checks to pass before merging."
        : "The checks failed: it cannot be merged.",
    );
  }
  await github.mergePull(gh, r.prNumber, pull.head.sha);
  await prisma.claudeCodeRequest.update({
    where: { id: r.id },
    data: { state: "MERGED", mergedAt: new Date(), mergedById: ctx.user.id, checks, note: null },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ClaudeCodeRequest",
    entityId: r.id,
    summary: `Merged PR #${r.prNumber} (${r.title}) at commit ${sha.slice(0, 7)}, opened by ${vet.author}, ${vet.filesTotal} file${vet.filesTotal === 1 ? "" : "s"}: the safe update installs it`,
  });
  return { deploys: `https://github.com/${gh.repo}/actions/workflows/deploy.yml` };
}

// ---------------------------------------------------------------- the screen

export async function getFullCheck(ctx: CompanyContext, runId?: string) {
  assertPlatform(ctx);
  await finishStale(new Date(), ctx.company.id);
  const s = await settingsOf(ctx.company.id);
  const connected = !!(s?.githubRepo && s.githubTokenSealed);
  const [runs, requests] = await Promise.all([
    ctx.db.fullCheckRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 8,
      include: {
        startedBy: { select: { name: true } },
        _count: { select: { problems: true } },
      },
    }),
    ctx.db.claudeCodeRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { createdBy: { select: { name: true } } },
    }),
  ]);
  // A running check's link on GitHub, once GitHub shows it.
  const going = runs.find((r) => r.status === "STARTING" || r.status === "RUNNING");
  if (going && !going.githubRunUrl && connected) {
    const gh = await githubOf(ctx.company.id);
    const found = gh
      ? await github
          .workflowRuns(
            gh,
            github.FULL_CHECK_WORKFLOW,
            new Date(going.startedAt.getTime() - 60_000),
          )
          .catch(() => [])
      : [];
    // The workflow's run-name carries the check's id.
    const mine = found.find((r) => r.display_title?.includes(going.id));
    if (mine) {
      going.githubRunUrl = mine.html_url;
      await prisma.fullCheckRun.update({
        where: { id: going.id },
        data: { githubRunUrl: mine.html_url },
      });
    }
  }
  const shown =
    (runId && runs.find((r) => r.id === runId)) || runs.find((r) => r.status === "DONE") || null;
  const problems = shown
    ? await ctx.db.fullCheckProblem.findMany({
        where: { runId: shown.id },
        orderBy: [{ kind: "asc" }, { screen: "asc" }],
        include: {
          request: {
            select: {
              id: true,
              state: true,
              issueNumber: true,
              prNumber: true,
              checks: true,
              note: true,
              prVetted: true,
              prProblem: true,
            },
          },
        },
      })
    : [];
  return {
    site: siteOf(),
    url: process.env.APP_URL ?? null,
    github: {
      connected,
      repo: s?.githubRepo ?? null,
      hint: s?.githubTokenHint ?? null,
      test: (s?.githubTest as GitHubTest | null) ?? null,
      /** Whether GitHub said main is locked (null: not tested yet); Claude Code waits for it. */
      mainLocked: ((s?.githubTest as GitHubTest | null)?.mainLocked ?? null) as boolean | null,
    },
    going: going
      ? {
          id: going.id,
          status: going.status,
          startedAt: going.startedAt,
          githubRunUrl: going.githubRunUrl,
        }
      : null,
    runs: runs.map((r) => ({
      id: r.id,
      site: r.site,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      by: r.startedBy?.name ?? null,
      problems: r._count.problems,
      note: r.note,
      githubRunUrl: r.githubRunUrl,
      summary: r.summary as z.infer<typeof reportSchema>["summary"] | null,
    })),
    shown: shown?.id ?? null,
    problems: problems.map((p) => ({
      id: p.id,
      role: p.role,
      kind: p.kind,
      kindText: KIND_TEXT[p.kind as ProblemKind] ?? p.kind,
      kindLabel: KIND_LABEL[p.kind as ProblemKind] ?? p.kind,
      screen: p.screen,
      pattern: p.pattern,
      text: p.text,
      detail: p.detail,
      ms: p.ms,
      shot: !!p.shotPath,
      request: p.request ? { id: p.request.id, text: requestText({ ...p.request }) } : null,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      text: r.text,
      state: r.state,
      stateText: requestText(r),
      issueNumber: r.issueNumber,
      issueUrl: r.issueUrl,
      prNumber: r.prNumber,
      prUrl: r.prUrl,
      checks: r.checks,
      by: r.createdBy?.name ?? null,
      createdAt: r.createdAt,
      mergedAt: r.mergedAt,
      headSha: r.headSha,
      /** Who made the pull request and what it changes, shown before Merge. */
      fix: r.prNumber ? fixOf(r) : null,
      canMerge: r.state === "PR_OPEN" && r.checks === "passed" && r.prVetted && !!r.headSha,
    })),
  };
}

function fixOf(r: Request) {
  const kept = (r.prFiles as FixFiles | null) ?? { files: [], total: 0 };
  return {
    author: r.prAuthor,
    openedByErp: r.prOpenedByErp,
    files: kept.files,
    filesTotal: kept.total,
    /** Files that run, build or install the ERP, or set Claude Code's rules: look twice. */
    careful: carefulFiles(kept.files.map((f) => f.name)),
  };
}

export type FullCheckScreen = Awaited<ReturnType<typeof getFullCheck>>;
