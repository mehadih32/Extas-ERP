import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppError } from "@/lib/errors";
import { REQUESTED_PATH_HEADER, ROUTES, signInPath, termsPath } from "@/lib/routes";
import {
  type CompanyContext,
  getCurrentSession,
  requireCompany,
  requireCompanyForTerms,
} from "@/modules/auth/context";
import type { ValidSession } from "@/modules/auth/session.service";

/*
 * Gatekeepers for the screens (Server Components). They use the same checks as
 * the Server Actions and API routes (modules/auth/context.ts) and turn a refusal
 * into the screen that sorts it out, instead of an error.
 */

/** To sign in, then back to the page that was asked for (the proxy says which). */
async function redirectToSignIn(): Promise<never> {
  const requested = (await headers()).get(REQUESTED_PATH_HEADER);
  redirect(signInPath(requested));
}

/** A signed-in person, or the sign-in screen. */
export async function requireSessionPage(): Promise<ValidSession> {
  const current = await getCurrentSession();
  if (!current) return redirectToSignIn();
  return current;
}

/**
 * The active company with the person's role and permissions in it. Sends people
 * who are signed out to sign in, people who must set a new password to do that
 * first, staff who have not agreed to the terms of employment to read them, and
 * people without a usable company to choose one.
 */
export async function requireCompanyPage(): Promise<CompanyContext> {
  try {
    return await requireCompany();
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "UNAUTHENTICATED") return redirectToSignIn();
      if (error.code === "PASSWORD_CHANGE_REQUIRED") redirect(ROUTES.changePassword);
      if (error.code === "TERMS_REQUIRED") {
        redirect(termsPath((await headers()).get(REQUESTED_PATH_HEADER)));
      }
      if (error.code === "NO_COMPANY") redirect(ROUTES.selectCompany);
    }
    throw error;
  }
}

/**
 * The active company for the terms screen, which opens before the person has
 * agreed to the terms (every other screen sends them there until they do).
 */
export async function requireTermsPage(): Promise<CompanyContext> {
  try {
    return await requireCompanyForTerms();
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "UNAUTHENTICATED") return redirectToSignIn();
      if (error.code === "PASSWORD_CHANGE_REQUIRED") redirect(ROUTES.changePassword);
      if (error.code === "NO_COMPANY") redirect(ROUTES.selectCompany);
    }
    throw error;
  }
}
