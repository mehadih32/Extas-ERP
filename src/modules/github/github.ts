import { AppError } from "@/lib/errors";

/*
 * The few GitHub calls the ERP makes (AI Center > Full check), with the
 * owner's fine-grained token for one repository: start the Full check
 * workflow, open an issue for the Claude Code GitHub Action, find the branch
 * and pull request it made (open the pull request when Claude Code only
 * pushed a branch), read its checks, and merge it. GITHUB_API_URL points the
 * calls elsewhere in tests. Errors come back as plain words.
 */

const API = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const TIMEOUT_MS = 20_000;

/** "owner/name". */
export const REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export type GitHub = { repo: string; token: string };

type Answer<T> = { status: number; data: T };

async function call<T>(
  gh: GitHub,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
  okStatuses: number[] = [],
): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(`${API()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${gh.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Extas-ERP",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError("UNAVAILABLE", "GitHub could not be reached. Try again in a minute.");
  }
  const text = await response.text();
  const data = (text ? safeJson(text) : null) as T;
  if (response.ok || okStatuses.includes(response.status)) return { status: response.status, data };
  const message = (data as { message?: string } | null)?.message ?? "";
  if (response.status === 401) {
    throw new AppError(
      "UNAVAILABLE",
      "GitHub refused the token (wrong or expired). Make a new one and save it here.",
    );
  }
  if (response.status === 403 || response.status === 404) {
    throw new AppError(
      "UNAVAILABLE",
      `GitHub said the token cannot do this on ${gh.repo} (${response.status}${message ? `: ${message}` : ""}). Check the token's repository and permissions.`,
    );
  }
  if (response.status === 422) {
    throw new AppError("VALIDATION", `GitHub did not accept it${message ? `: ${message}` : "."}`);
  }
  throw new AppError("UNAVAILABLE", `GitHub answered ${response.status}. Try again in a minute.`);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const repoPath = (gh: GitHub) => `/repos/${gh.repo}`;

/** The workflows the ERP uses, by file name. */
export const FULL_CHECK_WORKFLOW = "full-check.yml";
export const CLAUDE_WORKFLOW = "claude.yml";

type Repo = {
  default_branch: string;
  private: boolean;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
};

/** What the token can do on the repository, in plain notes. */
export async function testGitHub(gh: GitHub): Promise<{ ok: boolean; notes: string[] }> {
  const { data: repo } = await call<Repo>(gh, "GET", repoPath(gh));
  const notes: string[] = [];
  let ok = true;
  if (!repo.permissions?.push && !repo.permissions?.admin) {
    ok = false;
    notes.push(
      "The token cannot write to the repository: give it Contents, Issues and Pull requests (read and write).",
    );
  } else {
    notes.push(`Connected to ${gh.repo} (${repo.private ? "private" : "public"}).`);
  }
  for (const [file, name] of [
    [FULL_CHECK_WORKFLOW, "Full check"],
    [CLAUDE_WORKFLOW, "Claude Code"],
  ] as const) {
    const found = await call<{ state?: string }>(
      gh,
      "GET",
      `${repoPath(gh)}/actions/workflows/${file}`,
      undefined,
      [404],
    );
    if (found.status === 404) {
      ok = false;
      notes.push(`The ${name} workflow (.github/workflows/${file}) is not on the main branch yet.`);
    } else if (found.data.state && found.data.state !== "active") {
      ok = false;
      notes.push(`The ${name} workflow is turned off on GitHub (Actions tab): turn it on.`);
    }
  }
  return { ok, notes };
}

async function defaultBranch(gh: GitHub): Promise<string> {
  return (await call<Repo>(gh, "GET", repoPath(gh))).data.default_branch;
}

/**
 * Starts the Full check on GitHub's computers, from the main branch: the ERP
 * takes only that workflow's proof (oidc.ts), whatever the default branch is.
 */
export async function dispatchFullCheck(gh: GitHub, inputs: Record<string, string>) {
  await call(gh, "POST", `${repoPath(gh)}/actions/workflows/${FULL_CHECK_WORKFLOW}/dispatches`, {
    ref: MAIN,
    inputs,
  });
}

type WorkflowRun = {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  display_title?: string;
  created_at: string;
};

/** The newest runs of a workflow since a time (for the run's link, and Claude Code's runs). */
export async function workflowRuns(gh: GitHub, file: string, since: Date): Promise<WorkflowRun[]> {
  const day = since.toISOString().slice(0, 19);
  const { data } = await call<{ workflow_runs: WorkflowRun[] }>(
    gh,
    "GET",
    `${repoPath(gh)}/actions/workflows/${file}/runs?per_page=30&created=${encodeURIComponent(`>=${day}Z`)}`,
  );
  return data.workflow_runs ?? [];
}

