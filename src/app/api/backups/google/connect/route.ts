import { apiRoute, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany, requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";
import { startDriveConnect } from "@/modules/backups/drive-connect";

export const dynamic = "force-dynamic";

/**
 * POST /api/backups/google/connect — starts connecting Google Drive: a code the
 * owner enters at google.com/device on their phone ({ userCode, verificationUrl }).
 * While Drive is connected it replaces the sign-in, so it needs "pin" (the
 * company's PIN) in the body.
 */
export const POST = apiRoute(async (request) => {
  const ctx = await requireCompany();
  if (!ctx.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only the platform owner can do this.");
  }
  return startDriveConnect(ctx, await readJson(request), await getRequestMeta());
});

/**
 * GET /api/backups/google/connect — whether the owner has said yes on their phone:
 * { status: waiting | connected | denied | expired | none, config }.
 */
export const GET = apiRoute(async () => {
  const { user } = await requirePlatformSuperAdmin();
  return backups.checkGoogleSignIn({ userId: user.id }, await getRequestMeta());
});
