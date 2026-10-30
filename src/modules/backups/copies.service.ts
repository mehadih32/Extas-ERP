import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { hashText } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import { alertOwner, audit, getBackupConfig, googleClient } from "@/modules/backups/backup-core";
import { copyAddressSchema } from "@/modules/backups/copy-address";
import { onDrill, onStandby } from "@/modules/backups/standby";

/*
 * Giving this server's Google client to sold copies of the ERP by a copy code
 * (owner's decision, 2026-10-29; the copy's side is extas-client.ts). The owner
 * presses "Make a copy code" on the Backups screen (PIN), names who the copy is
 * for, and gives the code to the buyer. On the copy, its owner enters the code
 * once ("Use a copy code"); the copy then asks this server for the client
 * (POST /api/v1/extas-client/claim) with the code and its own web address. A
 * code works once, only within 30 days, and only while the owner has not
 * blocked it: without a code nobody gets the client. The copy is given a name
 * and secret of its own, checks in once a day (POST /api/v1/extas-client/check-in)
 * and is listed on the Backups screen: who it is for, its web address, its last
 * check-in and whether its Drive is connected (never its Google account). The
 * owner can Block a copy (PIN): its code stops working, its next check-in is
 * answered "not allowed" and the copy stops sending new backups to Google Drive.
 *
 * The client given is the one this server's owner set on the Backups screen. A
 * copy whose client came from another ERP never gives it on.
 */

const CODE_DAYS = 30;
/** Letters a person cannot mix up (no 0/O, 1/I/L, U). */
const CODE_LETTERS = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_GROUPS = 5;
const CODE_GROUP = 4;

const NO_CLIENT = "This ERP has no Google client of its own to give.";
const BAD_CODE = "This copy code is not right, or it was already used.";
const EXPIRED = "This copy code is too old. Ask Extas for a new one.";
const BLOCKED = "This copy was blocked by the ERP that gave it the Google client.";

const copyIdSchema = z.string().trim().min(1).max(64);
const copySecretSchema = z.string().trim().min(1).max(200);
const pinSchema = z.string().trim().max(20).optional();

/** "EXTAS-ABCD-...": spaces, dashes and the EXTAS start are not part of the code. */
export function normalizeCode(raw: string): string {
  const flat = raw.toUpperCase().replace(/[\s-]/g, "");
  return flat.startsWith("EXTAS") ? flat.slice(5) : flat;
}

export const copyCodeSchema = z
  .string()
  .max(60, "The copy code is too long")
  .transform((raw, ctx) => {
    const code = normalizeCode(raw);
    if (
      code.length !== CODE_GROUPS * CODE_GROUP ||
      [...code].some((c) => !CODE_LETTERS.includes(c))
    ) {
      ctx.addIssue({ code: "custom", message: "Type the copy code as Extas gave it" });
      return z.NEVER;
    }
    return code;
  });

export const claimSchema = z.union([
  z.object({ code: copyCodeSchema, address: copyAddressSchema }),
  z.object({ copyId: copyIdSchema, copySecret: copySecretSchema, address: copyAddressSchema }),
]);

export const checkInSchema = z.object({
  copyId: copyIdSchema,
  copySecret: copySecretSchema,
  address: copyAddressSchema,
  driveConnected: z.boolean(),
});

export const makeCopyCodeSchema = z.object({
  label: z.string().trim().min(2, "Write who the copy is for").max(80, "Use at most 80 characters"),
  pin: pinSchema,
});

export const blockCopySchema = z.object({
  copyId: copyIdSchema,
  blocked: z.boolean(),
  pin: pinSchema,
});

/** A new copy code: 20 letters in groups of 4, about 98 bits. */
export function newCopyCode(): string {
  return Array.from({ length: CODE_GROUPS * CODE_GROUP }, () =>
    CODE_LETTERS.charAt(randomInt(CODE_LETTERS.length)),
  ).join("");
}

/** How a code is shown: EXTAS-ABCD-EFGH-... */
export function showCode(code: string): string {
  const groups = code.match(new RegExp(`.{1,${CODE_GROUP}}`, "g")) ?? [];
  return ["EXTAS", ...groups].join("-");
}

const newSecret = () => randomBytes(32).toString("base64url");

/** Whether a secret is the copy's (compared by its SHA-256, in constant time). */
function secretMatches(secret: string, tokenHash: string | null) {
  if (!tokenHash) return false;
  const given = Buffer.from(hashText(secret), "hex");
  const kept = Buffer.from(tokenHash, "hex");
  return given.length === kept.length && timingSafeEqual(given, kept);
}

