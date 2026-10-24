import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import { type Actor, getBackupConfig } from "@/modules/backups/backup-core";
import * as backups from "@/modules/backups/backup.service";
import { connectDriveSchema } from "@/modules/backups/schemas";

/*
 * "Connect Google Drive" from the Backups screen or the API (owner's decision,
 * 2026-10-24): while Drive is connected, a new sign-in (Reconnect, or another
 * Google account) would replace where the backups go, so it needs the owner's
 * PIN, checked here before Google is asked for a code. The first Connect needs
 * none. Every request path starts a sign-in only through here; the sign-in
 * itself (backup.service.ts) is unchanged, as the restore drill uses it.
 */

export async function startDriveConnect(
  who: Actor | CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { pin } = connectDriveSchema.parse(raw ?? {});
  const config = await getBackupConfig();
  if (config.credentialsRef) {
    if (!("company" in who)) {
      throw new AppError("FORBIDDEN", "Open Settings > Backups in a company to give your PIN.");
    }
    const { requirePin } = await import("@/modules/ai/settings.service");
    await requirePin(who, pin || undefined, "connect Google Drive again (it replaces the sign-in)");
  }
  const actor: Actor = "company" in who ? { userId: who.user.id } : who;
  return backups.startGoogleSignIn(actor, meta);
}
