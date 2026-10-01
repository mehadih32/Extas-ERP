import type { ValidSession } from "@/modules/auth/session.service";
import { listAccessibleCompanies, resolveCompanyAccess } from "@/modules/companies/access";

/**
 * Everything the app shell needs after sign-in: the user, the companies for the
 * switcher, the active company and the user's permissions there.
 */
export async function getMe(current: ValidSession) {
  const companies = await listAccessibleCompanies(current.user);
  const companyId = current.session.activeCompanyId;
  const access = companyId ? await resolveCompanyAccess(current.user, companyId) : null;
  return {
    user: current.user,
    companies,
    activeCompany: access
      ? {
          id: access.company.id,
          name: access.company.name,
          slug: access.company.slug,
          logoUrl: access.company.logoUrl,
          primaryColor: access.company.primaryColor,
          accentColor: access.company.accentColor,
          currency: access.company.currency,
        }
      : null,
    role: access?.role ?? null,
    permissions: access ? [...access.permissions].sort() : [],
    mustChangePassword: current.user.mustChangePassword,
  };
}
