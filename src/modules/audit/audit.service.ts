import type { AuditAction, Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";

export type AuditInput = {
  companyId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  meta?: RequestMeta;
};

/** Writes one row to the security / activity log. Pass `db` to join a transaction. */
export async function recordAudit(input: AuditInput, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      companyId: input.companyId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      before: input.before,
      after: input.after,
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
    },
  });
}

export type AuditQuery = {
  companyId: string;
  action?: AuditAction;
  entityType?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  take?: number;
};

/** Newest-first page of a company's audit trail. */
export async function listAuditLogs(query: AuditQuery) {
  const take = Math.min(query.take ?? 50, 200);
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId: query.companyId,
      action: query.action,
      entityType: query.entityType,
      userId: query.userId,
      createdAt: { gte: query.from, lte: query.to },
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

/** Shorthand for module services: stamps the company and acting user from the context. */
export async function auditInCompany(
  ctx: { company: { id: string }; user: { id: string } },
  meta: RequestMeta | undefined,
  input: Omit<AuditInput, "companyId" | "userId" | "meta">,
  db: Db = prisma,
): Promise<void> {
  await recordAudit({ ...input, companyId: ctx.company.id, userId: ctx.user.id, meta }, db);
}
