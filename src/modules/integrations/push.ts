import { type PlugStatus, providerOf, serverSettings, type Settings } from "./config";

/*
 * Push notifications to phones (task read receipts, notices). Off until
 * PUSH_PROVIDER is set; until then the in-app inbox carries every message, as
 * today. "log" is test mode: each push is written to the server log. Web push
 * to installed phones (with its keys) is added with the employee dashboard.
 */

const SETTINGS = ["PUSH_PROVIDER"] as const;

export type PushMessage = {
  title: string;
  body: string;
  /** The page it opens, e.g. "/me/tasks". */
  url?: string;
};

export type PushSender = {
  provider: "log";
  /** Sends to each user's devices; how many were reached. */
  send: (userIds: readonly string[], message: PushMessage) => Promise<{ sent: number }>;
};

export function pushStatus(settings: Settings = serverSettings()): PlugStatus {
  const { provider, problem } = providerOf(settings, "PUSH_PROVIDER", ["log"] as const);
  return {
    key: "push",
    state: provider === "log" ? "TEST" : "OFF",
    provider,
    settings: SETTINGS,
    problem,
  };
}

/** The sender the settings describe, or null while push is off. */
export function pushSender(settings: Settings = serverSettings()): PushSender | null {
  if (pushStatus(settings).state === "OFF") return null;
  return {
    provider: "log",
    async send(userIds, message) {
      for (const userId of new Set(userIds)) {
        console.info(`[push:test] to ${userId}: ${message.title} | ${message.body}`);
      }
      return { sent: new Set(userIds).size };
    },
  };
}

/** Pushes when push is on; does nothing (the inbox has the message) while it is off. */
export async function pushToUsers(
  userIds: readonly string[],
  message: PushMessage,
  sender: PushSender | null = pushSender(),
): Promise<{ sent: number }> {
  if (!sender || userIds.length === 0) return { sent: 0 };
  try {
    return await sender.send(userIds, message);
  } catch (error) {
    console.error("[push] could not send", error);
    return { sent: 0 };
  }
}
