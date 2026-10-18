import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4.1 (A13): the late-backup alert that runs on GitHub, not on this server.
 * Settings > Backups, "Set up the alert on GitHub" (with the PIN and a GitHub
 * token used once) sends the ERP's Google Drive sign-in and the Telegram bot to
 * the repository's secrets, each locked to the repository's own key, never
 * shown or kept. Each backup the ERP puts in Drive says when the next one is due,
 * so the alert (scripts/backup-watch.mjs), with exactly what GitHub received,
 * reads the backups and knows when they are late. Google is the stand-in
 * (scripts/fake-google.ts); GitHub and Telegram are played here.
 */

import { encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { sealedBoxOpen } from "@/lib/sealed-box";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";
import { disk } from "@/modules/backups/disk";
import { nextLabel } from "@/modules/backups/drive-copies";
import { ALERT_SECRETS, setUpGitHubAlert } from "@/modules/backups/github-alert";
import * as keys from "@/modules/backups/recovery-key.service";
import { nextRunAt, scheduleOf } from "@/modules/backups/schedule";

import { watch } from "../../scripts/backup-watch.mjs";
import { type FakeGoogle, startFakeGoogle } from "../../scripts/fake-google";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PIN = "2468";
const OWNER_KEY = "Padma river at dawn, 1971!";
const GH_TOKEN = "github_pat_ONE_TIME_0123456789abcdefghij";
const BOT_TOKEN = "123456:bot-token-of-the-erp";
const H = 3_600_000;

/** GitHub's secrets API for one repository, with a real X25519 key pair. */
async function startFakeGitHub(repo: string) {
  const pair = generateKeyPairSync("x25519");
  const raw = (der: Buffer) => new Uint8Array(der.subarray(der.length - 32));
  const publicKey = raw(pair.publicKey.export({ format: "der", type: "spki" }));
  const secretKey = raw(pair.privateKey.export({ format: "der", type: "pkcs8" }));
  const secrets = new Map<string, { encrypted_value: string; key_id: string }>();
  const state = { refuse: 0 };
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => resolve(body));
    });
  const server: Server = createServer(async (req, res) => {
    const body = await read(req);
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    if (req.headers.authorization !== `Bearer ${GH_TOKEN}`) return send(401, { message: "Bad" });
    if (state.refuse) return send(state.refuse, { message: "Resource not accessible" });
    if (req.method === "GET" && req.url === `/repos/${repo}/actions/secrets/public-key`) {
      return send(200, { key_id: "key-7", key: Buffer.from(publicKey).toString("base64") });
    }
    const m = req.url?.match(new RegExp(`^/repos/${repo}/actions/secrets/([A-Z_]+)$`));
    if (req.method === "PUT" && m) {
      secrets.set(m[1]!, JSON.parse(body) as { encrypted_value: string; key_id: string });
      return send(201, {});
    }
    return send(404, { message: "Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  /** What GitHub Actions would read: each secret opened with the repository's key. */
  const opened = () =>
    Object.fromEntries(
      [...secrets].map(([name, s]) => {
        const value = sealedBoxOpen(
          new Uint8Array(Buffer.from(s.encrypted_value, "base64")),
          publicKey,
          secretKey,
        );
        return [name, value ? new TextDecoder().decode(value) : null];
      }),
    ) as Record<string, string | null>;
  return {
    url,
    secrets,
    state,
    opened,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function expectAppError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
}

run("the late-backup alert on GitHub (A13)", { timeout: 120_000 }, () => {
  let dir: string;
  let google: FakeGoogle;
  let github: Awaited<ReturnType<typeof startFakeGitHub>>;
  let owner: { userId: string };
  let ctx: CompanyContext;
  let companyId: string;

  beforeEach(async () => {
    vi.spyOn(disk, "freeBytes").mockResolvedValue(null);
    await resetDb();
    dir = await mkdtemp(path.join(os.tmpdir(), "extas-alert-"));
    vi.stubEnv("BACKUP_DIR", path.join(dir, "backups"));
    vi.stubEnv("UPLOAD_DIR", path.join(dir, "uploads"));
    vi.stubEnv("PG_DUMP_PATH", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "client-123.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret-abcdef");
    vi.stubEnv("APP_URL", "https://erp.extasbd.com");
    google = await startFakeGoogle({ email: "owner@gmail.com" }, 0);
    vi.stubEnv("GOOGLE_OAUTH_BASE", google.url);
    vi.stubEnv("GOOGLE_DRIVE_BASE", google.url);
    github = await startFakeGitHub("extas/erp");
    vi.stubEnv("GITHUB_API_URL", github.url);
    await mkdir(path.join(dir, "uploads", "c1"), { recursive: true });
    await writeFile(path.join(dir, "uploads", "c1", "logo.png"), "not really a png");
    owner = { userId: (await makeUser("owner@extas.test", { isSuperAdmin: true })).id };
    const { company, roles } = await makeCompany("Extas");
    companyId = company.id;
    await addToCompany(owner.userId, company.id, roles.SUPER_ADMIN);
    ctx = await contextFor(owner.userId, company.id);
    await setPin(ctx, { pin: PIN });
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await google.close();
    await github.close();
    await rm(dir, { recursive: true, force: true });
  });

  const connectDrive = async () => {
    await backups.startGoogleSignIn(owner);
    expect((await backups.checkGoogleSignIn(owner)).status).toBe("connected");
  };
  const linkBot = () =>
    prisma.aiBotLink.create({
      data: {
        companyId,
        channel: "TELEGRAM",
        botKey: "123456",
        tokenSealed: encryptSecret(BOT_TOKEN),
        webhookKey: "hash",
        ownerId: owner.userId,
        chatId: "555000111",
        linkedAt: new Date(),
      },
    });
  const setUp = (extra: Record<string, unknown> = {}) =>
    setUpGitHubAlert(ctx, { pin: PIN, repo: "extas/erp", token: GH_TOKEN, ...extra });

  it("sends the alert's values to GitHub, each locked to the repository's key, and keeps none", async () => {
    await connectDrive();
    await linkBot();
    const done = await setUp();
    expect(done.repo).toBe("extas/erp");
    expect(done.secrets).toEqual([...ALERT_SECRETS]);
    const config = await prisma.backupConfig.findFirstOrThrow();
    const opened = github.opened();
    expect(opened).toEqual({
      BACKUP_ALERT_GOOGLE_CLIENT_ID: "client-123.apps.googleusercontent.com",
      BACKUP_ALERT_GOOGLE_CLIENT_SECRET: "client-secret-abcdef",
      BACKUP_ALERT_GOOGLE_REFRESH_TOKEN: expect.stringMatching(/^refresh-/),
      BACKUP_ALERT_DRIVE_FOLDER_ID: config.googleDriveFolderId,
      BACKUP_ALERT_TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      BACKUP_ALERT_TELEGRAM_CHAT_ID: "555000111",
    });
    for (const s of github.secrets.values()) expect(s.key_id).toBe("key-7");
    // What GitHub got is locked: no value in plain text on the way.
    const wire = JSON.stringify([...github.secrets.values()]);
    for (const value of Object.values(opened)) expect(wire).not.toContain(value!);
    expect(config.googleDriveFolderId).toBeTruthy();

    expect(config).toMatchObject({ githubAlertRepo: "extas/erp", githubAlertAt: expect.any(Date) });
    // Neither the token nor a value is kept or logged.
    const everything = JSON.stringify([
      config,
      await prisma.auditLog.findMany(),
      await prisma.notificationLog.findMany(),
      done,
    ]);
    expect(everything).not.toContain(GH_TOKEN);
    expect(everything).not.toContain(BOT_TOKEN);
    expect(everything).not.toContain(opened.BACKUP_ALERT_GOOGLE_REFRESH_TOKEN!);
    expect(everything).not.toContain("client-secret-abcdef");
    const logged = await prisma.auditLog.findFirstOrThrow({
      where: { summary: { startsWith: "Set up the late-backup alert on GitHub" } },
    });
    expect(logged).toMatchObject({ userId: owner.userId });
    // The screen shows where and when, never a value.
    const overview = await backups.getBackupOverview();
    expect(overview.config.githubAlert).toEqual({ repo: "extas/erp", setAt: expect.any(Date) });
  });

  it("asks for the PIN, Google Drive, the bot and a token that may set secrets, in plain words", async () => {
    await expectAppError(setUp({ pin: "0000" }), "VALIDATION", /PIN/);
    await expectAppError(setUp(), "VALIDATION", /Connect Google Drive first/);
    await connectDrive();
    await expectAppError(setUp(), "VALIDATION", /Link the Telegram bot/);
    await linkBot();
    await expectAppError(
      setUp({ token: "github_pat_WRONG_0123456789abcdefghijk" }),
      "VALIDATION",
      /refused the token/,
    );
    github.state.refuse = 403;
    await expectAppError(setUp(), "VALIDATION", /Secrets: Read and write/);
    github.state.refuse = 0;
    // Not a token at all: the form says so (the screen shows it under the field).
    await expect(setUp({ token: "not-a-token" })).rejects.toMatchObject({ name: "ZodError" });
    expect(github.secrets.size).toBe(0);
    expect((await prisma.backupConfig.findFirstOrThrow()).githubAlertAt).toBeNull();
    // Only the platform owner.
    const { company, roles } = await makeCompany("Other");
    const staff = await makeUser("staff@extas.test");
    await addToCompany(staff.id, company.id, roles.SUPER_ADMIN);
    await expectAppError(
      setUpGitHubAlert(await contextFor(staff.id, company.id), {
        pin: PIN,
        repo: "extas/erp",
        token: GH_TOKEN,
      }),
      "FORBIDDEN",
    );
  });

  it("with exactly what GitHub received, the alert reads the ERP's backups in Drive and knows when they are late", async () => {
    await keys.setRecoveryKey(ctx, { pin: PIN, key: OWNER_KEY, confirm: OWNER_KEY });
    await connectDrive();
    await linkBot();
    const made = await backups.runBackup({ trigger: "MANUAL", actor: owner, wait: true });
    const backup = await prisma.backupRun.findUniqueOrThrow({ where: { id: made.id } });
    expect(backup.checkedAt).toBeInstanceOf(Date);

    // The backup's folder says when the owner's schedule makes the next one.
    const config = await prisma.backupConfig.findFirstOrThrow();
    const folder = google.files.get(backup.driveFileId!)!;
    const createdAt = new Date(folder.appProperties.createdAt!);
    expect(folder.appProperties.nextAt).toBe(
      nextRunAt(scheduleOf(config), config.timezone, createdAt)!.toISOString(),
    );

    // A safety copy, or backups switched off: no next one to wait for.
    expect(nextLabel(config, "SAFETY_COPY", createdAt.toISOString())).toEqual({});
    expect(nextLabel({ ...config, isEnabled: false }, "BACKUP", createdAt.toISOString())).toEqual(
      {},
    );

    await setUp();
    const env = github.opened() as Record<string, string>;
    expect(env.BACKUP_ALERT_DRIVE_FOLDER_ID).toBe(config.googleDriveFolderId);

    // Google's real addresses go to the stand-in; Telegram is caught here.
    const sent: Array<{ chat: string; text: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://api.telegram.org/bot")) {
        expect(url).toContain(BOT_TOKEN);
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        sent.push({ chat: body.chat_id, text: body.text });
        return new Response("{}", { status: 200 });
      }
      const to = url
        .replace("https://oauth2.googleapis.com", google.url)
        .replace("https://www.googleapis.com", google.url);
      return fetch(to, init);
    }) as typeof fetch;
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);

    // On time: quiet on a scheduled run, a message when run by hand.
    expect(await watch({ env, fetchImpl, now: Date.now(), event: "schedule", log })).toBe(0);
    expect(sent).toEqual([]);
    expect(await watch({ env, fetchImpl, now: Date.now(), event: "workflow_dispatch", log })).toBe(
      0,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat: "555000111", text: expect.stringContaining("ঠিক আছে") });

    // Two days on with no new backup (the server is down): late, and the owner is told.
    expect(await watch({ env, fetchImpl, now: Date.now() + 48 * H, event: "schedule", log })).toBe(
      1,
    );
    expect(sent[1]!.text).toContain("ব্যাকআপ দেরি হচ্ছে");

    // Google Drive connected again: GitHub's copy no longer works, and the owner hears so.
    await google.close();
    google = await startFakeGoogle({ email: "owner@gmail.com" }, 0);
    expect(await watch({ env, fetchImpl, now: Date.now(), event: "schedule", log })).toBe(1);
    expect(sent[2]!.text).toContain("Set up the alert on GitHub");
    for (const value of Object.values(env)) {
      if (value.length > 12) expect(lines.join("\n")).not.toContain(value);
    }
  });
});
