import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CHECK_NEVER_ROUTES,
  CHECK_READ_ROUTES,
  CHECK_TOKEN_PREFIX,
  checkMayDo,
  isCheckToken,
} from "@/lib/auth/check-token";
import { checkSessionReadOnly } from "@/lib/read-only";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import {
  askIssue,
  carefulFiles,
  errorTypeOf,
  FIX_CHECKS_COMMENT,
  fixIssue,
  KIND_TEXT,
  ourStackLines,
  CHECK_MINUTES,
  PROBLEM_KINDS,
  pullBody,
  noProblemsText,
  reportMessage,
  requestText,
  safeRoute,
} from "@/modules/ai/full-check/texts";
import { config } from "@/proxy";

/*
 * v6.3 G: the Full check's rules that need no database. Its sessions only read
 * on the live site (the proxy runs on the API for them alone, by the session
 * cookie), the issues the ERP opens wake Claude Code ("@claude"), and the two
 * workflows are set up so the ERP really can start them.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("Full check sessions", () => {
  it("only read on the live site, and may write on the demo site", () => {
    const token = `${CHECK_TOKEN_PREFIX}abc`;
    expect(isCheckToken(token)).toBe(true);
    expect(isCheckToken("abc")).toBe(false);
    expect(isCheckToken(undefined)).toBe(false);
    for (const method of ["GET", "HEAD"]) expect(checkMayDo(method, token, false, "/")).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(checkMayDo(method, token, false, "/sales"), method).toBe(false);
      expect(checkMayDo(method, token, true, "/sales"), method).toBe(true);
      // Everyone else is untouched.
      expect(checkMayDo(method, "an-ordinary-session", false, "/sales"), method).toBe(true);
      expect(checkMayDo(method, undefined, false, "/sales"), method).toBe(true);
    }
    // The server refuses their writes too, whatever the route (lib/read-only.ts).
    expect(checkSessionReadOnly(token, false)).toBe(true);
    expect(checkSessionReadOnly(token, true)).toBe(false);
    expect(checkSessionReadOnly("an-ordinary-session", false)).toBe(false);
    expect(checkSessionReadOnly(undefined, false)).toBe(false);
  });

  it("on the live site reach only screens and the API's read-only routes (deny by default)", () => {
    const token = `${CHECK_TOKEN_PREFIX}abc`;
    expect(checkMayDo("GET", token, false, "/sales/orders")).toBe(true);
    expect(checkMayDo("GET", token, false, "/api/accounts/reports/trial-balance")).toBe(true);
    expect(checkMayDo("GET", token, false, "/api/production/projects/cm1x/tech-pack")).toBe(true);
    expect(checkMayDo("HEAD", token, false, "/api/materials/purchase-orders/cm2y/pdf")).toBe(true);
    // A GET that starts something, or hands out a whole backup: never, not even on the demo site.
    for (const path of [
      "/api/backups/google/connect",
      "/api/backups/runs/cm3z/download",
      "/api/bot/whatsapp/webhook",
    ]) {
      expect(checkMayDo("GET", token, false, path), path).toBe(false);
      expect(checkMayDo("GET", token, true, path), path).toBe(false);
    }
    // A route nobody listed is refused until it is.
    expect(checkMayDo("GET", token, false, "/api/something-new")).toBe(false);
    expect(checkMayDo("GET", token, false, "/api/accounts/reports/trial-balance/../x")).toBe(false);
    expect(checkMayDo("POST", token, false, "/api/accounts/journal")).toBe(false);
    // Everyone else is untouched.
    expect(checkMayDo("GET", "x", false, "/api/backups/google/connect")).toBe(true);
  });

  it("know every API route that answers GET: read-only for the check, or never", () => {
    const api = path.join(root, "src/app/api");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name === "route.ts" &&
          /export (const|async function|function) GET\b/.test(readFileSync(full, "utf8"))
        )
          routes.push(`/api${path.dirname(full).slice(api.length).split(path.sep).join("/")}`);
      }
    };
    walk(api);
    expect(routes.length).toBeGreaterThan(200);
    const never = CHECK_NEVER_ROUTES.map((n) => n.route);
    for (const route of routes) {
      expect(
        CHECK_READ_ROUTES.includes(route) !== never.includes(route),
        `${route}: list it in CHECK_READ_ROUTES (it only reads) or CHECK_NEVER_ROUTES (lib/auth/check-token.ts)`,
      ).toBe(true);
    }
    for (const route of [...CHECK_READ_ROUTES, ...never]) expect(routes, route).toContain(route);
    for (const n of CHECK_NEVER_ROUTES) expect(n.why.length, n.route).toBeGreaterThan(10);
  });

  it("are caught on the API by the session cookie alone (others' uploads never pass the proxy)", () => {
    const [screens, api] = config.matcher as [
      string,
      { source: string; has: Array<{ type: string; key: string; value: string }> },
    ];
    expect(screens).toContain("(?!api/");
    expect(api.source).toBe("/api/:path*");
    expect(api.has).toHaveLength(1);
    expect(api.has[0]!.type).toBe("cookie");
    expect(api.has[0]!.key).toBe(SESSION_COOKIE);
    // Next.js matches the value as ^value$.
    const value = new RegExp(`^${api.has[0]!.value}$`);
    expect(value.test(`${CHECK_TOKEN_PREFIX}Zx9_-abc`)).toBe(true);
    expect(value.test("Zx9_-abc")).toBe(false);
    expect(value.test("xfullcheck.abc")).toBe(false);
  });
});

describe("Claude Code issues", () => {
  const problem = {
    role: "Accounts",
    kind: "BROKEN_LINK" as const,
    screen: "/help/production-batches",
    pattern: "/help/[slug]",
    text: "A link leads to a page that does not exist (404)",
    detail: "GET /production/projects/[projectId] answered 404\n```",
    ms: null,
  };

  it("start with @claude, name the screens, and ask for a test, on the issue's own branch", () => {
    const one = fixIssue({
      problems: [problem],
      site: "live",
      at: "2026-10-16 05:00 UTC",
      runId: "run1",
      issue: 41,
    });
    expect(one.title).toBe("Full check: Broken link on /help/[slug]");
    expect(one.body.startsWith("@claude please fix this problem")).toBe(true);
    expect(one.body).toContain("`/help/[slug]`");
    expect(one.body).toContain("GET /production/projects/[projectId] answered 404");
    expect(one.body).toContain("Add a test that fails without the fix");
    expect(one.body).toContain("src/modules/help/content");
    expect(one.body).toContain("Never delete data");
    expect(one.body).toContain("Never push to `main`");
    expect(one.body).toContain("claude/issue-41-");
    expect(one.body).toContain("CLAUDE.md");
    // The role, the site's address and who sent it stay in the ERP.
    expect(one.body).not.toContain("Accounts");
    expect(one.body).not.toContain("https://");

    const many = fixIssue({
      problems: [
        problem,
        { ...problem, kind: "SLOW", ms: 7200, screen: "/accounts", pattern: null },
      ],
      site: "live",
      at: "2026-10-16 05:00 UTC",
      runId: "run1",
      issue: 42,
    });
    expect(many.title).toBe("Full check: fix 2 problems found on 2026-10-16");
    expect(many.body).toContain("(7.2 s)");

    const ask = askIssue({ text: `${"x".repeat(120)}\nmore`, site: "live", at: "now", issue: 43 });
    expect(ask.title).toBe(`ERP request: ${"x".repeat(90)}...`);
    expect(ask.body.startsWith("@claude please build this request")).toBe(true);
    expect(FIX_CHECKS_COMMENT.startsWith("@claude ")).toBe(true);
    expect(FIX_CHECKS_COMMENT).toContain("Do not skip or switch off a test");
    expect(pullBody(12).startsWith("Fixes #12\n")).toBe(true);
  });

  it("carry no screen text or business data: only paths, status codes, error types and our own stack lines", () => {
    expect(safeRoute("/sales/orders/cm4x1y2z3a4b5c6d7e8f9g0h1?q=Rahim%20Textiles#top")).toBe(
      "/sales/orders/[id]",
    );
    expect(safeRoute("/parties/Rahim%20Textiles/statement")).toBe("/parties/[id]/statement");
    expect(safeRoute("/production/projects/[projectId]/tech-pack")).toBe(
      "/production/projects/[projectId]/tech-pack",
    );
    expect(safeRoute("/help/production/production-batches")).toBe(
      "/help/production/production-batches",
    );
    expect(safeRoute("/sales/orders/SO-2026-00042")).toBe("/sales/orders/[id]");
    expect(safeRoute("/hr/payroll/2026-10")).toBe("/hr/payroll/[id]");
    expect(safeRoute("not a path")).toBe("(a screen)");
    expect(errorTypeOf("TypeError")).toBe("TypeError");
    expect(errorTypeOf("PrismaClientKnownRequestError")).toBe("PrismaClientKnownRequestError");
    expect(errorTypeOf("Rahim owes 45000")).toBeNull();
    expect(
      ourStackLines([
        "TypeError: Cannot read properties of undefined (reading 'Rahim')",
        "    at OrderRow (https://erp.extasbd.com/_next/static/chunks/app-1a2b.js:1:2345)",
        "    at https://erp.extasbd.com/_next/static/chunks/main.js:2:10",
        "    at Rahim Textiles owes 45000",
        "    at f (https://cdn.other.com/x.js:1:1)",
        "    at async load (/app/.next/server/chunks/ssr/src_modules_x.js:10:5)",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
        "    at Object.query (/app/node_modules/@prisma/client/runtime/library.js:1:2)",
      ]),
    ).toEqual([
      "at OrderRow (/_next/static/chunks/app-1a2b.js:1:2345)",
      "at /_next/static/chunks/main.js:2:10",
      "at async load (/.next/server/chunks/ssr/src_modules_x.js:10:5)",
    ]);
    // Files that run or install the ERP get a warning before Merge.
    expect(
      carefulFiles([
        "src/modules/sales/order.service.ts",
        ".github/workflows/deploy.yml",
        "deploy/deploy.sh",
        "Dockerfile",
        "package.json",
        "package-lock.json",
        "prisma/migrations/20261201090000_x/migration.sql",
        "CLAUDE.md",
        ".claude/settings.json",
        "src/proxy.ts",
      ]),
    ).toEqual([
      ".github/workflows/deploy.yml",
      "deploy/deploy.sh",
      "Dockerfile",
      "package.json",
      "package-lock.json",
      "prisma/migrations/20261201090000_x/migration.sql",
      "CLAUDE.md",
      ".claude/settings.json",
      "src/proxy.ts",
    ]);
  });

  it("says where each request stands in plain words", () => {
    const at = { issueNumber: 5, prNumber: 9, checks: null, note: null };
    expect(requestText({ ...at, state: "SENT" })).toBe("Claude Code is working on it (issue #5)");
    expect(requestText({ ...at, state: "PR_OPEN" })).toBe("The checks are running on PR #9");
    expect(requestText({ ...at, state: "PR_OPEN", checks: "passed" })).toBe(
      "Fix ready: merge PR #9",
    );
    expect(requestText({ ...at, state: "PR_OPEN", checks: "failed" })).toMatch(/asked to fix them/);
    expect(requestText({ ...at, state: "MERGED" })).toBe(
      "Merged PR #9: the safe update installs it",
    );
    expect(requestText({ ...at, state: "STOPPED", note: "Closed." })).toBe("Closed.");
    // A pull request that is not Claude Code's own work is never "ready".
    expect(
      requestText({
        ...at,
        state: "PR_OPEN",
        checks: "passed",
        prVetted: false,
        prProblem: "it was not opened by Claude Code",
      }),
    ).toBe("PR #9 cannot be merged here: it was not opened by Claude Code");
    for (const kind of PROBLEM_KINDS) expect(KIND_TEXT[kind]).toBeTruthy();
  });
});

describe("The workflows", () => {
  it("Full check: started by the ERP with a pass, proves itself to the ERP, runs the crawler", () => {
    const yml = read(".github/workflows/full-check.yml");
    expect(yml).toMatch(/workflow_dispatch:\n\s+inputs:\n\s+site:/);
    for (const input of ["site:", "run:", "pass:"]) expect(yml).toContain(`      ${input}`);
    expect(yml).toContain("id-token: write");
    expect(yml).toContain("contents: read");
    expect(yml).toContain('echo "::add-mask::$PASS"');
    expect(yml).toContain("node scripts/full-check/crawl.mjs");
    expect(yml).toContain("run-name: Full check ${{ inputs.run }}");
    // Inputs reach the script through the environment, never pasted into a shell line.
    for (const line of yml.split("\n").filter((l) => /^\s+run:|^\s{10}\S/.test(l))) {
      expect(line).not.toMatch(/\$\{\{\s*inputs\./);
    }
    const crawler = JSON.parse(read("scripts/full-check/package.json")) as {
      dependencies: Record<string, string>;
    };
    const root = JSON.parse(read("package.json")) as { devDependencies?: Record<string, string> };
    expect(crawler.dependencies.playwright).toMatch(/^\d+\.\d+\.\d+$/);
    if (root.devDependencies?.playwright) {
      expect(root.devDependencies.playwright.replace(/^\D/, "")).toBe(
        crawler.dependencies.playwright,
      );
    }
  });

  it("Claude Code: answers @claude from the owner only, never a bot, and can never push to main", () => {
    const yml = read(".github/workflows/claude.yml");
    expect(yml).toContain("uses: anthropics/claude-code-action@v1");
    expect(yml).toContain("claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}");
    expect(yml).toMatch(/issues:\n\s+types: \[opened\]/);
    expect(yml).toMatch(/issue_comment:\n\s+types: \[created\]/);
    expect(yml).toContain("contains(github.event.issue.body, '@claude')");
    expect(yml).toContain("github.actor == github.repository_owner");
    expect(yml).toContain("id-token: write");
    expect(yml).toContain("TEST_DATABASE_URL:");
    // No bot may start it.
    expect(yml).not.toMatch(/^\s+allowed_bots:/m);
    // Its commits go through GitHub's API onto its own branch; git itself cannot write.
    expect(yml).toContain("use_commit_signing: true");
    expect(yml).toContain("persist-credentials: false");
    expect(yml).toMatch(/permissions:\n\s+contents: read\n/);
    const allowed = /--allowedTools "([^"]+)"/.exec(yml)![1]!.split(",");
    // Nothing that could write to GitHub or run a shell of its own.
    for (const tool of allowed) {
      expect(tool).not.toMatch(/^Bash\((find|curl|wget|gh|bash|sh|env|xargs|node)\b/);
    }
    for (const tool of allowed.filter((t) => t.startsWith("Bash(git"))) {
      expect(tool).toMatch(/^Bash\(git (status|diff|log|show)(:\*)?\)$/);
    }
    expect(allowed).not.toContain("Bash(git:*)");
    expect(allowed).not.toContain("Bash(find:*)");
    const denied = /--disallowedTools "([^"]+)"/.exec(yml)![1]!.split(",");
    expect(denied).toContain("Bash(git push:*)");
  });

  it("Full check: knows the error window by its code box, not by the words a guide quotes", () => {
    const crawler = read("scripts/full-check/crawl.mjs");
    expect(crawler).toContain(`page.$('[data-testid="error-code"]')`);
    expect(crawler).not.toMatch(/Something went wrong/);
    expect(read("src/components/feedback/error-dialog.tsx")).toContain('data-testid="error-code"');
    // A download that is an HTML file (a document template) is not a web page in its place.
    expect(crawler).toContain(
      '!/attachment/i.test(response.headers()["content-disposition"] ?? "")',
    );
    // The guide on errors quotes them, which the first run took for an error.
    expect(read("src/modules/help/content/getting-started.ts")).toContain("“Something went wrong”");
  });
});

describe("The Full check's message to the owner", () => {
  const role = (o: Partial<{ notReached: number; filesLeft: number; stopped: boolean }> = {}) => ({
    role: "Owner",
    member: "Full check (Owner)",
    screens: 100,
    pdfs: 10,
    skipped: 0,
    notReached: 0,
    filesLeft: 0,
    stopped: false,
    ...o,
  });
  const summary = (roles: ReturnType<typeof role>[]) => ({
    roles,
    screens: 584,
    pdfs: 2,
    links: 4000,
    seconds: 600,
  });

  it("says every screen opened only when every screen and file was reached", () => {
    expect(reportMessage(summary([role(), role()]), 0)).toEqual({
      subject: "Full check: no problems found",
      body: "Every screen opened as the owner and as each role (584 screens, 2 PDFs and files checked).",
    });
  });

  it("says how much it did not reach in the time, and never says every screen then", () => {
    const short = reportMessage(
      summary([role({ notReached: 300, filesLeft: 4 }), role({ notReached: 17 })]),
      0,
    );
    expect(short.subject).toBe("Full check: no problems found in what it reached");
    expect(short.body).toBe(
      "It checked 584 screens and 2 PDFs and files as the owner and each role, but 317 screens and 4 PDFs and files were not reached in the time. Start it again to check the rest.",
    );
    expect(short.body).not.toMatch(/every screen/i);
    const stopped = reportMessage(summary([role(), role({ stopped: true })]), 0);
    expect(stopped.body).toBe(
      "It checked 584 screens and 2 PDFs and files as the owner and each role, but 1 role stopped before the end (see AI Center > Full check). Start it again to check the rest.",
    );
    const found = reportMessage(summary([role({ notReached: 1 })]), 3);
    expect(found.subject).toBe("Full check: 3 problems found");
    expect(found.body).toBe(
      "Read them, with screenshots, in AI Center > Full check; send them to Claude Code from there. 1 screen was not reached in the time.",
    );
  });

  it("says the same on the Full check screen as in the inbox", () => {
    expect(noProblemsText(summary([role(), role()]))).toBe(
      "No problems: every screen opened as each role.",
    );
    expect(noProblemsText(summary([role({ notReached: 317 })]))).toBe(
      "No problems in what it reached. It checked 584 screens and 2 PDFs and files as the owner and each role, but 317 screens were not reached in the time. Start it again to check the rest.",
    );
    expect(noProblemsText(null)).toBe("No problems found.");
    const screen = read("src/components/ai/full-check-screen.tsx");
    expect(screen).toContain("noProblemsText(shown.summary)");
    expect(screen).not.toContain("No problems: every screen opened as each role.");
  });

  it("reads a report from an older crawler, which did not count what it missed", () => {
    const old = { ...summary([]), roles: [{ ...role(), notReached: undefined }] };
    expect(reportMessage(old, 0).subject).toBe("Full check: no problems found");
  });

  it("gives a full pass its time, and the workflow more than that", () => {
    // A full pass took about 15 minutes on a copy of the demo data.
    expect(CHECK_MINUTES).toBeGreaterThanOrEqual(20);
    const yml = read(".github/workflows/full-check.yml");
    const timeout = Number(/timeout-minutes: (\d+)/.exec(yml)![1]);
    // Installing the browser and sending the report take a few minutes more.
    expect(timeout).toBeGreaterThanOrEqual(CHECK_MINUTES + 10);
    const crawler = read("scripts/full-check/crawl.mjs");
    // Downloads are fetched while the screens are crawled, not left for the end.
    expect(crawler).toMatch(/pendingDownloads\.shift\(\)/);
  });
});
