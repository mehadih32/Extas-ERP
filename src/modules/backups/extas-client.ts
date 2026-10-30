import { z } from "zod";

import type { BackupConfig } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import { alertOwner, audit, getBackupConfig, googleClient } from "@/modules/backups/backup-core";
import { copyCodeSchema } from "@/modules/backups/copies.service";
import { copyOrigin } from "@/modules/backups/copy-address";
import { onDrill } from "@/modules/backups/standby";

/*
 * A sold copy of the ERP gets its Google client from the Extas ERP by a copy
 * code (owner's decision, 2026-10-29; the other side is copies.service.ts). The
 * copy's owner enters the code Extas gave them on the Backups screen ("Use a
 * copy code", with the PIN, as for any new Google client); the copy asks the
 * Extas ERP for the client (POST /api/v1/extas-client/claim) with the code and
 * keeps it, sealed, as the client set on its Backups screen (shown "(from
 * Extas)"), with its own name and secret there. Nothing changes in the backups
 * or the restore: the restore guide prints this client as it prints any other
 * (googleClient). If the client is later removed (a Block, then an Unblock), the
 * copy asks again with its own name and secret when its owner presses Connect.
 *
 * Once a day the copy checks in (POST /api/v1/extas-client/check-in): its web
 * address and whether its Drive is connected, never its Google account. When
 * the Extas ERP answers that the copy was blocked, the client and the Drive
 * sign-in are removed: new backups stay on the server and the owner is told.
 * Any other answer, or none, changes nothing (a copy is never stopped because
 * the Extas ERP could not be reached).
 *
 * Where it asks: https://erp.extasbd.com in production. EXTAS_CLIENT_SOURCE
 * changes it for the tests and a test server (an empty value turns this off). Never on a restore
 * drill copy, the demo site, or the Extas ERP itself.
 */

export const DEFAULT_SOURCE = "https://erp.extasbd.com";
export const CLAIM_PATH = "/api/v1/extas-client/claim";
export const CHECK_IN_PATH = "/api/v1/extas-client/check-in";

const DAY_MS = 24 * 60 * 60_000;
/** After a check-in that got no answer, the next try waits this long. */
const RETRY_MS = 60 * 60_000;
const TIMEOUT_MS = 15_000;

let nextTryAt = 0;

/** The Extas ERP a copy asks for the Google client (its origin), or null when turned off. */
export function extasSource(): string | null {
  const set = process.env.EXTAS_CLIENT_SOURCE;
  const value =
    set === undefined ? (process.env.NODE_ENV === "production" ? DEFAULT_SOURCE : "") : set;
  return value.trim() ? copyOrigin(value) : null;
}

/** This server's own web address (its origin), as a copy gives it. */
const ownAddress = () => copyOrigin(process.env.APP_URL ?? "");

/** Why this server never asks the Extas ERP, or null when it may. */
async function notHere(source: string | null): Promise<string | null> {
  if (!source) return "No Extas ERP is set to give the Google client.";
  if (process.env.DEMO_SITE === "on") return "The demo site uses its own Google client.";
  if (ownAddress() === source) return "This is the Extas ERP itself.";
  if (await onDrill()) return "A restore drill copy never uses Google Drive.";
  return null;
}

type Answer = { ok: true; data: unknown } | { ok: false; status: number | null; message: string };

/** Asks the Extas ERP (JSON both ways). Never throws; never puts a secret in the error. */
async function ask(source: string, path: string, body: unknown): Promise<Answer> {
  try {
    const response = await fetch(`${source}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      data?: unknown;
      error?: { message?: unknown };
    } | null;
    if (response.ok && json?.ok) return { ok: true, data: json.data };
    const said = typeof json?.error?.message === "string" ? json.error.message.slice(0, 200) : "";
    return {
      ok: false,
      status: response.status,
      message: said
        ? `The Extas ERP said: ${said}`
        : `The Extas ERP answered with an error (${response.status}).`,
    };
  } catch {
    return { ok: false, status: null, message: `The Extas ERP at ${source} could not be reached.` };
  }
}

const claimAnswer = z.object({
  copyId: z.string().min(1).max(64),
  copySecret: z.string().min(1).max(200),
  clientId: z.string().min(1).max(300),
  clientSecret: z.string().min(1).max(300),
});

export const applyCopyCodeSchema = z.object({
  code: copyCodeSchema,
  pin: z.string().trim().max(20).optional(),
});

/** Saves the client the Extas ERP gave (a new client means signing in to Google again). */
async function keepClient(
  config: BackupConfig,
  source: string,
  got: z.infer<typeof claimAnswer>,
  now: Date,
) {
  const changed = config.googleClientId !== got.clientId;
  return prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      googleClientId: got.clientId,
      googleClientSecretRef: encryptSecret(got.clientSecret),
      googleClientFrom: source,
      copyId: got.copyId,
      copySecretRef: encryptSecret(got.copySecret),
      copyCheckedAt: now,
      copyBlockedAt: null,
      ...(changed && config.credentialsRef
        ? { credentialsRef: null, googleDriveAccount: null, googleDriveFolderId: null }
        : {}),
      googleDeviceRef: null,
      googleDeviceExpiresAt: null,
    },
  });
}

/**
 * "Use a copy code" on a copy's Backups screen: the PIN (it sets a new Google
 * client), then the Extas ERP is asked with the code. The owner is told.
 */
export async function applyCopyCode(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = applyCopyCodeSchema.parse(raw);
  const source = extasSource();
  const skip = await notHere(source);
  if (skip) throw new AppError("UNAVAILABLE", skip);
  const address = ownAddress();
  if (!address) {
    throw new AppError(
      "UNAVAILABLE",
      "This server's web address (APP_URL) is not an https address, so it cannot use a copy code.",
    );
  }
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, input.pin || undefined, "use a copy code for the Google client");
  const answer = await ask(source!, CLAIM_PATH, { code: input.code, address });
  if (!answer.ok) throw new AppError("UNAVAILABLE", answer.message);
  const got = claimAnswer.safeParse(answer.data);
  if (!got.success) throw new AppError("UNAVAILABLE", "The Extas ERP's answer could not be read.");
  const config = await getBackupConfig();
  const hadSignIn = Boolean(config.credentialsRef) && config.googleClientId !== got.data.clientId;
  await keepClient(config, source!, got.data, new Date());
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Got the Google client for backups from the Extas ERP at ${source} with a copy code (${got.data.clientId})`,
  });
  await alertOwner(
    "Google client set with a copy code",
    `${ctx.user.name || ctx.user.email} used a copy code on the Backups screen, with the PIN: this server now backs up with the Google client from Extas${hadSignIn ? ", so Google Drive must be connected again" : ""}. If that was not you, change your password and PIN at once.`,
  );
  return { ready: true };
}

