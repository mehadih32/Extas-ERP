import type {
  MeasurementUnit,
  Prisma,
  RawMaterialKind,
  RawMaterialMovementType,
} from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { ZERO } from "@/modules/materials/valuation";

/** The stock card lines that charge a production project for materials. */
export const PROJECT_MATERIAL_MOVES: RawMaterialMovementType[] = [
  "ISSUE_TO_PRODUCTION",
  "RETURN_FROM_PRODUCTION",
];

export type ProjectMaterialUsage = {
  material: {
    id: string;
    code: string;
    name: string;
    kind: RawMaterialKind;
    unit: MeasurementUnit;
  };
  issuedQuantity: Prisma.Decimal;
  returnedQuantity: Prisma.Decimal;
  /** Still with the project (issued less returned). */
  netQuantity: Prisma.Decimal;
  issuedValue: Prisma.Decimal;
  returnedValue: Prisma.Decimal;
  /** What the project is charged for it. */
  netValue: Prisma.Decimal;
};

/** Materials a project received from the store and gave back, per material. */
export async function projectMaterialUsage(
  db: Db,
  companyId: string,
  projectId: string,
): Promise<ProjectMaterialUsage[]> {
  const rows = await db.rawMaterialMovement.groupBy({
    by: ["rawMaterialId", "type"],
    where: { companyId, productionProjectId: projectId, type: { in: PROJECT_MATERIAL_MOVES } },
    _sum: { quantity: true, value: true },
  });
  if (rows.length === 0) return [];
  const materials = await db.rawMaterial.findMany({
    where: { companyId, id: { in: [...new Set(rows.map((r) => r.rawMaterialId))] } },
    select: { id: true, code: true, name: true, kind: true, unit: true },
  });
  const usage = new Map<string, ProjectMaterialUsage>(
    materials.map((m) => [
      m.id,
      {
        material: m,
        issuedQuantity: ZERO,
        returnedQuantity: ZERO,
        netQuantity: ZERO,
        issuedValue: ZERO,
        returnedValue: ZERO,
        netValue: ZERO,
      },
    ]),
  );
  for (const row of rows) {
    const u = usage.get(row.rawMaterialId)!;
    const quantity = row._sum.quantity ?? ZERO;
    const value = row._sum.value ?? ZERO;
    if (row.type === "ISSUE_TO_PRODUCTION") {
      // Issues leave the store: negative on the stock card.
      u.issuedQuantity = ZERO.minus(quantity);
      u.issuedValue = ZERO.minus(value);
    } else {
      u.returnedQuantity = quantity;
      u.returnedValue = value;
    }
  }
  for (const u of usage.values()) {
    u.netQuantity = u.issuedQuantity.minus(u.returnedQuantity);
    u.netValue = u.issuedValue.minus(u.returnedValue);
  }
  return [...usage.values()].sort((a, b) => a.material.code.localeCompare(b.material.code));
}
