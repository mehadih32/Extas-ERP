import { apiRoute } from "@/lib/api";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import { listDriveBackups } from "@/modules/backups/drive-copies";

export const dynamic = "force-dynamic";

/** GET /api/backups/drive — the backups in Google Drive, newest first (date, size, checked). */
export const GET = apiRoute(async () => {
  await requirePlatformSuperAdmin();
  return listDriveBackups();
});
