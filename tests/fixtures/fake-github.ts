import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * A stand-in for the GitHub API and GitHub Actions' token issuer in tests
 * (GITHUB_API_URL and GITHUB_OIDC_ISSUER point here): the repository, the
 * workflows and their runs, issues, branches, pull requests, check runs, merges
 * and comments the Full check uses, kept in `state` for each test to shape.
 * `actionsToken` signs a token the way GitHub Actions does.
 */

export type FakePull = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  title: string;
  body: string | null;
  /** Who opened it. */
  user: { login: string; type: "User" | "Bot" };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
};

export type FakeCommit = {
  sha: string;
  author: { login: string; type?: string } | null;
  committer: { login: string; type?: string } | null;
  verified: boolean;
};

export type FakeFile = { filename: string; status: string; additions: number; deletions: number };

/** Claude Code's GitHub App, as GitHub shows it. */
export const CLAUDE_BOT = { login: "claude[bot]", type: "Bot" as const };

/** A commit made by Claude Code's GitHub App (signed through GitHub's API). */
export const claudeCommit = (sha: string): FakeCommit => ({
  sha,
  author: { login: CLAUDE_BOT.login, type: "Bot" },
  committer: { login: CLAUDE_BOT.login, type: "Bot" },
  verified: true,
});

export type FakeRun = {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  display_title: string;
  created_at: string;
};

export type FakeGitHub = {
  url: string;
  issuer: string;
  token: string;
  calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }>;
  state: {
    repo: string;
    /** The repository's default branch as GitHub says it ("main" unless a test changes it). */
    defaultBranch?: string;
    permissions: { push: boolean; admin: boolean };
    workflows: Record<string, "active" | "disabled_manually" | null>;
    runs: Record<string, FakeRun[]>;
    issues: Array<{ number: number; title: string; body: string }>;
    comments: Array<{ number: number; body: string }>;
    branches: string[];
    ahead: Record<string, number>;
    pulls: FakePull[];
    checks: Record<string, Array<{ name: string; status: string; conclusion: string | null }>>;
    merged: Array<{ number: number; sha: string }>;
    /** The token's own GitHub account (it opens the ERP's pull requests). */
    tokenUser: string;
    /** The commits on each branch (Claude Code's own by default). */
    branchCommits: Record<string, FakeCommit[]>;
    /** The commits and changed files of each pull request. */
    pullCommits: Record<number, FakeCommit[]>;
    pullFiles: Record<number, FakeFile[]>;
    /** The rules of the active rulesets on main (the Help's "Protect main" by default). */
    mainRules: string[];
    /**
     * Who may skip that ruleset (its Bypass list); null when the token may not see it, as
     * GitHub does for a token that may not change rulesets (the Help's token: the default).
     */
    rulesetBypass: Array<{ actor_type: string }> | null;
    /** Whether the token's own account may skip that ruleset (null: GitHub does not say). */
    currentUserCanBypass: "always" | "pull_requests_only" | "never" | null;
    /** The ruleset cannot be read at all (GitHub answers 404). */
    rulesetHidden?: boolean;
    /** The old kind of branch protection on main, when set. */
    classicProtection: Record<string, unknown> | null;
  };
  /** A GitHub Actions token (OpenID Connect), signed with the fake issuer's key or another. */
  actionsToken: (claims: Record<string, unknown>, opts?: { otherKey?: boolean }) => string;
  close: () => Promise<void>;
};

