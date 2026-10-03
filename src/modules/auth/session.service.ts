import type { Session, User } from "@prisma/client";

import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-cookie";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";

export const SESSION_TTL_MS = SESSION_MAX_AGE_SECONDS * 1000; // 30 days
const RENEW_WHEN_REMAINING_MS = 15 * 24 * 60 * 60 * 1000; // slide expiry after 15 days
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000; // avoid a DB write on every request

export type SessionUser = Pick<
  User,
  "id" | "email" | "name" | "phone" | "avatarUrl" | "status" | "isSuperAdmin" | "mustChangePassword"
>;
export type ValidSession = { session: Session; user: SessionUser };

const sessionUserSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  avatarUrl: true,
  status: true,
  isSuperAdmin: true,
  mustChangePassword: true,
} as const;

/** Creates a session and returns the raw token (only ever sent to the browser). */
export async function createSession(
  userId: string,
  activeCompanyId: string | null,
  meta: RequestMeta = {},
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const session = await prisma.session.create({
    data: {
      userId,
      token: hashSessionToken(token),
      activeCompanyId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token, session };
}

/**
 * Looks up a session by its raw token. Returns null when missing, expired or the
 * user is no longer active. Extends the expiry (sliding window) when it is getting old.
 */
export async function validateSessionToken(token: string): Promise<ValidSession | null> {
  const row = await prisma.session.findUnique({
    where: { token: hashSessionToken(token) },
    include: { user: { select: sessionUserSelect } },
  });
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  if (row.user.status !== "ACTIVE") return null;

  const { user, ...current } = row;
  const renew = current.expiresAt.getTime() - now < RENEW_WHEN_REMAINING_MS;
  const touch = now - current.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS;
  let session: Session = current;
  if (renew || touch) {
    session = await prisma.session.update({
      where: { id: current.id },
      data: {
        lastSeenAt: new Date(now),
        ...(renew ? { expiresAt: new Date(now + SESSION_TTL_MS) } : {}),
      },
    });
  }
  return { session, user };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Signs a user out everywhere (optionally keeping the current device). */
export async function revokeAllUserSessions(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
  return count;
}

export async function setSessionCompany(sessionId: string, companyId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } });
}

/** Housekeeping for a scheduled job: removes expired sessions. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
