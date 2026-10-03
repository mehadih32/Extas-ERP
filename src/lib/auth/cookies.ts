import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session-cookie";

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt });
}

export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
