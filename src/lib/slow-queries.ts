/*
 * The database calls that took long (over a second), kept in memory since the
 * server started, for Bug Guard (checks/app.ts): which table and what kind of
 * call, how long, and when. Never the query's values. The newest 200 are kept.
 */

export const SLOW_QUERY_MS = 1000;
const KEEP = 200;

export type SlowQuery = { model: string; operation: string; ms: number; at: Date };

const store = globalThis as unknown as { slowQueries?: SlowQuery[] };

/** Notes one call when it was slow. */
export function noteQueryTime(model: string | undefined, operation: string, ms: number) {
  if (ms < SLOW_QUERY_MS) return;
  const list = (store.slowQueries ??= []);
  list.push({ model: model ?? "(raw SQL)", operation, ms: Math.round(ms), at: new Date() });
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
}

/** The slow calls since a moment, newest last. */
export function slowQueriesSince(since: Date): SlowQuery[] {
  return (store.slowQueries ?? []).filter((q) => q.at >= since);
}
