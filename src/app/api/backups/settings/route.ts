import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { AppError } from "@/lib/errors";
import { requireCompany, requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

export const dynamic = "force-dynamic";

/*
 * Backups hold every company's data, so every /api/backups route is for the
 * platform owner only.
 */

/** GET /api/backups/settings — schedule, Google Drive connection, last runs, pg_dump check. */
export const GET = apiRoute(async () => {
  await requirePlatformSuperAdmin();
  return backups.getBackupOverview();
});

/**
 * PATCH /api/backups/settings — schedule, timezone, retention, on/off. Switching
 * backups off or fewer days in Google Drive also needs "pin" (the company's PIN).
 */
export const PATCH = apiRoute(async (request) => {
  const ctx = await requireCompany();
  if (!ctx.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only the platform owner can do this.");
  }
  return backups.updateBackupConfig(ctx, await readJson(request), await getRequestMeta());
});
