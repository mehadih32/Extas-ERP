import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret, signPayload, verifyPayload } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { pgEnvironment } from "@/modules/backups/backup.service";
import { nextRun, parseCron, previousRun } from "@/modules/backups/cron";
import * as drive from "@/modules/backups/google-drive";

import { startFakeGoogle } from "../../scripts/fake-google";

const TZ = "Asia/Dhaka";

function expectAppError(fn: () => unknown, code: string) {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("backup schedule (cron)", () => {
  it("reads the five parts: lists, ranges, steps, 7 = Sunday", () => {
    expect(parseCron("0 2 * * *")).toMatchObject({
      minutes: [0],
      hours: [2],
      anyDay: true,
      anyWeekday: true,
    });
    const workHours = parseCron("*/15 9-17/4 * * 1-5");
    expect(workHours.minutes).toEqual([0, 15, 30, 45]);
    expect(workHours.hours).toEqual([9, 13, 17]);
    expect([...workHours.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("30 1 1,15 * 7").weekdays]).toEqual([0]);
  });

  it("rejects schedules that cannot run", () => {
    for (const bad of [
      "0 2 * *",
      "60 2 * * *",
      "0 24 * * *",
      "0 2 0 * *",
      "0 2 * 13 *",
      "a b c d e",
    ]) {
      expectAppError(() => parseCron(bad), "VALIDATION");
    }
  });

  it("finds the next and the latest run in the schedule's timezone", () => {
    // 01:30 on 2 October in Dhaka.
    const now = new Date("2026-10-01T19:30:00Z");
    expect(nextRun("0 2 * * *", TZ, now)?.toISOString()).toBe("2026-10-01T20:00:00.000Z");
    expect(previousRun("0 2 * * *", TZ, now)?.toISOString()).toBe("2026-09-30T20:00:00.000Z");
    // Exactly at 02:00: that run is the latest one, the next is tomorrow's.
    const twoAm = new Date("2026-10-01T20:00:00Z");
    expect(previousRun("0 2 * * *", TZ, twoAm)?.toISOString()).toBe("2026-10-01T20:00:00.000Z");
    expect(nextRun("0 2 * * *", TZ, twoAm)?.toISOString()).toBe("2026-10-02T20:00:00.000Z");
    // Every 6 hours from 00:30 Dhaka: 06:00.
    expect(nextRun("0 */6 * * *", TZ, new Date("2026-10-01T18:30:00Z"))?.toISOString()).toBe(
      "2026-10-02T00:00:00.000Z",
    );
  });

  it("runs when either day field matches, as standard cron does", () => {
    // Friday 2 October 2026: the next Monday is the 5th.
    const friday = new Date("2026-10-02T06:00:00Z");
    expect(nextRun("0 3 1 * 1", TZ, friday)?.toISOString()).toBe("2026-10-04T21:00:00.000Z");
    // Tuesday 27 October: 1 November (a Sunday) comes before Monday the 2nd.
    const tuesday = new Date("2026-10-27T06:00:00Z");
    expect(nextRun("0 3 1 * 1", TZ, tuesday)?.toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(nextRun("0 3 * * 1", TZ, tuesday)?.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(nextRun("0 3 1 * *", TZ, friday)?.toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });
});

describe("secrets and signed links", () => {
  beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", "test-key-0123456789abcdef"));

  it("seals secrets so only the same key opens them", () => {
    const sealed = encryptSecret("1//refresh-token");
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("refresh-token");
    expect(encryptSecret("1//refresh-token")).not.toBe(sealed); // a fresh IV every time
    expect(decryptSecret(sealed)).toBe("1//refresh-token");

    const payload = sealed.slice(3);
    // Change the second-to-last character, whatever it is (it may already be an "A").
    const swap = payload.at(-2) === "A" ? "B" : "A";
    const flipped = `v1:${payload.slice(0, -2)}${swap}${payload.slice(-1)}`;
    expectAppError(() => decryptSecret(flipped), "UNAVAILABLE");
    vi.stubEnv("ENCRYPTION_KEY", "another-key-0123456789");
    expectAppError(() => decryptSecret(sealed), "UNAVAILABLE");
    vi.stubEnv("ENCRYPTION_KEY", "");
    expectAppError(() => encryptSecret("x"), "UNAVAILABLE");
  });

  it("signs payloads and refuses altered or expired ones", () => {
    const token = signPayload({ u: "user_1", p: "drive-backup" }, 60);
    expect(verifyPayload(token)).toMatchObject({ u: "user_1", p: "drive-backup" });
    const [body, signature] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ u: "user_2", p: "drive-backup", exp: 9e9 }));
    expect(verifyPayload(`${forged.toString("base64url")}.${signature}`)).toBeNull();
    // The first character carries 6 whole bits, so changing it always changes the signature
    // (the last one has spare bits, and "…xx" was sometimes the same signature).
    const altered = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(verifyPayload(`${body}.${altered}`)).toBeNull();
    expect(verifyPayload(signPayload({ u: "user_1" }, -5))).toBeNull();
    expect(verifyPayload("not-a-token")).toBeNull();
  });
});

describe("pg_dump connection settings", () => {
  it("passes the password through the environment, decoded", () => {
    expect(
      pgEnvironment(
        "postgresql://extras:p%40ss%3Aword@db.example.com:6543/extras_erp?schema=public&sslmode=require",
      ),
    ).toEqual({
      PGHOST: "db.example.com",
      PGPORT: "6543",
      PGUSER: "extras",
      PGPASSWORD: "p@ss:word",
      PGDATABASE: "extras_erp",
      PGSSLMODE: "require",
    });
    expect(pgEnvironment("postgresql://u:p@localhost/erp?host=/var/run/postgresql")).toMatchObject({
      PGHOST: "/var/run/postgresql",
      PGPORT: "5432",
      PGDATABASE: "erp",
    });
  });
});

describe("Google Drive client", () => {
  const client = { clientId: "client-123.apps.googleusercontent.com", clientSecret: "shh" };

  it("signs in with a code for the owner's phone, for the drive.file scope only", async () => {
    const google = await startFakeGoogle({ pendingPolls: 1 }, 0);
    vi.stubEnv("GOOGLE_OAUTH_BASE", google.url);
    const sent = vi.spyOn(globalThis, "fetch");
    try {
      const start = await drive.startDeviceSignIn(client);
      expect(start).toMatchObject({ userCode: "ABCD-EFGH", interval: 1 });
      expect(start.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(await drive.pollDeviceSignIn(client, start.deviceCode)).toEqual({ status: "waiting" });
      const done = await drive.pollDeviceSignIn(client, start.deviceCode);
      expect(done).toMatchObject({ status: "connected" });
      const asked = sent.mock.calls[0]![1]!.body as URLSearchParams;
      expect(asked.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
      expect(asked.get("client_id")).toBe(client.clientId);

      google.options.deny = true;
      const refused = await drive.startDeviceSignIn(client);
      expect(await drive.pollDeviceSignIn(client, refused.deviceCode)).toEqual({
        status: "denied",
      });
    } finally {
      sent.mockRestore();
      await google.close();
    }
  });

  it("says which kind of Google client is needed when Google refuses it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "invalid_client" }, { status: 401 })),
    );
    await expect(drive.startDeviceSignIn(client)).rejects.toThrow(/TVs and Limited Input devices/);
  });

  it("marks a revoked refresh token as needing a new connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })),
    );
    const error = await drive.accessToken(client, "old-token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(drive.DriveError);
    expect(error).toMatchObject({ status: 400, reconnect: true });
  });

  it("reads every page of a Drive list, newest first, so no backup or keys file is left out", async () => {
    // Google sends a long list in pages (here 2 files a page, as it may with fewer than asked).
    const google = await startFakeGoogle({ pageSize: 2 }, 0);
    vi.stubEnv("GOOGLE_OAUTH_BASE", google.url);
    vi.stubEnv("GOOGLE_DRIVE_BASE", google.url);
    try {
      const start = await drive.startDeviceSignIn(client);
      const signedIn = await drive.pollDeviceSignIn(client, start.deviceCode);
      if (signedIn.status !== "connected") throw new Error("not signed in");
      const token = signedIn.accessToken;
      const root = await drive.createFolder(token, "Extas ERP backups", undefined, {
        extas: "backups",
      });
      const made: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const folder = await drive.createFolder(token, `2026-10-0${i}_020000`, root.id, {
          extas: "backup",
        });
        // Drive's own times, one minute apart, so the order is certain.
        google.files.get(folder.id)!.createdTime = `2026-10-0${i}T02:00:00.000Z`;
        made.push(folder.name);
      }
      const keyFile = await drive.uploadBytes(
        token,
        Buffer.from("{}"),
        root.id,
        "restore-key.json",
        "application/json",
        { extas: "restore-key" },
      );
      google.files.get(keyFile.id)!.createdTime = "2026-10-06T02:00:00.000Z";
      google.requests.length = 0;

      const folders = await drive.listFolders(token, root.id);
      expect(folders.map((f) => f.name)).toEqual([...made].reverse());
      const files = await drive.listFiles(token, root.id);
      expect(files.map((f) => f.name)).toEqual(["restore-key.json", ...[...made].reverse()]);
      // Several pages were read for each list.
      expect(google.requests.filter((r) => r === "GET /drive/v3/files").length).toBe(3 + 3);
    } finally {
      await google.close();
    }
  });

  it("uploads in resumable chunks and carries on from what Google kept", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "extras-drive-"));
    try {
      const file = path.join(dir, "database.dump");
      await writeFile(file, "0123456789");
      const calls: Array<{ url: string; method?: string; headers: Record<string, string> }> = [];
      let put = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit = {}) => {
          calls.push({
            url,
            method: init.method,
            headers: (init.headers ?? {}) as Record<string, string>,
          });
          if (init.method === "POST") {
            return new Response(null, {
              status: 200,
              headers: { location: "https://upload.example/session-1" },
            });
          }
          put += 1;
          // The first chunk only half arrives.
          if (put === 1)
            return new Response(null, { status: 308, headers: { range: "bytes=0-4" } });
          return Response.json({ id: "file-1" });
        }),
      );
      await expect(drive.uploadFile("token", file, "folder-1")).resolves.toEqual({ id: "file-1" });
      expect(calls[0]).toMatchObject({
        method: "POST",
        headers: { Authorization: "Bearer token", "X-Upload-Content-Length": "10" },
      });
      expect(calls.slice(1).map((c) => c.headers["Content-Range"])).toEqual([
        "bytes 0-9/10",
        "bytes 5-9/10",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
