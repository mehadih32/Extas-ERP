import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  judge,
  missingSecrets,
  newestBackup,
  SECRETS,
  telegramText,
  watch,
  weeklyNoteDue,
} from "../../scripts/backup-watch.mjs";

/*
 * v6.4.1 (A13): the late-backup alert that runs on GitHub, not on the ERP's
 * server (scripts/backup-watch.mjs, .github/workflows/backup-watch.yml). It
 * reads the backup folders the ERP made in Google Drive, page by page, and
 * tells the owner on Telegram when the newest whole backup is late, when Drive
 * cannot be read, and once a week that all is well. Google and Telegram are
 * played by a stand-in fetch here; no secret ever reaches the log.
 */

const H = 3_600_000;
const NOW = Date.parse("2026-10-21T08:00:00Z"); // a Wednesday

const ENV = {
  BACKUP_ALERT_GOOGLE_CLIENT_ID: "client-id-123.apps.googleusercontent.com",
  BACKUP_ALERT_GOOGLE_CLIENT_SECRET: "client-secret-SHOULD-NOT-LEAK",
  BACKUP_ALERT_GOOGLE_REFRESH_TOKEN: "1//refresh-token-SHOULD-NOT-LEAK",
  BACKUP_ALERT_TELEGRAM_BOT_TOKEN: "123456:bot-token-SHOULD-NOT-LEAK",
  BACKUP_ALERT_TELEGRAM_CHAT_ID: "987654321",
};

type Folder = { id: string; createdTime?: string; appProperties?: Record<string, string> };

const backup = (hoursAgo: number, extra: Record<string, string> = {}): Folder => {
  const at = new Date(NOW - hoursAgo * H).toISOString();
  return {
    id: `f${hoursAgo}`,
    createdTime: at,
    appProperties: { extas: "backup", kind: "BACKUP", createdAt: at, checked: "yes", ...extra },
  };
};

/** A stand-in for Google and Telegram; `pages` are Drive's answers in order. */
function stand(options: {
  pages?: Folder[][];
  token?: { status: number; body: unknown };
  drive?: number;
  telegram?: number;
}) {
  const calls: Array<{ url: string; body: string; auth: string | null }> = [];
  const sent: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    calls.push({ url, body: String(init.body ?? ""), auth: headers.get("authorization") });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const t = options.token ?? { status: 200, body: { access_token: "access-SHOULD-NOT-LEAK" } };
      return json(t.status, t.body);
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
      if (options.drive && options.drive !== 200) return json(options.drive, { error: "no" });
      const pageToken = new URL(url).searchParams.get("pageToken");
      const index = pageToken ? Number(pageToken.slice(1)) : 0;
      const pages = options.pages ?? [[]];
      return json(200, {
        files: pages[index] ?? [],
        ...(index + 1 < pages.length ? { nextPageToken: `p${index + 1}` } : {}),
      });
    }
    if (url.startsWith("https://api.telegram.org/bot")) {
      sent.push((JSON.parse(String(init.body)) as { text: string }).text);
      return json(options.telegram ?? 200, { ok: (options.telegram ?? 200) === 200 });
    }
    throw new Error(`unexpected call ${url}`);
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, sent };
}

async function run(
  options: Parameters<typeof stand>[0],
  more: { env?: Record<string, string>; now?: number; event?: string } = {},
) {
  const s = stand(options);
  const lines: string[] = [];
  const code = await watch({
    env: { ...ENV, ...more.env },
    fetchImpl: s.fetchImpl,
    now: more.now ?? NOW,
    event: more.event ?? "schedule",
    log: (line: string) => lines.push(line),
  });
  const log = lines.join("\n");
  // Nothing secret is ever printed (GitHub's logs can be public).
  for (const value of [...Object.values(ENV), "access-SHOULD-NOT-LEAK"]) {
    if (value !== ENV.BACKUP_ALERT_TELEGRAM_CHAT_ID) expect(log).not.toContain(value);
  }
  expect(log).not.toMatch(/SHOULD-NOT-LEAK|api\.telegram\.org|googleapis/);
  return { code, log, ...s };
}

