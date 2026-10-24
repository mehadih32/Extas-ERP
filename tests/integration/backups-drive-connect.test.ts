import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getBackupConfig, googleClient } from "@/modules/backups/backup-core";
import * as backups from "@/modules/backups/backup.service";
import { disk } from "@/modules/backups/disk";
import { startDriveConnect } from "@/modules/backups/drive-connect";
import { sendUnsent } from "@/modules/backups/drive-copies";
import { driveStatus } from "@/modules/backups/drive-status";
import { downloadGuide } from "@/modules/backups/guide.service";
import * as keys from "@/modules/backups/recovery-key.service";

import { type FakeGoogle, startFakeGoogle } from "../../scripts/fake-google";
import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

/*
 * Google Drive Connect (plan v5): the ERP uploads with the one Google client of the
 * "TVs and Limited Input devices" type that the server's settings hold (EXTAS's
 * central client), the same client the restore guide prints for the one restore
 * command. Changing the client needs the PIN; the screen shows the Drive's free
 * space and asks to Reconnect when Google ended the access. The backup engine, its
 * format and the restore are not changed (their own tests).
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PIN = "2468";
const OWNER_KEY = "Padma river at dawn, 1971!";
const CENTRAL_ID = "extas-central-123.apps.googleusercontent.com";
const CENTRAL_SECRET = "GOCSPX-extas-central-secret";
const OWN_ID = "owners-own-456.apps.googleusercontent.com";
const OWN_SECRET = "GOCSPX-the-owners-own-secret";

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

run("Google Drive Connect with the central client (plan v5)", { timeout: 120_000 }, () => {
  let dir: string;
  let owner: { userId: string };
  let ctx: CompanyContext;
  let google: FakeGoogle;

  beforeEach(async () => {
    vi.spyOn(disk, "freeBytes").mockResolvedValue(null);
    await resetDb();
    dir = await mkdtemp(path.join(os.tmpdir(), "extas-drive-connect-"));
    vi.stubEnv("BACKUP_DIR", path.join(dir, "backups"));
    vi.stubEnv("UPLOAD_DIR", path.join(dir, "uploads"));
    vi.stubEnv("PG_DUMP_PATH", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", CENTRAL_ID);
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", CENTRAL_SECRET);
    vi.stubEnv("APP_URL", "https://erp.extasbd.com");
    google = await startFakeGoogle({ email: "owner@gmail.com" }, 0);
    vi.stubEnv("GOOGLE_OAUTH_BASE", google.url);
    vi.stubEnv("GOOGLE_DRIVE_BASE", google.url);
    await mkdir(path.join(dir, "uploads", "c1"), { recursive: true });
    await writeFile(path.join(dir, "uploads", "c1", "logo.png"), "not really a png");
    owner = { userId: (await makeUser("owner@extas.test", { isSuperAdmin: true })).id };
    const { company, roles } = await makeCompany("Extas");
    await addToCompany(owner.userId, company.id, roles.SUPER_ADMIN);
    ctx = await contextFor(owner.userId, company.id);
    await setPin(ctx, { pin: PIN });
  }, 60_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await google.close();
    await rm(dir, { recursive: true, force: true });
  });

  const inbox = async () =>
    (
      await prisma.notificationLog.findMany({
        where: { userId: owner.userId },
        orderBy: { createdAt: "asc" },
      })
    ).map((n) => n.subject);
  async function connectDrive() {
    await backups.startGoogleSignIn(owner);
    expect((await backups.checkGoogleSignIn(owner)).status).toBe("connected");
  }
  const backUpNow = () => backups.runBackup({ trigger: "MANUAL", actor: owner, wait: true });

  describe("the central client (in the server's settings)", () => {
    it("is used with no Google setup on the screen, and the screen says so", async () => {
      const { config } = await backups.getBackupOverview();
      expect(config.googleDrive).toMatchObject({
        available: true,
        clientId: CENTRAL_ID,
        setOnScreen: false,
        connected: false,
      });
      expect(JSON.stringify(config)).not.toContain(CENTRAL_SECRET);
      const code = await backups.startGoogleSignIn(owner);
      expect(code.userCode).toBeTruthy();
      expect(code.verificationUrl).toMatch(/^https?:\/\//);
      // Google is asked with the central client, for drive.file only.
      expect(google.requests.some((r) => r.includes("/device/code"))).toBe(true);
    });

    it("is the client the restore guide prints, the one restore command signs in with", async () => {
      await connectDrive();
      const config = await getBackupConfig();
      expect(googleClient(config)).toEqual({ clientId: CENTRAL_ID, clientSecret: CENTRAL_SECRET });
      const guide = pdfLines((await downloadGuide(owner, "en")).data).join("\n");
      expect(guide).toContain(CENTRAL_ID);
      expect(guide).toContain(CENTRAL_SECRET);
    });
  });

  describe("changing the Google client needs the PIN (plan v5)", () => {
    const input = { clientId: OWN_ID, clientSecret: OWN_SECRET };

    it("is refused without the PIN, with a wrong one, and outside a company; nothing changes", async () => {
      await connectDrive();
      const without = await expectAppError(backups.setGoogleClient(ctx, input), "VALIDATION");
      expect(without.details?.pin).toBeTruthy();
      const wrong = await expectAppError(
        backups.setGoogleClient(ctx, { ...input, pin: "1111" }),
        "VALIDATION",
      );
      expect(wrong.details?.pin).toEqual(["The PIN is not right"]);
      await expectAppError(backups.setGoogleClient(owner, { ...input, pin: PIN }), "FORBIDDEN");
      const config = await getBackupConfig();
      expect(config.googleClientId).toBeNull();
      expect(config.credentialsRef).not.toBeNull();
      expect(await inbox()).not.toContain("Backups made less safe");
    });

    it("with the PIN: saved sealed, Drive disconnected for the new client, the owner told", async () => {
      await connectDrive();
      const saved = await backups.setGoogleClient(ctx, { ...input, pin: PIN });
      expect(saved.googleDrive).toMatchObject({
        clientId: OWN_ID,
        setOnScreen: true,
        connected: false,
      });
      const config = await getBackupConfig();
      expect(config.googleClientSecretRef).not.toContain(OWN_SECRET);
      expect(decryptSecret(config.googleClientSecretRef!)).toBe(OWN_SECRET);
      expect(config.credentialsRef).toBeNull();
      expect(await inbox()).toContain("Backups made less safe");
      const logged = await prisma.auditLog.findMany({ where: { entityType: "BackupConfig" } });
      expect(JSON.stringify(logged)).not.toContain(OWN_SECRET);
      expect(JSON.stringify(logged)).not.toContain(PIN);
    });

    it("saving the same client again keeps the Drive connection", async () => {
      await backups.setGoogleClient(ctx, { ...input, pin: PIN });
      await connectDrive();
      await backups.setGoogleClient(ctx, { ...input, pin: PIN });
      expect((await getBackupConfig()).credentialsRef).not.toBeNull();
    });
  });

  describe("connecting another Google account needs the PIN (owner's decision, 2026-10-24)", () => {
    const deviceCodes = () => google.requests.filter((r) => r.includes("/device/code")).length;

    it("the first Connect needs no PIN", async () => {
      const code = await startDriveConnect(ctx, {});
      expect(code.userCode).toBeTruthy();
      expect((await backups.checkGoogleSignIn(owner)).status).toBe("connected");
    });

    it("while Drive is connected, a new sign-in is refused without the right PIN, and nothing starts", async () => {
      await connectDrive();
      const before = await getBackupConfig();
      const asked = deviceCodes();
      const without = await expectAppError(startDriveConnect(ctx, {}), "VALIDATION");
      expect(without.details?.pin).toBeTruthy();
      const wrong = await expectAppError(startDriveConnect(ctx, { pin: "1111" }), "VALIDATION");
      expect(wrong.details?.pin).toEqual(["The PIN is not right"]);
      // Outside a company there is no PIN to check: refused.
      await expectAppError(startDriveConnect(owner, { pin: PIN }), "FORBIDDEN");
      expect(deviceCodes()).toBe(asked);
      const after = await getBackupConfig();
      expect(after.googleDeviceRef).toBe(before.googleDeviceRef);
      expect(after.credentialsRef).toBe(before.credentialsRef);
    });

    it("Reconnect after Google ended the access needs the PIN too, then connects again", async () => {
      await connectDrive();
      google.refreshTokens.clear();
      expect(await driveStatus()).toEqual({ state: "reconnect" });
      await expectAppError(startDriveConnect(ctx, {}), "VALIDATION");
      const code = await startDriveConnect(ctx, { pin: PIN });
      expect(code.userCode).toBeTruthy();
      expect((await backups.checkGoogleSignIn(owner)).status).toBe("connected");
      expect((await driveStatus()).state).toBe("connected");
      const logged = await prisma.auditLog.findMany({ where: { entityType: "BackupConfig" } });
      expect(JSON.stringify(logged)).not.toContain(PIN);
    });

    it("every request path starts a sign-in only through the PIN check", () => {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (/\.tsx?$/.test(name)) files.push(full);
        }
      };
      for (const dir of ["src/app", "src/server", "src/components", "src/modules/ai"]) {
        walk(path.join(process.cwd(), dir));
      }
      const direct = files.filter((f) => /\bstartGoogleSignIn\(/.test(readFileSync(f, "utf8")));
      expect(direct.map((f) => path.relative(process.cwd(), f))).toEqual([]);
      for (const file of [
        "src/app/api/backups/google/connect/route.ts",
        "src/server/actions/backups.actions.ts",
      ]) {
        expect(readFileSync(path.join(process.cwd(), file), "utf8")).toContain(
          "startDriveConnect(",
        );
      }
    });
  });

  describe("the Drive panel's live state", () => {
    it("is none before Connect", async () => {
      expect(await driveStatus()).toEqual({ state: "none" });
    });

    it("is connected after Connect, with the free space when Google gives it", async () => {
      await connectDrive();
      // The stand-in for Google tells no free space: the screen leaves that line out.
      expect(await driveStatus()).toEqual({
        state: "connected",
        freeBytes: null,
        totalBytes: null,
      });
      const real = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
        String(url).includes("fields=storageQuota")
          ? Response.json({ storageQuota: { limit: "16106127360", usage: "6106127360" } })
          : real(url, init),
      );
      expect(await driveStatus()).toEqual({
        state: "connected",
        freeBytes: 10_000_000_000,
        totalBytes: 16_106_127_360,
      });
    });

    it("asks to Reconnect when Google ended the access; the backups wait on the server and go after Reconnect", async () => {
      await connectDrive();
      await keys.setRecoveryKey(ctx, { pin: PIN, key: OWNER_KEY, confirm: OWNER_KEY });
      // The owner removed the ERP's access at myaccount.google.com.
      google.refreshTokens.clear();
      expect(await driveStatus()).toEqual({ state: "reconnect" });
      const made = await backUpNow();
      expect(made.status).toBe("SUCCEEDED");
      const waiting = await prisma.backupRun.findUniqueOrThrow({ where: { id: made.id } });
      expect(waiting.checkedAt).toBeNull();
      expect(waiting.driveError).toMatch(/revoked or expired: connect Google Drive again/);
      // Reconnect is Connect again: the same code on the phone, the same central client.
      await connectDrive();
      expect((await driveStatus()).state).toBe("connected");
      // Within the hour (the hourly retry; not sooner after the failed try).
      expect(await sendUnsent(Date.now() + 61 * 60_000)).toBe(1);
      const sent = await prisma.backupRun.findUniqueOrThrow({ where: { id: made.id } });
      expect(sent.checkedAt).not.toBeNull();
      expect(sent.driveError).toBeNull();
    });

    it("asks to Reconnect when the server's Google client was changed under the sign-in", async () => {
      await connectDrive();
      // Google's answer to a sign-in made with another client (deploy/set-google-client.sh).
      const real = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
        String(init?.body ?? "").includes("grant_type=refresh_token")
          ? Response.json(
              { error: "unauthorized_client", error_description: "Unauthorized" },
              { status: 401 },
            )
          : real(url, init),
      );
      expect(await driveStatus()).toEqual({ state: "reconnect" });
    });

    it("asks to Reconnect when the saved sign-in can no longer be opened", async () => {
      await connectDrive();
      const config = await getBackupConfig();
      // As after the server's ENCRYPTION_KEY changed.
      vi.stubEnv("ENCRYPTION_KEY", "another-encryption-key-9876543210");
      expect(await driveStatus()).toEqual({ state: "reconnect" });
      vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
      expect((await getBackupConfig()).credentialsRef).toBe(config.credentialsRef);
      // And when no Google client is left to use it with.
      vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "");
      vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "");
      expect(await driveStatus()).toEqual({ state: "reconnect" });
    });

    it("is unreachable when Google cannot be reached, and nothing is changed", async () => {
      await connectDrive();
      vi.stubEnv("GOOGLE_OAUTH_BASE", "http://127.0.0.1:9");
      expect(await driveStatus()).toEqual({ state: "unreachable" });
      expect((await getBackupConfig()).credentialsRef).not.toBeNull();
    });
  });
});
