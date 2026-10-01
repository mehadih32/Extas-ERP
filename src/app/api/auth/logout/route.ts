import { apiRoute } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { getRequestMeta } from "@/lib/request-meta";
import { logout } from "@/modules/auth/auth.service";
import { getCurrentSession } from "@/modules/auth/context";

/** POST /api/auth/logout — ends this device's session. */
export const POST = apiRoute(async () => {
  const current = await getCurrentSession();
  if (current) await logout(current.session, await getRequestMeta());
  await clearSessionCookie();
  return null;
});
