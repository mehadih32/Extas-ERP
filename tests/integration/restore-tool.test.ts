import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { backupLock, guideRoot, hostRoot } from "@/modules/backups/backup-core";
import * as backups from "@/modules/backups/backup.service";
import { disk } from "@/modules/backups/disk";
import * as cloudflare from "@/modules/backups/cloudflare";
import {
  backupKey,
  keyId,
  lockFile,
  newRecoveryKey,
  parseRecoveryKey,
  type PublicKey,
} from "@/modules/backups/crypt";
import { downloadGuide, guideTick, resetGuideRetry } from "@/modules/backups/guide.service";
import * as keys from "@/modules/backups/recovery-key.service";

import { type FakeCloudflare, startFakeCloudflare } from "../../scripts/fake-cloudflare";
import { type FakeGoogle, startFakeGoogle } from "../../scripts/fake-google";
import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

/*
 * The one restore command on a new server (G8, A6, A8): deploy/restore-tool.py
 * signs in to Google with a code, lists the backups newest first, opens the one
 * picked with the recovery key kept in Drive (or typed, hidden), writes the
 * server's settings without ever replacing its own ENCRYPTION_KEY, points the
 * web address at the server in Cloudflare, and compares every table and file
 * with the backup's manifest. Run here against stand-ins for Google and
 * Cloudflare, on real backups made by the ERP; the answers come from a file
 * instead of the keyboard, as in the restore drill. Also the restore guide's
 * copies (G7): in Drive, on the server, inside every backup, and downloaded.
 */

const exec = promisify(execFile);
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const TOOL = path.join(process.cwd(), "deploy", "restore-tool.py");
const OWNER_KEY = "Padma river at dawn, 1971!";
const PIN = "2468";
const COMMIT = "c0ffee".padEnd(40, "0");
const BOOTSTRAP_SHA = "ab".repeat(32);
const CLIENT_ID = "client-123.apps.googleusercontent.com";
const CLIENT_SECRET = "client-secret-abcdef";
const OLD_SERVER_KEY = "test-encryption-key-0123456789";
const SETTINGS = `APP_DOMAIN=erp.extasbd.com\nPOSTGRES_PASSWORD=pg-secret-1\nENCRYPTION_KEY=${OLD_SERVER_KEY}\n`;
const CF_TOKEN = "cf_token_only_dns_for_extas_0123456789abcd";
/** The same count restore.sh --counts makes, just after the restore. */
const COUNT_SQL = `SELECT coalesce(json_object_agg(table_name, n ORDER BY table_name), '{}')
  FROM (SELECT table_name::text AS table_name,
               (xpath('/row/n/text()',
                 query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name),
                              false, true, '')))[1]::text::bigint AS n
          FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS t`;

type Ran = { code: number; stdout: string; stderr: string };
type State = Record<string, unknown>;