/** How long the same code from the same address is answered again (a lost answer). */
const SAME_ANSWER_MS = 15 * 60_000;

/** Tells the owner without making the copy wait (a slow bot never loses its answer). */
function tellOwner(auditSummary: string, entityId: string, title: string, text: string) {
  void audit(null, undefined, {
    action: "UPDATE",
    entityType: "ErpCopy",
    entityId,
    summary: auditSummary,
  })
    .then(() => alertOwner(title, text))
    .catch((error: unknown) => console.error("[copies] could not tell the owner", error));
}

/**
 * This server's own Google client (set on its Backups screen), or null. Never on
 * the demo site, a restore drill copy or a restored ERP waiting on standby.
 */
async function ownClient() {
  if (process.env.DEMO_SITE === "on" || (await onDrill()) || (await onStandby())) return null;
  const config = await getBackupConfig();
  if (!config.googleClientId || !config.googleClientSecretRef || config.googleClientFrom) {
    return null;
  }
  return googleClient(config);
}

/**
 * A copy asks for the Google client (no sign-in: the copy is another server),
 * with its copy code the first time, or with its own name and secret again
 * (after its owner pressed Connect once more, or after an Unblock).
 */
export async function claimClient(raw: unknown, now: Date = new Date()) {
  const input = claimSchema.parse(raw);
  const client = await ownClient();
  if (!client) throw new AppError("FORBIDDEN", NO_CLIENT);

  if ("code" in input) {
    const copySecret = newSecret();
    const copy = await prisma.erpCopy.findUnique({ where: { codeHash: hashText(input.code) } });
    if (!copy) throw new AppError("FORBIDDEN", BAD_CODE);
    if (copy.blockedAt) throw new AppError("FORBIDDEN", BLOCKED);
    if (copy.claimedAt) {
      // The same copy asking again soon after (its first answer was lost) gets it again.
      const again =
        copy.address === input.address && now.getTime() - copy.claimedAt.getTime() < SAME_ANSWER_MS;
      if (!again) throw new AppError("FORBIDDEN", BAD_CODE);
      const answered = await prisma.erpCopy.updateMany({
        where: { id: copy.id, blockedAt: null, address: input.address },
        data: { tokenHash: hashText(copySecret), lastSeenAt: now },
      });
      if (answered.count === 0) throw new AppError("FORBIDDEN", BAD_CODE);
      return { copyId: copy.id, copySecret, ...client };
    }
    if (copy.blockedAt) throw new AppError("FORBIDDEN", BLOCKED);
    if (copy.codeExpiresAt <= now) throw new AppError("FORBIDDEN", EXPIRED);
    // Only the first of two at once wins the code.
    const used = await prisma.erpCopy.updateMany({
      where: { id: copy.id, claimedAt: null, blockedAt: null },
      data: {
        claimedAt: now,
        address: input.address,
        tokenHash: hashText(copySecret),
        lastSeenAt: now,
      },
    });
    if (used.count === 0) throw new AppError("FORBIDDEN", BAD_CODE);
    tellOwner(
      `The copy for ${copy.label} at ${input.address} used its copy code and got the Google client for backups`,
      copy.id,
      "A copy used its code",
      `The copy of the ERP for ${copy.label} at ${input.address} used its copy code and now backs up to its own Google Drive. You can Block it on the Backups screen.`,
    );
    return { copyId: copy.id, copySecret, ...client };
  }

  const copy = await prisma.erpCopy.findUnique({ where: { id: input.copyId } });
  if (!copy || !secretMatches(input.copySecret, copy.tokenHash)) {
    throw new AppError("FORBIDDEN", BAD_CODE);
  }
  if (copy.blockedAt) throw new AppError("FORBIDDEN", BLOCKED);
  // The copy keeps its secret: a lost answer never leaves it with one that no longer works.
  await prisma.erpCopy.update({
    where: { id: copy.id },
    data: { address: input.address, lastSeenAt: now },
  });
  return { copyId: copy.id, copySecret: input.copySecret, ...client };
}

/**
 * A copy's daily check-in: its address and whether its Drive is connected.
 * Answers whether it may keep using the client. A name or secret this server
 * does not know is a 404, never "not allowed", so a copy is only ever stopped
 * by the owner's Block.
 */
export async function checkInCopy(raw: unknown, now: Date = new Date()) {
  const input = checkInSchema.parse(raw);
  const copy = await prisma.erpCopy.findUnique({ where: { id: input.copyId } });
  if (!copy || !secretMatches(input.copySecret, copy.tokenHash)) {
    throw new AppError("NOT_FOUND", "This copy is not known here.");
  }
  await prisma.erpCopy.update({
    where: { id: copy.id },
    data: { address: input.address, driveConnected: input.driveConnected, lastSeenAt: now },
  });
  return { allowed: copy.blockedAt === null };
}