/** Opens an issue (the Claude Code GitHub Action answers it). */
export async function openIssue(gh: GitHub, issue: { title: string; body: string }) {
  const { data } = await call<{ number: number; html_url: string }>(
    gh,
    "POST",
    `${repoPath(gh)}/issues`,
    issue,
  );
  return { number: data.number, url: data.html_url };
}

/** Rewrites an issue's text (the ERP adds the issue's own number once GitHub gave it). */
export async function updateIssue(gh: GitHub, number: number, body: string) {
  await call(gh, "PATCH", `${repoPath(gh)}/issues/${number}`, { body });
}

export type Pull = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  title: string;
  body: string | null;
  /** Who opened it. */
  user: { login: string; type?: string } | null;
  /** Its branch, and the repository the branch is in (another one for a fork). */
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
  /** How many files it changes. */
  changed_files?: number;
  mergeable?: boolean | null;
};

/** The only branch a fix may go into (the Deploy workflow installs what lands there). */
export const MAIN = "main";

/** The branch the Claude Code GitHub Action makes for an issue: "claude/issue-<n>-<time>". */
export const issueBranchPrefix = (issue: number) => `claude/issue-${issue}-`;

/**
 * Claude Code's GitHub App, as GitHub names it on pull requests and commits
 * (CLAUDE_BOT_LOGINS can name it differently, comma-separated).
 */
export const claudeBots = () =>
  (process.env.CLAUDE_BOT_LOGINS || "claude[bot]")
    .split(",")
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);

/**
 * Claude Code's work on an issue: its branch (claude/issue-<n>-...) in this
 * repository, and the pull request from that branch. Never a pull request that
 * only names the issue ("#<n>"), and never one from a fork.
 */
