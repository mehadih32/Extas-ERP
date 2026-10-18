import type { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import { visitorAddress } from "@/lib/cloudflare-ips";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
} from "@/modules/auth/schemas";
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  type SessionUser,
} from "@/modules/auth/session.service";
import {
  activeBlock,
  afterFailedLogin,
  afterLogin,
  blockedError,
  ownerPassedBlock,
  passesBlock,
} from "@/modules/bug-guard/security";
import { pickDefaultCompanyId } from "@/modules/companies/access";

/** Wrong passwords for one account from one place that make that place wait. */
export const MAX_FAILED_LOGINS = 5;
/** How long they count. */
export const LOCKOUT_MS = 15 * 60 * 1000;

/** How an unlock is kept in the audit log; wrong passwords before it no longer count. */
export const UNLOCK_ENTITY = "SignInUnlock";

export const SLOWED_TEXT =
  "Too many wrong passwords for this account from this place. Wait 15 minutes and try again, or unlock it: write “unlock” to the bot on Telegram, or press “Email me an unlock link”.";

const INVALID_CREDENTIALS = "Incorrect email or password.";

/** Sign-in tries a minute with no visitor address, all of them together (checkLoginRate). */
export const LOGIN_UNKNOWN_PER_MINUTE = 30;

/**
 * Sign-in tries a minute: 10 from one visitor. A Cloudflare address (or none)
 * is no one visitor (v6.4.1 B2), and counting such tries per account would let
 * anyone make the owner's account wait by trying it (v6.4.2): they share one
 * limit instead, whatever the account, so guessing a password from there stays
 * slow and no account is ever slowed on its own.
 */
export function checkLoginRate(meta: RequestMeta) {
  const visitor = visitorAddress(meta.ipAddress);
  if (visitor) checkRateLimit(`login:${visitor}`, 10, 60_000);
  else checkRateLimit("login-unknown", LOGIN_UNKNOWN_PER_MINUTE, 60_000);
}

export type LoginResult = {
  token: string;
  expiresAt: Date;
  user: SessionUser;
  activeCompanyId: string | null;
};

/**
 * Wrong passwords for this account from this place in the last 15 minutes,
 * since its last unlock and since the last sign-in from there (v6.4.1 B5):
 * someone else's wrong passwords from another place never count, so they can
 * never lock the owner out. A Cloudflare address (or none) is no one place, so
 * it never waits: the one limit a minute for all such tries (checkLoginRate) holds there.
 */
