import "server-only";

import { cache } from "react";

import { readSessionCookie } from "@/lib/auth/cookies";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { validateSessionToken, type ValidSession } from "@/modules/auth/session.service";
import { resolveCompanyAccess, type CompanyAccess } from "@/modules/companies/access";
import { TERMS_STAFF_STATUSES, termsDue } from "@/modules/hr/terms";
import type { PermissionKey } from "@/modules/rbac/permissions";

/**
 * Request-scoped auth helpers for Server Actions, Route Handlers and (later)
 * Server Components. `cache` makes each lookup run at most once per request.
 */

/** The signed-in session, or null. Never throws. */
export const getCurrentSession = cache(async (): Promise<ValidSession | null> => {
  const token = await readSessionCookie();
  return token ? validateSessionToken(token) : null;
});

/** The signed-in session, or throws UNAUTHENTICATED. */
export async function requireSession(): Promise<ValidSession> {
  const current = await getCurrentSession();
  if (!current) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  return current;
}

export type CompanyContext = ValidSession &
  CompanyAccess & {
    /** Prisma client that can only see this company's data. */
    db: TenantDb;
    can: (permission: PermissionKey) => boolean;
    /** The AI acting through its own account (modules/ai/account.ts): its audit rows are marked "AI". */
    byAi?: boolean;
  };

/**
 * Whether the person must agree to the company's terms of employment first:
 * the company published terms everyone agrees to, and the person is a current
 * employee here who has not agreed since (hr/terms.ts). One small lookup, and
 * only in companies with terms.
 */
async function mustAgreeToTerms(company: CompanyAccess["company"], userId: string) {
  if (!company.termsRequiredSince) return false;
  const employee = await prisma.employee.findFirst({
    where: { companyId: company.id, userId, status: { in: [...TERMS_STAFF_STATUSES] } },
    select: { termsAgreedAt: true },
  });
  return employee !== null && termsDue(company.termsRequiredSince, employee.termsAgreedAt);
}

const loadCompanyAccess = cache(async (): Promise<{ ctx: CompanyContext; termsDue: boolean }> => {
  const current = await requireSession();
  if (current.user.mustChangePassword) {
    // Invited users and password resets: only /me, change-password and logout work until then.
    throw new AppError("PASSWORD_CHANGE_REQUIRED", "Please set a new password to continue.");
  }
  const companyId = current.session.activeCompanyId;
  if (!companyId) {
    throw new AppError("NO_COMPANY", "Select a company to continue.");
  }
  const access = await resolveCompanyAccess(current.user, companyId, current.session.checkRoleId);
  if (!access) {
    throw new AppError(
      "NO_COMPANY",
      "You no longer have access to this company. Select another one.",
    );
  }
  const ctx: CompanyContext = {
    ...current,
    ...access,
    db: tenantDb(access.company.id),
    can: (permission) => access.permissions.has(permission),
  };
  return { ctx, termsDue: await mustAgreeToTerms(access.company, current.user.id) };
});

async function loadCompanyContext(): Promise<CompanyContext> {
  const { ctx, termsDue } = await loadCompanyAccess();
  if (termsDue) {
    // Until they agree, only the terms screen (/terms) and signing out work.
    throw new AppError(
      "TERMS_REQUIRED",
      "Please read and agree to the terms of employment to continue.",
    );
  }
  return ctx;
}

/**
 * The active company for the terms screen itself, which works before the
 * person has agreed (everything else answers TERMS_REQUIRED until then).
 */
export async function requireCompanyForTerms(): Promise<CompanyContext> {
  return (await loadCompanyAccess()).ctx;
}

/** The active company, the user's role in it and a tenant-locked DB client. */
export async function requireCompany(): Promise<CompanyContext> {
  return loadCompanyContext();
}

/** Like requireCompany, but also demands every listed permission. */
export async function requirePermission(...permissions: PermissionKey[]): Promise<CompanyContext> {
  const ctx = await loadCompanyContext();
  const missing = permissions.filter((p) => !ctx.permissions.has(p));
  if (missing.length > 0) {
    throw new AppError("FORBIDDEN", "You do not have permission to do this.");
  }
  return ctx;
}

/** Like requireCompany, but demands at least one of the listed permissions. */
export async function requireAnyPermission(
  ...permissions: PermissionKey[]
): Promise<CompanyContext> {
  const ctx = await loadCompanyContext();
  if (!permissions.some((p) => ctx.permissions.has(p))) {
    throw new AppError("FORBIDDEN", "You do not have permission to do this.");
  }
  return ctx;
}

/** Platform-level owner check (create companies, manage everything). */
export async function requirePlatformSuperAdmin(): Promise<ValidSession> {
  const current = await requireSession();
  if (!current.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only the platform owner can do this.");
  }
  return current;
}
