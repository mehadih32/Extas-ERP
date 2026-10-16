import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import type { CompanyContext } from "@/modules/auth/context";
import { resolveCompanyAccess } from "@/modules/companies/access";

/*
 * The platform owner of a company, for what Bug Guard does in their name when
 * no screen is open: the clock (its own "opens fixes by itself" option, off by
 * default) and the bot's buttons. A stand-in for that one piece of work, never
 * a sign-in, with the owner's own permissions in the store and never more.
 */

/** The company's platform owners (active super admins who are members), oldest first. */
export async function ownersOf(companyId: string) {
  return prisma.user.findMany({
    where: {
      isSuperAdmin: true,
      status: "ACTIVE",
      memberships: { some: { companyId, isActive: true } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

/** A stand-in context for one owner (the given one, or the oldest), or null when there is none. */
export async function ownerStandIn(
  companyId: string,
  userId?: string | null,
  agent = "Bug Guard",
): Promise<CompanyContext | null> {
  const id = userId ?? (await ownersOf(companyId))[0]?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
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
  if (!user || user.status !== "ACTIVE" || !user.isSuperAdmin) return null;
  const access = await resolveCompanyAccess(user, companyId);
  if (!access) return null;
  const now = new Date();
  return {
    session: {
      id: `bug-guard-${companyId}`,
      userId: user.id,
      token: "",
      activeCompanyId: companyId,
      userAgent: agent,
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
