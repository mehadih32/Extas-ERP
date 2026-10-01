import { readJson, apiRoute } from "@/lib/api";
import { setSessionCookie } from "@/lib/auth/cookies";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestMeta } from "@/lib/request-meta";
import { login } from "@/modules/auth/auth.service";
import { loginSchema } from "@/modules/auth/schemas";

/** POST /api/auth/login — { email, password } → sets the session cookie. */
export const POST = apiRoute(async (request) => {
  const meta = await getRequestMeta();
  checkRateLimit(`login:${meta.ipAddress ?? "unknown"}`, 10, 60_000);
  const result = await login(loginSchema.parse(await readJson(request)), meta);
  await setSessionCookie(result.token, result.expiresAt);
  return {
    user: result.user,
    activeCompanyId: result.activeCompanyId,
    mustChangePassword: result.user.mustChangePassword,
  };
});
