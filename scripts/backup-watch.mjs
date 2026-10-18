// The late-backup alert that does not depend on the ERP's server (v6.4.1, A13).
// GitHub runs it every 6 hours (.github/workflows/backup-watch.yml): it signs in
// to the owner's Google Drive with its own copy of the ERP's Google sign-in (the
// "drive.file" scope only sees the files the ERP made, which the backups are),
// finds the newest backup that reached Drive whole (its folder is labelled
// "checked" once every file was compared), and tells the owner on Telegram when
// it is late by the owner's schedule, when Drive cannot be read, and once a week
// that all is well. A run started by hand ("Run workflow") always says how it went.
// Backups switched off on purpose (the newest backup's folder says so) are told
// once, at the first run after the switch, then only in the weekly message.
//
// The values come from GitHub's repository secrets, which the ERP fills in itself
// (Settings > Backups, "Set up the alert on GitHub"): nothing is typed or shown.
// GitHub's logs can be public, so this prints only how it went, never a value.
// Node's standard library and fetch only: nothing to install.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The secrets it needs, and what each is (for the line that names the missing ones). */
export const SECRETS = [
  "BACKUP_ALERT_GOOGLE_CLIENT_ID",
  "BACKUP_ALERT_GOOGLE_CLIENT_SECRET",
  "BACKUP_ALERT_GOOGLE_REFRESH_TOKEN",
  "BACKUP_ALERT_TELEGRAM_BOT_TOKEN",
  "BACKUP_ALERT_TELEGRAM_CHAT_ID",
];
/** The ERP's backup folder in Drive (optional: without it, every backup folder the ERP made). */
export const FOLDER_SECRET = "BACKUP_ALERT_DRIVE_FOLDER_ID";
/** A fixed "late after so many hours" (a repository variable), instead of the schedule's. */
export const LATE_HOURS_VARIABLE = "BACKUP_ALERT_LATE_HOURS";

const OAUTH = "https://oauth2.googleapis.com";
const DRIVE = "https://www.googleapis.com/drive/v3";
const TELEGRAM = "https://api.telegram.org";
const FOLDER = "application/vnd.google-apps.folder";
const HOUR = 3_600_000;
/** Late after this when the newest backup does not say when the next one is due. */
export const DEFAULT_LATE_HOURS = 26;
/** How often GitHub runs it on its clock (.github/workflows/backup-watch.yml). */
const RUN_EVERY_MS = 6 * HOUR;
/** Pages of 100 backup folders read at most (5,000 backups). */
const MAX_PAGES = 50;
const TIMEOUT_MS = 30_000;

/** The names of the secrets that are not set. */
export function missingSecrets(env) {
  return SECRETS.filter((name) => !String(env[name] ?? "").trim());
}

/** Something that went wrong, in plain words that never hold a secret. */
export class WatchError extends Error {}

async function call(fetchImpl, url, init, what) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new WatchError(`${what} could not be reached`);
  }
}

/** A Drive access token from the refresh token the ERP sent. */
export async function googleAccessToken(env, fetchImpl = fetch) {
  const response = await call(
    fetchImpl,
    `${OAUTH}/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.BACKUP_ALERT_GOOGLE_CLIENT_ID.trim(),
        client_secret: env.BACKUP_ALERT_GOOGLE_CLIENT_SECRET.trim(),
        refresh_token: env.BACKUP_ALERT_GOOGLE_REFRESH_TOKEN.trim(),
        grant_type: "refresh_token",
      }),
    },
    "Google",
  );
  const body = await response.json().catch(() => ({}));
  if (response.ok && typeof body.access_token === "string") return body.access_token;
  // Google's own error code only ("invalid_grant"), never its whole answer.
  const code = typeof body.error === "string" ? body.error : "";
  if (code === "invalid_grant") {
    throw new WatchError(
      "Google no longer accepts the alert's sign-in (Google Drive was connected again, or the access was taken back)",
    );
  }
  if (code === "invalid_client" || code === "unauthorized_client") {
    throw new WatchError("Google does not know the alert's Google client any more");
  }
  throw new WatchError(`Google did not sign in the alert (HTTP ${response.status})`);
}

/** Every backup folder the ERP made in Drive, newest first (page by page). */
export async function listBackupFolders(token, folderId, fetchImpl = fetch) {
  if (folderId && !/^[A-Za-z0-9_-]{10,200}$/.test(folderId)) {
    throw new WatchError(`${FOLDER_SECRET} is not a Google Drive folder id`);
  }
  const q = [
    `mimeType = '${FOLDER}'`,
    "trashed = false",
    "appProperties has { key='extas' and value='backup' }",
    ...(folderId ? [`'${folderId}' in parents`] : []),
  ].join(" and ");
  const folders = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      q,
      orderBy: "createdTime desc",
      pageSize: "100",
      fields: "nextPageToken,files(id,createdTime,appProperties)",
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await call(
      fetchImpl,
      `${DRIVE}/files?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
      "Google Drive",
    );
    if (!response.ok) {
      throw new WatchError(`Google Drive did not list the backups (HTTP ${response.status})`);
    }
    const body = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.files)) {
      throw new WatchError("Google Drive sent a list that could not be read");
    }
    folders.push(...body.files);
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
    if (!pageToken) break;
  }
  return folders;
}

