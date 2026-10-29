import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getBackupConfig, googleClient } from "@/modules/backups/backup-core";
import {
  checkInCopy,
  claimClient,
  listCopies,
  makeCopyCode,
  normalizeCode,
  setCopyBlocked,
} from "@/modules/backups/copies.service";
import { applyCopyCode, extasCheckIn, reclaimExtasClient } from "@/modules/backups/extas-client";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

/*
 * Copy codes (owner's decision, 2026-10-29): the Extas ERP gives its own Google
 * client to a sold copy only for a one-time code the owner made with the PIN;
 * without a code nobody gets it. A code works once and for 30 days, Block stops
 * the code and the copy, and the copy keeps the client, sealed, until blocked.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PIN = "2468";
const OWN_ID = "extas-own-123.apps.googleusercontent.com";
const OWN_SECRET = "GOCSPX-the-extas-secret";
const COPY = "https://erp.rahim.example";
const DAY = 24 * 60 * 60_000;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

run("copy codes for the Google client", { timeout: 60_000 }, () => {
  let ctx: CompanyContext;

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "");
    const user = await makeUser("owner@extas.test", { isSuperAdmin: true });
    const { company, roles } = await makeCompany("Extas");
    await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
    ctx = await contextFor(user.id, company.id);
    await setPin(ctx, { pin: PIN });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function ownClientSet() {
    const config = await getBackupConfig();
    await prisma.backupConfig.update({
      where: { id: config.id },
      data: { googleClientId: OWN_ID, googleClientSecretRef: encryptSecret(OWN_SECRET) },
    });
  }

  it("makes a code only with the PIN and only with this server's own client", async () => {
    await expectAppError(makeCopyCode(ctx, { label: "Rahim Fashions", pin: PIN }), "VALIDATION");
    await ownClientSet();
    await expectAppError(makeCopyCode(ctx, { label: "Rahim Fashions" }), "VALIDATION");
    const made = await makeCopyCode(ctx, { label: "Rahim Fashions", pin: PIN });
    expect(made.code).toMatch(/^EXTAS(-[2-9A-Z]{4}){5}$/);
    const row = await prisma.erpCopy.findFirstOrThrow();
    // The code itself is never stored.
    expect(JSON.stringify(row)).not.toContain(normalizeCode(made.code));
    expect(made.list.counts.waiting).toBe(1);
  });

  it("gives the client for a right code, once; never without a code", async () => {
    await ownClientSet();
    const { code } = await makeCopyCode(ctx, { label: "Rahim Fashions", pin: PIN });
    // No code at all: refused by the input check (the route answers VALIDATION).
    await expect(claimClient({ address: COPY })).rejects.toThrow();
    await expectAppError(
      claimClient({ code: "EXTAS-2222-2222-2222-2222-2222", address: COPY }),
      "FORBIDDEN",
    );
    const got = await claimClient({ code: code.toLowerCase().replace(/-/g, " "), address: COPY });
    expect(got).toMatchObject({ clientId: OWN_ID, clientSecret: OWN_SECRET });
    await expectAppError(claimClient({ code, address: "https://other.example" }), "FORBIDDEN");
    const list = await listCopies();
    expect(list.copies[0]).toMatchObject({ state: "IN_USE", address: COPY });
    // Its own name and secret get the client again (a new secret each time).
    const again = await claimClient({
      copyId: got.copyId,
      copySecret: got.copySecret,
      address: COPY,
    });
    expect(again.copySecret).not.toBe(got.copySecret);
    await expectAppError(
      claimClient({ copyId: got.copyId, copySecret: got.copySecret, address: COPY }),
      "FORBIDDEN",
    );
  });

  it("refuses a code after 30 days, and a blocked code or copy", async () => {
    await ownClientSet();
    const now = new Date("2026-11-01T00:00:00Z");
    const old = await makeCopyCode(ctx, { label: "Old", pin: PIN }, undefined, now);
    await expectAppError(
      claimClient({ code: old.code, address: COPY }, new Date(now.getTime() + 31 * DAY)),
      "FORBIDDEN",
    );
    const fresh = await makeCopyCode(ctx, { label: "Karim", pin: PIN });
    const row = await prisma.erpCopy.findFirstOrThrow({ where: { label: "Karim" } });
    await expectAppError(setCopyBlocked(ctx, { copyId: row.id, blocked: true }), "VALIDATION");
    await setCopyBlocked(ctx, { copyId: row.id, blocked: true, pin: PIN });
    await expectAppError(claimClient({ code: fresh.code, address: COPY }), "FORBIDDEN");
    await setCopyBlocked(ctx, { copyId: row.id, blocked: false, pin: PIN });
    const got = await claimClient({ code: fresh.code, address: COPY });
    // The daily check-in says whether the copy may go on.
    expect(await checkInCopy({ ...got, address: COPY, driveConnected: true })).toEqual({
      allowed: true,
    });
    await setCopyBlocked(ctx, { copyId: row.id, blocked: true, pin: PIN });
    expect(await checkInCopy({ ...got, address: COPY, driveConnected: true })).toEqual({
      allowed: false,
    });
    await expectAppError(
      checkInCopy({ copyId: got.copyId, copySecret: "wrong", address: COPY, driveConnected: true }),
      "NOT_FOUND",
    );
  });

  it("never gives on a client that came from another ERP", async () => {
    await ownClientSet();
    const config = await getBackupConfig();
    await prisma.backupConfig.update({
      where: { id: config.id },
      data: { googleClientFrom: "https://erp.extasbd.com" },
    });
    expect((await listCopies()).canShare).toBe(false);
    await expectAppError(makeCopyCode(ctx, { label: "Rahim", pin: PIN }), "VALIDATION");
  });

  describe("on a sold copy", () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let answer: { status: number; body: unknown };

    beforeEach(() => {
      calls.length = 0;
      vi.stubEnv("EXTAS_CLIENT_SOURCE", "https://erp.extasbd.com");
      vi.stubEnv("APP_URL", COPY);
      vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
        calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      });
    });

    const given = {
      copyId: "copy-1",
      copySecret: "copy-secret-1",
      clientId: OWN_ID,
      clientSecret: OWN_SECRET,
    };

    it("uses a copy code with the PIN and keeps the client sealed", async () => {
      answer = { status: 200, body: { ok: true, data: given } };
      const code = "EXTAS-ABCD-EFGH-JKMN-PQRS-TVWX";
      await expectAppError(applyCopyCode(ctx, { code }), "VALIDATION");
      expect(calls).toHaveLength(0);
      await applyCopyCode(ctx, { code, pin: PIN });
      expect(calls[0]).toEqual({
        url: "https://erp.extasbd.com/api/v1/extas-client/claim",
        body: { code: "ABCDEFGHJKMNPQRSTVWX", address: COPY },
      });
      const config = await getBackupConfig();
      expect(googleClient(config)).toEqual({ clientId: OWN_ID, clientSecret: OWN_SECRET });
      expect(config.googleClientFrom).toBe("https://erp.extasbd.com");
      expect(config.googleClientSecretRef).not.toContain(OWN_SECRET);
      expect(decryptSecret(config.copySecretRef!)).toBe("copy-secret-1");
    });

    it("says what the Extas ERP said when the code is refused", async () => {
      answer = {
        status: 403,
        body: { ok: false, error: { message: "This copy code is not right." } },
      };
      const error = await expectAppError(
        applyCopyCode(ctx, { code: "EXTAS-ABCD-EFGH-JKMN-PQRS-TVWX", pin: PIN }),
        "UNAVAILABLE",
      );
      expect(error.message).toContain("This copy code is not right.");
      expect(googleClient(await getBackupConfig())).toBeNull();
    });

    it("stops Drive backups only when blocked; no answer changes nothing", async () => {
      answer = { status: 200, body: { ok: true, data: given } };
      await applyCopyCode(ctx, { code: "EXTAS-ABCD-EFGH-JKMN-PQRS-TVWX", pin: PIN });
      const config = await getBackupConfig();
      await prisma.backupConfig.update({
        where: { id: config.id },
        data: { credentialsRef: encryptSecret("{}"), googleDriveAccount: "rahim@gmail.com" },
      });
      answer = { status: 500, body: null };
      expect(await extasCheckIn(new Date(), { force: true })).toBeNull();
      expect((await getBackupConfig()).credentialsRef).not.toBeNull();
      answer = { status: 200, body: { ok: true, data: { allowed: true } } };
      expect(await extasCheckIn(new Date(), { force: true })).toBe("allowed");
      expect(calls.at(-1)!.body).toMatchObject({ copyId: "copy-1", driveConnected: true });
      answer = { status: 200, body: { ok: true, data: { allowed: false } } };
      expect(await extasCheckIn(new Date(), { force: true })).toBe("blocked");
      const after = await getBackupConfig();
      expect(googleClient(after)).toBeNull();
      expect(after.credentialsRef).toBeNull();
      // After an Unblock, Connect asks again with the copy's own name and secret.
      answer = { status: 200, body: { ok: true, data: { ...given, copySecret: "copy-secret-2" } } };
      await reclaimExtasClient();
      expect(calls.at(-1)!.body).toEqual({
        copyId: "copy-1",
        copySecret: "copy-secret-1",
        address: COPY,
      });
      expect(googleClient(await getBackupConfig())).toEqual({
        clientId: OWN_ID,
        clientSecret: OWN_SECRET,
      });
    });
  });
});
