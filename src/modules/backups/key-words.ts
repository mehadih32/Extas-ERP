/*
 * The recovery key's rules in plain words, shared by the server (keys.ts) and
 * the Backups screen (the strength hint as the owner types). No secrets here.
 */

export const RECOVERY_KEY_MIN = 8;
export const RECOVERY_KEY_MAX = 200;

/** The recovery key as compared: the same letters however they were typed (NFC), ends trimmed. */
export function normalizeRecoveryKey(typed: string): string {
  return typed.normalize("NFC").trim();
}

export type KeyStrength = {
  level: "weak" | "fair" | "strong";
  /** One plain sentence for the screen. */
  hint: string;
  /** Every character can be typed on an ordinary (English) keyboard, as in PuTTY. */
  plainKeyboard: boolean;
};

/** A plain hint about a recovery key: length and variety, nothing more. */
export function keyStrength(typed: string): KeyStrength {
  const key = normalizeRecoveryKey(typed);
  const plainKeyboard = /^[\x20-\x7e]*$/.test(key);
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d\s]/, /\s/].filter((r) => r.test(key)).length;
  const words = key.split(/\s+/).filter(Boolean).length;
  let level: KeyStrength["level"] = "weak";
  if (key.length >= 20 || (key.length >= 14 && kinds >= 3) || words >= 4) level = "strong";
  else if (key.length >= 12 || (key.length >= RECOVERY_KEY_MIN && kinds >= 3)) level = "fair";
  const hint =
    key.length < RECOVERY_KEY_MIN
      ? `Use at least ${RECOVERY_KEY_MIN} characters.`
      : level === "weak"
        ? "Weak: easy to guess. A sentence of 4 or more words you will remember is better."
        : level === "fair"
          ? "Fair. Longer is safer: a short sentence you will remember is best."
          : "Strong. Keep it where you will find it in 5 years.";
  return {
    level,
    hint: plainKeyboard
      ? hint
      : `${hint} It has letters a server keyboard cannot type (such as Bengali): keep it in Google Drive, or use English letters and digits.`,
    plainKeyboard,
  };
}

/** Whether a recovery key can be set: long enough, not too long. Returns the reason when not. */
export function recoveryKeyProblem(typed: string): string | null {
  const key = normalizeRecoveryKey(typed);
  if (key.length < RECOVERY_KEY_MIN) return `Use at least ${RECOVERY_KEY_MIN} characters`;
  if (key.length > RECOVERY_KEY_MAX) return `Use at most ${RECOVERY_KEY_MAX} characters`;
  return null;
}
