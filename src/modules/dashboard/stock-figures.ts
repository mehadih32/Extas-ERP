import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ZERO } from "@/modules/accounts/balances";

/*
 * Finished-goods stock alerts for the dashboard and the Report Builder, per
 * active SKU of an active style, summed across warehouses:
 *
 *   on hand     A-grade + B-grade pieces
 *   available   A-grade pieces less those reserved for open orders (sellable)
 *
 *   Low stock   available below the company's threshold (5 by default), for
 *               SKUs that have been stocked before (a matrix cell never made
 *               is not "low"). Out-of-stock SKUs that sell come first.
 *   Highest     the SKUs holding the most pieces.
 *   Dead        had sellable stock `slowDays` ago and sold nothing since.
 *   Slow        had stock `slowDays` ago and sells, but at that pace the pieces
 *               available now last longer than `coverDays`.
 *
 * SKUs that arrived (or came back in stock) within the window are not judged
 * yet. Sales are counted as in sales-figures.ts (invoices that are not void).
 */

export type StockWindow = {
  /** Start of the slow-stock window: stock held then and sales since. */
  cutoff: Date;
  /** Start of the "sold recently" window shown next to low stock. */
  recentSince: Date;
  slowDays: number;
  coverDays: number;
};

export type SkuStock = {
  variantId: string;
  sku: string;
  styleCode: string;
  styleName: string;
  colorName: string;
  sizeName: string;
  aGrade: number;
  bGrade: number;
  onHand: number;
  reserved: number;
  available: number;
  avgCost: Prisma.Decimal;
  /** Sellable pieces at their average cost. */
  availableValue: Prisma.Decimal;
  soldInWindow: number;
  soldRecently: number;
  lastSoldAt: Date | null;
};

type PositionRow = Omit<SkuStock, "avgCost" | "availableValue"> & {
  avgCost: Prisma.Decimal;
  availableValue: Prisma.Decimal;
};

/**
 * One row per active SKU with its stock now and, when asked for, its stock at
 * the cutoff (`history`, a pass over the stock movements) and its sales.
 */
