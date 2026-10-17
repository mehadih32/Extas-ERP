/*
 * The recovery key's rules in plain words, shared by the server (keys.ts) and
 * the Backups screen (the strength hint as the owner types). No secrets here.
 */

export const RECOVERY_KEY_MIN = 6;
export const RECOVERY_KEY_MAX = 200;
/** Below this the key is accepted, with a gentle warning (never a block). */
export const RECOVERY_KEY_SAFER = 10;

/** The recovery key as compared: the same letters however they were typed (NFC), ends trimmed. */
export function normalizeRecoveryKey(typed: string): string {
  return typed.normalize("NFC").trim();
}

/** Characters as a person counts them: letters, digits, symbols or Bengali, one each. */
function characters(key: string): number {
  return [...key].length;
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
  const length = characters(key);
  const plainKeyboard = /^[\x20-\x7e]*$/.test(key);
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d\s]/, /\s/].filter((r) => r.test(key)).length;
  const words = key.split(/\s+/).filter(Boolean).length;
  let level: KeyStrength["level"] = "weak";
  if (length >= RECOVERY_KEY_SAFER) {
    if (length >= 20 || (length >= 14 && kinds >= 3) || words >= 4) level = "strong";
    else if (length >= 12 || kinds >= 3) level = "fair";
  }
  const hint =
    length < RECOVERY_KEY_MIN
      ? `Use at least ${RECOVERY_KEY_MIN} characters.`
      : length < RECOVERY_KEY_SAFER
        ? `Short: it works, but ${RECOVERY_KEY_SAFER} or more characters is safer. A sentence of 4 or more words you will remember is best.`
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
  const length = characters(normalizeRecoveryKey(typed));
  if (length < RECOVERY_KEY_MIN) return `Use at least ${RECOVERY_KEY_MIN} characters`;
  if (length > RECOVERY_KEY_MAX) return `Use at most ${RECOVERY_KEY_MAX} characters`;
  return null;
}
