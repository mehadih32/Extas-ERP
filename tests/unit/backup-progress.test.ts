import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BACKING_UP,
  BACKUP_POLL_LIMIT_MS,
  BACKUP_POLL_MS,
  backupDoneNotice,
  backupProgress,
  backupSize,
} from "@/modules/backups/progress";

const run = (over: Partial<Parameters<typeof backupProgress>[0]> = {}) => ({
  status: "RUNNING",
  checkedAt: null,
  driveError: null,
  error: null,
  ...over,
});

describe("Back up now: the screen says how the backup went without reopening the page", () => {
  it("keeps waiting while the backup runs, and while it goes to Google Drive", () => {
    expect(backupProgress(run({ status: "QUEUED" }))).toEqual({ done: false, text: BACKING_UP });
    expect(backupProgress(run())).toEqual({ done: false, text: BACKING_UP });
    // Marked done on the server first; Google's copy is not checked yet.
    const sending = backupProgress(run({ status: "SUCCEEDED" }));
    expect(sending.done).toBe(false);
    expect(sending.text).toMatch(/going to Google Drive now/);
  });

  it("says the backup is safe in Google Drive once Google's copy is checked", () => {
    expect(backupProgress(run({ status: "SUCCEEDED", checkedAt: new Date() }))).toEqual({
      done: true,
      tone: "success",
      text: "The backup is done and safe in Google Drive.",
    });
  });

  it("says plainly when the backup stays on this server only, and why", () => {
    const why = "Kept on the server only: Google Drive is not connected.";
    expect(backupProgress(run({ status: "SUCCEEDED", driveError: why }))).toEqual({
      done: true,
      tone: "note",
      text: "The backup is done, on this server only. Google Drive is not connected.",
    });
  });

  it("says why a backup failed", () => {
    expect(backupProgress(run({ status: "FAILED", error: "pg_dump is not installed." }))).toEqual({
      done: true,
      tone: "error",
      text: "The backup failed: pg_dump is not installed.",
    });
  });

  it("reads the page again every 10 seconds, for 30 minutes at most, while it waits", () => {
    expect(BACKUP_POLL_MS).toBe(10_000);
    expect(BACKUP_POLL_LIMIT_MS).toBe(30 * 60_000);
    const screen = readFileSync(
      join(process.cwd(), "src/components/settings/backups-screen.tsx"),
      "utf8",
    );
    expect(screen).toContain("router.refresh()");
    expect(screen).toContain("setInterval(");
    expect(screen).toContain("clearInterval(timer)");
    expect(screen).toContain("setWatching(result.data.id)");
  });

  it("tells the person who started it how it ended, in a short plain line", () => {
    const mb = Math.round(47.2 * 1024 * 1024);
    expect(backupDoneNotice({ ...run(), sizeBytes: null })).toBeNull();
    // On the server, still going to Google Drive: not ended yet.
    expect(backupDoneNotice({ ...run({ status: "SUCCEEDED" }), sizeBytes: BigInt(mb) })).toBeNull();
    expect(
      backupDoneNotice({ ...run({ status: "SUCCEEDED", checkedAt: new Date() }), sizeBytes: mb }),
    ).toEqual({ subject: "Backup done", text: "Backup done: safe in Google Drive (47.2 MB)." });
    expect(
      backupDoneNotice({
        ...run({
          status: "SUCCEEDED",
          driveError: "Kept on the server only: Google Drive is not connected.",
        }),
        sizeBytes: BigInt(mb),
      }),
    ).toEqual({
      subject: "Backup done, on this server only",
      text: "Backup done, on this server only (47.2 MB): Google Drive is not connected.",
    });
    expect(
      backupDoneNotice({
        ...run({ status: "FAILED", error: "The disk is full." }),
        sizeBytes: null,
      }),
    ).toEqual({ subject: "Backup failed", text: "Backup failed: The disk is full." });
    expect(backupSize(512 * 1024)).toBe("512 KB");
    expect(backupSize(3 * 1024 ** 3)).toBe("3.00 GB");
  });

  it("is told by the Back up now action, which does not wait for the backup", () => {
    const actions = readFileSync(
      join(process.cwd(), "src/server/actions/backups.actions.ts"),
      "utf8",
    );
    expect(actions).toContain("void noticeWhenDone(run.id, actor.userId)");
  });
});
