import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4.1 B5: wrong passwords from someone else must never lock the owner out.
 * Five wrong passwords for one account from one place make only that place
 * wait 15 minutes for that account; any other place signs in as always. The
 * person ends the wait from their own mailbox with a link that works once, for
 * 30 minutes (only its hash is kept), or the owner through the bot with the
 * PIN (tests/integration/ai-bot.test.ts).
 */

import { hashSessionToken } from "@/lib/auth/token";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  checkLoginRate,
  login,
  MAX_FAILED_LOGINS,
  unlockSignIn,
} from "@/modules/auth/auth.service";
import { askUnlockLink, UNLOCK_ASKED_TEXT, unlockWithLink } from "@/modules/auth/unlock.service";
import { type MailConfig, type OutgoingMail, standInForMail } from "@/modules/mail/mail.service";

import { addToCompany, makeCompany, makeUser, PASSWORD, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ATTACKER = "203.0.113.66";
const HOME = "198.51.100.10";
/** A Cloudflare address: many visitors at once when CF-Connecting-IP is missing. */
const CLOUDFLARE = "173.245.48.10";

async function expectAppError(promise: Promise<unknown>, code: string, message?: string | RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
}

run("Sign-in that waits, and unlocking it (v6.4.1 B5)", () => {
  let sent: OutgoingMail[];
  let owner: { id: string; email: string };

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("SMTP_HOST", "smtp.test");
    vi.stubEnv("SMTP_FROM", "erp@extas.test");
    sent = [];
    standInForMail(async (_config: MailConfig, mail: OutgoingMail) => {
      sent.push(mail);
      return { messageId: `m-${sent.length}` };
    });
    const { company, roles } = await makeCompany("Extas");
    const user = await makeUser("owner@extas.test", { isSuperAdmin: true });
    await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
    owner = { id: user.id, email: user.email };
  });
  afterEach(() => {
    standInForMail(null);
    vi.unstubAllEnvs();
  });

  const signIn = (ip: string, password = PASSWORD) =>
    login({ email: "owner@extas.test", password }, { ipAddress: ip });
  const wrong = async (ip: string, times: number) => {
    for (let i = 0; i < times; i += 1) await signIn(ip, "not-the-password").catch(() => undefined);
    // The minute's sign-in limit is the route's; these are many minutes' worth.
    resetRateLimits();
  };

  it("never locks the account for wrong passwords from another place", async () => {
    await wrong(ATTACKER, 30);
    expect((await signIn(HOME)).token).toBeTruthy();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user.lockedUntil).toBeNull();
  });

  it("makes only the place with the wrong passwords wait 15 minutes, right password or not", async () => {
    await wrong(ATTACKER, MAX_FAILED_LOGINS);
    await expectAppError(signIn(ATTACKER), "ACCOUNT_LOCKED", /Wait 15 minutes.*unlock/);
    // Its wrong passwords before the wait are not counted again, nor its refused tries.
    expect(
      await prisma.auditLog.count({ where: { action: "LOGIN_FAILED", userId: owner.id } }),
    ).toBe(MAX_FAILED_LOGINS);
    expect((await signIn(HOME)).token).toBeTruthy();
    // 15 minutes later the place may try again.
    await prisma.auditLog.updateMany({
      where: { action: "LOGIN_FAILED", ipAddress: ATTACKER },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    expect((await signIn(ATTACKER)).token).toBeTruthy();
    expect((await signIn(HOME)).token).toBeTruthy();
  });

  it("never makes the owner wait for wrong passwords from a Cloudflare address or none: that is no one place", async () => {
    // Someone else's wrong passwords through Cloudflare (no visitor address), or with no address.
    await wrong(CLOUDFLARE, MAX_FAILED_LOGINS * 2);
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      await login({ email: owner.email, password: "nope-nope-1" }).catch(() => undefined);
    }
    resetRateLimits();
    expect((await signIn(CLOUDFLARE)).token).toBeTruthy();
    expect((await login({ email: owner.email, password: PASSWORD })).token).toBeTruthy();
    // The sign-in route's tries a minute for the account still hold there.
    const tries = () => checkLoginRate({ ipAddress: CLOUDFLARE }, owner.email);
    for (let i = 0; i < 10; i += 1) tries();
    expect(tries).toThrow(/Too many attempts/);
  });

  it("keeps link requests from a Cloudflare address or none apart for each account", async () => {
    // Someone asks for links for many other emails through Cloudflare, or with no address.
    for (let i = 0; i < 12; i += 1) {
      await askUnlockLink({ email: `someone${i}@extas.test` }, { ipAddress: CLOUDFLARE });
      await askUnlockLink({ email: `other${i}@extas.test` });
    }
    // The owner's own request still goes out, from there too.
    expect(await askUnlockLink({ email: owner.email }, { ipAddress: CLOUDFLARE })).toBe(
      UNLOCK_ASKED_TEXT,
    );
    expect(sent).toHaveLength(1);
    // Many wrong links from there do not use up the owner's own link.
    for (let i = 0; i < 12; i += 1) {
      await unlockWithLink({ token: `${"y".repeat(40)}${i}` }, { ipAddress: CLOUDFLARE }).catch(
        () => 0,
      );
      await unlockWithLink({ token: `${"z".repeat(40)}${i}` }).catch(() => 0);
    }
    const token = /unlock=([\w-]+)/.exec(sent[0]!.text)![1]!;
    expect(await unlockWithLink({ token }, { ipAddress: CLOUDFLARE })).toMatch(/Unlocked/);
  });

  it("ends the wait from the person's own mailbox, with a link that works once for 30 minutes", async () => {
    await wrong(HOME, MAX_FAILED_LOGINS);
    await expectAppError(signIn(HOME), "ACCOUNT_LOCKED");

    // The same answer whoever asks; only a real account gets an email, at its own address.
    expect(await askUnlockLink({ email: "nobody@extas.test" }, { ipAddress: HOME })).toBe(
      UNLOCK_ASKED_TEXT,
    );
    expect(sent).toHaveLength(0);
    expect(await askUnlockLink({ email: " OWNER@extas.test " }, { ipAddress: HOME })).toBe(
      UNLOCK_ASKED_TEXT,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(owner.email);
    const token = /\/sign-in\?unlock=([\w-]+)/.exec(sent[0]!.text)?.[1];
    expect(token).toBeTruthy();
    expect(sent[0]!.text).toContain("https://erp.test/sign-in?unlock=");
    // Only its hash is kept.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user.unlockTokenHash).toBe(hashSessionToken(token!));
    expect(JSON.stringify(user)).not.toContain(token);
    const log = await prisma.notificationLog.findMany();
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(token);
    expect(log).toHaveLength(1);

    expect(await unlockWithLink({ token }, { ipAddress: HOME })).toMatch(/Unlocked/);
    expect((await signIn(HOME)).token).toBeTruthy();
    expect(
      await prisma.auditLog.count({
        where: { entityType: "SignInUnlock", entityId: owner.id, summary: { contains: "link" } },
      }),
    ).toBe(1);
    // Once only.
    await expectAppError(unlockWithLink({ token }, { ipAddress: HOME }), "VALIDATION", /run out/);
    await expectAppError(unlockWithLink({ token: "x".repeat(43) }), "VALIDATION", /run out/);
    await expectAppError(unlockWithLink({ token: "short" }), "VALIDATION", /run out/);

    // A link past its 30 minutes does nothing; a new one replaces the old.
    await askUnlockLink({ email: owner.email }, { ipAddress: HOME });
    const late = /unlock=([\w-]+)/.exec(sent[1]!.text)![1]!;
    await prisma.user.update({
      where: { id: owner.id },
      data: { unlockTokenUntil: new Date(Date.now() - 1000) },
    });
    await expectAppError(unlockWithLink({ token: late }), "VALIDATION", /run out/);
    await askUnlockLink({ email: owner.email }, { ipAddress: HOME });
    const fresh = /unlock=([\w-]+)/.exec(sent[2]!.text)![1]!;
    await expectAppError(unlockWithLink({ token: late }), "VALIDATION", /run out/);
    expect(await unlockWithLink({ token: fresh })).toMatch(/Unlocked/);
    // Asking is limited for each account (3 an hour): the answer stays the same.
    expect(await askUnlockLink({ email: owner.email }, { ipAddress: "192.0.2.1" })).toBe(
      UNLOCK_ASKED_TEXT,
    );
    expect(sent).toHaveLength(3);
  });

  it("counts only wrong passwords after an unlock, or after signing in from there", async () => {
    await wrong(HOME, MAX_FAILED_LOGINS);
    await expectAppError(signIn(HOME), "ACCOUNT_LOCKED");
    await unlockSignIn(owner.id, "in a test");
    expect((await signIn(HOME)).token).toBeTruthy();
    await wrong(HOME, MAX_FAILED_LOGINS - 1);
    expect((await signIn(HOME)).token).toBeTruthy();
    // The four before that sign-in no longer count: four more still let it in.
    await wrong(HOME, MAX_FAILED_LOGINS - 1);
    expect((await signIn(HOME)).token).toBeTruthy();
    // The fifth in a row makes it wait again.
    await wrong(HOME, MAX_FAILED_LOGINS);
    await expectAppError(signIn(HOME), "ACCOUNT_LOCKED");
  });
});
