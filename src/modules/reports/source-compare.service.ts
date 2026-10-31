import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { localDay } from "@/lib/dates";
import { PERIOD_PRESETS, resolvePeriod, type ResolvedPeriod } from "@/modules/accounts/periods";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { type SalesRange, topSellers } from "@/modules/dashboard/sales-figures";

/*
 * Production vs ready stock (2026-10-31)
 * --------------------------------------
 * For a period, what came into stock from the factories (production deliveries,
 * less those undone) and what was bought as ready stock (Business > Retail >
 * Shop stock), and what each of them sold: pieces, sales, cost of goods and
 * profit. Stock that came in as opening stock, or before batches were kept,
 * is "Opening and other stock".
 *
 * A sale does not say which batch its pieces came from (stock is costed at the
 * average), so a style that came both ways shares its sales by the pieces that
 * came in each way up to the period's end: a style with 600 pieces made and 400
 * bought puts 60% of its sales under Production and 40% under Ready stock.
 */

export const SOURCES = ["PRODUCTION", "READY_STOCK", "OTHER"] as const;
export type StockSource = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<StockSource, string> = {
  PRODUCTION: "Production",
  READY_STOCK: "Ready stock",
  OTHER: "Opening and other stock",
};

export type SourceFigures = {
  /** Pieces that came in during the period (less deliveries undone in it). */
  piecesIn: number;
  /** Their cost. */
  costIn: string;
  /** Pieces sold in the period, less those that came back in it. */
  piecesSold: number;
  sales: string;
  /** Cost of the goods sold. */
  cogs: string;
  profit: string;
  /** Profit out of sales, or null without sales. */
  profitPct: string | null;
};

export type StyleSourceRow = {
  styleId: string;
  styleCode: string;
  styleName: string;
  /** The style came in more than one way, so its sales are shared. */
  shared: boolean;
  /** "60% production, 40% ready stock" when shared. */
  shareNote: string | null;
  sources: Partial<Record<StockSource, SourceFigures>>;
};

export type SourceComparison = {
  from: string;
  to: string;
  totals: Record<StockSource, SourceFigures>;
  styles: StyleSourceRow[];
};

const ZERO = new Prisma.Decimal(0);

type Sums = {
  piecesIn: number;
  costIn: Prisma.Decimal;
  piecesSold: number;
  sales: Prisma.Decimal;
  cogs: Prisma.Decimal;
};

const empty = (): Sums => ({ piecesIn: 0, costIn: ZERO, piecesSold: 0, sales: ZERO, cogs: ZERO });

function add(a: Sums, b: Sums): Sums {
  return {
    piecesIn: a.piecesIn + b.piecesIn,
    costIn: a.costIn.plus(b.costIn),
    piecesSold: a.piecesSold + b.piecesSold,
    sales: a.sales.plus(b.sales),
    cogs: a.cogs.plus(b.cogs),
  };
}

function present(s: Sums): SourceFigures {
  const profit = s.sales.minus(s.cogs);
  return {
    piecesIn: s.piecesIn,
    costIn: s.costIn.toFixed(2),
    piecesSold: s.piecesSold,
    sales: s.sales.toFixed(2),
    cogs: s.cogs.toFixed(2),
    profit: profit.toFixed(2),
    profitPct: s.sales.gt(0) ? profit.dividedBy(s.sales).times(100).toFixed(1) : null,
  };
}

const LOT_SOURCE: Record<string, StockSource> = {
  PRODUCTION: "PRODUCTION",
  PURCHASE: "READY_STOCK",
  OPENING: "OTHER",
};

/** Splits a whole in proportion to the weights; the last one takes what rounding leaves. */
function shareOut(whole: Prisma.Decimal, weights: number[], places: number): Prisma.Decimal[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = ZERO;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return whole.minus(given);
    const part = whole
      .times(w)
      .dividedBy(sum)
      .toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);
    given = given.plus(part);
    return part;
  });
}

/**
 * The comparison for a period. Shows costs and profit, so it needs the
 * financials (dashboard.financials or accounts.view).
 */
