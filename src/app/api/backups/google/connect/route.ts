import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/backups/google/connect — starts connecting Google Drive: a code the
 * owner enters at google.com/device on their phone ({ userCode, verificationUrl }).
 */
export const POST = apiRoute(async () => {
  const { user } = await requirePlatformSuperAdmin();
  return backups.startGoogleSignIn({ userId: user.id }, await getRequestMeta());
});

/**
 * GET /api/backups/google/connect — whether the owner has said yes on their phone:
 * { status: waiting | connected | denied | expired | none, config }.
 */
export const GET = apiRoute(async () => {
  const { user } = await requirePlatformSuperAdmin();
  return backups.checkGoogleSignIn({ userId: user.id }, await getRequestMeta());
});
