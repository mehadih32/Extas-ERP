import { Prisma, type SalesChannel } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ZERO } from "@/modules/accounts/balances";

/*
 * Sales figures for the dashboard and the Report Builder, from the sales
 * documents. A sale counts on its invoice's issue date; void invoices and
 * cancelled orders never count. Amounts are the goods' value after line and
 * order discounts, without delivery charges or VAT: the same amount the invoice
 * posts to the Sales account, so these figures add up to the books when no
 * invoice from the period was voided later.
 *
 * Per product, an order discount is shared across the order's lines in
 * proportion to their value, to the paisa: the shares are rounded down and the
 * paisa left over go to the lines with the largest remainders, so the lines of
 * an order always add up to the order.
 */

/** Half-open [start, end) on the invoice issue date. */
export type SalesRange = { start: Date; end: Date };

export type SalesTotals = { orders: number; pieces: number; net: Prisma.Decimal };

/** Orders whose live invoice was issued in the range, with their net goods value. */
function invoicedOrders(companyId: string, range: SalesRange) {
  return Prisma.sql`
    SELECT so.id, so.channel, so.subtotal - so.discount AS net, inv."issueDate",
           (SELECT COALESCE(SUM(i.quantity), 0) FROM "SalesOrderItem" i WHERE i."orderId" = so.id) AS pieces
    FROM "Invoice" inv
    JOIN "SalesOrder" so ON so.id = inv."orderId"
    WHERE inv."companyId" = ${companyId}
      AND inv.status <> 'VOID' AND so.status <> 'CANCELLED'
      AND inv."issueDate" >= ${range.start} AND inv."issueDate" < ${range.end}`;
}

/** Invoices, pieces and net sales in the range. */
export async function salesTotals(companyId: string, range: SalesRange): Promise<SalesTotals> {
  const [row] = await prisma.$queryRaw<
    Array<{ orders: number; pieces: bigint | null; net: Prisma.Decimal | null }>
  >`
    SELECT COUNT(*)::int AS orders, SUM(o.pieces)::bigint AS pieces, SUM(o.net) AS net
    FROM (${invoicedOrders(companyId, range)}) o`;
  return {
    orders: row?.orders ?? 0,
    pieces: Number(row?.pieces ?? 0),
    net: new Prisma.Decimal(row?.net ?? 0),
  };
}

export type SalesBucket = SalesTotals & { bucket: string };

/**
 * Sales per local calendar day ("2026-09-01") or month ("2026-09"), only for
 * buckets that had sales; callers fill in the empty ones.
 */
export async function salesByBucket(
  companyId: string,
  range: SalesRange,
  timeZone: string,
  unit: "day" | "month",
): Promise<SalesBucket[]> {
  const format = unit === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  const rows = await prisma.$queryRaw<
    Array<{ bucket: string; orders: number; pieces: bigint; net: Prisma.Decimal }>
  >`
    SELECT to_char((o."issueDate" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, ${format}) AS bucket,
           COUNT(*)::int AS orders, SUM(o.pieces)::bigint AS pieces, SUM(o.net) AS net
    FROM (${invoicedOrders(companyId, range)}) o
    GROUP BY 1
    ORDER BY 1`;
  return rows.map((r) => ({
    bucket: r.bucket,
    orders: r.orders,
    pieces: Number(r.pieces),
    net: new Prisma.Decimal(r.net),
  }));
}

export type ChannelSales = SalesTotals & { channel: SalesChannel };

/** Sales per channel (POS, website, social commerce, wholesale, B2B pre-order). */
export async function salesByChannel(
  companyId: string,
  range: SalesRange,
): Promise<ChannelSales[]> {
  const rows = await prisma.$queryRaw<
    Array<{ channel: SalesChannel; orders: number; pieces: bigint; net: Prisma.Decimal }>
  >`
    SELECT o.channel, COUNT(*)::int AS orders, SUM(o.pieces)::bigint AS pieces, SUM(o.net) AS net
    FROM (${invoicedOrders(companyId, range)}) o
    GROUP BY o.channel
    ORDER BY SUM(o.net) DESC, o.channel`;
  return rows.map((r) => ({
    channel: r.channel,
    orders: r.orders,
    pieces: Number(r.pieces),
    net: new Prisma.Decimal(r.net),
  }));
}

