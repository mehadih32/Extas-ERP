import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/backups/google/callback?code=&state= — where Google returns the owner
 * after they allow access. Saves the (encrypted) Drive connection and creates the
 * "Extras ERP Backups" folder. This address must be an authorised redirect URI of
 * the Google OAuth client.
 */
export const GET = apiRoute(async (request) => {
  const { user } = await requirePlatformSuperAdmin();
  return backups.completeGoogleConnect(
    { userId: user.id },
    Object.fromEntries(new URL(request.url).searchParams),
    await getRequestMeta(),
  );
});
