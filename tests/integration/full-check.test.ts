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
 *
 * v6.4 A: a fix is ready only when it is Claude Code's own work (its GitHub
 * App's commits) for that exact issue, from a branch of this repository, into
 * main, never a pull request that merely names "#n"; the owner sees who opened
 * it and the files it changes, and merges exactly the commit shown. Issues
 * carry no screen text or business data. The check's sessions belong to its
 * own check account, one per role, never a real person's login, and only a
 * run of the workflow on main may open a check.
 */

import { hashSessionToken } from "@/lib/auth/token";
import { AppError } from "@/lib/errors";
import { resetRateLimits } from "@/lib/rate-limit";
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
import { login } from "@/modules/auth/auth.service";
import { validateSessionToken } from "@/modules/auth/session.service";
import { resolveCompanyAccess } from "@/modules/companies/access";
import { vetPull } from "@/modules/github/github";
import { addMember } from "@/modules/rbac/member.service";
import { createRole } from "@/modules/rbac/role.service";

import {
  claudeCommit,
  CLAUDE_BOT,
  type FakeCommit,
  type FakeGitHub,
  type FakePull,
  helpRulesets,
  REPOSITORY_ADMIN,
  startFakeGitHub,
} from "../fixtures/fake-github";
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

  it("shows Lock main first, and starts no Claude Code work, until main on GitHub is locked (v6.4.1 B1)", async () => {
    await connect();
    // The test button allows a few presses a minute; this test presses it often.
    const tested = () => {
      resetRateLimits();
      return testGitHubConnection(env.owner);
    };
    const notes = async () => (await tested()).notes.join("\n");
    const ask = () =>
      askClaudeCode(env.owner, { text: "Add a button to print the packing list twice." });
    // Locked as the Help says: "Protect main" (pull requests only, Tests and build, no force
    // pushes or deletions, nobody may skip it) and "Restrict updates" (only the repository
    // admin, the owner, may update main). The Help's token may not see the Bypass lists
    // (GitHub shows them only to a token that may change rulesets), but GitHub says the
    // token's account cannot skip the first and can skip the second: the screen says what
    // it could not see.
    expect(await tested()).toMatchObject({ ok: true, mainLocked: true });
    expect(await notes()).toMatch(/The main branch is locked/);
    expect(await notes()).toMatch(
      /cannot see the rulesets' Bypass lists.*Protect main's Bypass list is empty and Restrict updates' holds only Repository admin/,
    );
    expect((await getFullCheck(env.owner)).github.mainLocked).toBe(true);
    // Bypass lists the token may read, and right: nothing more to say.
    gh.state.rulesets[7]!.bypass = [];
    gh.state.rulesets[8]!.bypass = [REPOSITORY_ADMIN];
    expect(await notes()).not.toMatch(/Bypass list/);
    gh.state.rulesets = helpRulesets();

    // No ruleset on main: not ready, and nothing goes to Claude Code.
    gh.state.rulesets = {};
    const not = await tested();
    expect(not).toMatchObject({ ok: false, mainLocked: false });
    expect(not.notes.join("\n")).toMatch(/Lock main first/);
    expect((await getFullCheck(env.owner)).github.mainLocked).toBe(false);
    await expectAppError(ask(), "VALIDATION", /Lock main first/);
    expect(gh.state.issues).toHaveLength(0);

    // A first ruleset that still lets a push, a deletion or an untested change through.
    const notLocked = async (shape: () => void, still: RegExp) => {
      gh.state.rulesets = helpRulesets();
      shape();
      const result = await tested();
      expect(result, String(still)).toMatchObject({ ok: false, mainLocked: false });
      expect(result.notes.join("\n")).toMatch(/Lock main first/);
      expect(result.notes.join("\n")).toMatch(still);
      await expectAppError(ask(), "VALIDATION", /Lock main first/);
    };
    await notLocked(() => (gh.state.rulesets[7]!.rules = ["pull_request"]), /Block force pushes/);
    await notLocked(() => (gh.state.rulesets[7]!.rules = ["pull_request"]), /Restrict deletions/);
    await notLocked(
      () =>
        (gh.state.rulesets[7]!.rules = ["deletion", "non_fast_forward", "required_status_checks"]),
      /Require a pull request before merging/,
    );
    await notLocked(
      () => (gh.state.rulesets[7]!.rules = ["deletion", "non_fast_forward", "pull_request"]),
      /Require status checks to pass \(with Tests and build\)/,
    );
    await notLocked(
      () => (gh.state.rulesets[7]!.statusChecks = ["Lint"]),
      /Require status checks to pass \(with Tests and build\)/,
    );
    // With approvals asked, nobody could merge Claude Code's fixes (no one reviews them).
    await notLocked(() => (gh.state.rulesets[7]!.approvals = 1), /Required approvals: 0/);
    // A ruleset only being tried out ("Evaluate") locks nothing.
    await notLocked(() => (gh.state.rulesets[7]!.enforcement = "evaluate"), /Restrict deletions/);
    // Someone on its Bypass list, or the token's own account, could still skip it.
    await notLocked(
      () => (gh.state.rulesets[7]!.bypass = [REPOSITORY_ADMIN]),
      /an empty Bypass list on Protect main/,
    );
    for (const can of ["always", "pull_requests_only", "exempt"] as const) {
      await notLocked(
        () => (gh.state.rulesets[7]!.canBypass = can),
        /an empty Bypass list on Protect main \(your token's GitHub account can skip it\)/,
      );
    }
    // GitHub says nothing about who may skip it, or it cannot be read: not confirmed.
    await notLocked(
      () => (gh.state.rulesets[7]!.canBypass = null),
      /Protect main \(the ERP could not check who may skip it\)/,
    );
    await notLocked(
      () => (gh.state.rulesets[7]!.hidden = true),
      /Protect main \(the ERP could not check who may skip it\)/,
    );

    // The second ruleset: without it Claude Code's GitHub App (or any other token that may
    // write) could merge into main itself.
    await notLocked(
      () => delete gh.state.rulesets[8],
      /a second ruleset, Restrict updates, with only Repository admin on its Bypass list/,
    );
    await notLocked(
      () => (gh.state.rulesets[8]!.enforcement = "disabled"),
      /a second ruleset, Restrict updates/,
    );
    // Anyone else on its Bypass list (the Claude GitHub App, a team, a deploy key) could
    // update main: only the repository admin role may be there.
    for (const other of [
      { actor_type: "Integration", actor_id: 1236702, bypass_mode: "always" },
      { actor_type: "RepositoryRole", actor_id: 4, bypass_mode: "always" },
      { actor_type: "DeployKey", actor_id: null, bypass_mode: "always" },
    ]) {
      await notLocked(
        () => (gh.state.rulesets[8]!.bypass = [REPOSITORY_ADMIN, other]),
        /only Repository admin on the Bypass list of Restrict updates/,
      );
    }
    await notLocked(
      () => (gh.state.rulesets[8]!.bypass = []),
      /only Repository admin on the Bypass list of Restrict updates/,
    );
    // The token's account cannot skip it: the ERP's Merge (with that token) would not work.
    await notLocked(
      () => (gh.state.rulesets[8]!.canBypass = "never"),
      /Repository admin on the Bypass list of Restrict updates \(your token's GitHub account cannot merge now/,
    );
    await notLocked(
      () => (gh.state.rulesets[8]!.canBypass = null),
      /Restrict updates \(the ERP could not check who may skip it\)/,
    );
    // Both in one ruleset: the owner's own skip would also skip the pull request and checks.
    await notLocked(() => {
      gh.state.rulesets[7]!.rules.push("update");
      delete gh.state.rulesets[8];
    }, /Restrict updates in a ruleset of its own/);

    // The server asks GitHub itself each time, whatever the last test said.
    gh.state.rulesets = helpRulesets();
    expect((await tested()).ok).toBe(true);
    delete gh.state.rulesets[8];
    await expectAppError(ask(), "VALIDATION", /Lock main first/);
    expect((await getFullCheck(env.owner)).github.mainLocked).toBe(false);
    expect(gh.state.issues).toHaveLength(0);
    gh.state.rulesets = helpRulesets();
    const asked = await ask();
    expect(gh.state.issues.map((i) => i.number)).toEqual([asked.issueNumber]);
    expect((await getFullCheck(env.owner)).github.mainLocked).toBe(true);
    // The older branch protection is not asked for any more (it cannot let only the owner
    // update main on a personal repository).
    expect(gh.calls.some((c) => c.path.includes("/protection"))).toBe(false);
  });

  it("opens a check once, only with the pass and GitHub's proof from main, with its own check account per role", async () => {
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
    // Only the workflow as it is on main: never a copy changed on another branch.
    await expectAppError(
      beginCheck({
        run: id,
        pass: inputs.pass,
        proof: proof({
          workflow_ref: `${REPO}/.github/workflows/full-check.yml@refs/heads/try-something`,
          ref: "refs/heads/try-something",
        }),
      }),
      "FORBIDDEN",
      /main/,
    );
    await expectAppError(
      beginCheck({ run: id, pass: inputs.pass, proof: proof({ ref: "refs/heads/try-something" }) }),
      "FORBIDDEN",
      /main/,
    );

    // None of that used the pass up.
    const begun = await beginCheck({ run: id, pass: inputs.pass, proof: proof() });
    expect(begun.writes).toBe(false);
    expect(begun.minutes).toBe(25);
    expect(begun.roles[0]).toMatchObject({ role: "Owner", member: "Full check (Owner)" });
    // Every role is checked, with or without members; the Owner's role is the owner's view.
    const roles = await prisma.role.findMany({ where: { companyId: env.company.id } });
    const roleNames = begun.roles.map((r) => r.role);
    expect(roleNames.slice(1).sort()).toEqual(
      roles
        .filter((r) => r.systemRole !== "SUPER_ADMIN")
        .map((r) => r.name)
        .sort(),
    );
    expect(begun.notChecked).toEqual([]);
    for (const s of begun.roles) expect(s.cookie.startsWith("fullcheck.")).toBe(true);

    // Every session is a check account's (one per role), never a real person's login.
    const sessions = await prisma.session.findMany({ where: { userAgent: `Full check ${id}` } });
    expect(sessions).toHaveLength(begun.roles.length);
    const sessionOf = (role: string) =>
      sessions.find(
        (s) => s.token === hashSessionToken(begun.roles.find((r) => r.role === role)!.cookie),
      )!;
    const superAdmin = roles.find((r) => r.systemRole === "SUPER_ADMIN")!;
    const people = [env.owner.user.id, env.partner.user.id];
    for (const s of sessions) {
      const account = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
      expect(account.email).toBe(`check-${s.checkRoleId}@check.invalid`);
      expect(account).toMatchObject({ passwordHash: null, isSuperAdmin: false });
      expect(account.name).toMatch(/^Full check \(.+\)$/);
      expect(people).not.toContain(account.id);
      // It is no one's colleague: no membership, so no team list, inbox or role ever shows it.
      expect(await prisma.companyMembership.count({ where: { userId: account.id } })).toBe(0);
      expect(s.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(50 * 60_000);
    }
    expect(new Set(sessions.map((s) => s.userId)).size).toBe(sessions.length);
    const checkUser = await prisma.user.findUniqueOrThrow({
      where: { id: sessionOf("Checker").userId },
    });
    expect(checkUser.name).toBe("Full check (Checker)");
    expect(sessionOf("Owner")).toMatchObject({ checkRoleId: superAdmin.id, checkPlatform: true });
    expect(sessionOf("Checker")).toMatchObject({
      checkRoleId: env.checkerRole.id,
      checkPlatform: false,
    });

    // A check session sees exactly its role (and the owner's view the platform owner's).
    const owner = await validateSessionToken(begun.roles[0]!.cookie);
    expect(owner!.user.isSuperAdmin).toBe(true);
    const checker = await validateSessionToken(
      begun.roles.find((r) => r.role === "Checker")!.cookie,
    );
    expect(checker!.user.isSuperAdmin).toBe(false);
    const access = await resolveCompanyAccess(
      checker!.user,
      env.company.id,
      checker!.session.checkRoleId,
    );
    expect([...access!.permissions]).toEqual(["dashboard.view"]);
    expect(access!.role?.name).toBe("Checker");
    // A check session never writes, not even "last seen".
    const before = await prisma.session.update({
      where: { id: sessionOf("Checker").id },
      data: { lastSeenAt: new Date(Date.now() - 3_600_000) },
    });
    await validateSessionToken(begun.roles.find((r) => r.role === "Checker")!.cookie);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: before.id } })).lastSeenAt,
    ).toEqual(before.lastSeenAt);
    // The check account can never sign in or be added to a team.
    await expect(
      login({ email: checkUser.email, password: "anything-at-all-1" }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      addMember(env.owner, { email: checkUser.email, name: "Someone", roleId: superAdmin.id }),
    ).rejects.toBeInstanceOf(ZodError);

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
        roles: [
          { role: "Owner", member: "owner", screens: 140, pdfs: 12, skipped: 3, note: null },
          {
            role: "Accounts",
            member: "accounts",
            screens: 60,
            pdfs: 4,
            skipped: 0,
            notReached: 5,
            filesLeft: 0,
            stopped: false,
            note: "5 screens were not reached in the time.",
          },
        ],
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
    // It says what it did not reach in the time.
    expect(told.body).toContain("5 screens were not reached in the time.");
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
          screen: "/sales/orders?q=Rahim%20Textiles",
          pattern: "/sales/orders",
          text: "The screen showed an error for Rahim Textiles",
          detail: "ERR-123: ```boom``` Rahim Textiles owes 45,000",
          status: 500,
          errorType: "TypeError",
          stack: [
            "    at OrderRow (https://erp.test/_next/static/chunks/app-orders.js:1:2345)",
            "    at Rahim Textiles owes 45000",
            "    at f (https://evil.example/x.js:1:1)",
          ],
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
    // A name that shows if it leaks (the helper's is a plain word).
    await prisma.user.update({ where: { id: env.owner.user.id }, data: { name: "Mehadi Hasan" } });
    const sent = await sendFix(env.owner, { problemIds: [problemId] });
    const issue = gh.state.issues.find((i) => i.number === sent.issueNumber)!;
    expect(issue.body.startsWith("@claude ")).toBe(true);
    expect(issue.title).toBe("Full check: Error on /sales/orders");
    expect(issue.body).toContain("`/sales/orders`");
    // Only the screen's path, the error's type and code, the status and our own stack lines.
    expect(issue.body).toContain("ERR-123");
    expect(issue.body).toContain("500");
    expect(issue.body).toContain("TypeError");
    expect(issue.body).toContain("at OrderRow (/_next/static/chunks/app-orders.js:1:2345)");
    const company = await prisma.company.findUniqueOrThrow({ where: { id: env.company.id } });
    for (const leak of [
      "Rahim",
      "45,000",
      "45000",
      "boom",
      "evil.example",
      "owner@extas.test",
      company.name,
      "Mehadi",
    ]) {
      expect(issue.body, leak).not.toContain(leak);
      expect(issue.title, leak).not.toContain(leak);
    }
    // Claude Code works on the issue's own branch; the ERP opens the pull request.
    expect(issue.body).toContain(`claude/issue-${sent.issueNumber}-`);
    expect(issue.body).toContain("Never push to `main`");
    expect(issue.body).toContain("CLAUDE.md");
    // The problem's full detail and screenshot stay in the ERP, for the owner only.
    const kept = await prisma.fullCheckProblem.findUniqueOrThrow({ where: { id: problemId } });
    expect(kept).toMatchObject({ status: 500, errorType: "TypeError" });
    expect(kept.detail).toContain("boom");
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
    // Main is not locked any more: Claude Code is not asked again until it is (v6.4.1 B1).
    delete gh.state.rulesets[8];
    const unlocked = await look();
    expect(unlocked).toMatchObject({ checks: "failed", retries: 0 });
    expect(unlocked.note).toMatch(/Lock main first/);
    expect(gh.state.comments).toHaveLength(0);
    gh.state.rulesets = helpRulesets();
    expect(await look()).toMatchObject({ checks: "failed", retries: 1, note: null });
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
    await expectAppError(mergeFix(env.partner, gaveUp.id, { sha: "sha-3" }), "FORBIDDEN");
    const noPin = await expectAppError(
      mergeFix(env.owner, gaveUp.id, { sha: "sha-3" }),
      "VALIDATION",
    );
    expect(noPin.details?.pinNotSet).toBeTruthy();
    await setPin(env.owner, { pin: "2468" });
    await expectAppError(
      mergeFix(env.owner, gaveUp.id, { pin: "2468", sha: "sha-3" }),
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
      headSha: "sha-4",
      fix: {
        author: gh.state.tokenUser,
        openedByErp: true,
        files: [
          { name: "src/modules/sales/order.service.ts", added: 4, removed: 1, status: "modified" },
          { name: "tests/unit/order.test.ts", added: 20, removed: 0, status: "added" },
        ],
        filesTotal: 2,
        careful: [],
      },
    });
    expect(screen.problems.find((p) => p.id === problemId)!.request!.text).toBe(
      `Fix ready: merge PR #${pull.number}`,
    );

    const askPin = await expectAppError(
      mergeFix(env.owner, gaveUp.id, { sha: "sha-4" }),
      "VALIDATION",
    );
    expect(askPin.details?.pin).toBeTruthy();
    await expectAppError(
      mergeFix(env.owner, gaveUp.id, { pin: "1111", sha: "sha-4" }),
      "VALIDATION",
    );
    // Only the commit the owner looked at is merged.
    await expectAppError(
      mergeFix(env.owner, gaveUp.id, { pin: "2468", sha: "sha-3" }),
      "CONFLICT",
      /changed since you looked/,
    );
    expect(gh.state.merged).toEqual([]);
    const merged = await mergeFix(env.owner, gaveUp.id, { pin: "2468", sha: "sha-4" });
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
    const closedBranch = `claude/issue-${closed.issueNumber}-20261016-0200`;
    gh.state.branches.push(closedBranch);
    gh.state.pulls.push({
      number: 900,
      html_url: "https://github.com/pull/900",
      state: "closed",
      merged_at: null,
      title: "Show the cutting date",
      body: `Fixes #${closed.issueNumber}`,
      user: CLAUDE_BOT,
      head: { ref: closedBranch, sha: "sha-x", repo: { full_name: REPO } },
      base: { ref: "main" },
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

  it("offers a fix for merging only when Claude Code made it for that issue, from this repository, into main", async () => {
    await connect();
    const gitHub = { repo: REPO, token: gh.token };
    await setPin(env.owner, { pin: "2468" });
    const asked = async (text: string) => {
      const r = await askClaudeCode(env.owner, { text });
      return prisma.claudeCodeRequest.findFirstOrThrow({ where: { issueNumber: r.issueNumber } });
    };
    let next = 500;
    /** A pull request on GitHub (Claude Code's own, into main, unless told otherwise). */
    const pullFor = (branch: string, change: Partial<FakePull> = {}): FakePull => {
      const number = next++;
      const pull: FakePull = {
        number,
        html_url: `https://github.com/${REPO}/pull/${number}`,
        state: "open",
        merged_at: null,
        title: "A fix",
        body: null,
        user: CLAUDE_BOT,
        head: { ref: branch, sha: `sha-${number}`, repo: { full_name: REPO } },
        base: { ref: "main" },
        ...change,
      };
      gh.state.pulls.push(pull);
      gh.state.checks[pull.head.sha] = [
        { name: "Tests and build", status: "completed", conclusion: "success" },
      ];
      return pull;
    };
    const look = async (id: string) =>
      followRequest(gitHub, await prisma.claudeCodeRequest.findUniqueOrThrow({ where: { id } }));
    const shown = async (id: string) =>
      (await getFullCheck(env.owner)).requests.find((r) => r.id === id)!;

    // 1. A pull request that only names the issue ("Fixes #n") is never taken.
    const named = await asked("Show the buyer's country on the order screen.");
    pullFor("someone/feature", {
      user: { login: "stranger", type: "User" },
      title: `Fixes #${named.issueNumber}`,
      body: `Closes #${named.issueNumber}`,
    });
    expect(await look(named.id)).toMatchObject({ state: "SENT", prNumber: null });

    // 2. Claude Code's branch name copied in a fork is never taken either.
    const forked = await asked("Add a cutting date column to the batch list.");
    const forkBranch = `claude/issue-${forked.issueNumber}-20261016-0300`;
    pullFor(forkBranch, {
      user: { login: "stranger", type: "User" },
      head: { ref: forkBranch, sha: "sha-fork", repo: { full_name: "stranger/erp" } },
    });
    expect(await look(forked.id)).toMatchObject({ state: "SENT", prNumber: null });

    // 3. On Claude Code's branch, but someone else opened it, or it goes elsewhere, or
    //    has a commit that is not Claude Code's: shown, never offered for merging.
    const cases: Array<[string, Partial<FakePull> | null, RegExp]> = [
      [
        "opened by a person",
        { user: { login: "stranger", type: "User" } },
        /not opened by Claude Code/,
      ],
      ["into another branch", { base: { ref: "develop" } }, /not into main/],
      ["with a stranger's commit", null, /not Claude Code's/],
    ];
    for (const [what, change, why] of cases) {
      const r = await asked(`Make the stock list sortable (${what}).`);
      const branch = `claude/issue-${r.issueNumber}-20261016-0400`;
      gh.state.branches.push(branch);
      const pull = pullFor(branch, change ?? {});
      if (!change) {
        gh.state.pullCommits[pull.number] = [
          claudeCommit("sha-a"),
          {
            sha: pull.head.sha,
            author: { login: "stranger", type: "User" },
            committer: { login: "stranger", type: "User" },
            verified: false,
          },
        ];
      }
      const looked = await look(r.id);
      expect(looked, what).toMatchObject({
        state: "PR_OPEN",
        prNumber: pull.number,
        prVetted: false,
      });
      expect(looked.prProblem, what).toMatch(why);
      const view = await shown(r.id);
      expect(view.canMerge, what).toBe(false);
      expect(view.stateText, what).toMatch(/cannot be merged here/);
      await expectAppError(
        mergeFix(env.owner, r.id, { pin: "2468", sha: pull.head.sha }),
        "VALIDATION",
        /cannot be merged here/,
      );
      // The owner is never told it is ready.
      expect(
        await prisma.notificationLog.count({
          where: { entityId: r.id, subject: { startsWith: "Fix ready" } },
        }),
      ).toBe(0);
    }
    // The issue's number must match exactly: issue 5's branch is not issue 50's.
    const exact = await asked("Print the packing list in landscape.");
    gh.state.branches.push(`claude/issue-${exact.issueNumber}0-20261016-0500`);
    pullFor(`claude/issue-${exact.issueNumber}0-20261016-0500`);
    expect(await look(exact.id)).toMatchObject({ state: "SENT", prNumber: null });

    // 4. Claude Code's own pull request into main: the owner sees who made it and
    //    every changed file (with a warning on the ones that run or deploy the ERP).
    const good = await asked("Show the season on the tech pack list.");
    const branch = `claude/issue-${good.issueNumber}-20261016-0600`;
    gh.state.branches.push(branch);
    const pull = pullFor(branch);
    gh.state.pullFiles[pull.number] = [
      {
        filename: "src/components/production/tech-pack-list.tsx",
        status: "modified",
        additions: 12,
        deletions: 3,
      },
      { filename: ".github/workflows/deploy.yml", status: "modified", additions: 1, deletions: 1 },
    ];
    expect(await look(good.id)).toMatchObject({
      state: "PR_OPEN",
      prVetted: true,
      prProblem: null,
      prAuthor: "claude[bot]",
      prOpenedByErp: false,
      checks: "passed",
    });
    expect(await shown(good.id)).toMatchObject({
      canMerge: true,
      headSha: pull.head.sha,
      fix: {
        author: "claude[bot]",
        openedByErp: false,
        filesTotal: 2,
        careful: [".github/workflows/deploy.yml"],
      },
    });
    // Claude Code pushes again after the owner looked: the merge waits for a new look.
    const seen = pull.head.sha;
    pull.head.sha = "sha-newer";
    gh.state.checks["sha-newer"] = [
      { name: "Tests and build", status: "completed", conclusion: "success" },
    ];
    await expectAppError(
      mergeFix(env.owner, good.id, { pin: "2468", sha: seen }),
      "CONFLICT",
      /changed since you looked/,
    );
    expect(gh.state.merged).toEqual([]);
    // A stranger's commit pushed onto Claude Code's branch is caught at merge time too.
    gh.state.pullCommits[pull.number] = [
      {
        sha: "sha-newer",
        author: { login: "stranger", type: "User" },
        committer: { login: "stranger", type: "User" },
        verified: false,
      },
    ];
    await expectAppError(
      mergeFix(env.owner, good.id, { pin: "2468", sha: "sha-newer" }),
      "VALIDATION",
      /cannot be merged here/,
    );
    gh.state.pullCommits[pull.number] = [claudeCommit(seen), claudeCommit("sha-newer")];
    await look(good.id);
    await mergeFix(env.owner, good.id, { pin: "2468", sha: "sha-newer" });
    expect(gh.state.merged).toEqual([{ number: pull.number, sha: "sha-newer" }]);
  });

  it("counts a commit as Claude Code's only when its App committed it, or GitHub signed it for its App", async () => {
    const gitHub = { repo: REPO, token: gh.token };
    const issue = 77;
    const pull: FakePull = {
      number: 700,
      html_url: `https://github.com/${REPO}/pull/700`,
      state: "open",
      merged_at: null,
      title: "A fix",
      body: null,
      user: CLAUDE_BOT,
      head: {
        ref: `claude/issue-${issue}-20261016-0700`,
        sha: "sha-700",
        repo: { full_name: REPO },
      },
      base: { ref: "main" },
    };
    gh.state.pulls.push(pull);
    /** GitHub's own signer, the committer of what is made on github.com for someone. */
    const webFlow = { login: "web-flow", type: "User" };
    const stranger = { login: "stranger", type: "User" };
    const vet = async (
      author: FakeCommit["author"],
      committer: FakeCommit["committer"],
      verified = true,
    ) => {
      gh.state.pullCommits[pull.number] = [{ sha: pull.head.sha, author, committer, verified }];
      return vetPull(gitHub, pull as unknown as Parameters<typeof vetPull>[1], issue, false);
    };
    // Committed by Claude Code's App, signed by GitHub.
    expect(await vet(CLAUDE_BOT, CLAUDE_BOT)).toMatchObject({ ok: true, problem: null });
    // Made on github.com for the App (GitHub's signer commits it, the App is the author).
    expect(await vet(CLAUDE_BOT, webFlow)).toMatchObject({ ok: true, problem: null });
    // The App committed it, naming someone else as the author: still the App's commit.
    expect(await vet(stranger, CLAUDE_BOT)).toMatchObject({ ok: true, problem: null });
    // Anyone can write the App's name as the author: a person's own commit is not the App's.
    expect(await vet(CLAUDE_BOT, stranger)).toMatchObject({
      ok: false,
      problem: "a change in it is not Claude Code's (stranger, commit sha-700)",
    });
    // A person's edit on github.com (GitHub's signer, the person as the author).
    expect(await vet(stranger, webFlow)).toMatchObject({
      ok: false,
      problem: "a change in it is not Claude Code's (stranger, commit sha-700)",
    });
    // Nobody GitHub knows as the committer, or not verified: never.
    expect((await vet(CLAUDE_BOT, null)).ok).toBe(false);
    expect((await vet(CLAUDE_BOT, CLAUDE_BOT, false)).ok).toBe(false);
    expect((await vet(CLAUDE_BOT, webFlow, false)).ok).toBe(false);
  });
});
