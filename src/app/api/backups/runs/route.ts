import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

export const dynamic = "force-dynamic";

/** GET /api/backups/runs — backups, newest first (?cursor=&take=). */
export const GET = apiRoute(async (request) => {
  await requirePlatformSuperAdmin();
  return backups.listBackupRuns(Object.fromEntries(new URL(request.url).searchParams));
});

/**
 * POST /api/backups/runs — backs up now. Answers at once with the RUNNING run;
 * poll GET /api/backups/runs/:runId for the result. 409 while another one runs.
 */
export const POST = apiRoute(
  async () => {
    const { user } = await requirePlatformSuperAdmin();
    return backups.runBackup(
      { trigger: "MANUAL", actor: { userId: user.id } },
      await getRequestMeta(),
    );
  },
  { successStatus: 202 },
);
