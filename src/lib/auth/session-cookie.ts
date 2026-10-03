/*
 * The session cookie's name and settings, shared by the sign-in code
 * (cookies.ts) and the screen gatekeeper (src/proxy.ts), which must not load
 * the database layer.
 */

export const SESSION_COOKIE = "extras_session";

/** Sessions last 30 days from the last visit (session.service.ts slides the expiry). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  } as const;
}