/**
 * Every invoiced line in the range with its share of the order's net value, in
 * paisa-exact amounts, and its cost: the cost recorded when it was delivered,
 * or the SKU's average cost for lines not delivered yet.
 */
function soldLines(companyId: string, range: SalesRange) {
  return Prisma.sql`
    WITH lines AS (
      SELECT soi.id, soi."orderId", soi."variantId", pv."styleId", soi.quantity, soi."lineTotal",
             COALESCE(soi."unitCost", pv."avgCost") AS "unitCost",
             so.subtotal, so.subtotal - so.discount AS "orderNet"
      FROM "Invoice" inv
      JOIN "SalesOrder" so ON so.id = inv."orderId"
      JOIN "SalesOrderItem" soi ON soi."orderId" = so.id
      JOIN "ProductVariant" pv ON pv.id = soi."variantId"
      WHERE inv."companyId" = ${companyId}
        AND inv.status <> 'VOID' AND so.status <> 'CANCELLED'
        AND inv."issueDate" >= ${range.start} AND inv."issueDate" < ${range.end}
    ),
    shares AS (
      -- In whole paisa: line x order net / order subtotal, split into the rounded-down
      -- share and the remainder (exact integer arithmetic, no rounding drift).
      SELECT l.*,
             CASE WHEN l.subtotal = 0 THEN 0
                  ELSE div(l."lineTotal" * 100 * l."orderNet" * 100, l.subtotal * 100) END AS base,
             CASE WHEN l.subtotal = 0 THEN 0
                  ELSE mod(l."lineTotal" * 100 * l."orderNet" * 100, l.subtotal * 100) END AS remainder
      FROM lines l
    ),
    alloc AS (
      SELECT s.*,
             s."orderNet" * 100 - SUM(s.base) OVER (PARTITION BY s."orderId") AS leftover,
             ROW_NUMBER() OVER (PARTITION BY s."orderId" ORDER BY s.remainder DESC, s.id) AS rn
      FROM shares s
    )
    SELECT a."orderId", a."variantId", a."styleId", a.quantity,
           ((a.base + CASE WHEN a.rn <= a.leftover THEN 1 ELSE 0 END) / 100)::numeric(14, 2) AS net,
           a.quantity * a."unitCost" AS cost
    FROM alloc a`;
}

export type TopSellerOptions = {
  groupBy: "SKU" | "STYLE";
  sortBy: "QUANTITY" | "REVENUE";
  limit: number;
};

type GroupRow = {
  key: string;
  pieces: bigint;
  orders: number;
  skus: number;
  net: Prisma.Decimal;
  cost: Prisma.Decimal;
  available: bigint | null;
  sku: string | null;
  styleCode: string;
  styleName: string;
  colorName: string | null;
  sizeName: string | null;
  groupCount: number;
  totalPieces: Prisma.Decimal;
  totalNet: Prisma.Decimal;
  totalCost: Prisma.Decimal;
};

export type TopSeller = {
  /** The SKU (variant) id, or the style id when grouped by style. */
  id: string;
  sku: string | null;
  styleCode: string;
  styleName: string;
  colorName: string | null;
  sizeName: string | null;
  pieces: number;
  orders: number;
  /** SKUs of the style that sold (1 when grouped by SKU). */
  skus: number;
  net: Prisma.Decimal;
  cost: Prisma.Decimal;
  /** Sellable pieces now: A-grade on hand less pieces reserved for open orders. */
  available: number;
};

export type TopSellers = {
  items: TopSeller[];
  /** Over everything sold in the range, not only the rows returned. */
  totals: { groups: number; pieces: number; net: Prisma.Decimal; cost: Prisma.Decimal };
};

