import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
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

/** PATCH /api/backups/settings — schedule, timezone, media, retention, on/off. */
export const PATCH = apiRoute(async (request) => {
  const { user } = await requirePlatformSuperAdmin();
  return backups.updateBackupConfig(
    { userId: user.id },
    await readJson(request),
    await getRequestMeta(),
  );
});
