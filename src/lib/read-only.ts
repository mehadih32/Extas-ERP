import { AsyncLocalStorage } from "node:async_hooks";

import { isCheckToken } from "@/lib/auth/check-token";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { AppError } from "@/lib/errors";

/*
 * Work that may only read (v6.4 A4). Every write through Prisma is refused
 * (src/lib/prisma.ts) while:
 *   - the work runs inside `readOnly(why, ...)` (Bug Guard's checks), or
 *   - the request comes from a Full check session on the live site (its
 *     token starts with "fullcheck.", lib/auth/check-token.ts), whatever the
 *     route, so a screen or API route that writes when it is opened cannot
 *     change anything for the check either.
 * Reads go on as usual. Writes outside are untouched.
 */

/** Why a Full check session cannot write on the live site. */
export const CHECK_READ_ONLY = "The Full check only reads on the live site";

const work = new AsyncLocalStorage<{ why: string }>();

/** Runs the work so that it can only read: every write in it is refused with `why`. */
export function readOnly<T>(why: string, run: () => Promise<T>): Promise<T> {
  return work.run({ why }, run);
}

/** Whether this runs inside readOnly() work (Bug Guard's checks), not a request. */
export const insideReadOnlyWork = () => work.getStore() !== undefined;

/** Whether a session's token may only read here (a Full check session, not on the demo site). */
export const checkSessionReadOnly = (token: string | undefined, demoSite: boolean) =>
  isCheckToken(token) && !demoSite;

/** The request's session cookie, when there is a request (never throws). */
async function requestToken(): Promise<string | undefined> {
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    // Not in a request: a background job, a script or a test.
    return undefined;
  }
}

/** Why writes are refused now, or null when they are not. */
export async function readOnlyReason(): Promise<string | null> {
  const inside = work.getStore();
  if (inside) return inside.why;
  if (checkSessionReadOnly(await requestToken(), process.env.DEMO_SITE === "on")) {
    return CHECK_READ_ONLY;
  }
  return null;
}

/** Throws when writes are refused now. */
export async function assertMayWrite(): Promise<void> {
  const why = await readOnlyReason();
  if (why) throw new AppError("FORBIDDEN", `${why}: it cannot change anything.`);
}

/** Prisma operations that write. */
export const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "$executeRaw",
  "$executeRawUnsafe",
]);

/** Raw queries: allowed while they only read (readsOnly); a typed one is judged by its SQL too. */
const RAW_QUERIES = new Set(["$queryRaw", "$queryRawUnsafe", "$queryRawTyped"]);

/*
 * Server functions a SELECT can call that change or lock something: end or
 * cancel sessions, take advisory locks, reload settings, write files or large
 * objects, reach other databases, run other SQL from a string, reset the
 * statistics, send notifications, manage replication. A read never needs them.
 */
const SIDE_EFFECTS = new RegExp(
  [
    "pg_(terminate|cancel)_backend",
    "pg_(try_)?advisory\\w*",
    "pg_(reload_conf|rotate_logfile|switch_wal|switch_xlog|promote|create_restore_point|import_system_collations)",
    "pg_(create|drop|copy)_\\w*",
    "pg_\\w*replication\\w*",
    "pg_logical_\\w+",
    "pg_stat_reset\\w*",
    "pg_notify",
    "pg_file_\\w+",
    "lo_\\w+",
    "dblink\\w*",
    "(query|cursor)_to_xml\\w*",
  ]
    .map((name) => `\\b${name}\\s*\\(`)
    .join("|"),
  "i",
);

/** SELECT ... FOR UPDATE / FOR NO KEY UPDATE / FOR SHARE / FOR KEY SHARE: row locks. */
const ROW_LOCK = /\bfor\s+(no\s+key\s+|key\s+)?(update|share)\b/i;

/** The SQL of a raw query, from either form of call. */
function sqlOf(args: unknown): string {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) {
    const [first] = args as unknown[];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "strings" in first) {
      return (first as { strings: readonly string[] }).strings.join(" ");
    }
    if (Array.isArray(first)) return (first as string[]).join(" ");
  }
  if (args && typeof args === "object") {
    const a = args as { sql?: unknown; strings?: unknown };
    if (typeof a.sql === "string") return a.sql;
    if (Array.isArray(a.strings)) return (a.strings as string[]).join(" ");
  }
  return "";
}

/** A raw query that only reads: one SELECT (or WITH ... SELECT), nothing after it. */
export function readsOnly(sql: string): boolean {
  const text = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;\s*$/, "");
  if (!/^(select|with|show|explain)\b/i.test(text)) return false;
  const bare = text.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  // Data-changing words anywhere (a WITH ... UPDATE, SELECT ... INTO, or a second statement),
  // functions with side effects, and row locks.
  return (
    !/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|into|lock|vacuum|refresh|set_config|nextval|setval|pg_advisory_lock)\b|;/i.test(
      bare,
    ) &&
    !SIDE_EFFECTS.test(bare) &&
    !ROW_LOCK.test(bare)
  );
}

/** Whether a Prisma operation may run now (writes only outside read-only work). */
export async function guardOperation(operation: string, args: unknown): Promise<void> {
  const writes =
    WRITE_OPERATIONS.has(operation) || (RAW_QUERIES.has(operation) && !readsOnly(sqlOf(args)));
  if (writes) await assertMayWrite();
}
