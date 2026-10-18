import type { PrismaClient } from "@prisma/client";

import { isCloudflareAddress, visitorAddress } from "@/lib/cloudflare-ips";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";

/*
 * The security steps Bug Guard may take, and only these:
 *   - block a login source (an IP address) for 24 hours after repeated failed
 *     sign-ins from it, by itself, telling the owner at once; never a place
 *     where the team signs in (the office shares one address: blocking it
 *     would lock everyone out), which the owner hears of instead;
 *   - end a suspicious session (a sign-in from a new place that came right
 *     after wrong passwords for several accounts from there), by itself,
 *     telling the owner at once; never the owner's own;
 *   - a blocked place still lets an active platform owner in with the right
 *     password (their account lock still applies), so the owner can never be
 *     locked out by it; the owner is told each time, and nobody else passes;
 *   - with the owner's PIN (fixes.service.ts): block or unblock a source, end a
 *     session (never the owner's).
 * It never changes a password, a role or a permission, and never deletes anyone.
 * A Cloudflare address is never a place (v6.4.1 B2): behind Cloudflare's proxy
 * many visitors share each one, so it is never blocked, by Bug Guard or with
 * the PIN, and wrong passwords from it are never counted as one place's.
 */

/** Wrong passwords from one place within the hour that get it blocked. */
export const BLOCK_AFTER_FAILURES = 10;
export const BLOCK_WINDOW_MS = 60 * 60_000;
export const BLOCK_FOR_MS = 24 * 60 * 60_000;
/** Accounts tried from one place within the hour that make its next sign-in suspicious. */
export const SUSPICIOUS_ACCOUNTS = 3;

export const BLOCKED_TEXT =
  "Sign-in from this place is stopped for now after many wrong passwords. Try again tomorrow, or ask the owner.";

type Reader = Pick<PrismaClient, "auditLog" | "loginBlock" | "user">;

/** The owner's own places: where a platform owner signed in during the last 30 days. */
export async function isOwnersPlace(db: Reader, source: string, now: Date): Promise<boolean> {
  const owners = await db.user.findMany({ where: { isSuperAdmin: true }, select: { id: true } });
  if (owners.length === 0) return false;
  const found = await db.auditLog.count({
    where: {
      action: "LOGIN",
      ipAddress: source,
      userId: { in: owners.map((o) => o.id) },
      createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
    },
  });
  return found > 0;
}

/** How the audit log marks a sign-in Bug Guard ended (endSession): such a place is never "known". */
export const ENDED_BY_GUARD = "Sign-in ended by Bug Guard";

/**
 * A place the team signs in from: a sign-in from there in the 30 days before,
 * by an active member of a store on this site (sign-in and blocks are for the
 * whole site), made before the wrong passwords from there began this hour.
 * Never a sign-in Bug Guard ended as suspicious, nor the one being looked at:
 * an attacker's own sign-in must not make their place look like the office.
 */
