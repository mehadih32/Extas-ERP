/*
 * The Full check's words: what each kind of problem means, where a Claude
 * Code request stands, and the GitHub issues the ERP opens for the Claude Code
 * GitHub Action (they start with @claude, which is what wakes it). Plain data
 * and functions.
 */

export const PROBLEM_KINDS = [
  "ERROR",
  "BROKEN_LINK",
  "FAILED_REQUEST",
  "SLOW",
  "PDF",
  "SIGNED_OUT",
  "SCRIPT",
] as const;

export type ProblemKind = (typeof PROBLEM_KINDS)[number];

export const KIND_TEXT: Record<ProblemKind, string> = {
  ERROR: "The screen showed an error",
  BROKEN_LINK: "A link leads to a page that does not exist",
  FAILED_REQUEST: "Part of the screen did not load",
  SLOW: "The screen was slow",
  PDF: "A PDF did not open",
  SIGNED_OUT: "The check was sent to the sign-in screen",
  SCRIPT: "The screen had a script error",
};

export type RequestView = {
  state: "SENT" | "PR_OPEN" | "MERGED" | "STOPPED";
  issueNumber: number | null;
  prNumber: number | null;
  checks: string | null;
  note: string | null;
};

/** Where a Claude Code request stands, in plain words. */
export function requestText(r: RequestView): string {
  switch (r.state) {
    case "SENT":
      return r.note ?? `Claude Code is working on it (issue #${r.issueNumber ?? "?"})`;
    case "PR_OPEN":
      if (r.checks === "passed") return `Fix ready: merge PR #${r.prNumber}`;
      if (r.checks === "failed") {
        return r.note ?? `The checks failed on PR #${r.prNumber}: Claude Code is asked to fix them`;
      }
      return `The checks are running on PR #${r.prNumber}`;
    case "MERGED":
      return `Merged PR #${r.prNumber}: the safe update installs it`;
    case "STOPPED":
      return r.note ?? "Stopped";
  }
}

export type IssueProblem = {
  role: string;
  kind: ProblemKind;
  screen: string;
  pattern: string | null;
  text: string;
  detail: string | null;
  ms: number | null;
};

const HOW_TO = [
  "### How to do it",
  "- Find the cause in the code and fix it. Keep the change small.",
  "- Add a test that fails without the fix, so it cannot come back.",
  "- If a screen, button or label changes, update its Bengali guide in `src/modules/help/content` in the same change (`tests/unit/help-center.test.ts` checks the guides).",
  "- Never delete data, and keep every rule about permissions, the PIN and buyers as it is.",
  "- Run `npm run typecheck`, `npm run lint`, `npm run format:check` and the tests you touched (`TEST_DATABASE_URL` is set).",
  "- Push to your branch and open a pull request into the main branch whose description starts with `Fixes #` and this issue's number. Do not merge it: the owner merges it from the ERP, and the Deploy workflow installs it safely.",
].join("\n");

const fence = (text: string) => `\`\`\`\n${text.replaceAll("```", "'''")}\n\`\`\``;

/** The issue for "Fix with Claude Code" (one problem, or "Fix all"). */
export function fixIssue(input: {
  problems: IssueProblem[];
  site: string;
  company: string;
  by: string;
  at: string;
  runId: string;
}): { title: string; body: string } {
  const { problems } = input;
  const one = problems.length === 1 ? problems[0]! : null;
  const title = one
    ? `Full check: ${one.text} (${one.screen})`.slice(0, 200)
    : `Full check: fix ${problems.length} problems found on ${input.at.slice(0, 10)}`;
  const list = problems
    .map((p, i) =>
      [
        `${i + 1}. **${p.text}** on \`${p.screen}\`${p.pattern && p.pattern !== p.screen ? ` (screen \`${p.pattern}\`)` : ""}, seen as the ${p.role} role.`,
        `   ${KIND_TEXT[p.kind]}${p.ms ? ` (${(p.ms / 1000).toFixed(1)} s)` : ""}.`,
        ...(p.detail ? [fence(p.detail).replace(/^/gm, "   ")] : []),
      ].join("\n"),
    )
    .join("\n");
  const body = [
    `@claude please fix ${one ? "this problem" : "these problems"}, found by the ERP's Full check on ${input.site}.`,
    "",
    "### What the Full check found",
    list,
    "",
    HOW_TO,
    "",
    `_Sent from ${input.company}'s ERP (AI Center > Full check) by ${input.by} on ${input.at}, Full check ${input.runId}._`,
  ].join("\n");
  return { title, body };
}

/** The issue for "Ask Claude Code": a new request in plain words. */
export function askIssue(input: {
  text: string;
  site: string;
  company: string;
  by: string;
  at: string;
}): { title: string; body: string } {
  const first = input.text.split("\n")[0]!.trim();
  const title = `ERP request: ${first.length > 90 ? `${first.slice(0, 90)}...` : first}`;
  const body = [
    `@claude please build this request from the owner of the ERP at ${input.site}. Read it with the code: if it is unclear or would break a rule, say so in a comment on this issue instead of guessing.`,
    "",
    "### The request",
    input.text.trim(),
    "",
    HOW_TO,
    "",
    `_Sent from ${input.company}'s ERP (AI Center > Full check > Ask Claude Code) by ${input.by} on ${input.at}._`,
  ].join("\n");
  return { title, body };
}

/** The ERP's comment when a pull request's checks failed (Claude Code answers @claude). */
export const FIX_CHECKS_COMMENT = [
  "@claude the checks failed on this pull request. Read the failing check's log, fix the cause in this branch and push again. Do not skip or switch off a test.",
  "",
  "_Sent by the ERP (AI Center > Full check)._",
].join("\n");

/** The body of the pull request the ERP opens when Claude Code only pushed a branch. */
export const pullBody = (issue: number) =>
  [
    `Fixes #${issue}`,
    "",
    "Claude Code's fix for the issue above, opened by the ERP (AI Center > Full check). The owner merges it from the ERP; the Deploy workflow then installs it safely.",
  ].join("\n");