type CopyState = "WAITING" | "EXPIRED" | "IN_USE" | "BLOCKED";

function stateOf(
  copy: { claimedAt: Date | null; blockedAt: Date | null; codeExpiresAt: Date },
  now: Date,
): CopyState {
  if (copy.blockedAt) return "BLOCKED";
  if (copy.claimedAt) return "IN_USE";
  return copy.codeExpiresAt <= now ? "EXPIRED" : "WAITING";
}

/** The Backups screen's "Copies of this ERP" panel: whether codes can be made, and every copy, newest first. */
export async function listCopies(now: Date = new Date()) {
  const client = await ownClient();
  const copies = await prisma.erpCopy.findMany({ orderBy: { createdAt: "desc" } });
  const rows = copies.map((c) => ({
    id: c.id,
    label: c.label,
    state: stateOf(c, now),
    codeExpiresAt: c.codeExpiresAt,
    claimedAt: c.claimedAt,
    address: c.address,
    lastSeenAt: c.lastSeenAt,
    driveConnected: c.driveConnected,
    blockedAt: c.blockedAt,
  }));
  return {
    /** This server's own client is set on its screen: it can give it to copies. */
    canShare: client !== null,
    counts: {
      inUse: rows.filter((r) => r.state === "IN_USE").length,
      waiting: rows.filter((r) => r.state === "WAITING").length,
      blocked: rows.filter((r) => r.state === "BLOCKED").length,
    },
    copies: rows,
  };
}

async function askPin(ctx: CompanyContext, pin: string | undefined, what: string) {
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, pin || undefined, what);
}

const nameOf = (ctx: CompanyContext) => ctx.user.name || ctx.user.email;

/** "Make a copy code": the PIN, and the owner is told. The code is shown once. */
export async function makeCopyCode(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = makeCopyCodeSchema.parse(raw);
  if (!(await ownClient())) {
    throw new AppError(
      "VALIDATION",
      "Set your own Google client on this screen first: only that one can be given to copies.",
    );
  }
  await askPin(ctx, input.pin, "make a copy code");
  const code = newCopyCode();
  const codeExpiresAt = new Date(now.getTime() + CODE_DAYS * 24 * 60 * 60_000);
  const copy = await prisma.erpCopy.create({
    data: { label: input.label, codeHash: hashText(code), codeExpiresAt, createdById: ctx.user.id },
  });
  await audit({ userId: ctx.user.id }, meta, {
    action: "CREATE",
    entityType: "ErpCopy",
    entityId: copy.id,
    summary: `Made a copy code for ${input.label}`,
  });
  await alertOwner(
    "Copy code made",
    `${nameOf(ctx)} made a copy code for ${input.label} on the Backups screen, with the PIN. If that was not you, Block it there and change your password and PIN at once.`,
  );
  return { code: showCode(code), codeExpiresAt, list: await listCopies(now) };
}

/** Block or Unblock one copy (or its unused code): the PIN either way, and the owner is told. */
export async function setCopyBlocked(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = blockCopySchema.parse(raw);
  const copy = await prisma.erpCopy.findUnique({ where: { id: input.copyId } });
  if (!copy) throw new AppError("NOT_FOUND", "That copy is not in the list.");
  if (Boolean(copy.blockedAt) === input.blocked) return listCopies();
  await askPin(
    ctx,
    input.pin,
    input.blocked ? `block the copy for ${copy.label}` : `unblock the copy for ${copy.label}`,
  );
  await prisma.erpCopy.update({
    where: { id: copy.id },
    data: input.blocked
      ? { blockedAt: new Date(), blockedById: ctx.user.id }
      : { blockedAt: null, blockedById: null },
  });
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "ErpCopy",
    entityId: copy.id,
    summary: input.blocked
      ? `Blocked the copy for ${copy.label} from the Google client for backups`
      : `Unblocked the copy for ${copy.label}`,
  });
  const where = copy.address ? ` at ${copy.address}` : "";
  await alertOwner(
    input.blocked ? "A copy was blocked" : "A copy was unblocked",
    input.blocked
      ? `${nameOf(ctx)} blocked the copy for ${copy.label}${where} on the Backups screen, with the PIN. Its code no longer works, and a copy in use stops sending new backups to Google Drive at its next daily check-in.`
      : `${nameOf(ctx)} unblocked the copy for ${copy.label}${where} on the Backups screen, with the PIN. Its owner presses Connect Google Drive to use the Google client again.`,
  );
  return listCopies();
}