export async function isKnownPlace(
  db: Pick<PrismaClient, "auditLog">,
  source: string,
  now: Date,
  exceptSessionId?: string,
): Promise<boolean> {
  const firstFailure = await db.auditLog.findFirst({
    where: {
      action: "LOGIN_FAILED",
      ipAddress: source,
      createdAt: { gte: new Date(now.getTime() - BLOCK_WINDOW_MS), lte: now },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const logins = await db.auditLog.findMany({
    where: {
      action: "LOGIN",
      ipAddress: source,
      createdAt: {
        gte: new Date(now.getTime() - 30 * 86_400_000),
        lt: firstFailure?.createdAt ?? now,
      },
      user: { status: "ACTIVE", memberships: { some: { isActive: true } } },
      ...(exceptSessionId ? { NOT: { entityId: exceptSessionId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { entityId: true },
  });
  if (logins.length === 0) return false;
  const sessions = logins.flatMap((l) => (l.entityId ? [l.entityId] : []));
  const ended = new Set(
    (
      await db.auditLog.findMany({
        where: {
          action: "LOGOUT",
          entityType: "Session",
          entityId: { in: sessions },
          summary: { startsWith: ENDED_BY_GUARD },
        },
        select: { entityId: true },
      })
    ).map((e) => e.entityId),
  );
  return logins.some((l) => !l.entityId || !ended.has(l.entityId));
}

/** The block on a place now, if any. */
export async function activeBlock(source: string | undefined, now: Date = new Date()) {
  // A block on a Cloudflare address (from before) would keep everyone out.
  if (!visitorAddress(source)) return null;
  return prisma.loginBlock.findFirst({
    where: { source, liftedAt: null, blockedUntil: { gt: now } },
    orderBy: { blockedAt: "desc" },
  });
}

/** The refusal at a blocked place: the same words for everyone, owner or not. */
export const blockedError = () => new AppError("ACCOUNT_LOCKED", BLOCKED_TEXT);

/** Whether an account may pass a blocked place (with the right password): an active platform owner. */
export const passesBlock = (user: { isSuperAdmin: boolean; status: string } | null) =>
  !!user && user.isSuperAdmin && user.status === "ACTIVE";

/** After the platform owner signed in from a blocked place: logged, and the owner is told. */
export async function ownerPassedBlock(user: { id: string; name: string }, source: string) {
  try {
    const companyId = await platformCompanyId();
    if (!companyId) return;
    await prisma.bugGuardEvent.create({
      data: {
        companyId,
        kind: "OWNER_PASSED_BLOCK",
        summary: `${user.name} signed in from ${source}, a blocked place, with the right password`,
        byId: user.id,
      },
    });
    await alarmOwner(
      companyId,
      `${user.name} signed in from a blocked place`,
      `From ${source}, with the right password. Sign-in from there stays stopped for everyone else. If it was not you, change your password now.`,
    );
  } catch (error) {
    console.error(
      "[bug-guard] owner's sign-in not logged",
      error instanceof Error ? error.message : error,
    );
  }
}

/** The platform's own store: the oldest company (it gets the server's checks and alarms). */
export async function platformCompanyId(): Promise<string | null> {
  const first = await prisma.company.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Tells the platform owner at once: the bot (an alarm, AI on or off) and the inbox. */
export async function alarmOwner(companyId: string, subject: string, body: string) {
  try {
    const owners = await prisma.user.findMany({
      where: {
        isSuperAdmin: true,
        status: "ACTIVE",
        memberships: { some: { companyId, isActive: true } },
      },
      select: { id: true },
    });
    const { sendInApp } = await import("@/modules/reminders/notification.service");
    await sendInApp(
      prisma,
      companyId,
      owners.map((o) => ({ userId: o.id })),
      { subject, body, entityType: "BugGuard", entityId: companyId },
    );
    const { pushToBot } = await import("@/modules/ai/bot/push");
    await pushToBot(
      companyId,
      { kind: "text", text: `Bug Guard: ${subject}. ${body}` },
      { alarm: true },
    );
  } catch (error) {
    console.error("[bug-guard] alarm not sent", error instanceof Error ? error.message : error);
  }
}

async function logEvent(
  companyId: string,
  kind: string,
  summary: string,
  byId: string | null = null,
) {
  await prisma.bugGuardEvent.create({ data: { companyId, kind, summary, byId } });
}

/** Blocks a place for 24 hours (Bug Guard by itself, or the owner with the PIN). */
export async function blockSource(input: {
  source: string;
  failures: number;
  companyId: string;
  byId: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (isCloudflareAddress(input.source)) {
    throw new AppError(
      "VALIDATION",
      `${input.source} is one of Cloudflare's addresses, shared by many visitors: it is never blocked.`,
    );
  }
  if (await activeBlock(input.source, now)) return null;
  const block = await prisma.loginBlock.create({
    data: {
      companyId: input.companyId,
      source: input.source,
      failures: input.failures,
      reason: `${input.failures} wrong passwords`,
      blockedAt: now,
      blockedUntil: new Date(now.getTime() + BLOCK_FOR_MS),
    },
  });
  await logEvent(
    input.companyId,
    "SOURCE_BLOCKED",
    `Sign-in from ${input.source} blocked for 24 hours after ${input.failures} wrong passwords${input.byId ? "" : " (by Bug Guard itself)"}`,
    input.byId,
  );
  return block;
}

/** Lifts a block (the owner, with the PIN). */
export async function unblockSource(blockId: string, companyId: string, byId: string) {
  const block = await prisma.loginBlock.findUnique({ where: { id: blockId } });
  if (!block || block.liftedAt)
    throw new AppError("NOT_FOUND", "That block is not there any more.");
  await prisma.loginBlock.update({
    where: { id: block.id },
    data: { liftedAt: new Date(), liftedById: byId },
  });
  await logEvent(companyId, "SOURCE_UNBLOCKED", `Sign-in from ${block.source} allowed again`, byId);
}

/**
 * Ends one session now, never a platform owner's. The person is signed out on
 * that device and can sign in again with their password.
 */
export async function endSession(input: {
  sessionId: string;
  companyId: string;
  byId: string | null;
  why: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: { id: true, userId: true, user: { select: { name: true, isSuperAdmin: true } } },
  });
  if (!session) throw new AppError("NOT_FOUND", "That sign-in has ended already.");
  if (session.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Bug Guard never ends the owner's own sign-in.");
  }
  const ended = await prisma.session.updateMany({
    where: { id: session.id, expiresAt: { gt: now }, user: { isSuperAdmin: false } },
    data: { expiresAt: now },
  });
  if (ended.count === 0) throw new AppError("CONFLICT", "That sign-in has ended already.");
  await logEvent(
    input.companyId,
    "SESSION_ENDED",
    `Ended ${session.user.name}'s sign-in: ${input.why}`,
    input.byId,
  );
  // In the audit log too, beside its sign-in: its place never counts as "known" (isKnownPlace).
  await prisma.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: session.userId,
      action: "LOGOUT",
      entityType: "Session",
      entityId: session.id,
      summary: `${ENDED_BY_GUARD}: ${input.why}`.slice(0, 500),
    },
  });
  return { name: session.user.name };
}

/**
 * After a wrong password (auth.service.ts): a place with too many wrong
 * passwords this hour is blocked at once, unless the owner or the team signs
 * in from it (then the owner is told, and may block it with the PIN).
 */
export async function afterFailedLogin(meta: RequestMeta, now: Date = new Date()) {
  const source = visitorAddress(meta.ipAddress);
  if (!source) return;
  try {
    const failures = await prisma.auditLog.count({
      where: {
        action: "LOGIN_FAILED",
        ipAddress: source,
        createdAt: { gte: new Date(now.getTime() - BLOCK_WINDOW_MS) },
      },
    });
    if (failures < BLOCK_AFTER_FAILURES) return;
    if (await activeBlock(source, now)) return;
    const companyId = await platformCompanyId();
    if (!companyId) return;
    const owners = await isOwnersPlace(prisma, source, now);
    if (owners || (await isKnownPlace(prisma, source, now))) {
      // Never a place the team signs in from: the owner hears of it instead (once an hour).
      const told = await prisma.bugGuardEvent.count({
        where: {
          companyId,
          kind: "KNOWN_PLACE_FAILURES",
          summary: { contains: source },
          createdAt: { gte: new Date(now.getTime() - BLOCK_WINDOW_MS) },
        },
      });
      if (told) return;
      const whose = owners ? "a place you sign in from" : "a place your team signs in from";
      await logEvent(
        companyId,
        "KNOWN_PLACE_FAILURES",
        `${failures} wrong passwords from ${source} (${whose}), not blocked`,
      );
      await alarmOwner(
        companyId,
        `${failures} wrong passwords from ${owners ? "your own place" : "your team's place"}`,
        `From ${source} in the last hour. It was not blocked because it is ${whose}, and blocking it would lock you out. If it was not your team, block it in AI Center > Bug Guard (with your PIN) and change the passwords.`,
      );
      return;
    }
    const block = await blockSource({ source, failures, companyId, byId: null, now });
    if (block) {
      await alarmOwner(
        companyId,
        `Sign-in from ${source} blocked for 24 hours`,
        `${failures} wrong passwords from there in the last hour. Lift it in AI Center > Bug Guard (with your PIN) if it was one of your people.`,
      );
    }
  } catch (error) {
    console.error(
      "[bug-guard] failed sign-in not checked",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * After a sign-in (auth.service.ts): one from a new place (no one signed in
 * from there in the 30 days before) where several accounts were tried with
 * wrong passwords this hour is suspicious, and is ended at once (never a
 * platform owner's). From a place the team uses, it is left to the check.
 */
export async function afterLogin(
  user: { id: string; name: string; isSuperAdmin: boolean },
  sessionId: string,
  meta: RequestMeta,
  now: Date = new Date(),
): Promise<boolean> {
  const source = visitorAddress(meta.ipAddress);
  if (!source || user.isSuperAdmin) return false;
  try {
    const tried = await prisma.auditLog.groupBy({
      by: ["userId"],
      where: {
        action: "LOGIN_FAILED",
        ipAddress: source,
        createdAt: { gte: new Date(now.getTime() - BLOCK_WINDOW_MS) },
      },
    });
    const accounts = new Set(tried.map((t) => t.userId ?? "unknown"));
    if (accounts.size < SUSPICIOUS_ACCOUNTS) return false;
    if (await isKnownPlace(prisma, source, now, sessionId)) return false;
    const companyId = await platformCompanyId();
    if (!companyId) return false;
    await endSession({
      sessionId,
      companyId,
      byId: null,
      why: `signed in from ${source} right after wrong passwords for ${accounts.size} accounts from there (by Bug Guard itself)`,
      now,
    });
    await alarmOwner(
      companyId,
      `${user.name}'s sign-in was ended`,
      `It came from ${source} right after wrong passwords for ${accounts.size} accounts from the same place. If it was really ${user.name}, they can sign in again; if not, change their password.`,
    );
    return true;
  } catch (error) {
    console.error(
      "[bug-guard] sign-in not checked",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
