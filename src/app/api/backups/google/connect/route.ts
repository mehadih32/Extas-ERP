import { apiRoute } from "@/lib/api";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/backups/google/connect — the Google consent page to open ({ url }).
 * Google then sends the owner back to /api/backups/google/callback.
 */
export const GET = apiRoute(async () => {
  const { user } = await requirePlatformSuperAdmin();
  return backups.googleConnectUrl({ userId: user.id });
});