function positions(
  companyId: string,
  w: StockWindow,
  needs: { history?: boolean; sales?: boolean } = {},
) {
  const held = needs.history
    ? Prisma.sql`
      SELECT m."variantId", SUM(m.quantity) AS "atCutoff"
      FROM "StockMovement" m
      WHERE m."companyId" = ${companyId} AND m.grade = 'A_GRADE' AND m."createdAt" < ${w.cutoff}
      GROUP BY m."variantId"`
    : Prisma.sql`SELECT NULL::text AS "variantId", NULL::bigint AS "atCutoff" WHERE false`;
  const sold = needs.sales
    ? Prisma.sql`
      SELECT soi."variantId",
             SUM(soi.quantity) FILTER (WHERE inv."issueDate" >= ${w.cutoff}) AS "inWindow",
             SUM(soi.quantity) FILTER (WHERE inv."issueDate" >= ${w.recentSince}) AS recently,
             MAX(inv."issueDate") AS "lastSoldAt"
      FROM "Invoice" inv
      JOIN "SalesOrder" so ON so.id = inv."orderId"
      JOIN "SalesOrderItem" soi ON soi."orderId" = so.id
      WHERE inv."companyId" = ${companyId} AND inv.status <> 'VOID' AND so.status <> 'CANCELLED'
      GROUP BY soi."variantId"`
    : Prisma.sql`
      SELECT NULL::text AS "variantId", NULL::bigint AS "inWindow", NULL::bigint AS recently,
             NULL::timestamp AS "lastSoldAt"
      WHERE false`;
  return Prisma.sql`
    WITH bal AS (
      SELECT sb."variantId",
             SUM(sb.quantity) FILTER (WHERE sb.grade = 'A_GRADE') AS "aGrade",
             SUM(sb.quantity) FILTER (WHERE sb.grade = 'B_GRADE') AS "bGrade",
             SUM(sb.reserved) FILTER (WHERE sb.grade = 'A_GRADE') AS reserved
      FROM "StockBalance" sb
      WHERE sb."companyId" = ${companyId}
      GROUP BY sb."variantId"
    ),
    held AS (${held}),
    sold AS (${sold})
    SELECT pv.id AS "variantId", pv.sku, st.code AS "styleCode", st.name AS "styleName",
           c.name AS "colorName", z.name AS "sizeName", pv."avgCost",
           COALESCE(bal."aGrade", 0)::int AS "aGrade",
           COALESCE(bal."bGrade", 0)::int AS "bGrade",
           (COALESCE(bal."aGrade", 0) + COALESCE(bal."bGrade", 0))::int AS "onHand",
           COALESCE(bal.reserved, 0)::int AS reserved,
           (COALESCE(bal."aGrade", 0) - COALESCE(bal.reserved, 0))::int AS available,
           ((COALESCE(bal."aGrade", 0) - COALESCE(bal.reserved, 0)) * pv."avgCost")::numeric(16, 2)
             AS "availableValue",
           bal."variantId" IS NOT NULL AS stocked,
           COALESCE(held."atCutoff", 0)::int AS "atCutoff",
           COALESCE(sold."inWindow", 0)::int AS "soldInWindow",
           COALESCE(sold.recently, 0)::int AS "soldRecently",
           sold."lastSoldAt",
           CASE
             WHEN COALESCE(bal."aGrade", 0) - COALESCE(bal.reserved, 0) <= 0
               OR COALESCE(held."atCutoff", 0) <= 0 THEN NULL
             WHEN COALESCE(sold."inWindow", 0) = 0 THEN 'DEAD'
             WHEN (COALESCE(bal."aGrade", 0) - COALESCE(bal.reserved, 0))::numeric * ${w.slowDays}
                  / sold."inWindow" > ${w.coverDays} THEN 'SLOW'
           END AS movement,
           CASE WHEN COALESCE(sold."inWindow", 0) > 0
             THEN ROUND((COALESCE(bal."aGrade", 0) - COALESCE(bal.reserved, 0))::numeric * ${w.slowDays}
                        / sold."inWindow")::int
           END AS "daysOfCover"
    FROM "ProductVariant" pv
    JOIN "Style" st ON st.id = pv."styleId"
    JOIN "Color" c ON c.id = pv."colorId"
    JOIN "Size" z ON z.id = pv."sizeId"
    LEFT JOIN bal ON bal."variantId" = pv.id
    LEFT JOIN held ON held."variantId" = pv.id
    LEFT JOIN sold ON sold."variantId" = pv.id
    WHERE pv."companyId" = ${companyId} AND pv."isActive" AND st."isActive"`;
}

function toSku(r: PositionRow): SkuStock {
  return {
    variantId: r.variantId,
    sku: r.sku,
    styleCode: r.styleCode,
    styleName: r.styleName,
    colorName: r.colorName,
    sizeName: r.sizeName,
    aGrade: r.aGrade,
    bGrade: r.bGrade,
    onHand: r.onHand,
    reserved: r.reserved,
    available: r.available,
    avgCost: new Prisma.Decimal(r.avgCost),
    availableValue: new Prisma.Decimal(r.availableValue),
    soldInWindow: r.soldInWindow,
    soldRecently: r.soldRecently,
    lastSoldAt: r.lastSoldAt,
  };
}

export type LowStock = { total: number; outOfStock: number; items: SkuStock[] };

/** SKUs below the threshold: out of stock first, then the ones selling fastest. */
export async function lowStock(
  companyId: string,
  w: StockWindow,
  threshold: number,
  limit: number,
): Promise<LowStock> {
  const rows = await prisma.$queryRaw<Array<PositionRow & { total: number; outOfStock: number }>>`
    SELECT p.*, (COUNT(*) OVER ())::int AS total,
           (COUNT(*) FILTER (WHERE p.available <= 0) OVER ())::int AS "outOfStock"
    FROM (${positions(companyId, w, { sales: true })}) p
    WHERE p.stocked AND p.available < ${threshold}
    ORDER BY (p.available <= 0) DESC, p."soldRecently" DESC, p.available, p.sku
    LIMIT ${limit}`;
  return {
    total: rows[0]?.total ?? 0,
    outOfStock: rows[0]?.outOfStock ?? 0,
    items: rows.map(toSku),
  };
}

/** The SKUs holding the most pieces (A and B grade). */
export async function highestStock(
  companyId: string,
  w: StockWindow,
  limit: number,
): Promise<SkuStock[]> {
  const rows = await prisma.$queryRaw<PositionRow[]>`
    SELECT p.* FROM (${positions(companyId, w)}) p
    WHERE p."onHand" > 0
    ORDER BY p."onHand" DESC, p.sku
    LIMIT ${limit}`;
  return rows.map(toSku);
}

