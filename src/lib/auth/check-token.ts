/*
 * The Full check's sessions (AI Center > Full check) carry tokens that start
 * with this, so the server knows them before it looks anything up: on the live
 * site such a session may only read (src/proxy.ts refuses everything else).
 */
export const CHECK_TOKEN_PREFIX = "fullcheck.";

export const isCheckToken = (token: string | undefined) =>
  !!token && token.startsWith(CHECK_TOKEN_PREFIX);

/** Whether a request may go ahead: a check session on the live site only reads. */
export function checkMayDo(method: string, token: string | undefined, demoSite: boolean): boolean {
  if (!isCheckToken(token) || demoSite) return true;
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