// Real backups, restores and Python runs: slow on a busy machine, so 2 minutes each.
run("the restore tool on a new server", { timeout: 120_000 }, () => {
  let dir: string;
  let backupDir: string;
  let uploadDir: string;
  let work: string;
  let owner: { userId: string };
  let ctx: CompanyContext;
  let google: FakeGoogle;

  beforeEach(async () => {
    // The machine's own free disk never decides these tests (G7 has its own).
    vi.spyOn(disk, "freeBytes").mockResolvedValue(null);
    await resetDb();
    resetGuideRetry();
    dir = await mkdtemp(path.join(os.tmpdir(), "extas-restore-tool-"));
    backupDir = path.join(dir, "backups");
    uploadDir = path.join(dir, "uploads");
    work = path.join(dir, "work");
    vi.stubEnv("BACKUP_DIR", backupDir);
    vi.stubEnv("UPLOAD_DIR", uploadDir);
    vi.stubEnv("PG_DUMP_PATH", "");
    vi.stubEnv("ENCRYPTION_KEY", OLD_SERVER_KEY);
    vi.stubEnv("ENCRYPTION_OLD_KEYS", "");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", CLIENT_SECRET);
    vi.stubEnv("APP_URL", "https://erp.extasbd.com");
    google = await startFakeGoogle({ email: "owner@gmail.com" }, 0);
    vi.stubEnv("GOOGLE_OAUTH_BASE", google.url);
    vi.stubEnv("GOOGLE_DRIVE_BASE", google.url);
    await mkdir(path.join(uploadDir, "c1", "2026", "10"), { recursive: true });
    await writeFile(path.join(uploadDir, "c1", "2026", "10", "logo.png"), "not really a png");
    await writeFile(path.join(uploadDir, "c1", "2026", "10", "bill scan.pdf"), randomBytes(3000));
    owner = { userId: (await makeUser("owner@extas.test", { isSuperAdmin: true })).id };
    const { company, roles } = await makeCompany("Extas");
    await addToCompany(owner.userId, company.id, roles.SUPER_ADMIN);
    ctx = await contextFor(owner.userId, company.id);
  }, 60_000); // the first one of a run can take over 10 s on a busy machine

  afterEach(async () => {
    vi.unstubAllEnvs();
    await google.close();
    await rm(dir, { recursive: true, force: true });
  });

  const backUpNow = () => backups.runBackup({ trigger: "MANUAL", actor: owner, wait: true });
  const labelled = (label: string) =>
    [...google.files.values()].filter((f) => f.appProperties.extas === label && !f.trashed);
  const guideText = (label: string) => pdfLines(labelled(label)[0]!.data!).join("\n");

  async function connectDrive() {
    await backups.startGoogleSignIn(owner);
    expect((await backups.checkGoogleSignIn(owner)).status).toBe("connected");
  }
  async function setKey(extra: Record<string, unknown> = {}) {
    await setPin(ctx, { pin: PIN });
    return keys.setRecoveryKey(ctx, { pin: PIN, key: OWNER_KEY, confirm: OWNER_KEY, ...extra });
  }
  /** What deploy.sh leaves in BACKUP_DIR/.host at an update (the settings locked, when given). */
  async function prepareHost(settings: string | null) {
    const host = hostRoot();
    await mkdir(host, { recursive: true });
    await writeFile(
      path.join(host, "version.json"),
      JSON.stringify({
        commit: COMMIT,
        bootstrapSha256: BOOTSTRAP_SHA,
        deployedAt: new Date().toISOString(),
        version: "6.4.0",
      }),
    );
    await writeFile(path.join(host, "code.bundle"), "# v2 git bundle\nthe code at the commit\n");
    const lock = backupLock(await backups.getBackupConfig());
    if (settings === null || !lock) return;
    const plain = path.join(dir, "settings.env");
    await writeFile(plain, settings);
    const facts = await lockFile(
      lock.key as PublicKey,
      plain,
      path.join(host, "settings.env.locked"),
    );
    await rm(plain);
    await writeFile(
      path.join(host, "settings.env.json"),
      JSON.stringify({
        pairId: (lock.key as PublicKey).pairId,
        plain: { bytes: facts.plain.bytes, sha256: facts.plain.sha256 },
        locked: { bytes: facts.locked.bytes, sha256: facts.locked.sha256 },
      }),
    );
  }

  /** Runs the restore tool as bootstrap.sh does, with the answers from a file. */
  async function tool(
    args: string[],
    answers: Record<string, string>,
    options: { env?: Record<string, string>; mode?: number } = {},
  ): Promise<Ran> {
    const file = path.join(dir, "answers");
    await writeFile(
      file,
      Object.entries(answers)
        .map(([name, value]) => `${name}=${value}\n`)
        .join(""),
    );
    await chmod(file, options.mode ?? 0o600);
    return new Promise((resolve) => {
      execFile(
        "python3",
        ["-I", TOOL, ...args],
        {
          env: {
            ...process.env,
            RESTORE_ANSWERS: file,
            GOOGLE_OAUTH_BASE: google.url,
            GOOGLE_DRIVE_BASE: google.url,
            ...options.env,
          },
          timeout: 120_000,
        },
        (error, stdout, stderr) =>
          resolve({
            code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
            stdout,
            stderr,
          }),
      );
    });
  }
  /**
   * Runs the restore tool in a terminal (a pseudo-terminal, as PuTTY gives), with no
   * answers file: each answer is typed when its question shows. Prints what the
   * screen showed.
   */
  function typed(args: string[], replies: Array<[string, string]>): Promise<Ran> {
    const driver = `
import json, os, pty, select, sys, time
replies = json.loads(os.environ["REPLIES"])
pid, fd = pty.fork()
if pid == 0:
    os.execvp("python3", ["python3", "-I", *sys.argv[1:]])
screen, seen, deadline = "", "", time.time() + 100
while time.time() < deadline:
    if select.select([fd], [], [], 0.5)[0]:
        try:
            data = os.read(fd, 4096).decode("utf-8", "replace")
        except OSError:
            break
        if not data:
            break
        screen += data
        seen += data
    if replies and replies[0][0] in seen and seen.rstrip().endswith(":"):
        time.sleep(0.2)
        os.write(fd, (replies.pop(0)[1] + "\\r").encode())
        seen = ""
_, status = os.waitpid(pid, 0)
sys.stdout.write(screen)
sys.exit(os.waitstatus_to_exitcode(status))
`;
    return new Promise((resolve) => {
      execFile(
        "python3",
        ["-I", "-c", driver, TOOL, ...args],
        {
          env: {
            ...process.env,
            RESTORE_ANSWERS: "",
            REPLIES: JSON.stringify(replies),
            GOOGLE_OAUTH_BASE: google.url,
            GOOGLE_DRIVE_BASE: google.url,
          },
          timeout: 120_000,
        },
        (error, stdout, stderr) =>
          resolve({
            code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
            stdout,
            stderr,
          }),
      );
    });
  }
  const client = { google_client_id: CLIENT_ID, google_client_secret: CLIENT_SECRET };
  const fetch = (answers: Record<string, string> = {}) =>
    tool(["fetch", "--work", work], { ...client, pick: "", ...answers });
  const state = async () =>
    JSON.parse(await readFile(path.join(work, "state.json"), "utf8")) as State;

  /** Restores a dump into a throwaway database and counts every table as restore.sh does. */
  async function countsOf(dump: string) {
    const name = `extas_g_tool_${randomBytes(4).toString("hex")}`;
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    try {
      const env = {
        ...process.env,
        ...backups.pgEnvironment(process.env.DATABASE_URL!),
        PGDATABASE: name,
      };
      await exec(
        "pg_restore",
        ["--no-owner", "--no-privileges", "--exit-on-error", "-d", name, dump],
        { env },
      );
      const counted = await exec("psql", ["-X", "-q", "-At", "-c", COUNT_SQL], { env });
      const companies = await exec("psql", ["-X", "-At", "-c", 'SELECT name FROM "Company"'], {
        env,
      });
      return {
        counts: JSON.parse(counted.stdout) as Record<string, number>,
        companies: companies.stdout.trim().split("\n"),
      };
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
    }
  }

  describe("fetch: Google sign-in, the list of backups and opening one (G8)", () => {
    it("asks each question on the keyboard in PuTTY, with the secrets hidden (A8)", async () => {
      await connectDrive();
      await setKey({ keepInDrive: false });
      await prepareHost(SETTINGS);
      const backup = await backUpNow();

      const screen = await typed(
        ["fetch", "--work", work],
        [
          ["Google client ID (", CLIENT_ID],
          ["Google client secret (", CLIENT_SECRET],
          ["Which backup?", ""],
          ["Recovery key (", OWNER_KEY],
        ],
      );
      expect(screen.stderr).toBe("");
      expect(screen.stdout).toContain('Google client ID (from "Your restore details"');
      expect(screen.stdout).toContain(`Got the client ID (${CLIENT_ID.length} characters`);
      expect(screen.stdout).toContain("Recovery key (it stays hidden as you type):");
      expect(screen.stdout).toContain("The backup is open:");
      expect(screen.code).toBe(0);
      // What is typed for a secret never shows on the screen.
      for (const secret of [CLIENT_ID, CLIENT_SECRET, OWNER_KEY]) {
        expect(screen.stdout).not.toContain(secret);
      }
      expect((await state()).name).toBe(backup.name);

      // No keyboard (no terminal: setsid) and no answers file: a plain stop, not a hang.
      const none = await new Promise<Ran>((resolve) => {
        execFile(
          "setsid",
          ["-w", "python3", "-I", TOOL, "fetch", "--work", work],
          { env: { ...process.env, RESTORE_ANSWERS: "" }, timeout: 60_000 },
          (error, stdout, stderr) =>
            resolve({ code: error ? Number(error.code ?? -1) : 0, stdout, stderr }),
        );
      });
      expect(none.code).toBe(3);
      expect(none.stderr).toContain("Error R25: there is no keyboard to answer");
    });

    it("lists the backups newest first, opens the one picked, and fills in the key kept in Drive", async () => {
      await connectDrive();
      await setKey({ keepInDrive: true });
      await prepareHost(SETTINGS);
      const older = await backUpNow();
      const newer = await backUpNow();
      expect(labelled("restore-key")).toHaveLength(1);

      const got = await fetch();
      expect(got.stderr).toBe("");
      expect(got.code).toBe(0);
      expect(got.stdout).toContain("2. Type this code:  ABCD-EFGH");
      expect(got.stdout).toMatch(/ 1\) .+\(newest\)\n/);
      expect(got.stdout).toMatch(/ 2\) /);
      expect(got.stdout).toContain(
        "Your recovery key is kept in Google Drive: it is filled in by itself",
      );
      expect(got.stdout).toContain("Every file matches its checksum.");
      // No secret is ever shown (A8).
      for (const secret of [OWNER_KEY, CLIENT_SECRET, "pg-secret-1", OLD_SERVER_KEY]) {
        expect(got.stdout + got.stderr).not.toContain(secret);
      }

      expect(await state()).toMatchObject({
        name: newer.name,
        format: 3,
        commit: COMMIT,
        files: 2,
        hasCode: true,
        hasSettings: true,
        appDomain: "erp.extasbd.com",
        ownerEmail: "owner@extas.test",
      });
      expect((await readdir(path.join(work, "restore"))).sort()).toEqual([
        "database.dump",
        "manifest.json",
        "media.tar.gz",
      ]);
      expect(await readFile(path.join(work, "settings.env"), "utf8")).toBe(SETTINGS);
      expect(await readFile(path.join(work, "code.bundle"), "utf8")).toBe(
        "# v2 git bundle\nthe code at the commit\n",
      );
      // Only root can read what the backup holds; the locked download is gone.
      expect((await stat(work)).mode & 0o777).toBe(0o700);
      for (const file of ["google.json", "settings.env", "state.json", "server.json"]) {
        expect((await stat(path.join(work, file))).mode & 0o777).toBe(0o600);
      }
      expect(await readdir(work)).not.toContain("download");
      const { companies } = await countsOf(path.join(work, "restore", "database.dump"));
      expect(companies).toEqual(["Extas"]);

      // A number picks an older one.
      const second = await fetch({ pick: "2" });
      expect(second.code).toBe(0);
      expect((await state()).name).toBe(older.name);
    });

    it("asks for the key when it is not kept in Drive, and stops with a plain code", async () => {
      await connectDrive();
      await setKey({ keepInDrive: false });
      await prepareHost(SETTINGS);
      await backUpNow();
      expect(labelled("restore-key")).toEqual([]);

      const wrong = await fetch({ recovery_key: "Padma river at dusk" });
      expect(wrong.code).toBe(3);
      expect(wrong.stderr).toContain(
        "Error R12: the recovery key does not open this backup. Check capital letters, spaces and punctuation, then paste the command again.",
      );
      expect(wrong.stderr).toContain("(Look up R12 in the restore guide's list of errors.)");
      expect(wrong.stdout + wrong.stderr).not.toContain("Padma river at dusk");

      const typed = await fetch({ recovery_key: OWNER_KEY });
      expect(typed.code).toBe(0);
      expect(typed.stdout).toContain("Your recovery key");
      expect(typed.stdout).not.toContain("kept in Google Drive");
      expect((await state()).hasSettings).toBe(true);

      // An answers file others can read is refused (secrets are in it).
      const shared = await tool(
        ["fetch", "--work", work],
        { ...client, pick: "" },
        { mode: 0o644 },
      );
      expect(shared.code).toBe(3);
      expect(shared.stderr).toContain("Error R25:");
      // A wrong Google client ID.
      const badClient = await fetch({ google_client_id: "my-client-id" });
      expect(badClient.stderr).toContain(
        "Error R08: that is not a Google client ID: it ends in .apps.googleusercontent.com.",
      );
      // A Google account with no backups.
      google.files.clear();
      const none = await fetch({ recovery_key: OWNER_KEY });
      expect(none.stderr).toContain(
        "Error R10: there are no Extas ERP backups in this Google account's Drive.",
      );
    });

    it("opens a v6.3 backup with the old key card", async () => {
      await connectDrive();
      const card = newRecoveryKey();
      const legacy = backupKey(parseRecoveryKey(card));
      const config = await backups.getBackupConfig();
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: {
          recoveryKeyRef: encryptSecret(card),
          recoveryKeyId: keyId(legacy),
          recoveryKeyMadeAt: new Date(),
        },
      });
      const v63 = await backUpNow();
      const otherCard = newRecoveryKey();

      const wrong = await fetch({ old_key_card: otherCard });
      expect(wrong.code).toBe(3);
      expect(wrong.stderr).toContain("Error R13: the old key card does not open this backup.");

      const opened = await fetch({ old_key_card: card.toLowerCase().replace(/-/g, " ") });
      expect(opened.code).toBe(0);
      expect(opened.stdout).toContain("This backup is from v6.3: it opens with the old key card");
      expect(await state()).toMatchObject({ name: v63.name, format: 2 });
      const { companies } = await countsOf(path.join(work, "restore", "database.dump"));
      expect(companies).toEqual(["Extas"]);
    });
  });

  describe("env: the server's settings (A6)", () => {
    it("takes the backup's settings, and never replaces this server's own ENCRYPTION_KEY", async () => {
      await connectDrive();
      await setKey();
      await prepareHost(SETTINGS);
      await backUpNow();
      expect((await fetch()).code).toBe(0);

      // A new server: the settings as they were, with the Google client typed.
      const fresh = path.join(dir, "new", "deploy", ".env");
      expect((await tool(["env", "--work", work, "--env", fresh], {})).code).toBe(0);
      const written = await readFile(fresh, "utf8");
      expect(written).toContain("APP_DOMAIN=erp.extasbd.com\n");
      expect(written).toContain(`ENCRYPTION_KEY=${OLD_SERVER_KEY}\n`);
      expect(written).toContain(`GOOGLE_DRIVE_CLIENT_ID=${CLIENT_ID}\n`);
      expect(written).toContain("SEED_ADMIN_EMAIL=owner@extas.test\n");
      expect(written).not.toContain("ENCRYPTION_OLD_KEYS");
      expect((await stat(fresh)).mode & 0o777).toBe(0o600);

      // A server that has its own settings keeps them, and its own key.
      const existing = path.join(dir, "old", "deploy", ".env");
      await mkdir(path.dirname(existing), { recursive: true });
      await writeFile(
        existing,
        "APP_DOMAIN=erp.extasbd.com\nENCRYPTION_KEY=this-servers-own-key-0123456789\nPOSTGRES_PASSWORD=its-own\n",
      );
      for (let i = 0; i < 2; i++) {
        expect((await tool(["env", "--work", work, "--env", existing], {})).code).toBe(0);
      }
      const kept = await readFile(existing, "utf8");
      expect(kept).toContain("ENCRYPTION_KEY=this-servers-own-key-0123456789\n");
      expect(kept).toContain(`ENCRYPTION_OLD_KEYS=${OLD_SERVER_KEY}\n`);
      expect(kept).toContain("POSTGRES_PASSWORD=its-own\n");
      expect(kept.match(/ENCRYPTION_OLD_KEYS=/g)).toHaveLength(1);
    });

    it("says when the backup has no settings, so the restore asks for new ones", async () => {
      await connectDrive();
      await setKey();
      await prepareHost(null);
      await backUpNow();
      expect((await fetch()).code).toBe(0);
      expect((await state()).hasSettings).toBe(false);
      const target = path.join(dir, "new", "deploy", ".env");
      expect((await tool(["env", "--work", work, "--env", target], {})).code).toBe(5);
      await expect(stat(target)).rejects.toThrow();
    });
  });

  describe("dns: the web address in Cloudflare (G8, G9)", () => {
    let cf: FakeCloudflare;
    beforeEach(async () => {
      cf = await startFakeCloudflare({
        zones: ["extasbd.com"],
        tokens: { [CF_TOKEN]: ["extasbd.com"] },
      });
      vi.stubEnv("CLOUDFLARE_API_BASE", cf.url);
    });
    afterEach(async () => {
      await cf.close();
    });

    it("points the ERP and the demo site at this server with the saved token", async () => {
      const zone = cf.zones.get("extasbd.com")!;
      zone.records.push(
        {
          id: "r1",
          type: "A",
          name: "erp.extasbd.com",
          content: "20.1.2.3",
          proxied: true,
          ttl: 1,
        },
        {
          id: "r2",
          type: "AAAA",
          name: "erp.extasbd.com",
          content: "2001:db8::1",
          proxied: true,
          ttl: 1,
        },
      );
      await connectDrive();
      await setKey();
      await cloudflare.setCloudflare(ctx, { pin: PIN, zone: "extasbd.com", token: CF_TOKEN });
      await prepareHost(SETTINGS);
      await backUpNow();
      expect((await fetch()).code).toBe(0);
      expect(await state()).toMatchObject({
        cloudflareZone: "extasbd.com",
        hasCloudflareToken: true,
      });
      const deploy = path.join(dir, "srv", "deploy");
      await mkdir(deploy, { recursive: true });
      await writeFile(path.join(deploy, ".env"), "APP_DOMAIN=erp.extasbd.com\nDEMO_SITE=on\n");
      const env = { CLOUDFLARE_API_BASE: cf.url, PUBLIC_IP: "203.0.113.7" };

      // G2: moved only when the web address is typed (Enter leaves it as it is).
      const pointed = await tool(
        ["dns", "--work", work, "--deploy", deploy],
        { dns: "Erp.Extasbd.com" },
        { env },
      );
      expect(pointed.code).toBe(0);
      expect((await state()).dnsMoved).toBe(true);
      expect(pointed.stdout).toContain(
        "erp.extasbd.com now points to this server (it pointed to 20.1.2.3).",
      );
      expect(pointed.stdout).toContain(
        "demo.extasbd.com now points to this server (a new A record).",
      );
      expect(pointed.stdout).toContain("Note W08: erp.extasbd.com also has an AAAA (IPv6) record");
      expect(pointed.stdout + pointed.stderr).not.toContain(CF_TOKEN);
      expect(
        zone.records.filter((r) => r.type === "A").map((r) => [r.name, r.content, r.proxied]),
      ).toEqual([
        ["erp.extasbd.com", "203.0.113.7", true],
        ["demo.extasbd.com", "203.0.113.7", false],
      ]);

      // Already here: nothing to ask, nothing to change.
      const again = await tool(["dns", "--work", work, "--deploy", deploy], {}, { env });
      expect(again.stdout).toContain("erp.extasbd.com already points to this server.");
      expect((await state()).dnsMoved).toBe(true);
      zone.records.find((r) => r.name === "erp.extasbd.com" && r.type === "A")!.content =
        "20.1.2.3";
      // "no" changes nothing, and says what to do instead.
      const before = cf.requests.length;
      for (const typed of ["no", "", "demo.extasbd.com"]) {
        const no = await tool(["dns", "--work", work, "--deploy", deploy], { dns: typed }, { env });
        expect(no.stdout).toContain("Note W01: the web address was not changed.");
        expect((await state()).dnsMoved).toBe(false);
      }
      // Only looked: no record was changed.
      expect(cf.requests.slice(before).every((r) => r.startsWith("GET "))).toBe(true);
    });

    it("says when the ERP still answers from the old server, and leaves the address unless it is typed (G2)", async () => {
      const zone = cf.zones.get("extasbd.com")!;
      zone.records.push({
        id: "r1",
        type: "A",
        name: "erp.extasbd.com",
        content: "20.1.2.3",
        proxied: false,
        ttl: 1,
      });
      // The old server, still running.
      const old = createServer((req, res) => {
        res.writeHead(req.url === "/api/health" ? 200 : 404, {
          "content-type": "application/json",
        });
        res.end('{"ok":true}');
      });
      await new Promise<void>((resolve) => old.listen(0, "127.0.0.1", resolve));
      const site = `http://127.0.0.1:${(old.address() as AddressInfo).port}`;
      try {
        await connectDrive();
        await setKey();
        await cloudflare.setCloudflare(ctx, { pin: PIN, zone: "extasbd.com", token: CF_TOKEN });
        await prepareHost(SETTINGS);
        await backUpNow();
        expect((await fetch()).code).toBe(0);
        const deploy = path.join(dir, "srv", "deploy");
        await mkdir(deploy, { recursive: true });
        await writeFile(path.join(deploy, ".env"), "APP_DOMAIN=erp.extasbd.com\n");
        const env = {
          CLOUDFLARE_API_BASE: cf.url,
          PUBLIC_IP: "203.0.113.7",
          EXTAS_SITE_BASE: site,
        };

        const kept = await tool(["dns", "--work", work, "--deploy", deploy], { dns: "" }, { env });
        expect(kept.code).toBe(0);
        expect(kept.stdout).toContain(
          "The ERP at erp.extasbd.com still answers from another server (20.1.2.3)",
        );
        expect(kept.stdout).toContain("Note W01: the web address was not changed.");
        expect(zone.records[0]!.content).toBe("20.1.2.3");
        expect((await state()).dnsMoved).toBe(false);

        const moved = await tool(
          ["dns", "--work", work, "--deploy", deploy],
          { dns: "erp.extasbd.com" },
          { env },
        );
        expect(moved.stdout).toContain(
          "erp.extasbd.com now points to this server (it pointed to 20.1.2.3).",
        );
        expect((await state()).dnsMoved).toBe(true);
      } finally {
        await new Promise((resolve) => old.close(resolve));
      }
    });

    it("without a saved token, says which address to point where, and changes nothing", async () => {
      await mkdir(work, { recursive: true });
      await writeFile(path.join(work, "server.json"), "{}");
      const deploy = path.join(dir, "srv", "deploy");
      await mkdir(deploy, { recursive: true });
      await writeFile(path.join(deploy, ".env"), "APP_DOMAIN=erp.extasbd.com\n");
      const done = await tool(
        ["dns", "--work", work, "--deploy", deploy],
        {},
        { env: { CLOUDFLARE_API_BASE: cf.url, PUBLIC_IP: "203.0.113.7" } },
      );
      expect(done.code).toBe(0);
      expect(done.stdout).toContain(
        "Note W01: the Cloudflare token was not saved on the Backups screen, so the web address was not changed. In your domain's DNS, point erp.extasbd.com (A record) to this server: 203.0.113.7.",
      );
      expect(cf.requests).toEqual([]);
      // Not moved: the restored copy waits on standby (bootstrap.sh reads this).
      expect((await state()).dnsMoved).toBe(false);
    });
  });

  describe("compare: every record and file is back (G8)", () => {
    it("says all N records and M files are back, or exactly what is missing", async () => {
      await connectDrive();
      await setKey();
      await prepareHost(SETTINGS);
      const backup = await backUpNow();
      expect((await fetch()).code).toBe(0);
      const records = (await state()).records as number;
      expect(records).toBeGreaterThan(0);
      const { counts } = await countsOf(path.join(work, "restore", "database.dump"));
      const countsFile = path.join(dir, "counts.json");
      await writeFile(countsFile, JSON.stringify(counts));
      const back = path.join(dir, "uploads-back");
      await mkdir(back);
      await exec("tar", ["-xzf", path.join(work, "restore", "media.tar.gz"), "-C", back]);
      const result = path.join(dir, "result.json");
      const args = ["compare", "--work", work, "--counts", countsFile, "--uploads", back];

      const ok = await tool([...args, "--result", result], {});
      expect(ok.code).toBe(0);
      expect(ok.stdout).toContain(
        `All ${records.toLocaleString("en-US")} records and 2 files are back.`,
      );
      expect(JSON.parse(await readFile(result, "utf8"))).toMatchObject({
        ok: true,
        records,
        files: 2,
        problems: [],
      });
      expect(backup.status).toBe("SUCCEEDED");

      // One record short, one file changed and one missing: each is named.
      const table = Object.keys(counts).find((t) => counts[t]! > 0)!;
      await writeFile(countsFile, JSON.stringify({ ...counts, [table]: counts[table]! - 1 }));
      await writeFile(path.join(back, "c1", "2026", "10", "logo.png"), "changed");
      await rm(path.join(back, "c1", "2026", "10", "bill scan.pdf"));
      const short = await tool(args, {});
      expect(short.code).toBe(3);
      expect(short.stdout).toContain("Not everything is back (3 problems):");
      expect(short.stdout).toContain(
        `Table ${table} has ${counts[table]! - 1} of ${counts[table]} records.`,
      );
      expect(short.stdout).toContain("File c1/2026/10/logo.png is not the same.");
      expect(short.stdout).toContain("File c1/2026/10/bill scan.pdf is missing.");
      expect(short.stderr).toContain("Error R20: some records or files did not come back");
    });
  });

  describe("the restore guide's copies (G7)", () => {
    it("is in Drive with the key while it is kept there, made again when anything changes", async () => {
      await connectDrive();
      await setKey({ keepInDrive: true });
      await prepareHost(SETTINGS);
      expect(await guideTick()).toBe("made");
      expect(labelled("guide-bn")).toHaveLength(1);
      expect(labelled("guide-en")).toHaveLength(1);
      expect(labelled("guide-en")[0]!.name).toBe("Extas ERP restore guide (English).pdf");
      const en = guideText("guide-en");
      expect(en).toContain(OWNER_KEY);
      expect(en).toContain(CLIENT_ID);
      expect(en).toContain(CLIENT_SECRET);
      expect(en).toContain(`c=${COMMIT} &&`);
      expect(guideText("guide-bn")).toContain(OWNER_KEY);

      // Nothing changed: Google is not asked again.
      const asked = google.requests.length;
      expect(await guideTick()).toBe("fresh");
      expect(google.requests.length).toBe(asked);

      // A new web address, or a month later: made again, replacing the old ones.
      vi.stubEnv("APP_URL", "https://erp2.extasbd.com");
      expect(await guideTick()).toBe("made");
      expect(labelled("guide-en")).toHaveLength(1);
      expect(guideText("guide-en")).toContain("erp2.extasbd.com");
      expect(await guideTick(new Date(Date.now() + 31 * 24 * 3_600_000))).toBe("made");
      expect(labelled("guide-bn")).toHaveLength(1);

      // Taken out of Drive: the guide there is made without the key.
      await keys.setKeepKeyInDrive(ctx, { pin: PIN, keep: false });
      expect(guideText("guide-en")).not.toContain(OWNER_KEY);
      expect(guideText("guide-en")).toContain(CLIENT_ID);
    });

    it("puts restore.sh and restore-tool.py beside it, so a restore needs nothing from GitHub (G17)", async () => {
      await connectDrive();
      await setKey({ keepInDrive: true });
      await prepareHost(SETTINGS);
      const host = hostRoot();
      const version = async (script: string, commit: string) => {
        await writeFile(path.join(host, "restore.sh"), script);
        await writeFile(path.join(host, "restore-tool.py"), `print('${commit}')\n`);
        await writeFile(
          path.join(host, "version.json"),
          JSON.stringify({
            commit,
            // The checksum the guide's command checks restore.sh against.
            bootstrapSha256: createHash("sha256").update(script).digest("hex"),
            deployedAt: new Date().toISOString(),
            version: "6.4.0",
          }),
        );
      };
      const copies = () =>
        ["restore-script", "restore-tool"].flatMap((label) =>
          labelled(label).map((f) => [f.name, f.data!.toString()]),
        );
      await version("echo one\n", "1".repeat(40));
      expect(await guideTick()).toBe("made");
      expect(copies()).toEqual([
        ["restore.sh", "echo one\n"],
        ["restore-tool.py", `print('${"1".repeat(40)}')\n`],
      ]);
      expect(guideText("guide-en")).toContain("restore-tool.py");

      // A new version: made again, one of each.
      await version("echo two\n", "2".repeat(40));
      expect(await guideTick()).toBe("made");
      expect(copies()).toEqual([
        ["restore.sh", "echo two\n"],
        ["restore-tool.py", `print('${"2".repeat(40)}')\n`],
      ]);

      // A restore.sh that is not the one the guide's command checks is never put there.
      await writeFile(path.join(host, "restore.sh"), "echo changed\n");
      vi.stubEnv("APP_URL", "https://erp2.extasbd.com");
      expect(await guideTick()).toBe("made");
      expect(copies()[0]).toEqual(["restore.sh", "echo two\n"]);
    });

    it("is on the server and in every backup without details, and downloads without the key", async () => {
      await connectDrive();
      await setKey({ keepInDrive: true });
      await prepareHost(SETTINGS);
      await guideTick();
      const local = await readdir(guideRoot());
      expect(local.sort()).toEqual(["guide.json", "restore-guide-bn.pdf", "restore-guide-en.pdf"]);
      const plain = pdfLines(await readFile(path.join(guideRoot(), "restore-guide-en.pdf"))).join(
        "\n",
      );
      expect(plain).toContain(`c=${COMMIT} &&`);
      for (const secret of [OWNER_KEY, CLIENT_ID, CLIENT_SECRET])
        expect(plain).not.toContain(secret);

      const backup = await backUpNow();
      const folder = [...google.files.values()].find(
        (f) => f.appProperties.extas === "backup" && f.name === backup.name,
      )!;
      const inside = [...google.files.values()]
        .filter((f) => f.parents.includes(folder.id))
        .map((f) => f.name);
      expect(inside).toEqual(
        expect.arrayContaining(["restore-guide-bn.pdf", "restore-guide-en.pdf"]),
      );

      const downloaded = await downloadGuide(owner, "en");
      expect(downloaded.fileName).toBe("Extas ERP restore guide (English).pdf");
      const text = pdfLines(downloaded.data).join("\n");
      expect(text).toContain(CLIENT_ID);
      expect(text).not.toContain(OWNER_KEY);
      const audit = await prisma.auditLog.findFirst({
        where: { summary: "Downloaded the restore guide (English), with the restore details" },
      });
      expect(audit?.userId).toBe(owner.userId);
    });
  });
});
