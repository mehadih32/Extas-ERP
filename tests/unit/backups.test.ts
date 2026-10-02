import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret, signPayload, verifyPayload } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { pgEnvironment } from "@/modules/backups/backup.service";
import { nextRun, parseCron, previousRun } from "@/modules/backups/cron";
import * as drive from "@/modules/backups/google-drive";

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
    const flipped = `v1:${payload.slice(0, -2)}${payload.endsWith("A") ? "B" : "A"}${payload.slice(-1)}`;
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
    expect(verifyPayload(`${body}.${signature.slice(0, -2)}xx`)).toBeNull();
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
  beforeEach(() => {
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "client-123.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "shh");
    vi.stubEnv("APP_URL", "https://erp.example.com/");
  });

  it("builds the consent link for the drive.file scope with a refresh token", () => {
    expect(drive.driveConfigured()).toBe(true);
    expect(drive.redirectUri()).toBe("https://erp.example.com/api/backups/google/callback");
    const url = new URL(drive.authorizationUrl("state-abc"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-123.apps.googleusercontent.com",
      redirect_uri: "https://erp.example.com/api/backups/google/callback",
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      state: "state-abc",
    });
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "");
    expect(drive.driveConfigured()).toBe(false);
    expectAppError(() => drive.authorizationUrl("x"), "UNAVAILABLE");
  });

  it("marks a revoked refresh token as needing a new connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })),
    );
    const error = await drive.accessToken("old-token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(drive.DriveError);
    expect(error).toMatchObject({ status: 400, reconnect: true });
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
