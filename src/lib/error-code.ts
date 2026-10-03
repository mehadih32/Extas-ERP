/*
 * The code a person reads out to support when a screen fails (blueprint: "An
 * error occurred. Error Code: [Random ID]"). Safe to use in the browser.
 *   Server failures carry Next.js' digest, which the server log prints next to the
 *   error as [ERR-<digest>] (see instrumentation.ts), so support can find it.
 *   Failures inside the browser get a random code, logged to the browser console.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "ERR-7F3K9Q2M": a random code for an error that never reached the server. */
export function randomErrorCode(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `ERR-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

/** The code for a failed screen: the server's digest when there is one. */
export function errorCodeFor(error: { digest?: string }): string {
  const digest = error.digest?.trim();
  return digest && /^[\w-]{1,64}$/.test(digest) ? `ERR-${digest}` : randomErrorCode();
}

/** The blueprint's wording, also used by the Server Actions (src/lib/result.ts). */
export function errorMessageFor(code: string): string {
  return `An error occurred. Error Code: ${code}. Please share this with your technical support.`;
}