/** Best sellers in the range by pieces or by sales value, per SKU or per style. */
export async function topSellers(
  companyId: string,
  range: SalesRange,
  options: TopSellerOptions,
): Promise<TopSellers> {
  const bySku = options.groupBy === "SKU";
  const key = bySku ? Prisma.sql`s."variantId"` : Prisma.sql`s."styleId"`;
  const order =
    options.sortBy === "REVENUE"
      ? Prisma.sql`g.net DESC, g.pieces DESC`
      : Prisma.sql`g.pieces DESC, g.net DESC`;
  // Sellable stock now, per SKU or per style.
  const stockKey = bySku ? Prisma.sql`sb."variantId"` : Prisma.sql`pv."styleId"`;
  const stock = Prisma.sql`
    SELECT ${stockKey} AS key, SUM(sb.quantity - sb.reserved) AS available
    FROM "StockBalance" sb
    JOIN "ProductVariant" pv ON pv.id = sb."variantId"
    WHERE sb."companyId" = ${companyId} AND sb.grade = 'A_GRADE'
    GROUP BY 1`;
  const details = bySku
    ? Prisma.sql`
        SELECT pv.id AS key, pv.sku, st.code AS "styleCode", st.name AS "styleName",
               c.name AS "colorName", z.name AS "sizeName"
        FROM "ProductVariant" pv
        JOIN "Style" st ON st.id = pv."styleId"
        JOIN "Color" c ON c.id = pv."colorId"
        JOIN "Size" z ON z.id = pv."sizeId"
        WHERE pv."companyId" = ${companyId}`
    : Prisma.sql`
        SELECT st.id AS key, NULL::text AS sku, st.code AS "styleCode", st.name AS "styleName",
               NULL::text AS "colorName", NULL::text AS "sizeName"
        FROM "Style" st
        WHERE st."companyId" = ${companyId}`;

  const rows = await prisma.$queryRaw<GroupRow[]>`
    SELECT g.key, g.pieces, g.orders, g.skus, g.net, g.cost, g."groupCount",
           g."totalPieces", g."totalNet", g."totalCost",
           stock.available::bigint AS available,
           d.sku, d."styleCode", d."styleName", d."colorName", d."sizeName"
    FROM (
      SELECT ${key} AS key, SUM(s.quantity)::bigint AS pieces,
             COUNT(DISTINCT s."orderId")::int AS orders, COUNT(DISTINCT s."variantId")::int AS skus,
             SUM(s.net) AS net, SUM(s.cost) AS cost,
             (COUNT(*) OVER ())::int AS "groupCount",
             SUM(SUM(s.quantity)) OVER () AS "totalPieces",
             SUM(SUM(s.net)) OVER () AS "totalNet",
             SUM(SUM(s.cost)) OVER () AS "totalCost"
      FROM (${soldLines(companyId, range)}) s
      GROUP BY 1
    ) g
    JOIN (${details}) d ON d.key = g.key
    LEFT JOIN (${stock}) stock ON stock.key = g.key
    ORDER BY ${order}, d."styleCode", d.sku NULLS FIRST
    LIMIT ${options.limit}`;

  const first = rows[0];
  return {
    items: rows.map((r) => ({
      id: r.key,
      sku: r.sku,
      styleCode: r.styleCode,
      styleName: r.styleName,
      colorName: r.colorName,
      sizeName: r.sizeName,
      pieces: Number(r.pieces),
      orders: r.orders,
      skus: r.skus,
      net: new Prisma.Decimal(r.net),
      cost: new Prisma.Decimal(r.cost),
      available: Number(r.available ?? 0),
    })),
    totals: first
      ? {
          groups: first.groupCount,
          pieces: new Prisma.Decimal(first.totalPieces).toNumber(),
          net: new Prisma.Decimal(first.totalNet),
          cost: new Prisma.Decimal(first.totalCost),
        }
      : { groups: 0, pieces: 0, net: ZERO, cost: ZERO },
  };
}
