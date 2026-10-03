"use server";

import { redirect } from "next/navigation";

import type { ActionError } from "@/lib/result";
import { ROUTES, safeNextPath } from "@/lib/routes";
import { getCurrentSession } from "@/modules/auth/context";
import {
  changePasswordAction,
  loginAction,
  logoutAction,
  switchCompanyAction,
} from "@/server/actions/auth.actions";

/*
 * Form handlers for the sign-in screens. Each one calls the existing Server
 * Action (the same checks, rate limit and audit trail as the API) and then sends
 * the person on to the right screen. Expected problems come back as `error`.
 */

export type AuthFormState = {
  error?: ActionError;
  /** The email typed, so a failed sign-in does not empty the field. Never the password. */
  email?: string;
  /** Set when a password change went through and the person stays on the screen. */
  changed?: { otherSessionsRevoked: number };
} | null;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Sign in, then on to the page asked for, the new-password screen or the company list. */
export async function signInFormAction(
  _previous: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = text(form, "email");
  const result = await loginAction({ email, password: text(form, "password") });
  if (!result.ok) return { error: result.error, email };

  if (result.data.mustChangePassword) redirect(ROUTES.changePassword);
  if (!result.data.activeCompanyId) redirect(ROUTES.selectCompany);
  redirect(safeNextPath(text(form, "next")) ?? ROUTES.home);
}

/** A new password. A first-time (temporary) password goes straight on into the app afterwards. */
export async function changePasswordFormAction(
  _previous: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const current = await getCurrentSession();
  if (!current) redirect(ROUTES.signIn);

  const newPassword = text(form, "newPassword");
  if (newPassword !== text(form, "confirmPassword")) {
    return {
      error: {
        code: "VALIDATION",
        message: "Please check the highlighted fields.",
        fieldErrors: { confirmPassword: ["The two new passwords do not match."] },
      },
    };
  }
  const result = await changePasswordAction({
    currentPassword: text(form, "currentPassword"),
    newPassword,
    signOutOtherDevices: form.get("signOutOtherDevices") === "on",
  });
  if (!result.ok) return { error: result.error };

  if (current.user.mustChangePassword) {
    redirect(current.session.activeCompanyId ? ROUTES.home : ROUTES.selectCompany);
  }
  return { changed: result.data };
}

/** Signs out this device. Returns the error when the session could not be ended. */
export async function signOutAction(): Promise<ActionError | undefined> {
  const result = await logoutAction();
  if (!result.ok) return result.error;
  redirect(ROUTES.signIn);
}

/** Opens a company from the company list, then the dashboard. */
export async function selectCompanyAction(companyId: string): Promise<ActionError | undefined> {
  const result = await switchCompanyAction(companyId);
  if (!result.ok) return result.error;
  redirect(ROUTES.home);
}
