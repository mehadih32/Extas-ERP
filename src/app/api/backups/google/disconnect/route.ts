import { apiRoute, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/backups/google/disconnect — stops copying backups to Google Drive.
 * Needs "pin" (the company's PIN) in the body.
 */
export const POST = apiRoute(async (request) => {
  const ctx = await requireCompany();
  if (!ctx.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only the platform owner can do this.");
  }
  return backups.disconnectGoogleDrive(ctx, await readJson(request), await getRequestMeta());
});
