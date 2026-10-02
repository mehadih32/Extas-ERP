import { randomBytes } from "node:crypto";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NO_COMPANY"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK" // UI shows the "Force Override & Sell" warning
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "RATE_LIMITED"
  | "UNAVAILABLE" // an outside service (e.g. the AI reader) is not set up or not answering
  | "INTERNAL";

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NO_COMPANY: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS[code];
}

/**
 * An expected, user-safe error. Its message may be shown to the user.
 * Anything that is not an AppError is treated as an internal error and only
 * its generated error ID is shown (blueprint: "Error Code: [Random ID]").
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
  }
}

/** Short random ID users can quote to support, e.g. "ERR-7F3K9Q2M". */
export function newErrorId(): string {
  return `ERR-${randomBytes(5).toString("base64url").toUpperCase().slice(0, 8)}`;
}
