/*
 * The Full check's words: what each kind of problem means, where a Claude
 * Code request stands, and the GitHub issues the ERP opens for the Claude Code
 * GitHub Action (they start with @claude, which is what wakes it). Plain data
 * and functions.
 *
 * An issue can be read by others on GitHub, so it carries no screen text and
 * no business data (v6.4 A2): only the screen's path (ids taken out), the kind
 * of problem, the status code, the error's type and code, and stack lines from
 * the ERP's own code. The rest, and the screenshots, stay in the ERP.
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

/** The short label on each problem's badge. */
export const KIND_LABEL: Record<ProblemKind, string> = {
  ERROR: "Error",
  BROKEN_LINK: "Broken link",
  FAILED_REQUEST: "Did not load",
  SLOW: "Slow",
  PDF: "PDF",
  SIGNED_OUT: "Signed out",
  SCRIPT: "Script error",
};

export type RequestView = {
  state: "SENT" | "PR_OPEN" | "MERGED" | "STOPPED";
  issueNumber: number | null;
  prNumber: number | null;
  checks: string | null;
  note: string | null;
  /** Whether the pull request was found to be Claude Code's own fix (left out: not asked). */
  prVetted?: boolean;
  prProblem?: string | null;
};

/** Where a Claude Code request stands, in plain words. */
export function requestText(r: RequestView): string {
  switch (r.state) {
    case "SENT":
      return r.note ?? `Claude Code is working on it (issue #${r.issueNumber ?? "?"})`;
    case "PR_OPEN":
      if (r.prVetted === false) {
        return r.prProblem
          ? `PR #${r.prNumber} cannot be merged here: ${r.prProblem}`
          : `Looking at PR #${r.prNumber}: who made it and what it changes`;
      }
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
  kind: ProblemKind;
  screen: string;
  pattern: string | null;
  detail: string | null;
  ms: number | null;
  status?: number | null;
  errorType?: string | null;
  stack?: string[] | null;
};

// ---------------------------------------------------------------- what may leave the ERP

/** A path segment that is a word of the ERP's own (a screen's name), not an id or a name. */
const WORD = /^[a-z]+(-[a-z]+)*$/;
/** A word of the ERP's own: short, or hyphenated ("receivables-payables"); a long run of letters is an id. */
const isWord = (part: string) => WORD.test(part) && part.length <= (part.includes("-") ? 60 : 20);
/** A route pattern's placeholder: "[projectId]". */
const PLACEHOLDER = /^\[[A-Za-z]+\]$/;

/**
 * A screen's path with everything that could be data taken out: the query and
 * the hash go, and every part that is not a plain lower-case word of the ERP's
 * own (an id, a number, a name typed in an address) becomes "[id]".
 */
export function safeRoute(path: string): string {
  const bare = path.split(/[?#]/)[0]!.trim();
  if (!bare.startsWith("/")) return "(a screen)";
  const parts = bare
    .split("/")
    .slice(1)
    .filter(Boolean)
    .map((part) => (PLACEHOLDER.test(part) || isWord(part) ? part : "[id]"));
  return `/${parts.join("/")}`;
}

/** An error's type ("TypeError"), never its message. */
export function errorTypeOf(value: string | null | undefined): string | null {
  const v = value?.trim() ?? "";
  return /^[A-Z][A-Za-z0-9]{1,60}$/.test(v) ? v : null;
}

/** "at name (" … the frame's own name, when it is a plain code name. */
const FRAME = /^at (?:(async )?([\w$.<>[\]]{1,80}) \()?(.+?):(\d+):(\d+)\)?$/;

/**
 * The stack lines from the ERP's own code (its browser chunks under /_next/,
 * and its server build), with the site's address taken off: never a library's,
 * Node's own, another site's, or anything that is not a stack line.
 */
export function ourStackLines(lines: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of lines ?? []) {
    const m = FRAME.exec(raw.trim());
    if (!m) continue;
    const [, isAsync, name, where, line, column] = m;
    let file: string;
    try {
      file = /^https?:\/\//.test(where!) ? new URL(where!).pathname : where!;
    } catch {
      continue;
    }
    file = file.replace(/^.*?(\/\.next\/|\/_next\/)/, "$1");
    if (!/^\/(_next|\.next)\/[\w./-]+$/.test(file) || file.includes("node_modules")) continue;
    out.push(
      `at ${isAsync ?? ""}${name ? `${name} (` : ""}${file}:${line}:${column}${name ? ")" : ""}`,
    );
    if (out.length >= 12) break;
  }
  return out;
}

/** "GET /x answered 500" lines of a problem's detail, with their paths made safe. */
function requestLines(detail: string | null): string[] {
  const out: string[] = [];
  for (const line of (detail ?? "").split("\n")) {
    const link = /^Link: (\S+) \(on (\S+)\)$/.exec(line.trim());
    if (link) {
      out.push(`a link to ${safeRoute(link[1]!)} on ${safeRoute(link[2]!)}`);
      continue;
    }
    const m =
      /^(GET|HEAD|POST|PUT|PATCH|DELETE) (\S+) (answered (\d{3})|took (\d+) ms|failed|sent a file that is not a PDF|sent a web page instead of the file)/.exec(
        line.trim(),
      );
    if (!m) continue;
    const what = m[4]
      ? `answered ${m[4]}`
      : m[5]
        ? `took ${m[5]} ms`
        : m[3]!.startsWith("failed")
          ? "did not answer"
          : m[3]!;
    out.push(`${m[1]} ${safeRoute(m[2]!)} ${what}`);
    if (out.length >= 8) break;
  }
  return out;
}

/** The ERP's error code shown on the screen ("ERR-7F3K9Q2M"): what support looks up in the log. */
const errorCodeIn = (detail: string | null) =>
  /\b(ERR-[A-Za-z0-9_-]{3,64})\b/.exec(detail ?? "")?.[1] ?? null;

/** A status code in the detail ("answered 500"), when the check did not send one. */
const statusIn = (detail: string | null) => {
  const n = Number(/\banswered (\d{3})\b/.exec(detail ?? "")?.[1]);
  return Number.isInteger(n) && n >= 100 ? n : null;
};

/** One problem as an issue may say it. */
function problemLines(p: IssueProblem, i: number): string {
  const route = safeRoute(p.pattern ?? p.screen);
  const status = p.status ?? (p.kind === "SLOW" ? null : statusIn(p.detail));
  const code = errorCodeIn(p.detail);
  const type = errorTypeOf(p.errorType);
  const facts = [
    status ? `status ${status}` : null,
    type ? `error type ${type}` : null,
    code ? `error code ${code}` : null,
    p.ms ? `${(p.ms / 1000).toFixed(1)} s` : null,
  ].filter(Boolean);
  const calls = requestLines(p.detail);
  const stack = ourStackLines(p.stack);
  return [
    `${i + 1}. **${KIND_TEXT[p.kind]}** on \`${route}\`${facts.length ? ` (${facts.join(", ")})` : ""}.`,
    ...calls.map((c) => `   - \`${c}\``),
    ...(stack.length
      ? [
          "   Stack lines from the ERP's own code:",
          "   ```",
          ...stack.map((l) => `   ${l}`),
          "   ```",
        ]
      : []),
  ].join("\n");
}

/** The way of working every issue asks for (the owner's rules are in CLAUDE.md). */
const howTo = (issue: number) =>
  [
    "### How to do it",
    "- Read `CLAUDE.md` first: it holds the owner's rules, and they apply to this change.",
    "- Find the cause in the code and fix it. Keep the change small.",
    "- Add a test that fails without the fix, so it cannot come back.",
    "- If a screen, button or label changes, update its Bengali guide in `src/modules/help/content` in the same change (`tests/unit/help-center.test.ts` checks the guides).",
    "- Never delete data, and keep every rule about permissions, the PIN and buyers as it is.",
    "- Run `npm run typecheck`, `npm run lint`, `npm run format:check` and the tests you touched (`TEST_DATABASE_URL` is set).",
    `- Commit only to this issue's own branch (\`claude/issue-${issue > 0 ? issue : "<this issue's number>"}-…\`). Never push to \`main\`. Leave the pull request to the ERP: it opens it into \`main\`, the owner looks at it and merges it from the ERP with the PIN, and the Deploy workflow installs it safely.`,
  ].join("\n");

/** The issue for "Fix with Claude Code" (one problem, or "Fix all"). */
export function fixIssue(input: {
  problems: IssueProblem[];
  /** "live" or "demo". */
  site: string;
  at: string;
  runId: string;
  /** The issue's number, once known (the branch name carries it); 0 before. */
  issue: number;
}): { title: string; body: string } {
  const { problems } = input;
  const one = problems.length === 1 ? problems[0]! : null;
  const title = one
    ? `Full check: ${KIND_LABEL[one.kind]} on ${safeRoute(one.pattern ?? one.screen)}`.slice(0, 200)
    : `Full check: fix ${problems.length} problems found on ${input.at.slice(0, 10)}`;
  const body = [
    `@claude please fix ${one ? "this problem" : "these problems"}, found by the ERP's Full check on the ${input.site === "demo" ? "demo" : "live"} site.`,
    "",
    "### What the Full check found",
    problems.map(problemLines).join("\n"),
    "",
    "The screen's text, the data on it and the screenshots stay private in the ERP: open the screen on the demo site to see it.",
    "",
    howTo(input.issue),
    "",
    `_Sent from the ERP (AI Center > Full check) on ${input.at}, Full check ${input.runId}._`,
  ].join("\n");
  return { title, body };
}

/** The issue for "Ask Claude Code": a new request in the owner's own words. */
export function askIssue(input: { text: string; site: string; at: string; issue: number }): {
  title: string;
  body: string;
} {
  const first = input.text.split("\n")[0]!.trim();
  const title = `ERP request: ${first.length > 90 ? `${first.slice(0, 90)}...` : first}`;
  const body = [
    "@claude please build this request from the owner of the ERP. Read it with the code: if it is unclear or would break a rule, say so in a comment on this issue instead of guessing.",
    "",
    "### The request",
    input.text.trim(),
    "",
    howTo(input.issue),
    "",
    `_Sent from the ERP (AI Center > Full check > Ask Claude Code) on ${input.at}._`,
  ].join("\n");
  return { title, body };
}

/** The safe facts of a Bug Guard finding (modules/bug-guard/types.ts CodeFacts). */
export type GuardFacts = {
  route: string;
  method?: string | null;
  status?: number | null;
  errorType?: string | null;
  stack?: string[];
  times?: number;
  routes?: string[];
};

/** A route as an issue may name it (a pattern; the database and package.json as they are). */
const guardRoute = (route: string) =>
  /^database: [A-Za-z]{1,60}\.[A-Za-z$]{1,40}$/.test(route) || route === "package.json"
    ? route
    : safeRoute(route);

/**
 * The issue for a Bug Guard finding with a code fix: only the route pattern,
 * the error's type, the status, how often, and stack lines from the ERP's own
 * code. Never a message, a screen's text or anything from the ERP's data.
 */
export function guardIssue(input: { facts: GuardFacts; site: string; at: string; issue: number }): {
  title: string;
  body: string;
} {
  const f = input.facts;
  const route = guardRoute(f.route);
  const type = errorTypeOf(f.errorType);
  let what: string[];
  let title: string;
  if (type === "SlowQuery") {
    title = `Bug Guard: slow database call ${route.replace(/^database: /, "")}`;
    what = [
      `The database call \`${route.replace(/^database: /, "")}\` took over a second ${f.times ?? 1} time(s) on the live site.`,
      "Find why (a missing index, a query in a loop, too much loaded at once) and make it fast without changing what it returns.",
    ];
  } else if (type === "VulnerablePackages") {
    title = "Bug Guard: packages with known weaknesses";
    what = [
      "`npm audit` reports high or critical weaknesses in the ERP's packages.",
      "Update them to safe versions (keep the major versions where you can), keep everything working and run the whole test suite.",
    ];
  } else if (type === "MissingHelpGuide") {
    const routes = [...new Set([f.route, ...(f.routes ?? [])].map(safeRoute))].slice(0, 20);
    title = `Bug Guard: ${routes.length} screen(s) without a Help guide`;
    what = [
      "People use these screens, and they have no guide in the Help Center:",
      ...routes.map((r) => `- \`${r}\``),
      "Write a Bengali guide for each, as CLAUDE.md and `tests/unit/help-center.test.ts` require.",
    ];
  } else {
    const facts = [
      f.method ? `method ${f.method.replace(/[^A-Z]/g, "")}` : null,
      f.status ? `status ${f.status}` : null,
      type ? `error type ${type}` : null,
      f.times ? `${f.times} time(s) since the last check` : null,
    ].filter(Boolean);
    title = `Bug Guard: ${type ?? "an error"} on ${route}`;
    const stack = ourStackLines(f.stack);
    what = [
      `**An error on \`${route}\`**${facts.length ? ` (${facts.join(", ")})` : ""}.`,
      ...(stack.length
        ? ["Stack lines from the ERP's own code:", "```", ...stack, "```"]
        : ["No stack lines from the ERP's own code were kept: find the cause from the route."]),
    ];
  }
  const body = [
    `@claude please fix this problem, found by the ERP's Bug Guard on the ${input.site === "demo" ? "demo" : "live"} site.`,
    "",
    "### What Bug Guard found",
    ...what,
    "",
    "What the screens showed and the data behind them stay private in the ERP.",
    "",
    howTo(input.issue),
    "",
    `_Sent from the ERP (AI Center > Bug Guard) on ${input.at}._`,
  ].join("\n");
  return { title: title.slice(0, 200), body };
}

/**
 * Changed files that run, build or install the ERP, or set the rules for
 * Claude Code: the owner is asked to look twice before merging these.
 */
export function carefulFiles(files: readonly string[]): string[] {
  return files.filter((f) =>
    /^(\.github\/|deploy\/|Dockerfile|docker|package(-lock)?\.json$|prisma\/migrations\/|prisma\/schema\.prisma$|CLAUDE\.md$|\.claude\/|\.mcp\.json$|scripts\/|src\/proxy\.ts$|src\/instrumentation\.ts$|next\.config|src\/lib\/(auth|prisma|tenant-db|read-only)|src\/modules\/(auth|rbac|backups)\/)/.test(
      f,
    ),
  );
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