async function bodyOf(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sign(key: KeyObject, kid: string, claims: Record<string, unknown>) {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(key).toString("base64url")}`;
}

export async function startFakeGitHub(
  repo = "extas/erp",
  token = "github_pat_test0123456789abcdefWXYZ",
): Promise<FakeGitHub> {
  const issuerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...issuerKey.publicKey.export({ format: "jwk" }),
    kid: "gh-1",
    alg: "RS256",
    use: "sig",
  };
  const calls: FakeGitHub["calls"] = [];
  const state: FakeGitHub["state"] = {
    repo,
    permissions: { push: true, admin: true },
    workflows: { "full-check.yml": "active", "claude.yml": "active" },
    runs: {},
    issues: [],
    comments: [],
    branches: [],
    ahead: {},
    pulls: [],
    checks: {},
    merged: [],
    tokenUser: "owner-on-github",
    branchCommits: {},
    pullCommits: {},
    pullFiles: {},
    mainRules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"],
    rulesetBypass: null,
    currentUserCanBypass: "never",
    classicProtection: null,
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await bodyOf(req);
    const path = url.pathname;
    calls.push({ method: req.method ?? "GET", path: `${path}${url.search}`, body });
    const send = (status: number, json?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(json === undefined ? "" : JSON.stringify(json));
    };
    if (path === "/oidc/.well-known/jwks") return send(200, { keys: [jwk] });
    if (req.headers.authorization !== `Bearer ${token}`) {
      return send(401, { message: "Bad credentials" });
    }
    const base = `/repos/${state.repo}`;
    if (!path.startsWith(base)) return send(404, { message: "Not Found" });
    const rest = path.slice(base.length);
    let m: RegExpMatchArray | null;
    if (rest === "" && req.method === "GET") {
      return send(200, {
        default_branch: state.defaultBranch ?? "main",
        private: true,
        permissions: { ...state.permissions, pull: true },
      });
    }
    if (rest === "/rules/branches/main") {
      return send(
        200,
        state.mainRules.map((type) => ({
          type,
          ruleset_source_type: "Repository",
          ruleset_source: state.repo,
          ruleset_id: 7,
        })),
      );
    }
    if (rest === "/rulesets/7") {
      if (state.rulesetHidden) return send(404, { message: "Not Found" });
      return send(200, {
        id: 7,
        name: "Protect main",
        enforcement: "active",
        ...(state.rulesetBypass ? { bypass_actors: state.rulesetBypass } : {}),
        ...(state.currentUserCanBypass
          ? { current_user_can_bypass: state.currentUserCanBypass }
          : {}),
      });
    }
    if (rest === "/branches/main/protection") {
      return state.classicProtection
        ? send(200, state.classicProtection)
        : send(404, { message: "Branch not protected" });
    }
    if ((m = rest.match(/^\/actions\/workflows\/([^/]+)$/))) {
      const found = state.workflows[m[1]!];
      return found ? send(200, { state: found }) : send(404, { message: "Not Found" });
    }
    if ((m = rest.match(/^\/actions\/workflows\/([^/]+)\/dispatches$/)) && req.method === "POST") {
      return state.workflows[m[1]!] ? send(204) : send(404, { message: "Not Found" });
    }
    if ((m = rest.match(/^\/actions\/workflows\/([^/]+)\/runs$/))) {
      return send(200, { workflow_runs: state.runs[m[1]!] ?? [] });
    }
    if (rest === "/issues" && req.method === "POST") {
      const number = 100 + state.issues.length + state.pulls.length;
      state.issues.push({ number, title: String(body?.title), body: String(body?.body) });
      return send(201, { number, html_url: `https://github.com/${state.repo}/issues/${number}` });
    }
    if ((m = rest.match(/^\/issues\/(\d+)$/)) && req.method === "PATCH") {
      const issue = state.issues.find((i) => i.number === Number(m![1]));
      if (!issue) return send(404, { message: "Not Found" });
      if (body?.body !== undefined) issue.body = String(body.body);
      return send(200, { number: issue.number });
    }
    if ((m = rest.match(/^\/issues\/(\d+)\/comments$/)) && req.method === "POST") {
      state.comments.push({ number: Number(m[1]), body: String(body?.body) });
      return send(201, { id: state.comments.length });
    }
    if ((m = rest.match(/^\/git\/matching-refs\/heads\/(.+)$/))) {
      const prefix = m[1]!;
      return send(
        200,
        state.branches.filter((b) => b.startsWith(prefix)).map((b) => ({ ref: `refs/heads/${b}` })),
      );
    }
    if ((m = rest.match(/^\/compare\/main\.\.\.(.+)$/))) {
      return send(200, { ahead_by: state.ahead[decodeURIComponent(m[1]!)] ?? 0 });
    }
    if (rest === "/pulls" && req.method === "GET") {
      // GitHub's "head" filter: "owner:branch", pull requests from this repository's branch only.
      const head = url.searchParams.get("head");
      const owner = state.repo.split("/")[0];
      return send(
        200,
        [...state.pulls]
          .reverse()
          .filter(
            (p) =>
              !head ||
              (head === `${owner}:${p.head.ref}` &&
                p.head.repo?.full_name.toLowerCase() === state.repo.toLowerCase()),
          ),
      );
    }
    if (rest === "/pulls" && req.method === "POST") {
      const number = 100 + state.issues.length + state.pulls.length;
      const branch = String(body?.head);
      const pull: FakePull = {
        number,
        html_url: `https://github.com/${state.repo}/pull/${number}`,
        state: "open",
        merged_at: null,
        title: String(body?.title),
        body: String(body?.body),
        user: { login: state.tokenUser, type: "User" },
        head: { ref: branch, sha: `sha-pr-${number}`, repo: { full_name: state.repo } },
        base: { ref: String(body?.base) },
      };
      state.pulls.push(pull);
      state.pullCommits[number] ??= state.branchCommits[branch] ?? [claudeCommit(pull.head.sha)];
      return send(201, pull);
    }
    if ((m = rest.match(/^\/pulls\/(\d+)$/))) {
      const pull = state.pulls.find((p) => p.number === Number(m![1]));
      return pull ? send(200, pull) : send(404, { message: "Not Found" });
    }
    if ((m = rest.match(/^\/pulls\/(\d+)\/commits$/))) {
      const pull = state.pulls.find((p) => p.number === Number(m![1]));
      if (!pull) return send(404, { message: "Not Found" });
      // Claude Code's pushes since: its own commits, up to the newest.
      const known = state.pullCommits[pull.number] ?? [];
      const commits = known.some((c) => c.sha === pull.head.sha)
        ? known
        : [...known, claudeCommit(pull.head.sha)];
      return send(
        200,
        commits.map((c) => ({
          sha: c.sha,
          author: c.author,
          committer: c.committer,
          commit: { verification: { verified: c.verified } },
        })),
      );
    }
    if ((m = rest.match(/^\/pulls\/(\d+)\/files$/))) {
      const pull = state.pulls.find((p) => p.number === Number(m![1]));
      if (!pull) return send(404, { message: "Not Found" });
      return send(
        200,
        state.pullFiles[pull.number] ?? [
          {
            filename: "src/modules/sales/order.service.ts",
            status: "modified",
            additions: 4,
            deletions: 1,
          },
          { filename: "tests/unit/order.test.ts", status: "added", additions: 20, deletions: 0 },
        ],
      );
    }
    if ((m = rest.match(/^\/pulls\/(\d+)\/merge$/)) && req.method === "PUT") {
      const pull = state.pulls.find((p) => p.number === Number(m![1]));
      if (!pull || pull.head.sha !== body?.sha)
        return send(409, { message: "Head branch was modified" });
      pull.state = "closed";
      pull.merged_at = new Date().toISOString();
      state.merged.push({ number: pull.number, sha: pull.head.sha });
      return send(200, { merged: true });
    }
    if ((m = rest.match(/^\/commits\/([^/]+)\/check-runs$/))) {
      return send(200, { check_runs: state.checks[m[1]!] ?? [] });
    }
    return send(404, { message: "Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const issuer = `${url}/oidc`;
  return {
    url,
    issuer,
    token,
    calls,
    state,
    actionsToken: (claims, opts) =>
      sign(opts?.otherKey ? otherKey.privateKey : issuerKey.privateKey, "gh-1", {
        iss: issuer,
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        repository: state.repo,
        workflow_ref: `${state.repo}/.github/workflows/full-check.yml@refs/heads/main`,
        ref: "refs/heads/main",
        event_name: "workflow_dispatch",
        run_id: "4242",
        ...claims,
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
