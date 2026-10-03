import { type NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth/session-cookie";
import { REQUESTED_PATH_HEADER, ROUTES, signInPath } from "@/lib/routes";

/*
 * Runs before every screen (not the API, which answers 401 itself). A quick
 * check on the cookie only: each screen still checks the session and the
 * person's permissions against the database.
 *   - No session cookie: off to the sign-in screen, which brings the person back
 *     to the page they asked for afterwards.
 *   - A session cookie: renewed for another 30 days on each visit, so the browser
 *     keeps an active person signed in for as long as the database session lives.
 *     The screen is told which page was asked for, in case it finds the session
 *     ended (signed out elsewhere, password changed) and has to send them to sign in.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // Server Actions (POST) set or clear the cookie themselves and answer for themselves.
  const isPageVisit = request.method === "GET" || request.method === "HEAD";

  if (!token && isPageVisit && pathname !== ROUTES.signIn) {
    return NextResponse.redirect(new URL(signInPath(pathname + search), request.url));
  }

  // Always set here, so a browser cannot supply its own.
  const headers = new Headers(request.headers);
  headers.set(REQUESTED_PATH_HEADER, pathname + search);
  const response = NextResponse.next({ request: { headers } });
  if (token && isPageVisit) {
    response.cookies.set(SESSION_COOKIE, token, {
      ...sessionCookieOptions(),
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export const config = {
  // Screens only: not the API, Next.js' own files or the app icon.
  matcher: ["/((?!api/|_next/|icon\\.svg$|favicon\\.ico$|robots\\.txt$).*)"],
};
