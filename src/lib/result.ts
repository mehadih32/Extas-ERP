import { ZodError } from "zod";

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
  const errorId = newErrorId();
  console.error(`[${errorId}]`, error);
  return {
    code: "INTERNAL",
    message: `An error occurred. Error Code: ${errorId}. Please share this with your technical support.`,
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
    return { ok: false, error: toActionError(error) };
  }
}

function isNextControlFlowError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" && (digest.startsWith("NEXT_") || digest === "DYNAMIC_SERVER_USAGE")
  );
}
