import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";

import { aiEmail } from "./ai-address";
import { NEVER_FOR_AI } from "./control-tree";
import { aiLabel, aiSettingsOf } from "./settings.service";

/*
 * The AI's own account in a company. It is a user that can never sign in (no
 * password, suspended, an address that cannot receive mail) and belongs to no
 * team, so it shows in no team list and no role can be given to it; its
 * address can never be added to a team or used by a person (ai-address.ts),
 * and an account found at it is locked again before the AI uses it. What the
 * AI does is written to the activity log in its name and marked "AI"; what the
 * owner does from the chat (Apply on a change card) stays in the owner's name.
 */

export type AiAccount = { id: string; name: string; email: string };

/** The company's AI account, made the first time it is needed (named after the AI). */
export async function aiAccountOf(companyId: string, db: Db = prisma): Promise<AiAccount> {
  const settings = await aiSettingsOf(companyId, db);
  const name = aiLabel(settings);
  if (settings.aiUserId) {
    const user = await db.user.findUnique({
      where: { id: settings.aiUserId },
      select: { id: true, name: true, email: true },
    });
    if (user) {
      if (user.name === name) return user;
      return db.user.update({
        where: { id: user.id },
        data: { name },
        select: { id: true, name: true, email: true },
      });
    }
  }
  const user = await db.user.upsert({
    where: { email: aiEmail(companyId) },
    create: { email: aiEmail(companyId), name, passwordHash: null, status: "SUSPENDED" },
    // Never a person's way in: no password, suspended, in no team, signed out.
    update: { name, passwordHash: null, status: "SUSPENDED", mustChangePassword: false },
    select: { id: true, name: true, email: true },
  });
  await db.companyMembership.updateMany({
    where: { userId: user.id, isActive: true },
    data: { isActive: false },
  });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.aiSettings.upsert({
    where: { companyId },
    create: { companyId, aiUserId: user.id },
    update: { aiUserId: user.id },
  });
  return user;
}

/**
 * The person's context with the AI acting in it: the AI's account (audit rows
 * marked "AI"), and the person's permissions without the ones the AI may never
 * hold (the team, roles, backups, the AI Center). Every step it takes still asks
 * Control first (aiMay).
 */
export async function asAi(ctx: CompanyContext): Promise<CompanyContext> {
  const account = await aiAccountOf(ctx.company.id);
  const permissions = new Set([...ctx.permissions].filter((p) => !NEVER_FOR_AI.has(p)));
  return {
    ...ctx,
    user: {
      ...ctx.user,
      id: account.id,
      name: account.name,
      email: account.email,
      phone: null,
      avatarUrl: null,
      isSuperAdmin: false,
    },
    permissions,
    can: (permission: PermissionKey) => permissions.has(permission),
    byAi: true,
  };
}

/** Writes an activity-log row in the AI's name, marked "AI". */
export async function auditAsAi(
  companyId: string,
  row: {
    action: "CREATE" | "UPDATE" | "STATUS_CHANGE" | "EXPORT";
    entityType: string;
    entityId?: string | null;
    summary: string;
  },
  db: Db = prisma,
) {
  const account = await aiAccountOf(companyId, db);
  await db.auditLog.create({
    data: {
      companyId,
      userId: account.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      summary: row.summary,
      byAi: true,
    },
  });
}