describe("the late-backup alert on GitHub (A13): what it decides", () => {
  it("names each missing secret in one line, and fails", async () => {
    expect(missingSecrets(ENV)).toEqual([]);
    expect(missingSecrets({ ...ENV, BACKUP_ALERT_TELEGRAM_CHAT_ID: " " })).toEqual([
      "BACKUP_ALERT_TELEGRAM_CHAT_ID",
    ]);
    const lines: string[] = [];
    const code = await watch({ env: {}, log: (l: string) => lines.push(l) });
    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    for (const name of SECRETS) expect(lines[0]).toContain(name);
    expect(lines[0]).toMatch(/^The backup alert is not set up: add the GitHub secrets /);
    expect(lines[0]).toContain("Set up the alert on GitHub");
  });

  it("takes the newest backup that reached Drive whole, never a safety copy or a half-sent one", () => {
    expect(newestBackup([])).toBeNull();
    const newest = newestBackup([
      backup(30),
      backup(2, { checked: "no" }),
      backup(1, { kind: "SAFETY_COPY" }),
      backup(5, { nextAt: new Date(NOW + 7 * H).toISOString() }),
      { id: "x", appProperties: { extas: "backup", checked: "yes" } },
    ]);
    expect(newest).toEqual({ madeAt: NOW - 5 * H, nextAt: NOW + 7 * H });
  });

  it("is late once the next backup's time has passed by as long again (2 hours to a day)", () => {
    // Twice a day: the newest at 14:00, the next due at 02:00; late from 14:00 the day after.
    const twice = { madeAt: NOW - 23 * H, nextAt: NOW - 11 * H };
    expect(judge(twice, NOW)).toMatchObject({ state: "ok", ageHours: 23 });
    expect(judge(twice, NOW + 2 * H)).toMatchObject({ state: "late", ageHours: 25 });
    // Every hour: late 2 hours after the next one was due.
    const hourly = { madeAt: NOW - 3 * H, nextAt: NOW - 2 * H };
    expect(judge(hourly, NOW).state).toBe("ok");
    expect(judge(hourly, NOW + 1).state).toBe("late");
    // Once a week: late a day after the next one was due, not a week.
    const weekly = { madeAt: NOW - 8 * 24 * H, nextAt: NOW - 24 * H };
    expect(judge(weekly, NOW).state).toBe("ok");
    expect(judge(weekly, NOW + 1).state).toBe("late");
    // No "next" label (a backup from before v6.4.1): 26 hours.
    expect(judge({ madeAt: NOW - 25 * H, nextAt: null }, NOW).state).toBe("ok");
    expect(judge({ madeAt: NOW - 27 * H, nextAt: null }, NOW).state).toBe("late");
    // The owner's fixed number of hours wins.
    expect(judge(twice, NOW, 12).state).toBe("late");
    expect(judge(null, NOW)).toEqual({ state: "none" });
  });

  it("says the weekly all-is-well on Saturday morning's scheduled run only", () => {
    const saturday = Date.parse("2026-10-24T03:17:00Z");
    expect(weeklyNoteDue(saturday, "schedule")).toBe(true);
    expect(weeklyNoteDue(saturday + 6 * H, "schedule")).toBe(false);
    expect(weeklyNoteDue(NOW, "schedule")).toBe(false);
    expect(weeklyNoteDue(saturday, "workflow_dispatch")).toBe(false);
  });

  it("writes plain Bengali with Western digits", () => {
    const late = telegramText({ state: "late", ageHours: 30, madeAt: NOW - 30 * H });
    expect(late).toContain("ব্যাকআপ দেরি হচ্ছে");
    expect(late).toContain("30 ঘণ্টা আগের");
    expect(late).toContain("GitHub থেকে");
    expect(late).not.toMatch(/[০-৯]/);
    expect(telegramText({ state: "unreadable", reason: "Google answered 500" })).toContain(
      "Google answered 500",
    );
    expect(telegramText({ state: "none" })).toContain("কোনো পুরো ব্যাকআপ নেই");
    expect(telegramText({ state: "ok", ageHours: 0, madeAt: NOW })).toContain("1 ঘণ্টার কম");
  });
});

