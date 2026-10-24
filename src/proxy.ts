import { type NextRequest, NextResponse } from "next/server";

import { checkMayDo } from "@/lib/auth/check-token";
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
 *     to the page they asked for afterwards. The privacy policy is the one other
 *     screen open to anyone (Google links to it from the Google Drive sign-in).
 *   - A session cookie: renewed for another 30 days on each visit, so the browser
 *     keeps an active person signed in for as long as the database session lives.
 *     The screen is told which page was asked for, in case it finds the session
 *     ended (signed out elsewhere, password changed) and has to send them to sign in.
 *   - The Full check's sessions (lib/auth/check-token.ts) only read on the live
 *     site, and on the API only the routes listed as read-only (deny by
 *     default); a few routes they never open on any site. Anything else is
 *     refused here, and the server refuses their writes again underneath
 *     (lib/read-only.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!checkMayDo(request.method, token, process.env.DEMO_SITE === "on", pathname)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message:
            "The Full check only reads, and only what is listed as safe for it (lib/auth/check-token.ts).",
        },
      },
      { status: 403 },
    );
  }
  // The API answers for itself (401 without a session); only the rule above applies to it.
  if (pathname.startsWith("/api/")) return NextResponse.next();
  // Server Actions (POST) set or clear the cookie themselves and answer for themselves.
  const isPageVisit = request.method === "GET" || request.method === "HEAD";

  if (!token && isPageVisit && pathname !== ROUTES.signIn && pathname !== ROUTES.privacy) {
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
  matcher: [
    // Screens only: not the API, Next.js' own files, the app icons or what installs the app.
    "/((?!api/|_next/|icons/|icon\\.svg$|favicon\\.ico$|favicon\\.svg$|robots\\.txt$|manifest\\.webmanifest$|sw\\.js$|offline\\.html$).*)",
    // The API only for the Full check's sessions (everyone else's uploads never pass here).
    {
      source: "/api/:path*",
      has: [{ type: "cookie", key: "extras_session", value: "fullcheck\\..*" }],
    },
  ],
};
