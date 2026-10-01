import type { BuyerType, Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { balancesFor } from "@/modules/parties/ledger.service";
import { dormantQuerySchema } from "@/modules/parties/schemas";

/** Re-engagement targets B2B buyers by default (blueprint: dormant B2B buyers). */
export const DEFAULT_CAMPAIGN_BUYER_TYPES: BuyerType[] = ["WHOLESALE", "B2B_CORPORATE"];

const DAY_MS = 86_400_000;

/** The same calendar day `months` months ago. */
export function monthsAgo(months: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Buyers with no transaction since `cutoff` (never-traded buyers count from the
 * day they were added). Closed and settling accounts are left out.
 */
export function inactiveBuyersWhere(
  cutoff: Date,
  buyerTypes?: BuyerType[],
): Prisma.PartyWhereInput {
  return {
    kind: { in: ["BUYER", "BOTH"] },
    status: { in: ["ACTIVE", "DORMANT"] },
    ...(buyerTypes ? { buyerType: { in: buyerTypes } } : {}),
    OR: [
      { lastTransactionAt: { lt: cutoff } },
      { lastTransactionAt: null, createdAt: { lt: cutoff } },
    ],
  };
}

/**
 * Dormant B2B buyer filter: buyers inactive for 6, 12 (or any) months, oldest
 * activity first, with their current balance. Defaults to the company's
 * "dormant after" setting and to wholesale + B2B corporate buyers.
 */
export async function listDormantBuyers(ctx: CompanyContext, raw: unknown = {}) {
  const q = dormantQuerySchema.parse(raw);
  const months = q.months ?? ctx.company.dormantAfterMonths;
  const buyerTypes = q.buyerTypes ?? DEFAULT_CAMPAIGN_BUYER_TYPES;
  const now = new Date();
  const cutoff = monthsAgo(months, now);
  const parties = await ctx.db.party.findMany({
    where: inactiveBuyersWhere(cutoff, buyerTypes),
    orderBy: [{ lastTransactionAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    take: 5000,
  });
  const balances = await balancesFor(
    ctx.company.id,
    parties.map((p) => p.id),
  );
  return {
    months,
    cutoff,
    buyerTypes,
    count: parties.length,
    items: parties.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      buyerType: p.buyerType,
      grade: p.grade,
      isVerified: p.isVerified,
      status: p.status,
      contactPerson: p.contactPerson,
      phone: p.phone,
      whatsapp: p.whatsapp,
      email: p.email,
      city: p.city,
      lastTransactionAt: p.lastTransactionAt,
      daysInactive: Math.floor(
        (now.getTime() - (p.lastTransactionAt ?? p.createdAt).getTime()) / DAY_MS,
      ),
      balance: balances.get(p.id)!.toFixed(2),
    })),
  };
}

type StatusRefresh = {
  dormant: Array<{ id: string; code: string }>;
  closed: Array<{ id: string; code: string }>;
};

/**
 * Housekeeping for one company (safe to run from a nightly job):
 *  - active buyers with no business for `dormantAfterMonths` become DORMANT;
 *  - SETTLING accounts whose dues are fully cleared become CLOSED.
 */
export async function refreshStatusesForCompany(
  company: { id: string; dormantAfterMonths: number },
  now: Date = new Date(),
  db: Db = prisma,
): Promise<StatusRefresh> {
  const cutoff = monthsAgo(company.dormantAfterMonths, now);
  const toDormant = await db.party.findMany({
    where: { companyId: company.id, ...inactiveBuyersWhere(cutoff), status: "ACTIVE" },
    select: { id: true, code: true },
  });
  if (toDormant.length > 0) {
    await db.party.updateMany({
      where: { id: { in: toDormant.map((p) => p.id) }, status: "ACTIVE" },
      data: { status: "DORMANT", statusChangedAt: now },
    });
  }

  const settling = await db.party.findMany({
    where: { companyId: company.id, status: "SETTLING" },
    select: { id: true, code: true },
  });
  const balances = await balancesFor(
    company.id,
    settling.map((p) => p.id),
    db,
  );
  const toClose = settling.filter((p) => balances.get(p.id)!.isZero());
  if (toClose.length > 0) {
    await db.party.updateMany({
      where: { id: { in: toClose.map((p) => p.id) }, status: "SETTLING" },
      data: { status: "CLOSED", statusChangedAt: now },
    });
  }
  return { dormant: toDormant, closed: toClose };
}

/** Runs the status refresh for the active company and records it in the audit log. */
export async function refreshPartyStatuses(ctx: CompanyContext, meta?: RequestMeta) {
  const result = await refreshStatusesForCompany(ctx.company);
  if (result.dormant.length + result.closed.length > 0) {
    await auditInCompany(ctx, meta, {
      action: "STATUS_CHANGE",
      entityType: "Party",
      summary: `Status refresh: ${result.dormant.length} buyer(s) marked dormant, ${result.closed.length} settled account(s) closed`,
      after: {
        dormant: result.dormant.map((p) => p.code),
        closed: result.closed.map((p) => p.code),
      },
    });
  }
  return {
    markedDormant: result.dormant.length,
    closed: result.closed.length,
    dormantCodes: result.dormant.map((p) => p.code),
    closedCodes: result.closed.map((p) => p.code),
  };
}
