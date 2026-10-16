import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * v6.3 G: AI Center > Full check and Claude Code. The ERP asks GitHub to run
 * the check (a one-time pass with the run), opens it only with the pass AND
 * GitHub's signed proof that it is the repository's own Full check workflow,
 * gives it a session for the owner and one member of each other role, takes
 * its report and screenshots, and ends the sessions. Problems (or a request in
 * plain words) go to Claude Code as GitHub issues starting "@claude"; the ERP
 * follows each to its pull request, opens the pull request when Claude Code
 * only pushed a branch, asks again when checks fail (twice at most), tells the
 * owner when a fix is ready, and merges it only with the PIN. Only the
 * platform owner does any of it. GitHub is a stand-in (tests/fixtures/fake-github.ts).
 */

import { hashSessionToken } from "@/lib/auth/token";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  askClaudeCode,
  beginCheck,
  finishStale,
  followRequest,
  getFullCheck,
  lookAgain,
  mergeFix,
  receiveReport,
  receiveShot,
  removeGitHub,
  saveGitHub,
  sendFix,
  shotOf,
  startFullCheck,
  testGitHubConnection,
} from "@/modules/ai/full-check/full-check.service";
import { FIX_CHECKS_COMMENT } from "@/modules/ai/full-check/texts";
import { setPin } from "@/modules/ai/settings.service";
import { createRole } from "@/modules/rbac/role.service";

import { type FakeGitHub, startFakeGitHub } from "../fixtures/fake-github";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const SITE = "https://erp.test";
const REPO = "extas/erp";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);