async function slowedHere(userId: string, address: string | undefined, now: Date) {
  const place = visitorAddress(address);
  if (!place) return false;
  const window = new Date(now.getTime() - LOCKOUT_MS);
  const latest = (where: Prisma.AuditLogWhereInput) =>
    prisma.auditLog.findFirst({
      where: { ...where, createdAt: { gt: window } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
  const [unlocked, signedIn] = await Promise.all([
    latest({ entityType: UNLOCK_ENTITY, entityId: userId }),
    latest({ action: "LOGIN", userId, ipAddress: place }),
  ]);
  const since = new Date(
    Math.max(
      window.getTime(),
      unlocked?.createdAt.getTime() ?? 0,
      signedIn?.createdAt.getTime() ?? 0,
    ),
  );
  const failures = await prisma.auditLog.count({
    where: {
      action: "LOGIN_FAILED",
      userId,
      ipAddress: place,
      createdAt: { gt: since },
    },
  });
  return failures >= MAX_FAILED_LOGINS;
}

/**
 * Unlocks a person's sign-in (v6.4.1 B5): the wrong passwords before now no
 * longer slow it down anywhere. Through the bot with the PIN, the link
 * emailed to them (unlock.service.ts), or a password reset on the Team screen
 * (`by` is who reset it); logged.
 */
export async function unlockSignIn(
  userId: string,
  how: string,
  meta: RequestMeta = {},
  by?: { userId: string; companyId: string },
) {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  await recordAudit({
    action: "UPDATE",
    entityType: UNLOCK_ENTITY,
    entityId: userId,
    userId: by?.userId ?? userId,
    companyId: by?.companyId,
    summary: `Sign-in unlocked ${how}: earlier wrong passwords no longer slow it down`,
    meta,
  });
}

/**
 * Email + password sign-in. Wrong passwords never lock the account: five for
 * one account from one place make only that place wait 15 minutes (v6.4.1
 * B5); many from one place get the place blocked (Bug Guard), and sign-in
 * tries are limited per place a minute (checkLoginRate).
 * Error messages never reveal whether an email exists.
 *
 * A place Bug Guard blocked after many wrong passwords (modules/bug-guard/
 * security.ts) refuses everyone, except an active platform owner with the right
 * password, whose wait at that place still applies; the refusal reads the same for
 * every account, so it never tells whether one is the owner's.
 */
export async function login(rawInput: LoginInput, meta: RequestMeta = {}): Promise<LoginResult> {
  const { email, password } = loginSchema.parse(rawInput);
  const blocked = await activeBlock(meta.ipAddress);
  const user = await prisma.user.findUnique({ where: { email } });
  if (blocked && !(user?.passwordHash && passesBlock(user))) {
    await burnPasswordCheck(password);
    throw blockedError();
  }

  if (!user || !user.passwordHash) {
    await burnPasswordCheck(password);
    await recordAudit({
      action: "LOGIN_FAILED",
      entityType: "User",
      userId: user?.id,
      summary: `Failed login for ${email} (unknown account)`,
      meta,
    });
    await afterFailedLogin(meta);
    throw new AppError("INVALID_CREDENTIALS", INVALID_CREDENTIALS);
  }

  if (await slowedHere(user.id, meta.ipAddress, new Date())) {
    await burnPasswordCheck(password);
    if (blocked) throw blockedError();
    throw new AppError("ACCOUNT_LOCKED", SLOWED_TEXT);
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordAudit({
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      userId: user.id,
      summary: "Wrong password",
      meta,
    });
    await afterFailedLogin(meta);
    if (blocked) throw blockedError();
    throw new AppError("INVALID_CREDENTIALS", INVALID_CREDENTIALS);
  }

  if (user.status === "SUSPENDED") {
    throw new AppError(
      "ACCOUNT_DISABLED",
      "This account has been disabled. Contact your administrator.",
    );
  }

  const activeCompanyId = await pickDefaultCompanyId(user);
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      status: "ACTIVE", // an invited user becomes active on first sign-in
      ...(activeCompanyId ? { lastCompanyId: activeCompanyId } : {}),
    },
  });
  const { token, session } = await createSession(user.id, activeCompanyId, meta);

  await recordAudit({
    action: "LOGIN",
    entityType: "Session",
    entityId: session.id,
    userId: user.id,
    companyId: activeCompanyId,
    meta,
  });
  if (blocked) await ownerPassedBlock(updatedUser, blocked.source);
  // Right after wrong passwords for several accounts from the same place: ended at once.
  if (await afterLogin(updatedUser, session.id, meta)) {
    throw new AppError(
      "ACCOUNT_LOCKED",
      "This sign-in looked unsafe, so it was stopped. Try again later, or ask the owner.",
    );
  }

  return {
    token,
    expiresAt: session.expiresAt,
    activeCompanyId,
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      phone: updatedUser.phone,
      avatarUrl: updatedUser.avatarUrl,
      status: updatedUser.status,
      isSuperAdmin: updatedUser.isSuperAdmin,
      mustChangePassword: updatedUser.mustChangePassword,
    },
  };
}

export async function logout(
  session: { id: string; userId: string; activeCompanyId: string | null },
  meta: RequestMeta = {},
): Promise<void> {
  await revokeSession(session.id);
  await recordAudit({
    action: "LOGOUT",
    entityType: "Session",
    entityId: session.id,
    userId: session.userId,
    companyId: session.activeCompanyId,
    meta,
  });
}

/** Changes the signed-in user's password; by default signs out their other devices. */
export async function changePassword(
  actor: { userId: string; sessionId: string; companyId: string | null },
  rawInput: ChangePasswordInput,
  meta: RequestMeta = {},
): Promise<{ otherSessionsRevoked: number }> {
  const input = changePasswordSchema.parse(rawInput);
  const user = await prisma.user.findUnique({ where: { id: actor.userId } });
  if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError("VALIDATION", "Current password is incorrect.", {
      currentPassword: ["Current password is incorrect."],
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    },
  });
  const otherSessionsRevoked = input.signOutOtherDevices
    ? await revokeAllUserSessions(user.id, actor.sessionId)
    : 0;

  await recordAudit({
    action: "PASSWORD_CHANGE",
    entityType: "User",
    entityId: user.id,
    userId: user.id,
    companyId: actor.companyId,
    summary: otherSessionsRevoked
      ? `Signed out ${otherSessionsRevoked} other device(s)`
      : undefined,
    meta,
  });
  return { otherSessionsRevoked };
}
