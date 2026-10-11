/*
 * Outside services ("plugs"): SMS codes, push notifications, bKash/Nagad
 * payouts and Google Maps. Each is switched off until its settings are added to
 * the server (deploy/.env, see deploy/README.md "Outside services"), and the app
 * works without them: staff sign with a drawn signature instead of an SMS code,
 * the inbox carries every notice, salaries are paid as today and the map shows
 * "Open in Google Maps" links. Adding the settings and restarting switches a
 * plug on; no code changes.
 *
 * Settings are read when used (not once at start), so tests can set them.
 */

export type Settings = Readonly<Record<string, string | undefined>>;

/** The process settings, or the ones a test passes. */
export const serverSettings = (): Settings => process.env;

/** A trimmed setting, or null when empty. */
export function setting(settings: Settings, key: string): string | null {
  const value = settings[key]?.trim();
  return value ? value : null;
}

/**
 * Where a plug stands:
 *   OFF   not set up (or set up wrongly: `problem` says what to fix)
 *   TEST  "log" mode: nothing leaves the server, each send is written to the server log
 *   ON    connected to the real service
 */
export type PlugState = "OFF" | "TEST" | "ON";

export type PlugStatus = {
  key: "sms" | "push" | "payouts" | "maps";
  state: PlugState;
  /** The provider chosen: "http", "log"... or null when off. */
  provider: string | null;
  /** The server settings this plug reads. */
  settings: readonly string[];
  /** What is wrong with the settings, when they are there but cannot work. */
  problem: string | null;
};

/** The provider a *_PROVIDER setting names, or a problem when it is not one of the choices. */
export function providerOf<T extends string>(
  settings: Settings,
  key: string,
  choices: readonly T[],
): { provider: T | null; problem: string | null } {
  const value = setting(settings, key)?.toLowerCase() ?? null;
  if (value === null || value === "off" || value === "none")
    return { provider: null, problem: null };
  if ((choices as readonly string[]).includes(value))
    return { provider: value as T, problem: null };
  return {
    provider: null,
    problem: `${key} must be ${["off", ...choices].join(", ").replace(/, ([^,]*)$/, " or $1")}.`,
  };
}
