"use server";

import { revalidatePath } from "next/cache";

import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { changePassword, login, logout } from "@/modules/auth/auth.service";
import { getCurrentSession, requireSession } from "@/modules/auth/context";
import type { ChangePasswordInput, LoginInput } from "@/modules/auth/schemas";
import { switchCompany } from "@/modules/companies/company.service";

export async function loginAction(input: LoginInput) {
  return runAction(async () => {
    const meta = await getRequestMeta();
    checkRateLimit(`login:${meta.ipAddress ?? "unknown"}`, 10, 60_000);
    const result = await login(input, meta);
    await setSessionCookie(result.token, result.expiresAt);
    return {
      user: result.user,
      activeCompanyId: result.activeCompanyId,
      mustChangePassword: result.user.mustChangePassword,
    };
  });
}

export async function logoutAction() {
  return runAction(async () => {
    const current = await getCurrentSession();
    if (current) await logout(current.session, await getRequestMeta());
    await clearSessionCookie();
    return null;
  });
}

export async function changePasswordAction(input: ChangePasswordInput) {
  return runAction(async () => {
    const { session } = await requireSession();
    return changePassword(
      { userId: session.userId, sessionId: session.id, companyId: session.activeCompanyId },
      input,
      await getRequestMeta(),
    );
  });
}

export async function switchCompanyAction(companyId: string) {
  return runAction(async () => {
    const current = await requireSession();
    const result = await switchCompany(current, companyId, await getRequestMeta());
    revalidatePath("/", "layout");
    return result;
  });
}
