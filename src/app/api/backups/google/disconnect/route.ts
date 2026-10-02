import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

export const dynamic = "force-dynamic";

/** POST /api/backups/google/disconnect — stops copying backups to Google Drive. */
export const POST = apiRoute(async () => {
  const { user } = await requirePlatformSuperAdmin();
  return backups.disconnectGoogleDrive({ userId: user.id }, await getRequestMeta());
});