const timeOf = (text) => {
  const at = typeof text === "string" ? Date.parse(text) : NaN;
  return Number.isNaN(at) ? null : at;
};

/**
 * The newest backup that reached Drive whole: the ERP labels a backup's folder
 * "checked" once every file in it matched the server's, and an update's safety
 * copy (kind SAFETY_COPY) is not a backup, nor is one made by a restored copy
 * waiting on standby (labelled "standby"), which says nothing about the ERP in
 * use. Null when there is none. offAt: when the owner switched backups off (the
 * ERP labels the newest backup so), else null.
 */
export function newestBackup(folders) {
  let newest = null;
  for (const folder of folders) {
    const labels = folder.appProperties ?? {};
    if (labels.checked !== "yes" || labels.kind === "SAFETY_COPY" || labels.standby === "yes") {
      continue;
    }
    const madeAt = timeOf(labels.createdAt) ?? timeOf(folder.createdTime);
    if (madeAt === null) continue;
    if (!newest || madeAt > newest.madeAt) {
      newest = { madeAt, nextAt: timeOf(labels.nextAt), offAt: timeOf(labels.backupsOffAt) };
    }
  }
  return newest;
}

/**
 * Whether the newest backup is late. The ERP labels each backup with when the
 * owner's schedule makes the next one (nextAt); it is late once that time has
 * passed by as long again as the gap between the two (at least 2 hours, at most
 * a day): with backups twice a day, a day after the newest one. A fixed number
 * of hours (the repository variable) wins when set; without either, 26 hours.
 * Backups switched off on purpose are never late ("off", with when).
 * @param {{ madeAt: number, nextAt: number | null, offAt?: number | null } | null} newest
 * @param {number} now
 * @param {number | null} [fixedLateHours]
 */
export function judge(newest, now, fixedLateHours = null) {
  if (!newest) return { state: "none" };
  const ageHours = Math.max(0, Math.floor((now - newest.madeAt) / HOUR));
  if (newest.offAt) {
    return { state: "off", madeAt: newest.madeAt, ageHours, offAt: newest.offAt };
  }
  let lateAt;
  if (fixedLateHours) {
    lateAt = newest.madeAt + fixedLateHours * HOUR;
  } else if (newest.nextAt && newest.nextAt > newest.madeAt) {
    const gap = newest.nextAt - newest.madeAt;
    lateAt = newest.nextAt + Math.min(Math.max(gap, 2 * HOUR), 24 * HOUR);
  } else {
    lateAt = newest.madeAt + DEFAULT_LATE_HOURS * HOUR;
  }
  return { state: now > lateAt ? "late" : "ok", madeAt: newest.madeAt, ageHours, lateAt };
}

const hours = (n) => (n < 1 ? "1 ঘণ্টার কম" : `${n} ঘণ্টা`);
const dhaka = (at) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
const FROM_GITHUB = "(এই খবর GitHub থেকে আসে, ERP-র সার্ভার থেকে নয়।)";

/** The Telegram message for a result, in simple Bengali (Western digits). */
export function telegramText(result) {
  if (result.state === "unreadable") {
    return [
      "⚠️ Extas ERP: ব্যাকআপ দেখা যাচ্ছে না",
      `GitHub থেকে Google Drive-এর ব্যাকআপ পড়া গেল না: ${result.reason}।`,
      "Google Drive আবার যুক্ত করে থাকলে ERP-তে “Settings” > “Backups”-এ “Set up the alert on GitHub” আবার চাপুন। না হলে “Settings” > “Backups” খুলে দেখুন ব্যাকআপ Drive-এ যাচ্ছে কিনা।",
      FROM_GITHUB,
    ].join("\n");
  }
  if (result.state === "none") {
    return [
      "⚠️ Extas ERP: Google Drive-এ কোনো পুরো ব্যাকআপ নেই",
      "ERP-র তৈরি এমন কোনো ব্যাকআপ পাওয়া গেল না যার সব ফাইল Drive-এ মিলিয়ে দেখা হয়েছে।",
      "ERP-তে “Settings” > “Backups” খুলে দেখুন; ERP না খুললে সার্ভার বন্ধ থাকতে পারে।",
      FROM_GITHUB,
    ].join("\n");
  }
  if (result.state === "off") {
    return [
      "ℹ️ Extas ERP: ব্যাকআপ বন্ধ আছে",
      `ERP-তে সময়সূচির ব্যাকআপ বন্ধ করা আছে। Google Drive-এ সবচেয়ে নতুন পুরো ব্যাকআপ ${hours(result.ageHours)} আগের (${dhaka(result.madeAt)})।`,
      "এটা আপনি নিজে বন্ধ না করে থাকলে, বা আবার চালু করতে চাইলে, ERP-তে “Settings” > “Backups” খুলুন। বন্ধ থাকলে এই খবর সপ্তাহে একবার আসে।",
      FROM_GITHUB,
    ].join("\n");
  }
  if (result.state === "late") {
    return [
      "⚠️ Extas ERP: ব্যাকআপ দেরি হচ্ছে",
      `Google Drive-এ সবচেয়ে নতুন পুরো ব্যাকআপ ${hours(result.ageHours)} আগের (${dhaka(result.madeAt)}); আপনার সময়সূচি অনুযায়ী এর মধ্যে নতুন ব্যাকআপ আসার কথা ছিল।`,
      "ERP-তে “Settings” > “Backups” খুলে দেখুন। ERP না খুললে সার্ভার বন্ধ থাকতে পারে: তখন সার্ভারটি চালু করুন বা আপনার কারিগরি সাহায্যকারীকে জানান।",
      FROM_GITHUB,
    ].join("\n");
  }
  return [
    "✅ Extas ERP: ব্যাকআপ ঠিক আছে",
    `Google Drive-এ সবচেয়ে নতুন পুরো ব্যাকআপ ${hours(result.ageHours)} আগের (${dhaka(result.madeAt)})।`,
    FROM_GITHUB,
  ].join("\n");
}

