import { readJson, apiRoute } from "@/lib/api";
import { setSessionCookie } from "@/lib/auth/cookies";
import { getRequestMeta } from "@/lib/request-meta";
import { checkLoginRate, login } from "@/modules/auth/auth.service";
import { loginSchema } from "@/modules/auth/schemas";

/** POST /api/auth/login — { email, password } → sets the session cookie. */
export const POST = apiRoute(async (request) => {
  const meta = await getRequestMeta();
  const input = loginSchema.parse(await readJson(request));
  checkLoginRate(meta);
  const result = await login(input, meta);
  await setSessionCookie(result.token, result.expiresAt);
  return {
    user: result.user,
    activeCompanyId: result.activeCompanyId,
    mustChangePassword: result.user.mustChangePassword,
  };
});
