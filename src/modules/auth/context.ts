import "server-only";

import { cache } from "react";

import { readSessionCookie } from "@/lib/auth/cookies";
import { AppError } from "@/lib/errors";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { validateSessionToken, type ValidSession } from "@/modules/auth/session.service";
import { resolveCompanyAccess, type CompanyAccess } from "@/modules/companies/access";
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
  };

const loadCompanyContext = cache(async (): Promise<CompanyContext> => {
  const current = await requireSession();
  if (current.user.mustChangePassword) {
    // Invited users and password resets: only /me, change-password and logout work until then.
    throw new AppError("PASSWORD_CHANGE_REQUIRED", "Please set a new password to continue.");
  }
  const companyId = current.session.activeCompanyId;
  if (!companyId) {
    throw new AppError("NO_COMPANY", "Select a company to continue.");
  }
  const access = await resolveCompanyAccess(current.user, companyId);
  if (!access) {
    throw new AppError(
      "NO_COMPANY",
      "You no longer have access to this company. Select another one.",
    );
  }
  return {
    ...current,
    ...access,
    db: tenantDb(access.company.id),
    can: (permission) => access.permissions.has(permission),
  };
});

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

/** Platform-level owner check (create companies, manage everything). */
export async function requirePlatformSuperAdmin(): Promise<ValidSession> {
  const current = await requireSession();
  if (!current.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only the platform owner can do this.");
  }
  return current;
}
