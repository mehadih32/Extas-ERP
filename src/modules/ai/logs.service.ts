import type { Prisma } from "@prisma/client";

import type { CompanyContext } from "@/modules/auth/context";

import { aiLabel, aiSettingsOf } from "./settings.service";

/*
 * AI Center > Logs: everything the AI did (audit rows marked byAi, shown with
 * the AI's name) and every change to what it may do (the switch, Control,
 * grants, models, key, PIN, and the answers to its requests). Read with
 * ai.view or ai.manage.
 */

/** The audit rows of the AI Center itself. */
export const AI_CENTER_ENTITIES = [
  "AiSettings",
  "AiControl",
  "AiPermissionRequest",
  "AiDeletionRequest",
  "AiBudget",
  "AiChat",
  "AiDraft",
  "AiFollowUp",
  "AiKnowledgeBook",
  "AiTestRun",
  "HouseRule",
  "CompanyMailSettings",
  "AiBotLink",
  "AiOrderRun",
  "AiStaffUpdate",
  "ServerHealthRun",
] as const;

export const LOG_FILTERS = [
  { value: "all", label: "Everything" },
  { value: "ai", label: "Done by the AI" },
  { value: "changes", label: "Changes to the AI" },
] as const;

export type LogFilter = (typeof LOG_FILTERS)[number]["value"];

const PAGE = 100;

export async function getAiLogs(ctx: CompanyContext, filter: LogFilter = "all") {
  const where: Prisma.AuditLogWhereInput =
    filter === "ai"
      ? { byAi: true }
      : filter === "changes"
        ? { byAi: false, entityType: { in: [...AI_CENTER_ENTITIES] } }
        : { OR: [{ byAi: true }, { entityType: { in: [...AI_CENTER_ENTITIES] } }] };
  const [settings, rows] = await Promise.all([
    aiSettingsOf(ctx.company.id),
    ctx.db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  return {
    filter,
    items: rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      byAi: r.byAi,
      who: r.byAi
        ? // Done in the AI's own account, or (before it had one) for the person who asked.
          `${aiLabel(settings)}${r.user && r.user.id !== settings.aiUserId ? ` for ${r.user.name}` : ""}`
        : (r.user?.name ?? "The system"),
      action: r.action,
      what: r.summary ?? r.entityType,
      entityType: r.entityType,
    })),
    more: rows.length === PAGE,
  };
}

export type AiLogs = Awaited<ReturnType<typeof getAiLogs>>;
