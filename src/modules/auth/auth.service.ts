import { AppError } from "@/lib/errors";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
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
import { pickDefaultCompanyId } from "@/modules/companies/access";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID_CREDENTIALS = "Incorrect email or password.";

export type LoginResult = {
  token: string;
  expiresAt: Date;
  user: SessionUser;
  activeCompanyId: string | null;
};

/**
 * Email + password sign-in with lockout after repeated failures.
 * Error messages never reveal whether an email exists.
 */
export async function login(rawInput: LoginInput, meta: RequestMeta = {}): Promise<LoginResult> {
  const { email, password } = loginSchema.parse(rawInput);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.passwordHash) {
    await burnPasswordCheck(password);
    await recordAudit({
      action: "LOGIN_FAILED",
      entityType: "User",
      userId: user?.id,
      summary: `Failed login for ${email} (unknown account)`,
      meta,
    });
    throw new AppError("INVALID_CREDENTIALS", INVALID_CREDENTIALS);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      "ACCOUNT_LOCKED",
      "Too many failed attempts. Please wait 15 minutes and try again.",
    );
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const locked = updated.failedLoginCount >= MAX_FAILED_LOGINS;
    if (locked) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
      });
    }
    await recordAudit({
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      userId: user.id,
      summary: locked ? "Wrong password; account locked for 15 minutes" : "Wrong password",
      meta,
    });
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
