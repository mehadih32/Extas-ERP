import { httpStatusFor } from "@/lib/errors";
import { toActionError } from "@/lib/result";

/*
 * Errors of the e-commerce API, always JSON in the contract's shape (CN-005):
 *   { "error": { "code": "...", "message": "...", "details": ... } }
 * Codes the shop can act on: UNAUTHENTICATED (no or wrong key), FORBIDDEN,
 * IP_NOT_ALLOWED, HTTPS_REQUIRED, BAD_SIGNATURE, STALE_TIMESTAMP,
 * IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_KEY_REUSED, IDEMPOTENCY_IN_PROGRESS,
 * RATE_LIMITED, VALIDATION, NOT_FOUND, CONFLICT, INSUFFICIENT_STOCK (409, with
 * the short SKUs in details), UNAVAILABLE and INTERNAL (with an error id to quote).
 */

export class EcommerceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "EcommerceApiError";
  }
}

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

/** Any thrown value as the status and body the shop gets. Unexpected errors keep only an id. */
export function toApiError(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof EcommerceApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }
  const safe = toActionError(error);
  const details = safe.fieldErrors ?? (safe.errorId ? { errorId: safe.errorId } : undefined);
  return {
    status: httpStatusFor(safe.code),
    body: {
      error: { code: safe.code, message: safe.message, ...(details ? { details } : {}) },
    },
  };
}