/** The weekly "all is well": the scheduled run on Saturday 00:00 to 05:59 UTC (06:00 to 11:59 in Dhaka). */
export function weeklyNoteDue(now, event) {
  const at = new Date(now);
  return event === "schedule" && at.getUTCDay() === 6 && at.getUTCHours() < 6;
}

/** Sends one message to the owner's Telegram chat. */
export async function sendTelegram(env, text, fetchImpl = fetch) {
  const response = await call(
    fetchImpl,
    `${TELEGRAM}/bot${env.BACKUP_ALERT_TELEGRAM_BOT_TOKEN.trim()}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.BACKUP_ALERT_TELEGRAM_CHAT_ID.trim(),
        text,
        disable_web_page_preview: true,
      }),
    },
    "Telegram",
  );
  if (!response.ok) {
    throw new WatchError(
      `Telegram did not take the message (HTTP ${response.status}): set up the alert again from the Backups screen`,
    );
  }
}

const lateHoursOf = (env) => {
  const n = Number(String(env[LATE_HOURS_VARIABLE] ?? "").trim());
  return Number.isFinite(n) && n >= 1 && n <= 24 * 60 ? n : null;
};

/**
 * One check: 0 when the newest backup is on time (and any message went), 1 when
 * it is late, missing or Drive could not be read (the owner was told), or the
 * alert itself could not work. `log` gets plain lines only.
 */
export async function watch({
  env,
  fetchImpl = fetch,
  now = Date.now(),
  event = "schedule",
  log = console.log,
}) {
  const missing = missingSecrets(env);
  if (missing.length === SECRETS.length && event === "schedule") {
    // Not set up yet: a failed run would make GitHub email the owner every 6 hours.
    log(
      `::notice::The backup alert is not set up yet, so there is nothing to check (Settings > Backups, "Set up the alert on GitHub").`,
    );
    return 0;
  }
  if (missing.length) {
    log(
      `The backup alert is not set up: add the GitHub secrets ${missing.join(", ")} (the ERP adds them all: Settings > Backups, "Set up the alert on GitHub").`,
    );
    return 1;
  }
  let result;
  try {
    const token = await googleAccessToken(env, fetchImpl);
    const folders = await listBackupFolders(
      token,
      String(env[FOLDER_SECRET] ?? "").trim(),
      fetchImpl,
    );
    result = judge(newestBackup(folders), now, lateHoursOf(env));
  } catch (error) {
    const reason = error instanceof WatchError ? error.message : "it stopped";
    result = { state: "unreadable", reason };
  }
  if (result.state === "ok") {
    log(`OK: the newest backup in Google Drive is ${result.ageHours} hour(s) old.`);
  } else if (result.state === "off") {
    log(
      `Backups are switched off on the Backups screen; the newest backup in Google Drive is ${result.ageHours} hour(s) old.`,
    );
  } else if (result.state === "late") {
    log(`Late: the newest backup in Google Drive is ${result.ageHours} hour(s) old.`);
  } else if (result.state === "none") {
    log("No backup that reached Google Drive whole was found.");
  } else {
    log(`Google Drive could not be read: ${result.reason}.`);
  }
  // Switched off on purpose: said at the first run after the switch, then weekly.
  const quiet =
    result.state === "ok" ||
    (result.state === "off" && !(now >= result.offAt && now < result.offAt + RUN_EVERY_MS));
  const tell = !quiet || event !== "schedule" || weeklyNoteDue(now, event);
  if (tell) {
    try {
      await sendTelegram(env, telegramText(result), fetchImpl);
      log("The owner was told on Telegram.");
    } catch (error) {
      log(error instanceof WatchError ? `${error.message}.` : "Telegram could not be told.");
      return 1;
    }
  }
  return result.state === "ok" || result.state === "off" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await watch({ env: process.env, event: process.env.EVENT || "schedule" });
}
