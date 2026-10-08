import { AppError } from "@/lib/errors";

/*
 * A rule's answer to "may this be done?". Services refuse with it and screens
 * read the same answer to decide which buttons to show, so a screen never offers
 * what the server refuses (or hides what it allows).
 */

export type Verdict = { ok: true } | { ok: false; code: "FORBIDDEN" | "CONFLICT"; message: string };

export const ALLOWED: Verdict = { ok: true };

export function refuse(code: "FORBIDDEN" | "CONFLICT", message: string): Verdict {
  return { ok: false, code, message };
}

/** Throws the refusal as the AppError the API and Server Actions report. */
export function assertAllowed(verdict: Verdict): void {
  if (!verdict.ok) throw new AppError(verdict.code, verdict.message);
}
