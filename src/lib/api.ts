import { NextResponse } from "next/server";

import { AppError, httpStatusFor } from "@/lib/errors";
import { toActionError } from "@/lib/result";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie-authenticated API calls: a browser always sends `Origin`
 * on cross-site POST/PATCH/DELETE, so reject any request from another site.
 */
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, server-to-server)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Invalid request origin.");
  }
  if (originHost !== host) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
}

/**
 * Parses a JSON body, turning malformed JSON into a 422 instead of a 500. An
 * empty body reads as `{}` (for actions whose fields are all optional).
 */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON.");
  }
}

type RouteContext<P> = { params: Promise<P> };

/** The JSON error envelope `{ ok: false, error }` with the matching HTTP status. */
export function apiErrorResponse(error: unknown): NextResponse {
  const safe = toActionError(error);
  return NextResponse.json({ ok: false, error: safe }, { status: httpStatusFor(safe.code) });
}

/**
 * Wraps a Route Handler: same-origin check for writes, JSON envelope
 * `{ ok: true, data }` / `{ ok: false, error }`, and correct HTTP status codes.
 */
export function apiRoute<P = Record<string, never>>(
  handler: (request: Request, params: P) => Promise<unknown>,
  options: { successStatus?: number } = {},
) {
  return async (request: Request, context: RouteContext<P>): Promise<NextResponse> => {
    try {
      if (!SAFE_METHODS.has(request.method)) assertSameOrigin(request);
      const data = await handler(request, await context.params);
      return NextResponse.json({ ok: true, data }, { status: options.successStatus ?? 200 });
    } catch (error) {
      return apiErrorResponse(error);
    }
  };
}
