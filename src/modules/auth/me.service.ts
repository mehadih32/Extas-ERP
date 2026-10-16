import type { ValidSession } from "@/modules/auth/session.service";
import {
  type CompanySummary,
  listAccessibleCompanies,
  resolveCompanyAccess,
} from "@/modules/companies/access";

const pickSummary = (c: CompanySummary): CompanySummary => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  logoUrl: c.logoUrl,
});

/**
 * Everything the app shell needs after sign-in: the user, the companies for the
 * switcher, the active company and the user's permissions there.
 */
export async function getMe(current: ValidSession) {
  const companyId = current.session.activeCompanyId;
  const access = companyId
    ? await resolveCompanyAccess(current.user, companyId, current.session.checkRoleId)
    : null;
  // A Full check session sees only the company of the role it checks.
  const companies = current.session.checkRoleId
    ? access
      ? [{ ...pickSummary(access.company), roleName: access.role?.name ?? null }]
      : []
    : await listAccessibleCompanies(current.user);
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