export async function productionVsReadyStock(
  ctx: CompanyContext,
  period: Pick<ResolvedPeriod, "from" | "to" | "start" | "end">,
): Promise<SourceComparison> {
  if (!canSeeFinancials(ctx)) {
    throw new AppError("FORBIDDEN", "Costs and profit are not part of your role.");
  }
  const companyId = ctx.company.id;
  const range: SalesRange = { start: period.start, end: period.end };

  // What came in per style and way: in the period, and ever up to its end (for the shares).
  const inbound = await prisma.$queryRaw<
    Array<{
      styleId: string;
      source: string;
      piecesIn: bigint | null;
      costIn: Prisma.Decimal | null;
      everIn: bigint | null;
    }>
  >`
    SELECT x."styleId", x.source,
           SUM(x.quantity) FILTER (WHERE x.at >= ${range.start})::bigint AS "piecesIn",
           SUM(x.quantity * x."unitCost") FILTER (WHERE x.at >= ${range.start}) AS "costIn",
           SUM(x.quantity)::bigint AS "everIn"
    FROM (
      -- Ready stock counts on its purchase date (as its bill does), the rest when it came in.
      SELECT pv."styleId", l.source::text AS source, m.quantity,
             COALESCE(m."unitCost", 0) AS "unitCost",
             COALESCE(rsp."purchaseDate", m."createdAt") AS at
      FROM "StockMovement" m
      JOIN "StockLot" l ON l.id = m."lotId"
      JOIN "ProductVariant" pv ON pv.id = m."variantId"
      LEFT JOIN "ReadyStockPurchase" rsp
        ON m.type = 'PURCHASE_IN' AND m."referenceType" = 'ReadyStockPurchase'
       AND rsp.id = m."referenceId"
      WHERE m."companyId" = ${companyId}
        AND m.type IN ('OPENING', 'PRODUCTION_IN', 'PRODUCTION_REVERSAL', 'PURCHASE_IN')
    ) x
    WHERE x.at < ${range.end}
    GROUP BY 1, 2`;

  const sold = await topSellers(companyId, range, {
    groupBy: "STYLE",
    sortBy: "QUANTITY",
    limit: 100_000,
  });

  type StyleIn = Map<StockSource, { piecesIn: number; costIn: Prisma.Decimal; everIn: number }>;
  const byStyle = new Map<string, StyleIn>();
  for (const r of inbound) {
    const source = LOT_SOURCE[r.source] ?? "OTHER";
    const style = byStyle.get(r.styleId) ?? new Map();
    const was = style.get(source) ?? { piecesIn: 0, costIn: ZERO, everIn: 0 };
    style.set(source, {
      piecesIn: was.piecesIn + Number(r.piecesIn ?? 0),
      costIn: was.costIn.plus(r.costIn ?? 0),
      everIn: was.everIn + Number(r.everIn ?? 0),
    });
    byStyle.set(r.styleId, style);
  }

  const soldById = new Map(sold.items.map((s) => [s.id, s]));
  const ids = [...new Set([...byStyle.keys(), ...soldById.keys()])];
  const names = new Map(
    (
      await ctx.db.style.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, name: true },
      })
    ).map((s) => [s.id, s]),
  );

  const totals = Object.fromEntries(SOURCES.map((s) => [s, empty()])) as Record<StockSource, Sums>;
  const styles: StyleSourceRow[] = [];
  for (const styleId of ids) {
    const style = names.get(styleId);
    if (!style) continue;
    const came = byStyle.get(styleId) ?? new Map();
    const sale = soldById.get(styleId);
    const sums = new Map<StockSource, Sums>();
    for (const [source, c] of came) {
      sums.set(source, { ...empty(), piecesIn: c.piecesIn, costIn: c.costIn });
    }

    if (sale && (sale.pieces !== 0 || !sale.net.isZero())) {
      // Shares by the pieces that came in each way; none known: opening and other stock.
      const ways = SOURCES.filter((s) => (came.get(s)?.everIn ?? 0) > 0);
      const weights = ways.map((s) => came.get(s)!.everIn);
      const into = ways.length > 0 ? ways : (["OTHER"] as StockSource[]);
      const w = ways.length > 0 ? weights : [1];
      const pieces = shareOut(new Prisma.Decimal(sale.pieces), w, 0);
      const sales = shareOut(sale.net, w, 2);
      const cogs = shareOut(sale.cost, w, 2);
      into.forEach((source, i) => {
        const was = sums.get(source) ?? empty();
        sums.set(source, {
          ...was,
          piecesSold: pieces[i]!.toNumber(),
          sales: sales[i]!,
          cogs: cogs[i]!,
        });
      });
    }
    if (sums.size === 0) continue;
    const active = [...sums.entries()].filter(
      ([, s]) => s.piecesIn !== 0 || s.piecesSold !== 0 || !s.sales.isZero(),
    );
    if (active.length === 0) continue;

    const ways = SOURCES.filter((s) => (came.get(s)?.everIn ?? 0) > 0);
    const everAll = ways.reduce((a, s) => a + came.get(s)!.everIn, 0);
    const shared = ways.length > 1 && Boolean(sale);
    styles.push({
      styleId,
      styleCode: style.code,
      styleName: style.name,
      shared,
      shareNote: shared
        ? ways
            .map(
              (s) =>
                `${Math.round((came.get(s)!.everIn / everAll) * 100)}% ${SOURCE_LABELS[s].toLowerCase()}`,
            )
            .join(", ")
        : null,
      sources: Object.fromEntries(active.map(([s, v]) => [s, present(v)])),
    });
    for (const [s, v] of active) totals[s] = add(totals[s], v);
  }

  styles.sort(
    (a, b) => Number(sumSales(b)) - Number(sumSales(a)) || a.styleCode.localeCompare(b.styleCode),
  );
  return {
    from: period.from,
    to: period.to,
    totals: Object.fromEntries(SOURCES.map((s) => [s, present(totals[s])])) as Record<
      StockSource,
      SourceFigures
    >,
    styles,
  };
}

function sumSales(row: StyleSourceRow) {
  return Object.values(row.sources).reduce((a, f) => a + Number(f.sales), 0);
}

const screenQuery = z.object({
  period: z.enum(PERIOD_PRESETS).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** The on-screen report (Reports > Production vs ready stock), the past month unless asked. */
export async function productionVsReadyScreen(ctx: CompanyContext, raw: unknown) {
  const query = screenQuery.parse(raw ?? {});
  const period = resolvePeriod(
    { period: query.from || query.to ? undefined : (query.period ?? "ONE_MONTH"), ...query },
    ctx.company,
  );
  return {
    period: { key: period.period, from: period.from, to: period.to },
    today: localDay(new Date(), ctx.company.timezone),
    currency: ctx.company.currency,
    /** May make the PDF or Excel file in the Report Builder. */
    canDownload: ctx.can("reports.export"),
    report: await productionVsReadyStock(ctx, period),
  };
}

export type ProductionVsReadyScreen = Awaited<ReturnType<typeof productionVsReadyScreen>>;
