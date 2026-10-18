"use server";

import { revalidatePath } from "next/cache";

import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { changePassword, checkLoginRate, login, logout } from "@/modules/auth/auth.service";
import { getCurrentSession, requireSession } from "@/modules/auth/context";
import type { ChangePasswordInput, LoginInput } from "@/modules/auth/schemas";
import { askUnlockLink, unlockWithLink } from "@/modules/auth/unlock.service";
import { switchCompany } from "@/modules/companies/company.service";

export async function loginAction(input: LoginInput) {
  return runAction(async () => {
    const meta = await getRequestMeta();
    checkLoginRate(meta, input?.email);
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

/** "Email me an unlock link": the same answer for any email (unlock.service.ts). */
export async function askUnlockLinkAction(input: { email: string }) {
  return runAction(async () => askUnlockLink(input, await getRequestMeta()));
}

/** "Unlock my sign-in" on the emailed link: once, while it works. */
export async function unlockWithLinkAction(input: { token: string }) {
  return runAction(async () => unlockWithLink(input, await getRequestMeta()));
}
