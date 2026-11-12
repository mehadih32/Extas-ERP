import type { Db } from "@/lib/db-types";
import { dateColumn } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { FOLLOW_UP_STAGES } from "@/modules/leads/rules";

/** For the reminder clock: open or Nurture leads whose next step is on or before a day. */
export async function dueLeads(companyId: string, untilDay: string, db: Db = prisma, limit = 1000) {
  return db.lead.findMany({
    where: {
      companyId,
      archivedAt: null,
      stage: { in: [...FOLLOW_UP_STAGES] },
      nextActionOn: { not: null, lte: dateColumn(untilDay) },
    },
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      nextActionOn: true,
      nextActionKind: true,
      nextActionNote: true,
      ownerUserId: true,
      createdById: true,
    },
    orderBy: [{ nextActionOn: "asc" }, { id: "asc" }],
    take: limit,
  });
}