async function expectAppError(promise: Promise<unknown>, code: string, message?: string | RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const join = async (roleId: string, who: string, isSuperAdmin = false) => {
    const user = await makeUser(`${who}@extas.test`, { isSuperAdmin });
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner", true);
  // An owner of the company who is not the platform owner.
  const partner = await join(roles.SUPER_ADMIN, "partner");
  const accounts = await join(roles.ACCOUNTS, "accounts");
  const pm = await join(roles.PRODUCTION_MANAGER, "pm");
  // A second platform owner in a role: not used for it (they would see more than the role).
  await join(roles.SALES_EXECUTIVE, "platform-sales", true);
  // The AI's own account is never used (its role has no one else, so it is not checked).
  const ai = await makeUser(`ai-${company.id}@ai.invalid`);
  await addToCompany(ai.id, company.id, roles.EMPLOYEE);
  const checker = await createRole(owner, { name: "Checker", permissions: ["dashboard.view"] });
  return { company, roles, owner, partner, accounts, pm, checkerRole: checker };
}

type Env = Awaited<ReturnType<typeof setup>>;

run("Full check and Claude Code", () => {
  let env: Env;
  let gh: FakeGitHub;
  let uploads: string;

  beforeEach(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("APP_URL", SITE);
    vi.stubEnv("DEMO_SITE", "");
    gh = await startFakeGitHub(REPO);
    vi.stubEnv("GITHUB_API_URL", gh.url);
    vi.stubEnv("GITHUB_OIDC_ISSUER", gh.issuer);
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-full-check-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    await resetDb();
    env = await setup();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await gh.close();
    await rm(uploads, { recursive: true, force: true });
  });

  const connect = () => saveGitHub(env.owner, { repo: REPO, token: gh.token });

  /** Starts a check and returns its id and the pass GitHub was given. */
  async function started() {
    const { id } = await startFullCheck(env.owner);
    const dispatch = [...gh.calls]
      .reverse()
      .find((c) => c.path.endsWith("/full-check.yml/dispatches"))!;
    const inputs = dispatch.body!.inputs as { site: string; run: string; pass: string };
    return { id, inputs };
  }

  it("connects GitHub with a locked token, tests it, and only the platform owner may", async () => {
    await expectAppError(getFullCheck(env.partner), "FORBIDDEN", /platform owner/);
    await expectAppError(saveGitHub(env.partner, { repo: REPO, token: gh.token }), "FORBIDDEN");
    await connect();
    await expect(
      saveGitHub(env.owner, { repo: "not a repo", token: gh.token }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      saveGitHub(env.owner, { repo: REPO, token: "password123" }),
    ).rejects.toBeInstanceOf(ZodError);

    const settings = await prisma.aiSettings.findUniqueOrThrow({
      where: { companyId: env.company.id },
    });
    expect(settings.githubTokenSealed).toBeTruthy();
    expect(settings.githubTokenSealed).not.toContain(gh.token);
    expect(settings.githubTokenHint).toBe(gh.token.slice(-4));
    // Saved again with the token left empty: the token stays.
    await saveGitHub(env.owner, { repo: REPO, token: "" });
    expect((await getFullCheck(env.owner)).github).toMatchObject({
      connected: true,
      repo: REPO,
      hint: "WXYZ",
    });

    const ok = await testGitHubConnection(env.owner);
    expect(ok.ok).toBe(true);
    expect(ok.notes.join(" ")).toMatch(/Connected to extas\/erp \(private\)/);

    gh.state.workflows["claude.yml"] = null;
    gh.state.workflows["full-check.yml"] = "disabled_manually";
    gh.state.permissions = { push: false, admin: false };
    const not = await testGitHubConnection(env.owner);
    expect(not.ok).toBe(false);
    expect(not.notes.join("\n")).toMatch(/cannot write to the repository/);
    expect(not.notes.join("\n")).toMatch(
      /The Claude Code workflow \(.github\/workflows\/claude.yml\) is not on the main branch/,
    );
    expect(not.notes.join("\n")).toMatch(/The Full check workflow is turned off/);
    expect((await getFullCheck(env.owner)).github.test).toMatchObject({ ok: false });

    await removeGitHub(env.owner);
    expect((await getFullCheck(env.owner)).github.connected).toBe(false);
    await expectAppError(startFullCheck(env.owner), "VALIDATION", /Connect GitHub first/);
    const audits = await prisma.auditLog.findMany({ where: { entityType: "AiSettings" } });
    expect(audits.map((a) => a.summary).join("\n")).not.toContain(gh.token);
  });

  it("opens a check once, only with the pass and GitHub's proof, as the owner and one member per role", async () => {
    await connect();
    const { id, inputs } = await started();
    expect(inputs).toMatchObject({ site: SITE, run: id });
    expect(inputs.pass.length).toBeGreaterThan(20);
    await expectAppError(startFullCheck(env.owner), "CONFLICT", /running already/);
    const proof = (claims: Record<string, unknown> = {}, otherKey = false) =>
      gh.actionsToken({ aud: SITE, ...claims }, { otherKey });

    await expectAppError(
      beginCheck({ run: id, pass: "x".repeat(30), proof: proof() }),
      "FORBIDDEN",
      /pass/,
    );
    await expect(beginCheck({ run: id, pass: inputs.pass })).rejects.toBeInstanceOf(ZodError);
    await expectAppError(
      beginCheck({ run: id, pass: inputs.pass, proof: proof({}, true) }),
      "FORBIDDEN",
      /signature/,
    );
    await expectAppError(
      beginCheck({ run: id, pass: inputs.pass, proof: proof({ aud: "https://other.test" }) }),
      "FORBIDDEN",
      /another site/,
    );
    await expectAppError(
      beginCheck({ run: id, pass: inputs.pass, proof: proof({ repository: "someone/else" }) }),
      "FORBIDDEN",
      /another repository/,
    );
    await expectAppError(
      beginCheck({
        run: id,
        pass: inputs.pass,
        proof: proof({ workflow_ref: `${REPO}/.github/workflows/claude.yml@refs/heads/main` }),
      }),
      "FORBIDDEN",
      /another workflow/,
    );
    await expectAppError(
      beginCheck({
        run: id,
        pass: inputs.pass,
        proof: proof({ exp: Math.floor(Date.now() / 1000) - 600 }),
      }),
      "FORBIDDEN",
      /expired/,
    );
    await expectAppError(
      beginCheck({ run: id, pass: inputs.pass, proof: proof({ iss: "https://evil.test" }) }),
      "FORBIDDEN",
      /GitHub Actions/,
    );

    // None of that used the pass up.
    const begun = await beginCheck({ run: id, pass: inputs.pass, proof: proof() });
    expect(begun.writes).toBe(false);
    expect(begun.minutes).toBe(10);
    expect(begun.roles[0]).toMatchObject({ role: "Owner", member: expect.any(String) });
    const roleNames = begun.roles.map((r) => r.role);
    expect(roleNames).toContain("Accounts");
    expect(roleNames).toContain("Production Manager");
    // The partner shares the owner's role; the platform owner in Sales and the AI never stand in.
    expect(roleNames.filter((r) => r === "Super Admin")).toEqual([]);
    expect(roleNames).not.toContain("Sales Executive");
    expect(begun.notChecked).toContain("Sales Executive");
    expect(begun.notChecked).toContain("Checker");
    expect(begun.notChecked).toContain("Employee");
    for (const s of begun.roles) expect(s.cookie.startsWith("fullcheck.")).toBe(true);
    const sessions = await prisma.session.findMany({ where: { userAgent: `Full check ${id}` } });
    expect(sessions).toHaveLength(begun.roles.length);
    expect(sessions.map((s) => s.token)).toContain(hashSessionToken(begun.roles[0]!.cookie));
    const ownerSession = sessions.find(
      (s) => s.token === hashSessionToken(begun.roles[0]!.cookie),
    )!;
    expect(ownerSession.userId).toBe(env.owner.user.id);
    expect(ownerSession.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(50 * 60_000);

    const row = await prisma.fullCheckRun.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "RUNNING", passHash: null });
    expect(row.githubRunUrl).toBe(`https://github.com/${REPO}/actions/runs/4242`);
    await expectAppError(
      beginCheck({ run: id, pass: inputs.pass, proof: proof() }),
      "FORBIDDEN",
      /pass/,
    );
  });

  it("takes the report and screenshots, ends the sessions and tells the owner", async () => {
    await connect();
    const { id, inputs } = await started();
    const begun = await beginCheck({
      run: id,
      pass: inputs.pass,
      proof: gh.actionsToken({ aud: SITE }),
    });
    const report = {
      summary: {
        roles: [{ role: "Owner", member: "owner", screens: 140, pdfs: 12, skipped: 3, note: null }],
        screens: 140,
        pdfs: 12,
        links: 900,
        seconds: 540,
      },
      problems: [
        {
          role: "Owner",
          kind: "BROKEN_LINK",
          screen: "/help/production-batches",
          pattern: "/help/[slug]",
          text: "A link leads to a page that does not exist (404)",
          detail: "GET /production/projects/[projectId] answered 404",
          shot: true,
        },
        {
          role: "Accounts",
          kind: "SLOW",
          screen: "/accounts/ledger",
          text: "The screen took 7.2 seconds to open",
          ms: 7200,
        },
      ],
    };
    await expectAppError(receiveReport("wrong-key", report), "FORBIDDEN");
    const got = await receiveReport(begun.reportKey, report);
    expect(got.problems).toHaveLength(1);
    expect(got.problems[0]!.index).toBe(0);
    expect(await prisma.session.count({ where: { userAgent: `Full check ${id}` } })).toBe(0);
    expect(await prisma.fullCheckRun.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "DONE",
    });
    const told = await prisma.notificationLog.findFirstOrThrow({
      where: { userId: env.owner.user.id, entityType: "FullCheckRun" },
    });
    expect(told.subject).toBe("Full check: 2 problems found");
    await expectAppError(receiveReport(begun.reportKey, report), "FORBIDDEN");

    const problemId = got.problems[0]!.id;
    await expectAppError(
      receiveShot(begun.reportKey, problemId, Buffer.from("<html>")),
      "VALIDATION",
      /JPEG or PNG/,
    );
    await expectAppError(receiveShot(begun.reportKey, "nope", JPEG), "NOT_FOUND");
    await receiveShot(begun.reportKey, problemId, JPEG);
    await expectAppError(receiveShot(begun.reportKey, problemId, JPEG), "CONFLICT");
    await expectAppError(
      receiveShot(begun.reportKey, problemId, JPEG, new Date(Date.now() + 21 * 60_000)),
      "FORBIDDEN",
    );
    const shot = await shotOf(env.owner, problemId);
    expect(shot.mimeType).toBe("image/jpeg");
    expect(Buffer.compare(shot.bytes, JPEG)).toBe(0);
    await expectAppError(shotOf(env.partner, problemId), "FORBIDDEN");

    const screen = await getFullCheck(env.owner);
    expect(screen.shown).toBe(id);
    expect(screen.going).toBeNull();
    expect(screen.problems.map((p) => [p.kind, p.kindText, p.shot])).toEqual([
      ["BROKEN_LINK", "A link leads to a page that does not exist", true],
      ["SLOW", "The screen was slow", false],
    ]);
    expect(screen.runs[0]!.summary).toMatchObject({ screens: 140, pdfs: 12 });
  });

  it("ends a check that never started or never reported, with its sessions", async () => {
    await connect();
    const first = await started();
    await finishStale(new Date(Date.now() + 31 * 60_000));
    expect(await prisma.fullCheckRun.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: "FAILED",
      note: expect.stringMatching(/GitHub did not start the check/),
    });
    await expectAppError(
      beginCheck({ run: first.id, pass: first.inputs.pass, proof: gh.actionsToken({ aud: SITE }) }),
      "FORBIDDEN",
    );

    const second = await started();
    await beginCheck({
      run: second.id,
      pass: second.inputs.pass,
      proof: gh.actionsToken({ aud: SITE }),
    });
    await finishStale(new Date(Date.now() + 61 * 60_000));
    expect(await prisma.fullCheckRun.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject(
      {
        status: "FAILED",
        note: expect.stringMatching(/No report came back/),
      },
    );
    expect(await prisma.session.count({ where: { userAgent: `Full check ${second.id}` } })).toBe(0);
  });

  it("sends problems to Claude Code and follows them to a merge with the PIN", async () => {
    await connect();
    const { id, inputs } = await started();
    const begun = await beginCheck({
      run: id,
      pass: inputs.pass,
      proof: gh.actionsToken({ aud: SITE }),
    });
    const { problems } = await receiveReport(begun.reportKey, {
      summary: { roles: [], screens: 10, pdfs: 0, links: 10, seconds: 60 },
      problems: [
        {
          role: "Owner",
          kind: "ERROR",
          screen: "/sales/orders",
          text: "The screen showed an error",
          detail: "ERR-123: ```boom```",
          shot: true,
        },
        {
          role: "Owner",
          kind: "SCRIPT",
          screen: "/accounts",
          text: "The screen had a script error",
          shot: false,
        },
      ],
    });
    const problemId = problems[0]!.id;

    await expectAppError(sendFix(env.partner, { problemIds: [problemId] }), "FORBIDDEN");
    const sent = await sendFix(env.owner, { problemIds: [problemId] });
    const issue = gh.state.issues.find((i) => i.number === sent.issueNumber)!;
    expect(issue.body.startsWith("@claude ")).toBe(true);
    expect(issue.title).toBe("Full check: The screen showed an error (/sales/orders)");
    expect(issue.body).toContain("`/sales/orders`");
    expect(issue.body).toContain("ERR-123: '''boom'''");
    expect(issue.body).toContain("Fixes #");
    await expectAppError(sendFix(env.owner, { problemIds: [problemId] }), "VALIDATION", /already/);
    // "Fix all" takes the rest of the check.
    const all = await sendFix(env.owner, { runId: id });
    expect(gh.state.issues.find((i) => i.number === all.issueNumber)!.body).toContain("/accounts");
    await expectAppError(sendFix(env.owner, { runId: id }), "VALIDATION");

    const asked = await askClaudeCode(env.owner, {
      text: "Add a button to print the packing list twice.\nOn the order screen.",
    });
    const askIssue = gh.state.issues.find((i) => i.number === asked.issueNumber)!;
    expect(askIssue.title).toBe("ERP request: Add a button to print the packing list twice.");
    expect(askIssue.body.startsWith("@claude ")).toBe(true);
    await expect(askClaudeCode(env.owner, { text: "short" })).rejects.toBeInstanceOf(ZodError);

    const request = () =>
      prisma.claudeCodeRequest.findFirstOrThrow({ where: { issueNumber: sent.issueNumber } });
    const look = async (minutes = 0) =>
      followRequest(
        { repo: REPO, token: gh.token },
        await request(),
        new Date(Date.now() + minutes * 60_000),
      );

    // Claude Code has not started yet: still waiting.
    expect((await look()).state).toBe("SENT");
    // Its run is going, with its branch: still waiting.
    const r0 = await request();
    gh.state.runs["claude.yml"] = [
      {
        id: 1,
        html_url: "https://github.com/run/1",
        status: "in_progress",
        conclusion: null,
        display_title: r0.title,
        created_at: new Date().toISOString(),
      },
    ];
    const branch = `claude/issue-${sent.issueNumber}-20261016-0100`;
    gh.state.branches.push(branch);
    gh.state.ahead[branch] = 2;
    expect((await look()).state).toBe("SENT");
    // Done, but only the branch was pushed: the ERP opens the pull request.
    gh.state.runs["claude.yml"]![0]!.status = "completed";
    gh.state.runs["claude.yml"]![0]!.conclusion = "success";
    const opened = await look();
    expect(opened).toMatchObject({ state: "PR_OPEN", branch, checks: "running" });
    const pull = gh.state.pulls.find((p) => p.number === opened.prNumber)!;
    expect(pull.body).toContain(`Fixes #${sent.issueNumber}`);
    expect(pull.head.ref).toBe(branch);

    // The checks fail: the ERP asks Claude Code to fix them, once per push, twice at most.
    gh.state.checks[pull.head.sha] = [
      { name: "Tests and build", status: "completed", conclusion: "failure" },
    ];
    expect(await look()).toMatchObject({ checks: "failed", retries: 1 });
    expect(gh.state.comments).toEqual([{ number: pull.number, body: FIX_CHECKS_COMMENT }]);
    await look();
    expect(gh.state.comments).toHaveLength(1);
    for (const sha of ["sha-2", "sha-3"]) {
      pull.head.sha = sha;
      gh.state.checks[sha] = [
        { name: "Tests and build", status: "completed", conclusion: "failure" },
      ];
      await look();
      expect(gh.state.comments).toHaveLength(2);
    }
    const gaveUp = await request();
    expect(gaveUp.retries).toBe(2);
    expect(gaveUp.note).toMatch(/again after 2 fixes/);
    const told = await prisma.notificationLog.findFirstOrThrow({
      where: { subject: { startsWith: "Claude Code could not get" } },
    });
    expect(told.userId).toBe(env.owner.user.id);

    // Merging asks for the PIN (set one first), and never merges failed checks.
    await expectAppError(mergeFix(env.partner, gaveUp.id, {}), "FORBIDDEN");
    const noPin = await expectAppError(mergeFix(env.owner, gaveUp.id, {}), "VALIDATION");
    expect(noPin.details?.pinNotSet).toBeTruthy();
    await setPin(env.owner, { pin: "2468" });
    await expectAppError(
      mergeFix(env.owner, gaveUp.id, { pin: "2468" }),
      "VALIDATION",
      /checks failed/,
    );

    // A new push passes: the owner is told, and it can be merged with the PIN.
    pull.head.sha = "sha-4";
    gh.state.checks["sha-4"] = [
      { name: "Tests and build", status: "completed", conclusion: "success" },
      { name: "Run the simulation and wipe it", status: "completed", conclusion: "skipped" },
    ];
    expect(await look()).toMatchObject({ checks: "passed", note: null });
    const ready = await prisma.notificationLog.findFirstOrThrow({
      where: { entityType: "ClaudeCodeRequest", subject: { startsWith: "Fix ready" } },
    });
    expect(ready.subject).toBe(`Fix ready: merge PR #${pull.number}`);
    const screen = await getFullCheck(env.owner);
    const shown = screen.requests.find((x) => x.id === gaveUp.id)!;
    expect(shown).toMatchObject({
      canMerge: true,
      stateText: `Fix ready: merge PR #${pull.number}`,
    });
    expect(screen.problems.find((p) => p.id === problemId)!.request!.text).toBe(
      `Fix ready: merge PR #${pull.number}`,
    );

    const askPin = await expectAppError(mergeFix(env.owner, gaveUp.id, {}), "VALIDATION");
    expect(askPin.details?.pin).toBeTruthy();
    await expectAppError(mergeFix(env.owner, gaveUp.id, { pin: "1111" }), "VALIDATION");
    expect(gh.state.merged).toEqual([]);
    const merged = await mergeFix(env.owner, gaveUp.id, { pin: "2468" });
    expect(merged.deploys).toBe(`https://github.com/${REPO}/actions/workflows/deploy.yml`);
    expect(gh.state.merged).toEqual([{ number: pull.number, sha: "sha-4" }]);
    expect(await request()).toMatchObject({ state: "MERGED", mergedById: env.owner.user.id });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ClaudeCodeRequest", summary: { startsWith: "Merged" } },
    });
    expect(audit.summary).toContain(`PR #${pull.number}`);
  });

  it("stops a request Claude Code answered without a change, never started, or whose pull request closed", async () => {
    await connect();
    const gitHub = { repo: REPO, token: gh.token };
    const asked = async (text: string) => {
      const r = await askClaudeCode(env.owner, { text });
      return prisma.claudeCodeRequest.findFirstOrThrow({ where: { issueNumber: r.issueNumber } });
    };

    const answered = await asked("Can the order screen show the buyer's country?");
    gh.state.runs["claude.yml"] = [
      {
        id: 7,
        html_url: "https://github.com/run/7",
        status: "completed",
        conclusion: "success",
        display_title: answered.title,
        created_at: new Date().toISOString(),
      },
    ];
    expect(await followRequest(gitHub, answered)).toMatchObject({
      state: "STOPPED",
      note: expect.stringMatching(/answered on issue #\d+ without a change/),
    });

    const never = await asked("Add a dark green theme to the reports.");
    expect((await followRequest(gitHub, never, new Date(Date.now() + 10 * 60_000))).state).toBe(
      "SENT",
    );
    expect(await followRequest(gitHub, never, new Date(Date.now() + 21 * 60_000))).toMatchObject({
      state: "STOPPED",
      note: expect.stringMatching(/Claude GitHub App is installed/),
    });

    const closed = await asked("Show the cutting date on the batch page.");
    gh.state.pulls.push({
      number: 900,
      html_url: "https://github.com/pull/900",
      state: "closed",
      merged_at: null,
      title: "Show the cutting date",
      body: `Fixes #${closed.issueNumber}`,
      head: { ref: "someone/branch", sha: "sha-x" },
    });
    expect(await followRequest(gitHub, closed)).toMatchObject({
      state: "STOPPED",
      prNumber: 900,
      note: "PR #900 was closed without merging.",
    });

    // "Look again" only for the platform owner, and only open requests are looked at.
    await expectAppError(lookAgain(env.partner), "FORBIDDEN");
    const before = gh.calls.length;
    await lookAgain(env.owner);
    expect(gh.calls.length).toBe(before);
  });
});
