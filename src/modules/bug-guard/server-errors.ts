import { isCheckToken } from "@/lib/auth/check-token";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { hashSessionToken } from "@/lib/auth/token";
import { prisma } from "@/lib/prisma";
import { readOnlyReason } from "@/lib/read-only";
import { errorTypeOf, ourStackLines, safeRoute } from "@/modules/ai/full-check/texts";

/*
 * The server's errors, kept for Bug Guard (checks/app.ts): every error Next.js
 * catches while showing a screen or running a Server Action
 * (instrumentation.ts), every unexpected error behind the API and the Server
 * Actions (lib/result.ts) and every background job that gave up. Only what
 * helps find the cause: the route pattern ("/sales/orders/[id]"), the error's
 * type, a short message with numbers, quotes and addresses taken out, and the
 * stack lines from the ERP's own code. Never a screen's text or a person's
 * data. Recording never throws and never holds up the request; a flood is cut
 * off at 60 a minute.
 */

const PER_MINUTE = 60;
let windowStart = 0;
let inWindow = 0;

function allowed(now: number) {
  if (now - windowStart > 60_000) {
    windowStart = now;
    inWindow = 0;
  }
  inWindow += 1;
  return inWindow <= PER_MINUTE;
}

/**
 * An error's message with what could be data taken out: quoted text, numbers,
 * e-mail and web addresses, long ids. Kept short.
 */
export function plainMessage(message: string): string {
  return message
    .split("\n")[0]!
    .replace(/https?:\/\/\S+/g, "<address>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .replace(/(["'`])(?:(?!\1).){0,400}\1/g, "<text>")
    .replace(/\b[a-z0-9]{20,}\b/gi, "<id>")
    .replace(/\d+(\.\d+)?/g, "#")
    .slice(0, 200);
}

/** A path with its ids taken out, as a pattern ("/sales/orders/[id]"). */
export const routeOf = (path: string) => safeRoute(path);

export type ServerErrorInput = {
  error: unknown;
  routeType: "render" | "route" | "action" | "proxy" | "api" | "job";
  method?: string | null;
  /** The route pattern, or a path (made a pattern here), or a job's kind. */
  path: string;
  digest?: string | null;
  errorId?: string | null;
  companyId?: string | null;
  /** The request's cookie header, to find the store (never kept). */
  cookie?: string | null;
};

function tokenIn(cookie: string | null | undefined) {
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

async function companyOf(cookie: string | null | undefined): Promise<string | null | false> {
  const token = tokenIn(cookie);
  if (!token) return null;
  // The Full check reports its own problems; it never writes on the live site.
  if (isCheckToken(token)) return false;
  const session = await prisma.session.findUnique({
    where: { token: hashSessionToken(token) },
    select: { activeCompanyId: true },
  });
  return session?.activeCompanyId ?? null;
}

/** Keeps one server error (never throws). */
export async function recordServerError(input: ServerErrorInput): Promise<void> {
  try {
    if (!allowed(Date.now())) return;
    if (await readOnlyReason()) return;
    const company = input.companyId ?? (await companyOf(input.cookie));
    if (company === false) return;
    const error = input.error;
    const name =
      error instanceof Error
        ? (errorTypeOf(error.name) ?? "Error")
        : typeof error === "string"
          ? "Error"
          : "Unknown";
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "No message";
    const stack = error instanceof Error && error.stack ? error.stack.split("\n").slice(1) : [];
    const path =
      input.routeType === "job" ? input.path.slice(0, 80) : routeOf(input.path).slice(0, 300);
    await prisma.serverError.create({
      data: {
        companyId: company,
        routeType: input.routeType,
        method: input.method?.slice(0, 10) ?? null,
        path,
        errorName: name.slice(0, 80),
        message: plainMessage(message),
        stack: ourStackLines(stack.map((l) => l.trim())),
        digest: input.digest?.slice(0, 64) ?? null,
        errorId: input.errorId?.slice(0, 40) ?? null,
      },
    });
  } catch (inner) {
    console.error(
      "[bug-guard] server error not kept",
      inner instanceof Error ? inner.message : inner,
    );
  }
}
