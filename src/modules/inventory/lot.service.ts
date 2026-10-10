import { Prisma, type StockLotSource } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { nextDocumentNumber } from "@/lib/numbering";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { lotsQuerySchema } from "@/modules/inventory/schemas";

/*
 * Inward batches (lots)
 * ---------------------
 * Every batch of finished goods that comes in (opening stock, a delivery from
 * production) is one lot per style and warehouse, numbered LOT-2026-00001 by
 * itself: nobody types a lot number. The lot's pieces, grades and costs are the
 * stock movements that name it, so a lot never disagrees with the stock. An
 * undone delivery's movements name the same lot, which then shows as undone.
 * Costing stays weighted average; lots record what came in, at what cost.
 */

/**
 * Opens one lot per style for the SKUs coming in together, inside `tx`, and
 * returns each SKU's lot id for its movements.
 */
export async function openLots(
  tx: Db,
  ctx: CompanyContext,
  input: {
    variantIds: string[];
    warehouseId: string;
    source: StockLotSource;
    intakeId?: string;
  },
): Promise<Map<string, string>> {
  const variants = await tx.productVariant.findMany({
    where: { id: { in: [...new Set(input.variantIds)] }, companyId: ctx.company.id },
    select: { id: true, styleId: true },
  });
  const byStyle = new Map<string, string>();
  for (const styleId of [...new Set(variants.map((v) => v.styleId))].sort()) {
    const lot = await tx.stockLot.create({
      data: {
        companyId: ctx.company.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "STOCK_LOT"),
        styleId,
        warehouseId: input.warehouseId,
        source: input.source,
        intakeId: input.intakeId ?? null,
        createdById: ctx.user.id,
      },
    });
    byStyle.set(styleId, lot.id);
  }
  return new Map(variants.map((v) => [v.id, byStyle.get(v.styleId)!]));
}

/** A delivery's lots by SKU (for taking its pieces back out when it is undone). */
export async function lotsOfIntake(tx: Db, intakeId: string, variantIds: string[]) {
  const [lots, variants] = await Promise.all([
    tx.stockLot.findMany({ where: { intakeId }, select: { id: true, styleId: true } }),
    tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, styleId: true },
    }),
  ]);
  const byStyle = new Map(lots.map((l) => [l.styleId, l.id]));
  return new Map(variants.map((v) => [v.id, byStyle.get(v.styleId) ?? null]));
}

/** Average cost of the pieces given, or null when there are none. */
function averageCost(lines: Array<{ quantity: number; unitCost: Prisma.Decimal | null }>) {
  const pieces = lines.reduce((sum, l) => sum + l.quantity, 0);
  if (pieces === 0) return null;
  const value = lines.reduce(
    (sum, l) => sum.plus((l.unitCost ?? new Prisma.Decimal(0)).times(l.quantity)),
    new Prisma.Decimal(0),
  );
  return value.dividedBy(pieces);
}

/**
 * A style's inward batches, newest first (in one warehouse, or all): where each
 * came from (opening stock, or a delivery with its project and factory), the
 * fresh (A-grade) and B-grade pieces, and what they cost each. Costs follow the
 * financials rule; the project and factory come as links only to people who
 * may open them.
 */
export async function listLots(ctx: CompanyContext, raw: unknown) {
  const query = lotsQuerySchema.parse(raw);
  const take = query.take ?? 20;
  const rows = await ctx.db.stockLot.findMany({
    where: {
      styleId: query.styleId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    },
    include: {
      warehouse: { select: { id: true, name: true } },
      intake: {
        select: {
          id: true,
          number: true,
          reversedAt: true,
          project: {
            select: {
              id: true,
              code: true,
              factoryName: true,
              factory: { select: { id: true, name: true } },
            },
          },
        },
      },
      movements: {
        where: { quantity: { gt: 0 } },
        select: { grade: true, quantity: true, unitCost: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  // Costs follow the financials rule, as in the stock history.
  const shown = canSeeFinancials(ctx);
  const cost = (value: Prisma.Decimal | null) => (shown && value ? value.toFixed(2) : null);
  const seeProjects = ctx.can("production.view");
  const seeSuppliers = ctx.can("parties.view");
  return {
    items: page.map((lot) => {
      const fresh = lot.movements.filter((m) => m.grade === "A_GRADE");
      const bGrade = lot.movements.filter((m) => m.grade === "B_GRADE");
      const pieces = (lines: typeof fresh) => lines.reduce((sum, l) => sum + l.quantity, 0);
      const value = lot.movements.reduce(
        (sum, m) => sum.plus((m.unitCost ?? new Prisma.Decimal(0)).times(m.quantity)),
        new Prisma.Decimal(0),
      );
      const project = lot.intake?.project ?? null;
      const factory = project?.factory ?? null;
      return {
        id: lot.id,
        number: lot.number,
        source: lot.source,
        createdAt: lot.createdAt,
        warehouse: lot.warehouse,
        fresh: pieces(fresh),
        bGrade: pieces(bGrade),
        /** What one piece cost, per grade (null when hidden or none came in). */
        unitCost: { fresh: cost(averageCost(fresh)), bGrade: cost(averageCost(bGrade)) },
        value: cost(value),
        /** The delivery was undone: its pieces went back out. */
        undone: Boolean(lot.intake?.reversedAt),
        delivery: lot.intake
          ? { id: seeProjects ? lot.intake.id : null, number: lot.intake.number }
          : null,
        project: project ? { id: seeProjects ? project.id : null, code: project.code } : null,
        supplier: factory
          ? { id: seeSuppliers ? factory.id : null, name: factory.name }
          : project?.factoryName
            ? { id: null, name: project.factoryName }
            : null,
      };
    }),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}

export type StockLotPage = Awaited<ReturnType<typeof listLots>>;
export type StockLotItem = StockLotPage["items"][number];
