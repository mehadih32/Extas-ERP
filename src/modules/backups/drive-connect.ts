import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import {
  type Actor,
  alertOwner,
  getBackupConfig,
  googleClient,
} from "@/modules/backups/backup-core";
import * as backups from "@/modules/backups/backup.service";
import { reclaimExtasClient } from "@/modules/backups/extas-client";
import { connectDriveSchema } from "@/modules/backups/schemas";

/*
 * "Connect Google Drive" from the Backups screen or the API (owner's decision,
 * 2026-10-24): while Drive is connected, a new sign-in (Reconnect, or another
 * Google account) would replace where the backups go, so it needs the owner's
 * PIN, checked here before Google is asked for a code. The first Connect needs
 * none. Every request path starts a sign-in only through here; the sign-in
 * itself (backup.service.ts) is unchanged, as the restore drill uses it. The
 * owner is told (inbox and Telegram) whenever Drive is connected again.
 */

export async function startDriveConnect(
  who: Actor | CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { pin } = connectDriveSchema.parse(raw ?? {});
  // A copy whose Google client came from Extas and was removed asks for it again.
  await reclaimExtasClient();
  const config = await getBackupConfig();
  if (!googleClient(config)) {
    throw new AppError(
      "UNAVAILABLE",
      "Google Drive is not set up on this server yet: use the copy code Extas gave you, or your own Google client (advanced).",
    );
  }
  const replacing = Boolean(config.credentialsRef);
  if (replacing) await askPin(who, pin);
  const actor: Actor = "company" in who ? { userId: who.user.id } : who;
  const code = await backups.startGoogleSignIn(actor, meta);
  if (replacing) {
    const name = "company" in who ? who.user.name || who.user.email : "The platform owner";
    await alertOwner(
      "Google Drive is being connected again",
      `${name} started connecting Google Drive again on the Backups screen, with the PIN: the new sign-in replaces the old one. If that was not you, change your password and PIN at once.`,
    );
    return code;
  }
  // Drive got connected while Google was asked for this code (no PIN was given):
  // the code must not replace that sign-in, so it is dropped and the PIN asked.
  const now = await getBackupConfig();
  if (now.credentialsRef) {
    await prisma.backupConfig.update({
      where: { id: now.id },
      data: { googleDeviceRef: null, googleDeviceExpiresAt: null },
    });
    await askPin(who, undefined);
  }
  return code;
}

async function askPin(who: Actor | CompanyContext, pin: string | undefined) {
  if (!("company" in who)) {
    throw new AppError("FORBIDDEN", "Open Settings > Backups in a company to give your PIN.");
  }
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(who, pin || undefined, "connect Google Drive again (it replaces the sign-in)");
}
