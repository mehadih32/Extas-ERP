import type { Company, SystemRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { PermissionKey } from "@/modules/rbac/permissions";
import { resolvePermissions } from "@/modules/rbac/resolve";

export type CompanySummary = Pick<Company, "id" | "name" | "slug" | "logoUrl">;

export type CompanyAccess = {
  company: Company;
  membershipId: string | null; // null for a platform super admin without a membership
  role: { id: string; name: string; systemRole: SystemRole | null } | null;
  permissions: Set<PermissionKey>;
};

const roleWithPermissions = {
  select: {
    id: true,
    name: true,
    systemRole: true,
    permissions: { select: { permission: { select: { key: true } } } },
  },
} as const;

/**
 * Decides whether a user may work inside a company and with which permissions:
 * their role's, with their own changes from the permission matrix on top.
 * Returns null when the company is inactive or the user has no active membership.
 *
 * A Full check session (its own check account, which is no one's colleague and
 * has no membership) passes the role it checks: it gets exactly that role's
 * permissions in that role's company, and nowhere else.
 */
export async function resolveCompanyAccess(
  user: { id: string; isSuperAdmin: boolean },
  companyId: string,
  checkRoleId?: string | null,
): Promise<CompanyAccess | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) return null;

  if (checkRoleId) {
    const role = await prisma.role.findFirst({
      where: { id: checkRoleId, companyId },
      ...roleWithPermissions,
    });
    if (!role) return null;
    return {
      company,
      membershipId: null,
      role: { id: role.id, name: role.name, systemRole: role.systemRole },
      permissions: resolvePermissions({
        isPlatformSuperAdmin: user.isSuperAdmin,
        systemRole: role.systemRole,
        grantedKeys: role.permissions.map((rp) => rp.permission.key),
        changes: [],
      }),
    };
  }

  const membership = await prisma.companyMembership.findUnique({
    where: { companyId_userId: { companyId, userId: user.id } },
    include: {
      role: roleWithPermissions,
      permissionChanges: { select: { granted: true, permission: { select: { key: true } } } },
    },
  });
  const activeMembership = membership?.isActive ? membership : null;

  if (!activeMembership && !user.isSuperAdmin) return null;

  const role = activeMembership?.role ?? null;
  return {
    company,
    membershipId: activeMembership?.id ?? null,
    role: role ? { id: role.id, name: role.name, systemRole: role.systemRole } : null,
    permissions: resolvePermissions({
      isPlatformSuperAdmin: user.isSuperAdmin,
      systemRole: role?.systemRole ?? null,
      grantedKeys: role?.permissions.map((rp) => rp.permission.key) ?? [],
      changes:
        activeMembership?.permissionChanges.map((c) => ({
          key: c.permission.key,
          granted: c.granted,
        })) ?? [],
    }),
  };
}

/** Companies shown in the top-nav switcher for this user. */
export async function listAccessibleCompanies(user: {
  id: string;
  isSuperAdmin: boolean;
}): Promise<Array<CompanySummary & { roleName: string | null }>> {
  const select = { id: true, name: true, slug: true, logoUrl: true } as const;
  const memberships = await prisma.companyMembership.findMany({
    where: { userId: user.id, isActive: true, company: { isActive: true } },
    select: { company: { select }, role: { select: { name: true } } },
    orderBy: { company: { name: "asc" } },
  });
  const result = memberships.map((m) => ({ ...m.company, roleName: m.role.name }));

  if (user.isSuperAdmin) {
    const memberIds = new Set(result.map((c) => c.id));
    const others = await prisma.company.findMany({
      where: { isActive: true, id: { notIn: [...memberIds] } },
      select,
      orderBy: { name: "asc" },
    });
    result.push(...others.map((c) => ({ ...c, roleName: "Platform Admin" })));
    result.sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

/** Picks the company to open after login: the last one used, else the first available. */
export async function pickDefaultCompanyId(user: {
  id: string;
  isSuperAdmin: boolean;
  lastCompanyId: string | null;
}): Promise<string | null> {
  if (user.lastCompanyId && (await resolveCompanyAccess(user, user.lastCompanyId))) {
    return user.lastCompanyId;
  }
  const companies = await listAccessibleCompanies(user);
  return companies[0]?.id ?? null;
}
