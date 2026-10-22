import type { Company, SalesChannelIntegration } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";

import { shopEmail } from "./shop-address";

/*
 * What a shop does through the e-commerce API is done by the integration's own
 * account, like the AI's (modules/ai/account.ts): a user that can never sign
 * in (no password, suspended, an address that cannot receive mail) and belongs
 * to no team. Orders, payments, returns and the activity log carry its name
 * ("Shop: <integration name>"), so everyone can see the shop did it.
 *
 * It holds only what the API needs: taking website orders and moving them on
 * (packing, delivery, cancelling before delivery), recording the money the shop
 * collected (the owner's contract, CN-005: "the ERP posts the journals itself")
 * and the returns the shop checked. Nothing else: no team, roles, prices,
 * settings or reports.
 */
export const SHOP_PERMISSIONS: readonly PermissionKey[] = [
  "sales.view",
  "sales.order.create",
  "accounts.receipts.record",
  "sales.returns.qc",
];

export const shopAccountName = (integration: Pick<SalesChannelIntegration, "name">) =>
  `Shop: ${integration.name}`.slice(0, 100);

/** The integration's account, made the first time it is needed (named after the shop). */
export async function shopAccountOf(
  integration: Pick<SalesChannelIntegration, "id" | "name" | "serviceUserId">,
  db: Db = prisma,
) {
  const name = shopAccountName(integration);
  const select = { id: true, name: true, email: true } as const;
  if (integration.serviceUserId) {
    const user = await db.user.findUnique({ where: { id: integration.serviceUserId }, select });
    if (user && user.email === shopEmail(integration.id)) {
      return user.name === name
        ? user
        : db.user.update({ where: { id: user.id }, data: { name }, select });
    }
  }
  const user = await db.user.upsert({
    where: { email: shopEmail(integration.id) },
    create: { email: shopEmail(integration.id), name, passwordHash: null, status: "SUSPENDED" },
    // Never a person's way in: no password, suspended, in no team, signed out.
    update: { name, passwordHash: null, status: "SUSPENDED", mustChangePassword: false },
    select,
  });
  await db.companyMembership.updateMany({
    where: { userId: user.id, isActive: true },
    data: { isActive: false },
  });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.salesChannelIntegration.update({
    where: { id: integration.id },
    data: { serviceUserId: user.id },
  });
  return user;
}

/**
 * The context the API's work runs in: the integration's company, its account
 * and SHOP_PERMISSIONS, with a client locked to that company. Services that
 * take a CompanyContext work unchanged, with every rule they check.
 */
export async function shopContext(
  integration: SalesChannelIntegration,
  company: Company,
): Promise<CompanyContext> {
  const account = await shopAccountOf(integration);
  const permissions = new Set<PermissionKey>(SHOP_PERMISSIONS);
  const now = new Date();
  return {
    session: {
      id: `shop-${integration.id}`,
      userId: account.id,
      token: "",
      activeCompanyId: company.id,
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(now.getTime() + 60_000),
      lastSeenAt: now,
      createdAt: now,
      checkRoleId: null,
      checkPlatform: false,
    },
    user: {
      id: account.id,
      email: account.email,
      name: account.name,
      phone: null,
      avatarUrl: null,
      status: "SUSPENDED",
      isSuperAdmin: false,
      mustChangePassword: false,
    },
    company,
    membershipId: null,
    role: null,
    permissions,
    db: tenantDb(company.id),
    can: (permission) => permissions.has(permission),
  };
}