describe("the late-backup alert on GitHub (A13): one run", () => {
  it("reads every page, and stays quiet on a weekday when the newest backup is on time", async () => {
    const r = await run({
      pages: [
        [backup(40), backup(30)],
        [backup(20)],
        [backup(6, { nextAt: new Date(NOW + 6 * H).toISOString() })],
      ],
    });
    expect(r.code).toBe(0);
    expect(r.log).toContain("OK: the newest backup in Google Drive is 6 hour(s) old.");
    expect(r.sent).toEqual([]);
    const drive = r.calls.filter((c) => c.url.includes("/drive/v3/files?"));
    expect(drive).toHaveLength(3);
    const q = new URL(drive[0]!.url).searchParams;
    expect(q.get("orderBy")).toBe("createdTime desc");
    expect(q.get("q")).toContain("appProperties has { key='extas' and value='backup' }");
    expect(q.get("q")).toContain("trashed = false");
    expect(drive[0]!.auth).toBe("Bearer access-SHOULD-NOT-LEAK");
    // Google is asked with the refresh token, Drive only with the access token.
    const token = r.calls.find((c) => c.url.includes("oauth2"))!;
    expect(new URLSearchParams(token.body).get("grant_type")).toBe("refresh_token");
  });

  it("limits the list to the ERP's backup folder when its id is given", async () => {
    const r = await run(
      { pages: [[backup(3)]] },
      { env: { BACKUP_ALERT_DRIVE_FOLDER_ID: "1AbCdEfGhIjKlMnOp" } },
    );
    expect(r.code).toBe(0);
    const q = new URL(r.calls.find((c) => c.url.includes("/files?"))!.url).searchParams.get("q");
    expect(q).toContain("'1AbCdEfGhIjKlMnOp' in parents");
    const bad = await run({}, { env: { BACKUP_ALERT_DRIVE_FOLDER_ID: "x' or '1'='1" } });
    expect(bad.code).toBe(1);
    expect(bad.log).toContain("is not a Google Drive folder id");
  });

  it("tells the owner when the newest backup is late, and fails the run", async () => {
    const r = await run({ pages: [[backup(30), backup(50)]] });
    expect(r.code).toBe(1);
    expect(r.log).toContain("Late: the newest backup in Google Drive is 30 hour(s) old.");
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toContain("ব্যাকআপ দেরি হচ্ছে");
    const telegram = r.calls.find((c) => c.url.includes("telegram"))!;
    expect(JSON.parse(telegram.body)).toMatchObject({ chat_id: "987654321" });
  });

  it("tells the owner when there is no whole backup in Drive", async () => {
    const r = await run({ pages: [[backup(1, { checked: "no" })]] });
    expect(r.code).toBe(1);
    expect(r.sent[0]).toContain("কোনো পুরো ব্যাকআপ নেই");
  });

  it("tells the owner when Google or Drive cannot be read, in plain words", async () => {
    const revoked = await run({ token: { status: 400, body: { error: "invalid_grant" } } });
    expect(revoked.code).toBe(1);
    expect(revoked.log).toContain("Google no longer accepts the alert's sign-in");
    expect(revoked.sent[0]).toContain("Set up the alert on GitHub");

    const refused = await run({ drive: 403 });
    expect(refused.code).toBe(1);
    expect(refused.log).toContain("Google Drive did not list the backups (HTTP 403)");
    expect(refused.sent).toHaveLength(1);

    // Google cannot be reached at all.
    const lines: string[] = [];
    const down = await watch({
      env: ENV,
      now: NOW,
      log: (l: string) => lines.push(l),
      fetchImpl: (async (url: string) => {
        if (url.includes("telegram")) return new Response("{}", { status: 200 });
        throw new Error(`connect ECONNREFUSED ${ENV.BACKUP_ALERT_GOOGLE_REFRESH_TOKEN}`);
      }) as unknown as typeof fetch,
    });
    expect(down).toBe(1);
    expect(lines.join("\n")).toContain("Google could not be reached");
    expect(lines.join("\n")).not.toContain(ENV.BACKUP_ALERT_GOOGLE_REFRESH_TOKEN);
  });

  it("says all is well once a week, and every time it is run by hand", async () => {
    const saturday = Date.parse("2026-10-24T03:17:00Z");
    const fresh: Folder = {
      id: "s",
      appProperties: {
        extas: "backup",
        kind: "BACKUP",
        checked: "yes",
        createdAt: new Date(saturday - 3 * H).toISOString(),
      },
    };
    const ok = await run({ pages: [[fresh]] }, { now: saturday });
    expect(ok.code).toBe(0);
    expect(ok.sent).toHaveLength(1);
    expect(ok.sent[0]).toContain("ব্যাকআপ ঠিক আছে");

    const byHand = await run({ pages: [[backup(2)]] }, { event: "workflow_dispatch" });
    expect(byHand.code).toBe(0);
    expect(byHand.sent).toHaveLength(1);
  });

  it("fails the run when Telegram does not take the message", async () => {
    const r = await run({ pages: [[backup(30)]], telegram: 401 });
    expect(r.code).toBe(1);
    expect(r.log).toContain("Telegram did not take the message (HTTP 401)");
  });
});

describe("the workflow that runs it (A13)", () => {
  const workflow = readFileSync(path.join(".github", "workflows", "backup-watch.yml"), "utf8");

  it("runs every 6 hours and by hand, reading only, with nothing from the ERP's server", () => {
    expect(workflow).toMatch(/schedule:\s*\n\s*- cron: "\d+ \*\/6 \* \* \*"/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(workflow).toContain("node scripts/backup-watch.mjs");
    expect(workflow).not.toMatch(/npm (ci|install)/);
    expect(workflow).not.toMatch(/extasbd\.com|APP_URL|ssh/i);
  });

  it("passes every secret the script needs from GitHub's secrets, never written out", () => {
    for (const name of [...SECRETS, "BACKUP_ALERT_DRIVE_FOLDER_ID"]) {
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(workflow).toContain("BACKUP_ALERT_LATE_HOURS: ${{ vars.BACKUP_ALERT_LATE_HOURS }}");
    expect(workflow).toContain("EVENT: ${{ github.event_name }}");
  });
});
