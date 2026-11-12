import { AsyncLocalStorage } from "node:async_hooks";

import { Prisma } from "@prisma/client";

import { hashSessionToken } from "@/lib/auth/token";

/*
 * While a company's Fresh start runs (from the claim until it is DONE or FAILED,
 * modules/fresh-start), nobody changes that company's data: a write to one of its
 * tables is refused (lib/read-only.ts asks here for every write). The company of
 * a write is the one its data or filter names, else the company of the row it
 * names by id, else the company the request's session is in. Platform tables
 * (sessions, users, backups) stay writable, and so does the fresh start's own
 * work. The wipe also locks its tables, so a write by a path this cannot place (a
 * clock's raw SQL or a filter with no company) never slips in half-way.
 *
 * "Runs" means a job of this server holds the claim (the running list below, kept
 * by the job itself): a row left BACKING_UP or ERASING by a stopped server or by a
 * restored backup holds nothing back, and is settled as FAILED when the card is
 * next read (fresh-start.service.ts).
 */

export const FRESH_START_RUNNING = "A fresh start is running for this company";

const work = new AsyncLocalStorage<{ companyId: string; claimId: string }>();

/** Runs the fresh start's own work, which may write while the company is closed (while its claim runs). */
export function asFreshStartWork<T>(
  companyId: string,
  claimId: string,
  run: () => Promise<T>,
): Promise<T> {
  return work.run({ companyId, claimId }, run);
}

const TENANT: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "companyId"))
    .map((m) => m.name),
);
/** Its own record is written by the fresh start alone (the claim and the card's settling). */
const NEVER_CLOSED = new Set(["FreshStart"]);

/** How long a session's company is trusted. */
const SESSION_TTL_MS = 30_000;

type Cache = {
  /** Company id -> the claim id of the fresh start a job of this server is running. */
  running: Map<string, string>;
  sessions: Map<string, { companyId: string | null; at: number }>;
};
const cache = ((globalThis as { __freshStartGuard?: Cache }).__freshStartGuard ??= {
  running: new Map(),
  sessions: new Map(),
});

/** Set by the job when it claims the row (claimId) and when it ends (null, only its own claim). */
export function noteFreshStartRunning(companyId: string, claimId: string | null, ended?: string) {
  if (claimId) cache.running.set(companyId, claimId);
  else if (!ended || cache.running.get(companyId) === ended) cache.running.delete(companyId);
}

/** The claim id of the fresh start a job of this server runs for the company, if any. */
export function liveFreshStartClaim(companyId: string): string | undefined {
  return cache.running.get(companyId);
}

function companyOf(args: unknown): string | null {
  const a = (args ?? {}) as { data?: unknown; where?: unknown; create?: unknown };
  for (const part of [a.data, a.where, a.create]) {
    const row = (Array.isArray(part) ? part[0] : part) as
      { companyId?: unknown; company?: { connect?: { id?: unknown } } } | undefined;
    if (!row || typeof row !== "object") continue;
    const id = row.companyId ?? row.company?.connect?.id;
    if (typeof id === "string") return id;
  }
  return null;
}

/** The company of the row a write names by its id (`where: { id }`). */
async function companyOfRow(model: string, args: unknown): Promise<string | null> {
  const id = ((args ?? {}) as { where?: { id?: unknown } }).where?.id;
  if (typeof id !== "string") return null;
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.$queryRawUnsafe<{ companyId: string | null }[]>(
    `SELECT "companyId" FROM "${model.replace(/"/g, '""')}" WHERE "id" = $1`,
    id,
  );
  return rows[0]?.companyId ?? null;
}

async function companyOfSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const known = cache.sessions.get(token);
  if (known && Date.now() - known.at < SESSION_TTL_MS) return known.companyId;
  const { prisma } = await import("@/lib/prisma");
  const session = await prisma.session.findUnique({
    where: { token: hashSessionToken(token) },
    select: { activeCompanyId: true },
  });
  const companyId = session?.activeCompanyId ?? null;
  cache.sessions.set(token, { companyId, at: Date.now() });
  return companyId;
}

/**
 * Why this write must wait for a fresh start, or null. `model`: the model (or the
 * table a raw write names); `args`: the model call's arguments (none for raw SQL);
 * `token`: the request's session cookie.
 */
export async function freshStartBlocks(
  model: string | undefined,
  args: unknown,
  token: () => Promise<string | undefined>,
): Promise<string | null> {
  if (cache.running.size === 0) return null;
  const own = work.getStore();
  if (own && cache.running.get(own.companyId) === own.claimId) return null;
  if (!model || !TENANT.has(model) || NEVER_CLOSED.has(model)) return null;
  const companyId =
    companyOf(args) ??
    (args ? await companyOfRow(model, args) : null) ??
    (await companyOfSession(await token()));
  return companyId && cache.running.has(companyId) ? FRESH_START_RUNNING : null;
}