export async function findWork(
  gh: GitHub,
  issue: number,
): Promise<{ branch: string | null; pull: Pull | null }> {
  const prefix = issueBranchPrefix(issue);
  const { data: refs } = await call<Array<{ ref: string }>>(
    gh,
    "GET",
    `${repoPath(gh)}/git/matching-refs/heads/${prefix}`,
  );
  const branches = refs
    .map((r) => r.ref.replace(/^refs\/heads\//, ""))
    .filter((b) => b.startsWith(prefix));
  const owner = gh.repo.split("/")[0]!;
  // The newest branch first; each asked for by name, so only this repository's branch counts.
  for (const branch of [...branches].reverse()) {
    const { data: pulls } = await call<Pull[]>(
      gh,
      "GET",
      `${repoPath(gh)}/pulls?state=all&per_page=10&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    const pull = pulls.find((p) => p.head.ref === branch && sameRepo(gh, p)) ?? null;
    if (pull) return { branch, pull };
  }
  return { branch: branches.at(-1) ?? null, pull: null };
}

/** GitHub's own signer: the committer of what GitHub makes on github.com for someone. */
const GITHUB_SIGNER = "web-flow";

const sameRepo = (gh: GitHub, pull: Pull) =>
  pull.head.repo?.full_name.toLowerCase() === gh.repo.toLowerCase();

type Commit = {
  sha: string;
  author: { login: string } | null;
  committer: { login: string } | null;
  commit?: { verification?: { verified?: boolean } };
};

export type PullFile = { name: string; status: string; added: number; removed: number };

export type Vetted = {
  /** Claude Code's own fix for the issue, into the main branch. */
  ok: boolean;
  /** Why not, in plain words. */
  problem: string | null;
  /** Who opened it on GitHub. */
  author: string;
  /** The commit it was checked at (only that one may be merged). */
  sha: string;
  /** The files it changes (the first 100) and how many there are. */
  files: PullFile[];
  filesTotal: number;
};

/**
 * Whether a pull request is Claude Code's own fix for an issue: from the
 * issue's branch in this repository (not a fork), into the main branch,
 * opened by Claude Code's GitHub App or by the ERP itself, and every commit
 * verified and made by Claude Code's GitHub App, up to the one checked: the
 * App is its committer, or GitHub's own signer is the committer with the App
 * as its author (made on github.com for the App). Also the files it changes,
 * for the owner to see before Merge.
 */
export async function vetPull(
  gh: GitHub,
  pull: Pull,
  issue: number,
  openedByErp: boolean,
): Promise<Vetted> {
  const bots = claudeBots();
  const isBot = (login: string | undefined | null) => !!login && bots.includes(login.toLowerCase());
  const [{ data: commits }, { data: files }] = await Promise.all([
    call<Commit[]>(gh, "GET", `${repoPath(gh)}/pulls/${pull.number}/commits?per_page=100`),
    call<Array<{ filename: string; status: string; additions: number; deletions: number }>>(
      gh,
      "GET",
      `${repoPath(gh)}/pulls/${pull.number}/files?per_page=100`,
    ),
  ]);
  const author = pull.user?.login ?? "someone";
  let problem: string | null = null;
  if (!sameRepo(gh, pull)) problem = "it comes from another repository (a fork)";
  else if (!pull.head.ref.startsWith(issueBranchPrefix(issue)))
    problem = `it is not on Claude Code's branch for issue #${issue}`;
  else if (pull.base.ref !== MAIN) problem = `it goes into ${pull.base.ref}, not into ${MAIN}`;
  else if (!openedByErp && !isBot(pull.user?.login))
    problem = `it was not opened by Claude Code (opened by ${author})`;
  else if (commits.length === 0 || commits.length >= 100)
    problem = "its commits could not all be checked";
  else if (!commits.some((c) => c.sha === pull.head.sha))
    problem = "its newest commit could not be checked";
  else {
    // Anyone can name the App as a commit's author; only the committer shows who made it.
    const signedForBot = (c: Commit) =>
      c.committer?.login === GITHUB_SIGNER && isBot(c.author?.login);
    const stranger = commits.find(
      (c) =>
        !(isBot(c.committer?.login) || signedForBot(c)) ||
        c.commit?.verification?.verified !== true,
    );
    if (stranger) {
      const who =
        stranger.committer?.login === GITHUB_SIGNER
          ? stranger.author?.login
          : (stranger.committer?.login ?? stranger.author?.login);
      problem = `a change in it is not Claude Code's (${who ?? "unknown"}, commit ${stranger.sha.slice(0, 7)})`;
    }
  }
  return {
    ok: problem === null,
    problem,
    author,
    sha: pull.head.sha,
    files: files.map((f) => ({
      name: f.filename,
      status: f.status,
      added: f.additions,
      removed: f.deletions,
    })),
    filesTotal: Math.max(pull.changed_files ?? 0, files.length),
  };
}

/** Whether the branch has commits the main branch does not. */
export async function branchAhead(gh: GitHub, branch: string): Promise<boolean> {
  const base = await defaultBranch(gh);
  const { data } = await call<{ ahead_by: number }>(
    gh,
    "GET",
    `${repoPath(gh)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`,
  );
  return data.ahead_by > 0;
}

/** Opens the pull request from Claude Code's branch into the main branch. */
export async function openPull(
  gh: GitHub,
  pull: { branch: string; title: string; body: string },
): Promise<Pull> {
  const base = await defaultBranch(gh);
  const { data } = await call<Pull>(gh, "POST", `${repoPath(gh)}/pulls`, {
    title: pull.title,
    head: pull.branch,
    base,
    body: pull.body,
  });
  return data;
}

export async function getPull(gh: GitHub, number: number): Promise<Pull> {
  return (await call<Pull>(gh, "GET", `${repoPath(gh)}/pulls/${number}`)).data;
}

/** The checks on a commit: still running, all passed, or one failed. */
export async function checksOf(gh: GitHub, sha: string): Promise<"running" | "passed" | "failed"> {
  const { data } = await call<{
    check_runs: Array<{ status: string; conclusion: string | null; name: string }>;
  }>(gh, "GET", `${repoPath(gh)}/commits/${sha}/check-runs?per_page=100`);
  const runs = data.check_runs ?? [];
  if (runs.length === 0) return "running";
  if (runs.some((r) => r.status === "completed" && FAILED.has(r.conclusion ?? ""))) return "failed";
  if (runs.some((r) => r.status !== "completed")) return "running";
  return "passed";
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

/** Merges the pull request (the Deploy workflow then installs it safely). */
export async function mergePull(gh: GitHub, number: number, sha: string) {
  const { data } = await call<{ merged: boolean; message?: string }>(
    gh,
    "PUT",
    `${repoPath(gh)}/pulls/${number}/merge`,
    { sha, merge_method: "merge" },
    [405, 409],
  );
  if (!data.merged) {
    throw new AppError(
      "CONFLICT",
      `GitHub did not merge it${data.message ? `: ${data.message}` : "."} Look at the pull request on GitHub.`,
    );
  }
}

/** Adds a comment to an issue or pull request. */
export async function comment(gh: GitHub, number: number, body: string) {
  await call(gh, "POST", `${repoPath(gh)}/issues/${number}/comments`, { body });
}