export type Movement = "DEAD" | "SLOW";

export type SlowSku = SkuStock & {
  movement: Movement;
  /** Days the available pieces last at the window's selling pace (null: no sales). */
  daysOfCover: number | null;
};

type Group = { skus: number; pieces: number; value: Prisma.Decimal };

export type DeadAndSlow = { dead: Group; slow: Group; items: SlowSku[] };

/** Dead stock (largest first), then slow stock (longest cover first). */
export async function deadAndSlowStock(
  companyId: string,
  w: StockWindow,
  limit: number,
): Promise<DeadAndSlow> {
  const rows = await prisma.$queryRaw<
    Array<
      PositionRow & {
        movement: Movement;
        daysOfCover: number | null;
        deadSkus: number;
        deadPieces: bigint | null;
        deadValue: Prisma.Decimal | null;
        slowSkus: number;
        slowPieces: bigint | null;
        slowValue: Prisma.Decimal | null;
      }
    >
  >`
    SELECT p.*,
           (COUNT(*) FILTER (WHERE p.movement = 'DEAD') OVER ())::int AS "deadSkus",
           (SUM(p.available) FILTER (WHERE p.movement = 'DEAD') OVER ())::bigint AS "deadPieces",
           SUM(p."availableValue") FILTER (WHERE p.movement = 'DEAD') OVER () AS "deadValue",
           (COUNT(*) FILTER (WHERE p.movement = 'SLOW') OVER ())::int AS "slowSkus",
           (SUM(p.available) FILTER (WHERE p.movement = 'SLOW') OVER ())::bigint AS "slowPieces",
           SUM(p."availableValue") FILTER (WHERE p.movement = 'SLOW') OVER () AS "slowValue"
    FROM (${positions(companyId, w, { history: true, sales: true })}) p
    WHERE p.movement IS NOT NULL
    ORDER BY (p.movement = 'DEAD') DESC, p."daysOfCover" DESC NULLS FIRST, p.available DESC, p.sku
    LIMIT ${limit}`;
  const first = rows[0];
  const group = (skus?: number, pieces?: bigint | null, value?: Prisma.Decimal | null) => ({
    skus: skus ?? 0,
    pieces: Number(pieces ?? 0),
    value: new Prisma.Decimal(value ?? ZERO),
  });
  return {
    dead: group(first?.deadSkus, first?.deadPieces, first?.deadValue),
    slow: group(first?.slowSkus, first?.slowPieces, first?.slowValue),
    items: rows.map((r) => ({ ...toSku(r), movement: r.movement, daysOfCover: r.daysOfCover })),
  };
}

export type StockOnHand = {
  aGradePieces: number;
  bGradePieces: number;
  aGradeValue: Prisma.Decimal;
  bGradeValue: Prisma.Decimal;
};

/** Pieces and value on hand by grade, at each SKU's average cost for the grade (all SKUs). */
export async function stockOnHand(companyId: string): Promise<StockOnHand> {
  const [row] = await prisma.$queryRaw<
    Array<{
      aPieces: bigint | null;
      bPieces: bigint | null;
      aValue: Prisma.Decimal | null;
      bValue: Prisma.Decimal | null;
    }>
  >`
    SELECT (SUM(sb.quantity) FILTER (WHERE sb.grade = 'A_GRADE'))::bigint AS "aPieces",
           (SUM(sb.quantity) FILTER (WHERE sb.grade = 'B_GRADE'))::bigint AS "bPieces",
           SUM(sb.quantity * pv."avgCost") FILTER (WHERE sb.grade = 'A_GRADE') AS "aValue",
           SUM(sb.quantity * pv."bGradeAvgCost") FILTER (WHERE sb.grade = 'B_GRADE') AS "bValue"
    FROM "StockBalance" sb
    JOIN "ProductVariant" pv ON pv.id = sb."variantId"
    WHERE sb."companyId" = ${companyId}`;
  return {
    aGradePieces: Number(row?.aPieces ?? 0),
    bGradePieces: Number(row?.bPieces ?? 0),
    aGradeValue: new Prisma.Decimal(row?.aValue ?? 0),
    bGradeValue: new Prisma.Decimal(row?.bValue ?? 0),
  };
}
