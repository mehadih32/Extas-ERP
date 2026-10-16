import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CHECK_TOKEN_PREFIX, checkMayDo, isCheckToken } from "@/lib/auth/check-token";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import {
  askIssue,
  FIX_CHECKS_COMMENT,
  fixIssue,
  KIND_TEXT,
  PROBLEM_KINDS,
  pullBody,
  requestText,
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
    for (const method of ["GET", "HEAD", "OPTIONS"])
      expect(checkMayDo(method, token, false)).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(checkMayDo(method, token, false), method).toBe(false);
      expect(checkMayDo(method, token, true), method).toBe(true);
      // Everyone else is untouched.
      expect(checkMayDo(method, "an-ordinary-session", false), method).toBe(true);
      expect(checkMayDo(method, undefined, false), method).toBe(true);
    }
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

  it("start with @claude, name the screens, and ask for a test and a pull request", () => {
    const one = fixIssue({
      problems: [problem],
      site: "https://erp.test",
      company: "Extas",
      by: "Mehadi",
      at: "2026-10-16 05:00 UTC",
      runId: "run1",
    });
    expect(one.title).toBe(
      "Full check: A link leads to a page that does not exist (404) (/help/production-batches)",
    );
    expect(one.body.startsWith("@claude please fix this problem")).toBe(true);
    expect(one.body).toContain("seen as the Accounts role");
    expect(one.body).toContain("(screen `/help/[slug]`)");
    // A fence in the detail cannot break out of its block.
    expect(one.body).toContain("'''");
    expect(one.body).toContain("Add a test that fails without the fix");
    expect(one.body).toContain("src/modules/help/content");
    expect(one.body).toContain("Never delete data");
    expect(one.body).toContain("Do not merge it");

    const many = fixIssue({
      problems: [problem, { ...problem, kind: "SLOW", ms: 7200, screen: "/accounts" }],
      site: "https://erp.test",
      company: "Extas",
      by: "Mehadi",
      at: "2026-10-16 05:00 UTC",
      runId: "run1",
    });
    expect(many.title).toBe("Full check: fix 2 problems found on 2026-10-16");
    expect(many.body).toContain("(7.2 s)");

    const ask = askIssue({
      text: `${"x".repeat(120)}\nmore`,
      site: "https://erp.test",
      company: "Extas",
      by: "Mehadi",
      at: "now",
    });
    expect(ask.title).toBe(`ERP request: ${"x".repeat(90)}...`);
    expect(ask.body.startsWith("@claude please build this request")).toBe(true);
    expect(FIX_CHECKS_COMMENT.startsWith("@claude ")).toBe(true);
    expect(FIX_CHECKS_COMMENT).toContain("Do not skip or switch off a test");
    expect(pullBody(12).startsWith("Fixes #12\n")).toBe(true);
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

  it("Claude Code: answers @claude from people with write access, never a bot", () => {
    const yml = read(".github/workflows/claude.yml");
    expect(yml).toContain("uses: anthropics/claude-code-action@v1");
    expect(yml).toContain("claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}");
    expect(yml).toMatch(/issues:\n\s+types: \[opened\]/);
    expect(yml).toMatch(/issue_comment:\n\s+types: \[created\]/);
    expect(yml).toContain("contains(github.event.issue.body, '@claude')");
    expect(yml).toContain("id-token: write");
    expect(yml).toContain("TEST_DATABASE_URL:");
    // No bot may start it.
    expect(yml).not.toMatch(/^\s+allowed_bots:/m);
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
