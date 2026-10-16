import { createPublicKey, type JsonWebKey, verify } from "node:crypto";

import { AppError } from "@/lib/errors";

/*
 * Proof that a request comes from a GitHub Actions run of one workflow in one
 * repository: the run asks GitHub for a signed token (OpenID Connect, the
 * workflow's "id-token: write"), and the ERP checks GitHub's signature and what
 * the token says (repository, workflow, audience, time). The Full check sends
 * one with its pass, so a pass seen anywhere else opens nothing.
 * GITHUB_OIDC_ISSUER points it elsewhere in tests.
 */

const ISSUER = () =>
  (process.env.GITHUB_OIDC_ISSUER || "https://token.actions.githubusercontent.com").replace(
    /\/$/,
    "",
  );
const KEYS_MINUTES = 10;
/** Clock difference allowed between GitHub and the server. */
const SKEW_S = 60;

type Jwk = JsonWebKey & { kid?: string; kty?: string };

let cached: { issuer: string; at: number; keys: Jwk[] } | null = null;

async function keys(fresh = false): Promise<Jwk[]> {
  const issuer = ISSUER();
  if (
    !fresh &&
    cached &&
    cached.issuer === issuer &&
    Date.now() - cached.at < KEYS_MINUTES * 60_000
  ) {
    return cached.keys;
  }
  let response: Response;
  try {
    response = await fetch(`${issuer}/.well-known/jwks`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError("UNAVAILABLE", "GitHub's keys could not be read. Try again in a minute.");
  }
  if (!response.ok) throw new AppError("UNAVAILABLE", "GitHub's keys could not be read.");
  const data = (await response.json().catch(() => null)) as { keys?: Jwk[] } | null;
  cached = { issuer, at: Date.now(), keys: data?.keys ?? [] };
  return cached.keys;
}

const part = (text: string) =>
  JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as Record<string, unknown>;

export type ActionsClaims = {
  repository: string;
  workflow_ref: string;
  event_name: string;
  run_id: string;
};

/**
 * Checks a GitHub Actions token: signed by GitHub, for this audience, from
 * `repo`'s workflow file `workflow` as it is on `branch`, run on `branch`, not expired.
 */
export async function verifyActionsToken(
  token: string,
  want: { repo: string; workflow: string; audience: string; branch: string },
  now: Date = new Date(),
): Promise<ActionsClaims> {
  const refuse = (why: string): never => {
    throw new AppError("FORBIDDEN", `GitHub's proof was not accepted: ${why}.`);
  };
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) refuse("it is not a GitHub token");
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = part(head!);
    claims = part(body!);
  } catch {
    return refuse("it is not a GitHub token");
  }
  if (header.alg !== "RS256") refuse("it is not signed the way GitHub signs");
  const find = (list: Jwk[]) => list.find((k) => k.kid === header.kid && k.kty === "RSA");
  const key = find(await keys()) ?? find(await keys(true));
  if (!key) refuse("GitHub did not sign it");
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    createPublicKey({ key: key!, format: "jwk" }),
    Buffer.from(signature!, "base64url"),
  );
  if (!signed) refuse("the signature does not match");

  const seconds = Math.floor(now.getTime() / 1000);
  if (claims.iss !== ISSUER()) refuse("it was not made by GitHub Actions");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(want.audience)) refuse("it was made for another site");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < seconds) refuse("it has expired");
  if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > seconds)
    refuse("it is not valid yet");
  const repository = String(claims.repository ?? "");
  if (repository.toLowerCase() !== want.repo.toLowerCase())
    refuse("it comes from another repository");
  const workflowRef = String(claims.workflow_ref ?? "");
  if (
    !workflowRef
      .toLowerCase()
      .startsWith(`${repository}/.github/workflows/${want.workflow}@`.toLowerCase())
  ) {
    refuse("it comes from another workflow");
  }
  // Only the workflow as it is on main, run on main: a copy changed on another
  // branch (or a pull request) could ask for anything.
  if (
    !workflowRef.endsWith(`@refs/heads/${want.branch}`) ||
    String(claims.ref ?? "") !== `refs/heads/${want.branch}`
  ) {
    refuse(`it was not run from the ${want.branch} branch`);
  }
  return {
    repository,
    workflow_ref: workflowRef,
    event_name: String(claims.event_name ?? ""),
    run_id: String(claims.run_id ?? ""),
  };
}