/**
 * Before Connect Google Drive on a copy whose client was removed (a Block, then
 * an Unblock): asks the Extas ERP again with this copy's own name and secret.
 * Never throws; does nothing when there is a client or no copy name.
 */
export async function reclaimExtasClient(): Promise<void> {
  const config = await getBackupConfig();
  if (googleClient(config) || !config.copyId || !config.copySecretRef) return;
  const source = extasSource();
  if (await notHere(source)) return;
  const address = ownAddress();
  if (!address) return;
  let copySecret: string;
  try {
    copySecret = decryptSecret(config.copySecretRef);
  } catch {
    return;
  }
  const answer = await ask(source!, CLAIM_PATH, { copyId: config.copyId, copySecret, address });
  if (!answer.ok) return;
  const got = claimAnswer.safeParse(answer.data);
  if (!got.success) return;
  await keepClient(config, source!, got.data, new Date());
  await audit(null, undefined, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Got the Google client for backups from the Extas ERP at ${source} again (${got.data.clientId})`,
  });
}

/**
 * The daily check-in of a copy whose client came from the Extas ERP (`force`:
 * now, whatever the time of the last one). Returns "blocked" when the Extas ERP
 * blocked this copy (its client and Drive sign-in are then removed), "allowed",
 * or null when it did not check in.
 */
export async function extasCheckIn(
  now: Date = new Date(),
  options: { force?: boolean } = {},
): Promise<"allowed" | "blocked" | null> {
  const config = await getBackupConfig();
  const source = config.googleClientFrom;
  if (!source || !config.copyId || !config.copySecretRef) return null;
  if (!options.force) {
    if (config.copyCheckedAt && now.getTime() - config.copyCheckedAt.getTime() < DAY_MS)
      return null;
    if (now.getTime() < nextTryAt) return null;
  }
  if (await onDrill()) return null;
  const address = ownAddress();
  if (!address) return null;
  let copySecret: string;
  try {
    copySecret = decryptSecret(config.copySecretRef);
  } catch {
    return null;
  }
  const answer = await ask(source, CHECK_IN_PATH, {
    copyId: config.copyId,
    copySecret,
    address,
    driveConnected: Boolean(config.credentialsRef),
  });
  const allowed =
    answer.ok && typeof (answer.data as { allowed?: unknown } | null)?.allowed === "boolean"
      ? (answer.data as { allowed: boolean }).allowed
      : null;
  if (allowed === null) {
    // No answer, or not one to act on: nothing changes; try again within the hour.
    nextTryAt = now.getTime() + RETRY_MS;
    return null;
  }
  if (allowed) {
    await prisma.backupConfig.update({ where: { id: config.id }, data: { copyCheckedAt: now } });
    return "allowed";
  }
  // Blocked: only the client that came from there (and its sign-in) is removed.
  const removed = await prisma.backupConfig.updateMany({
    where: { id: config.id, googleClientFrom: source },
    data: {
      googleClientId: null,
      googleClientSecretRef: null,
      googleClientFrom: null,
      credentialsRef: null,
      googleDriveAccount: null,
      googleDriveFolderId: null,
      googleDeviceRef: null,
      googleDeviceExpiresAt: null,
      copyCheckedAt: now,
      copyBlockedAt: now,
    },
  });
  if (removed.count === 0) return null;
  await audit(null, undefined, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `The Extas ERP at ${source} switched off Google Drive backups through its Google client for this server`,
  });
  await alertOwner(
    "Google Drive backups switched off by Extas",
    "Extas switched off Google Drive backups through its Google client for this server. New backups stay on this server only. The backups already in your Google Drive stay there. Contact Extas, or use your own Google client (advanced) on the Backups screen.",
  );
  return "blocked";
}
