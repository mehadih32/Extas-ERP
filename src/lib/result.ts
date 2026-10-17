import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { errorMessageFor } from "@/lib/error-code";
import { AppError, newErrorId, type ErrorCode } from "@/lib/errors";

export type ActionError = {
  code: ErrorCode;
  message: string;
  errorId?: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** Converts any thrown value into a safe, serialisable error. Internal errors are logged. */
export function toActionError(error: unknown): ActionError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, fieldErrors: error.details };
  }
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { code: "VALIDATION", message: "Please check the highlighted fields.", fieldErrors };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint (e.g. duplicate SKU or name) and "record not found".
    if (error.code === "P2002") {
      return { code: "CONFLICT", message: "A record with these details already exists." };
    }
    if (error.code === "P2025") {
      return { code: "NOT_FOUND", message: "The record was not found." };
    }
  }
  const errorId = newErrorId();
  console.error(`[${errorId}]`, error);
  return {
    code: "INTERNAL",
    message: errorMessageFor(errorId),
    errorId,
  };
}

/** Runs a Server Action body and always returns an ActionResult instead of throwing. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    // Let Next.js redirects / notFound propagate.
    if (isNextControlFlowError(error)) throw error;
    const safe = toActionError(error);
    if (safe.code === "INTERNAL") void noteActionError(error, safe.errorId);
    return { ok: false, error: safe };
  }
}

/** Keeps an unexpected Server Action error for Bug Guard, with the screen it came from. */
async function noteActionError(error: unknown, errorId: string | undefined) {
  try {
    const { headers } = await import("next/headers");
    const all = await headers();
    const from = all.get("referer");
    const { recordServerError } = await import("@/modules/bug-guard/server-errors");
    await recordServerError({
      error,
      routeType: "action",
      method: "POST",
      path: from ? new URL(from).pathname : "/",
      errorId,
      cookie: all.get("cookie"),
    });
  } catch {
    // Outside a request (a test or a script): nothing to keep.
  }
}

function isNextControlFlowError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" && (digest.startsWith("NEXT_") || digest === "DYNAMIC_SERVER_USAGE")
  );
}
