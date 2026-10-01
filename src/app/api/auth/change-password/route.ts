import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { changePassword } from "@/modules/auth/auth.service";
import { requireSession } from "@/modules/auth/context";
import { changePasswordSchema } from "@/modules/auth/schemas";

/** POST /api/auth/change-password — { currentPassword, newPassword, signOutOtherDevices? } */
export const POST = apiRoute(async (request) => {
  const { session } = await requireSession();
  const input = changePasswordSchema.parse(await readJson(request));
  return changePassword(
    { userId: session.userId, sessionId: session.id, companyId: session.activeCompanyId },
    input,
    await getRequestMeta(),
  );
});
