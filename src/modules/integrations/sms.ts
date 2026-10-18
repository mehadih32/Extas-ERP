import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";

import { type PlugStatus, providerOf, serverSettings, setting, type Settings } from "./config";

/*
 * SMS (one-time codes, later reminders). Off until SMS_PROVIDER is set:
 *   log   test mode: the message is written to the server log, nothing is sent
 *   http  any Bangladeshi or global SMS gateway with an HTTP API, described by
 *         SMS_HTTP_URL (and SMS_HTTP_BODY for POST). Placeholders are filled in:
 *           {to}        8801711000000 (country code, no plus)
 *           {to_local}  01711000000
 *           {text}      the message
 *           {sender}    SMS_SENDER_ID
 *           {key}       SMS_API_KEY
 *         e.g. SMS_HTTP_URL=https://gateway.example/send?api_key={key}&to={to}&from={sender}&msg={text}
 *         SMS_HTTP_SUCCESS (optional) is text the gateway's answer must contain.
 * Every send is kept in the notification log (channel SMS) with the text a
 * caller chose to keep: a code is never stored.
 */

const SETTINGS = [
  "SMS_PROVIDER",
  "SMS_HTTP_URL",
  "SMS_HTTP_METHOD",
  "SMS_HTTP_BODY",
  "SMS_HTTP_SUCCESS",
  "SMS_API_KEY",
  "SMS_SENDER_ID",
] as const;

export type SmsMessage = {
  /** A Bangladeshi mobile number, as typed: "01711-000000", "+8801711000000". */
  to: string;
  text: string;
};

export type SmsResult =
  { ok: true; providerMessageId: string | null } | { ok: false; error: string };

export type SmsGateway = {
  provider: "log" | "http";
  send: (message: SmsMessage) => Promise<SmsResult>;
};

type Fetch = typeof fetch;

/** "01711-000000", "+880 1711 000000", "8801711000000" → "01711000000"; null when not a BD mobile. */
export function bdMobile(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "").replace(/^\+/, "");
  const local = digits.startsWith("880") ? `0${digits.slice(3)}` : digits;
  return /^01[3-9]\d{8}$/.test(local) ? local : null;
}

type Fill = (value: string) => string;

/** The template with each {placeholder} filled in, each value made safe by `fill`. */
export function fillTemplate(template: string, values: Record<string, string>, fill: Fill): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? fill(values[name]!) : whole,
  );
}

const asJsonText: Fill = (value) => JSON.stringify(value).slice(1, -1);

function status(settings: Settings): PlugStatus {
  const { provider, problem } = providerOf(settings, "SMS_PROVIDER", ["log", "http"] as const);
  const base = { key: "sms" as const, settings: SETTINGS, provider };
  if (problem) return { ...base, state: "OFF", problem };
  if (provider === null) return { ...base, state: "OFF", problem: null };
  if (provider === "log") return { ...base, state: "TEST", problem: null };
  const url = setting(settings, "SMS_HTTP_URL");
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ...base, state: "OFF", problem: "SMS_HTTP_URL must be the gateway's web address." };
  }
  const method = (setting(settings, "SMS_HTTP_METHOD") ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return { ...base, state: "OFF", problem: "SMS_HTTP_METHOD must be GET or POST." };
  }
  if (method === "POST" && !setting(settings, "SMS_HTTP_BODY")) {
    return { ...base, state: "OFF", problem: "SMS_HTTP_BODY is needed for POST." };
  }
  return { ...base, state: "ON", problem: null };
}

export function smsStatus(settings: Settings = serverSettings()): PlugStatus {
  return status(settings);
}

/** The gateway the settings describe, or null while SMS is off. */
export function smsGateway(
  settings: Settings = serverSettings(),
  doFetch: Fetch = fetch,
): SmsGateway | null {
  const s = status(settings);
  if (s.state === "OFF") return null;
  if (s.provider === "log") {
    return {
      provider: "log",
      async send(message) {
        console.info(`[sms:test] to ${message.to}: ${message.text}`);
        return { ok: true, providerMessageId: null };
      },
    };
  }
  const url = setting(settings, "SMS_HTTP_URL")!;
  const method = (setting(settings, "SMS_HTTP_METHOD") ?? "GET").toUpperCase();
  const body = setting(settings, "SMS_HTTP_BODY");
  const success = setting(settings, "SMS_HTTP_SUCCESS");
  return {
    provider: "http",
    async send(message) {
      const local = bdMobile(message.to);
      if (!local) return { ok: false, error: "Not a Bangladeshi mobile number." };
      const values = {
        to: `88${local}`,
        to_local: local,
        text: message.text,
        sender: setting(settings, "SMS_SENDER_ID") ?? "",
        key: setting(settings, "SMS_API_KEY") ?? "",
      };
      const json = body?.trimStart().startsWith("{") ?? false;
      let response: Response;
      try {
        response = await doFetch(fillTemplate(url, values, encodeURIComponent), {
          method,
          ...(method === "POST" && body
            ? {
                headers: {
                  "content-type": json ? "application/json" : "application/x-www-form-urlencoded",
                },
                body: fillTemplate(body, values, json ? asJsonText : encodeURIComponent),
              }
            : {}),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        console.error("[sms] the gateway could not be reached", error);
        return { ok: false, error: "The SMS gateway could not be reached." };
      }
      const answer = await response.text().catch(() => "");
      if (!response.ok || (success && !answer.includes(success))) {
        console.error(`[sms] the gateway refused (${response.status})`, answer.slice(0, 300));
        return { ok: false, error: `The SMS gateway refused the message (${response.status}).` };
      }
      return { ok: true, providerMessageId: answer.trim().slice(0, 120) || null };
    },
  };
}

/**
 * Sends an SMS and keeps it in the notification log. `keep` is the text stored
 * there (a code hidden). Refused while SMS is off, so callers offer the other
 * way (a drawn signature) instead.
 */
export async function sendSms(
  db: Db,
  companyId: string,
  message: SmsMessage & { keep: string; employeeId?: string | null; userId?: string | null },
  gateway: SmsGateway | null = smsGateway(),
): Promise<SmsResult> {
  if (!gateway) {
    throw new AppError("UNAVAILABLE", "SMS is not connected yet.");
  }
  // A restore drill copy (test mode) sends no SMS; the log says so.
  const { DRILL_NOT_SENT, onDrill } = await import("@/modules/backups/standby");
  const result: SmsResult = (await onDrill())
    ? { ok: false, error: DRILL_NOT_SENT }
    : await gateway.send({ to: message.to, text: message.text });
  await db.notificationLog.create({
    data: {
      companyId,
      channel: "SMS",
      recipient: bdMobile(message.to) ?? message.to.slice(0, 40),
      userId: message.userId ?? null,
      employeeId: message.employeeId ?? null,
      body: message.keep.slice(0, 2000),
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.ok ? result.providerMessageId : null,
      error: result.ok ? null : result.error,
      sentAt: result.ok ? new Date() : null,
    },
  });
  return result;
}
