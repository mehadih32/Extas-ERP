import { apiRoute } from "@/lib/api";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/** GET /api/backups/runs/:runId — one backup: status, size, files, Google Drive copy. */
export const GET = apiRoute<Params>(async (_request, { runId }) => {
  await requirePlatformSuperAdmin();
  return backups.getBackupRun(runId);
});
