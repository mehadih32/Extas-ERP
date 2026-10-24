import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "Back up now": the person who pressed it is told in their ERP inbox when the
 * backup ends, and the platform owners' bot gets the same line (as an alarm,
 * so it goes even while the AI is off). A drill copy sends nothing.
 */

const pushes = vi.hoisted(() => [] as Array<{ companyId: string; text: string; alarm?: boolean }>);
vi.mock("@/modules/ai/bot/push", () => ({
  pushToBot: async (
    companyId: string,
    push: { text: string },
    options: { alarm?: boolean } = {},
  ) => {
    pushes.push({ companyId, text: push.text, alarm: options.alarm });
  },
}));

import { prisma } from "@/lib/prisma";
import { noticeWhenDone } from "@/modules/backups/manual-notice";
import { DRILL_MARK } from "@/modules/backups/standby";

import { addToCompany, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const FAST = { everyMs: 20, limitMs: 5_000 };

run("the Back up now notice", () => {
  let dir: string;
  const savedDir = process.env.BACKUP_DIR;

  beforeEach(async () => {
    await resetDb();
    pushes.length = 0;
    dir = await mkdtemp(path.join(os.tmpdir(), "extras-notice-"));
    process.env.BACKUP_DIR = dir;
  });
  afterEach(async () => {
    process.env.BACKUP_DIR = savedDir;
    await rm(dir, { recursive: true, force: true });
  });

  async function owner() {
    const { company, roles } = await makeCompany("Extas");
    const user = await makeUser("owner@extas.test", { isSuperAdmin: true });
    await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
    return { company, user };
  }

  const inbox = (userId: string) =>
    prisma.notificationLog.findMany({ where: { userId }, select: { subject: true, body: true } });

  it("waits for the backup to end, then tells who started it, once", async () => {
    const { company, user } = await owner();
    const backup = await prisma.backupRun.create({
      data: { trigger: "MANUAL", status: "RUNNING", triggeredById: user.id },
    });
    const told = noticeWhenDone(backup.id, user.id, FAST);
    await new Promise((r) => setTimeout(r, 100));
    expect(await inbox(user.id)).toEqual([]);
    // Done on the server, Google Drive still to come: not yet.
    await prisma.backupRun.update({ where: { id: backup.id }, data: { status: "SUCCEEDED" } });
    await new Promise((r) => setTimeout(r, 100));
    expect(await inbox(user.id)).toEqual([]);
    await prisma.backupRun.update({
      where: { id: backup.id },
      data: { checkedAt: new Date(), sizeBytes: BigInt(Math.round(47.2 * 1024 * 1024)) },
    });
    expect(await told).toBe(true);
    expect(await inbox(user.id)).toEqual([
      { subject: "Backup done", body: "Backup done: safe in Google Drive (47.2 MB)." },
    ]);
    expect(pushes).toEqual([
      { companyId: company.id, text: "Backup done: safe in Google Drive (47.2 MB).", alarm: true },
    ]);
  });

  it("says when the backup stays on this server, and when it failed", async () => {
    const { user } = await owner();
    const local = await prisma.backupRun.create({
      data: {
        trigger: "MANUAL",
        status: "SUCCEEDED",
        driveError: "Kept on the server only: Google Drive is not connected.",
      },
    });
    const failed = await prisma.backupRun.create({
      data: { trigger: "MANUAL", status: "FAILED", error: "pg_dump is not installed." },
    });
    expect(await noticeWhenDone(local.id, user.id, FAST)).toBe(true);
    expect(await noticeWhenDone(failed.id, user.id, FAST)).toBe(true);
    const bodies = (await inbox(user.id)).map((m) => m.body);
    expect(bodies).toContain("Backup done, on this server only: Google Drive is not connected.");
    expect(bodies).toContain("Backup failed: pg_dump is not installed.");
  });

  it("sends nothing on a drill copy", async () => {
    const { user } = await owner();
    await writeFile(path.join(dir, DRILL_MARK), '{"address":"drill.extasbd.com"}');
    const backup = await prisma.backupRun.create({
      data: { trigger: "MANUAL", status: "SUCCEEDED", checkedAt: new Date() },
    });
    expect(await noticeWhenDone(backup.id, user.id, FAST)).toBe(false);
    expect(await inbox(user.id)).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it("gives up quietly when the backup never ends, and never throws", async () => {
    const { user } = await owner();
    const stuck = await prisma.backupRun.create({ data: { trigger: "MANUAL", status: "RUNNING" } });
    expect(await noticeWhenDone(stuck.id, user.id, { everyMs: 20, limitMs: 100 })).toBe(false);
    expect(await noticeWhenDone("no-such-run", user.id, FAST)).toBe(false);
    expect(await inbox(user.id)).toEqual([]);
  });
});
