import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";

/*
 * A saved final CM settlement stands on its styles' cutting reports, finishing
 * counts, mending returns and CM: while it stands (not undone), deleting those
 * reports or changing those styles' CM would leave the settlement, its PDF bill
 * and the deductions on the factory's Supplier Due on figures that are no longer
 * there. So they are refused, with the settlement to undo first: undoing it puts
 * its faults back and reverses its entry, and the batch can be settled again.
 */

/** The standing CM settlement a style is on. */
export type CmHold = { id: string; number: string; batchId: string; batchCode: string };

/** The standing (not undone) CM settlement each of these styles is on. */
export async function cmSettlementsHolding(
  db: Db,
  companyId: string,
  projectIds: readonly string[],
): Promise<Map<string, CmHold>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db.$queryRaw<
    Array<{ projectId: string; id: string; number: string; batchId: string; batchCode: string }>
  >`
    SELECT st->>'id' AS "projectId", s.id, s.number, s."batchId", b.code AS "batchCode"
    FROM "CmSettlement" s
    JOIN "ProductionBatch" b ON b.id = s."batchId"
    CROSS JOIN LATERAL jsonb_array_elements(s.snapshot->'styles') st
    WHERE s."companyId" = ${companyId} AND s."undoneAt" IS NULL
      AND st->>'id' = ANY(${[...projectIds]})
    ORDER BY s."createdAt" DESC`;
  const held = new Map<string, CmHold>();
  for (const r of rows) {
    if (!held.has(r.projectId)) {
      held.set(r.projectId, {
        id: r.id,
        number: r.number,
        batchId: r.batchId,
        batchCode: r.batchCode,
      });
    }
  }
  return held;
}

/** The standing CM settlement a style is on, if any. */
export async function cmSettlementHolding(db: Db, companyId: string, projectId: string) {
  return (await cmSettlementsHolding(db, companyId, [projectId])).get(projectId) ?? null;
}

/** "Undo the CM settlement first: ..." for a change the settlement stands on. */
export function cmHeldMessage(hold: CmHold, what: string) {
  return `Undo the CM settlement first: ${hold.number} for ${hold.batchCode} is saved on ${what}. Undo it on the batch's CM settlement, then try again.`;
}

/** Refuses a change to what a standing CM settlement is saved on. */
export async function assertNoCmSettlement(
  db: Db,
  companyId: string,
  projectId: string,
  what: string,
) {
  const hold = await cmSettlementHolding(db, companyId, projectId);
  if (hold) throw new AppError("CONFLICT", cmHeldMessage(hold, what));
}
