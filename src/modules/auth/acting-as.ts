import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import type { CompanyContext } from "@/modules/auth/context";
import { resolveCompanyAccess } from "@/modules/companies/access";

/**
 * The context a nightly clock works in for a person who set something up to run
 * by itself (an installment paid on its due day, a monthly fixed cost): their
 * company access as it is NOW, so the services check every rule they would check
 * for that person in the app. Null when the person is no longer active or no
 * longer works in the company.
 */
export async function actingAs(userId: string, companyId: string): Promise<CompanyContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      avatarUrl: true,
      status: true,
      isSuperAdmin: true,
      mustChangePassword: true,
    },
  });
  if (!user || user.status !== "ACTIVE") return null;
  const access = await resolveCompanyAccess(user, companyId);
  if (!access) return null;
  const now = new Date();
  return {
    session: {
      id: `clock-${userId}`,
      userId,
      token: "",
      activeCompanyId: companyId,
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(now.getTime() + 60_000),
      lastSeenAt: now,
      createdAt: now,
      checkRoleId: null,
      checkPlatform: false,
    },
    user,
    ...access,
    db: tenantDb(companyId),
    can: (permission) => access.permissions.has(permission),
  };
}
