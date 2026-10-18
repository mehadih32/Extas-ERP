import { Prisma, type SalesChannel } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { WHOLESALE_CHANNELS } from "@/modules/sales/pricing";

/*
 * Sales figures for the dashboard and the Report Builder, from the sales
 * documents. A sale counts on its invoice's issue date; void invoices and
 * cancelled orders never count. A sales return (credit note) takes its pieces
 * and value off on the day the goods came back, in whichever period that is;
 * a void return never counts. Amounts are the goods' value after line and
 * order discounts, without delivery charges or VAT: the same amount the invoice
 * posts to the Sales account and the return takes back off it, so these
 * figures add up to the books when no invoice or return from the period was
 * voided later.
 *
 * Per product, an order discount is shared across the order's lines in
 * proportion to their value, to the paisa: the shares are rounded down and the
 * paisa left over go to the lines with the largest remainders, so the lines of
 * an order always add up to the order. A return's discount share is split
 * across its lines the same way.
 */

/** Half-open [start, end) on the invoice issue date (and the return date). */
export type SalesRange = { start: Date; end: Date };

export type SalesTotals = { orders: number; pieces: number; net: Prisma.Decimal };

/** A live invoice's order or a sales return that stands: orders, credit notes on them, or both. */
const liveSale = Prisma.sql`inv.status <> 'VOID' AND so.status <> 'CANCELLED'`;

/**
 * What changed sales in the range: each order whose live invoice was issued in
 * it (one invoice, its pieces and net goods value), and each sales return not
 * void that came back in it (no invoice, its pieces and value taken off).
 */
function salesEvents(companyId: string, range: SalesRange) {
  return Prisma.sql`
    SELECT so.id, so.channel, so."partyId", 1 AS invoices, so.subtotal - so.discount AS net,
           inv."issueDate" AS "soldAt",
           (SELECT COALESCE(SUM(i.quantity), 0) FROM "SalesOrderItem" i WHERE i."orderId" = so.id) AS pieces
    FROM "Invoice" inv
    JOIN "SalesOrder" so ON so.id = inv."orderId"
    WHERE inv."companyId" = ${companyId} AND ${liveSale}
      AND inv."issueDate" >= ${range.start} AND inv."issueDate" < ${range.end}
    UNION ALL
    SELECT so.id, so.channel, so."partyId", 0 AS invoices, r.discount - r."goodsValue" AS net,
           r."receivedAt" AS "soldAt",
           -(SELECT COALESCE(SUM(ri.quantity), 0) FROM "SalesReturnItem" ri WHERE ri."returnId" = r.id) AS pieces
    FROM "SalesReturn" r
    JOIN "Invoice" inv ON inv.id = r."invoiceId"
    JOIN "SalesOrder" so ON so.id = r."orderId"
    WHERE r."companyId" = ${companyId} AND r."voidedAt" IS NULL AND ${liveSale}
      AND r."receivedAt" >= ${range.start} AND r."receivedAt" < ${range.end}`;
}

export type SalesReturnTotals = { returns: number; pieces: number; net: Prisma.Decimal };

/** Sales returns (not void) that came back in the range: count, pieces and the sales they took off. */
export async function salesReturnTotals(
  companyId: string,
  range: SalesRange,
): Promise<SalesReturnTotals> {
  const [row] = await prisma.$queryRaw<
    Array<{ returns: number; pieces: bigint | null; net: Prisma.Decimal | null }>
  >`
    SELECT COUNT(*)::int AS returns, SUM(-o.pieces)::bigint AS pieces, SUM(-o.net) AS net
    FROM (${salesEvents(companyId, range)}) o
    WHERE o.invoices = 0`;
  return {
    returns: row?.returns ?? 0,
    pieces: Number(row?.pieces ?? 0),
    net: new Prisma.Decimal(row?.net ?? 0),
  };
}

/** Invoices issued, and pieces and net sales less returns, in the range. */
export async function salesTotals(companyId: string, range: SalesRange): Promise<SalesTotals> {
  const [row] = await prisma.$queryRaw<
    Array<{ orders: number | null; pieces: bigint | null; net: Prisma.Decimal | null }>
  >`
    SELECT SUM(o.invoices)::int AS orders, SUM(o.pieces)::bigint AS pieces, SUM(o.net) AS net
    FROM (${salesEvents(companyId, range)}) o`;
  return {
    orders: row?.orders ?? 0,
    pieces: Number(row?.pieces ?? 0),
    net: new Prisma.Decimal(row?.net ?? 0),
  };
}

export type SalesBucket = SalesTotals & { bucket: string };

/**
 * Sales per local calendar day ("2026-09-01") or month ("2026-09"), only for
 * buckets that had sales or returns; callers fill in the empty ones.
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
    SELECT to_char((o."soldAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, ${format}) AS bucket,
           SUM(o.invoices)::int AS orders, SUM(o.pieces)::bigint AS pieces, SUM(o.net) AS net
    FROM (${salesEvents(companyId, range)}) o
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
    SELECT o.channel, SUM(o.invoices)::int AS orders, SUM(o.pieces)::bigint AS pieces, SUM(o.net) AS net
    FROM (${salesEvents(companyId, range)}) o
    GROUP BY o.channel
    ORDER BY SUM(o.net) DESC, o.channel`;
  return rows.map((r) => ({
    channel: r.channel,
    orders: r.orders,
    pieces: Number(r.pieces),
    net: new Prisma.Decimal(r.net),
  }));
}

/** One buyer's sales: their account's orders, or Walk-in customers' (orders with no buyer). */
export type BuyerFilter = { partyId: string | null };

/** One style's sales: the orders with any of its SKUs (other lines are dropped after). */
type StyleFilter = { styleId: string };

function scopeCondition(scope?: BuyerFilter | StyleFilter) {
  if (!scope) return Prisma.empty;
  if ("styleId" in scope) {
    return Prisma.sql`AND so.id IN (
      SELECT i."orderId" FROM "SalesOrderItem" i JOIN "ProductVariant" v ON v.id = i."variantId"
      WHERE v."styleId" = ${scope.styleId})`;
  }
  return scope.partyId === null
    ? Prisma.sql`AND so."partyId" IS NULL`
    : Prisma.sql`AND so."partyId" = ${scope.partyId}`;
}

/**
 * Every invoiced line in the range with its share of the order's net value, in
 * paisa-exact amounts, and its cost: the cost recorded when it was delivered,
 * or the SKU's average cost for lines not delivered yet. Every line of a sales
 * return in the range comes in too, as negative pieces, value (its share of the
 * return's goods less discount) and cost (what the pieces left at); `sold`
 * tells the invoiced lines apart. With a buyer, only that buyer's lines; with a
 * style, the orders that have it.
 */
function soldLines(companyId: string, range: SalesRange, scope?: BuyerFilter | StyleFilter) {
  return Prisma.sql`
    WITH lines AS (
      SELECT soi.id, so.id AS "groupId", soi."orderId", soi."variantId", pv."styleId", soi.quantity,
             soi."lineTotal", COALESCE(soi."unitCost", pv."avgCost") AS "unitCost",
             so.subtotal, so.subtotal - so.discount AS "groupNet", 1 AS sign
      FROM "Invoice" inv
      JOIN "SalesOrder" so ON so.id = inv."orderId"
      JOIN "SalesOrderItem" soi ON soi."orderId" = so.id
      JOIN "ProductVariant" pv ON pv.id = soi."variantId"
      WHERE inv."companyId" = ${companyId} AND ${liveSale}
        AND inv."issueDate" >= ${range.start} AND inv."issueDate" < ${range.end}
        ${scopeCondition(scope)}
      UNION ALL
      SELECT ri.id, r.id, r."orderId", ri."variantId", pv."styleId", ri.quantity,
             ri.amount, ri."unitCost", r."goodsValue", r."goodsValue" - r.discount, -1
      FROM "SalesReturn" r
      JOIN "Invoice" inv ON inv.id = r."invoiceId"
      JOIN "SalesOrder" so ON so.id = r."orderId"
      JOIN "SalesReturnItem" ri ON ri."returnId" = r.id
      JOIN "ProductVariant" pv ON pv.id = ri."variantId"
      WHERE r."companyId" = ${companyId} AND r."voidedAt" IS NULL AND ${liveSale}
        AND r."receivedAt" >= ${range.start} AND r."receivedAt" < ${range.end}
        ${scopeCondition(scope)}
    ),
    shares AS (
      -- In whole paisa: line x order (or return) net / its goods value, split into the
      -- rounded-down share and the remainder (exact integer arithmetic, no rounding drift).
      SELECT l.*,
             CASE WHEN l.subtotal = 0 THEN 0
                  ELSE div(l."lineTotal" * 100 * l."groupNet" * 100, l.subtotal * 100) END AS base,
             CASE WHEN l.subtotal = 0 THEN 0
                  ELSE mod(l."lineTotal" * 100 * l."groupNet" * 100, l.subtotal * 100) END AS remainder
      FROM lines l
    ),
    alloc AS (
      SELECT s.*,
             s."groupNet" * 100 - SUM(s.base) OVER (PARTITION BY s."groupId") AS leftover,
             ROW_NUMBER() OVER (PARTITION BY s."groupId" ORDER BY s.remainder DESC, s.id) AS rn
      FROM shares s
    )
    SELECT a."orderId", a."variantId", a."styleId", a.sign * a.quantity AS quantity,
           (a.sign * (a.base + CASE WHEN a.rn <= a.leftover THEN 1 ELSE 0 END) / 100)::numeric(14, 2) AS net,
           a.sign * a.quantity * a."unitCost" AS cost, a.sign > 0 AS sold
    FROM alloc a`;
}

export type TopSellerOptions = {
  groupBy: "SKU" | "STYLE";
  sortBy: "QUANTITY" | "REVENUE";
  limit: number;
};

/** One listed group with the totals over all of them; key is null when none is listed. */
type GroupRow = {
  key: string | null;
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
  totalPieces: Prisma.Decimal | null;
  totalNet: Prisma.Decimal | null;
  totalCost: Prisma.Decimal | null;
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
  /**
   * Over everything sold in the range, not only the rows returned, less the
   * pieces that came back in it; groups counts those that still sold pieces.
   */
  totals: { groups: number; pieces: number; net: Prisma.Decimal; cost: Prisma.Decimal };
};

/**
 * Best sellers in the range by pieces or by sales value, per SKU or per style,
 * less what came back in the range; only those that still sold pieces are listed.
 */
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

  // Totals over every group (returns included), the groups listed only while they sold pieces.
  const rows = await prisma.$queryRaw<GroupRow[]>`
    WITH groups AS (
      SELECT ${key} AS key, SUM(s.quantity)::bigint AS pieces,
             (COUNT(DISTINCT s."orderId") FILTER (WHERE s.sold))::int AS orders,
             (COUNT(DISTINCT s."variantId") FILTER (WHERE s.sold))::int AS skus,
             SUM(s.net) AS net, SUM(s.cost) AS cost
      FROM (${soldLines(companyId, range)}) s
      GROUP BY 1
    ),
    totals AS (
      SELECT (COUNT(*) FILTER (WHERE pieces > 0))::int AS "groupCount",
             SUM(pieces) AS "totalPieces", SUM(net) AS "totalNet", SUM(cost) AS "totalCost"
      FROM groups
    )
    SELECT t."groupCount", t."totalPieces", t."totalNet", t."totalCost", g.*
    FROM totals t
    LEFT JOIN LATERAL (
      SELECT x.key, x.pieces, x.orders, x.skus, x.net, x.cost,
             stock.available::bigint AS available,
             d.sku, d."styleCode", d."styleName", d."colorName", d."sizeName"
      FROM groups x
      JOIN (${details}) d ON d.key = x.key
      LEFT JOIN (${stock}) stock ON stock.key = x.key
      WHERE x.pieces > 0
    ) g ON true
    ORDER BY ${order}, g."styleCode", g.sku NULLS FIRST
    LIMIT ${options.limit}`;

  const totals = rows[0];
  const listed = rows.filter((r): r is GroupRow & { key: string } => r.key !== null);
  return {
    items: listed.map((r) => ({
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
    totals: {
      groups: totals?.groupCount ?? 0,
      pieces: new Prisma.Decimal(totals?.totalPieces ?? 0).toNumber(),
      net: new Prisma.Decimal(totals?.totalNet ?? 0),
      cost: new Prisma.Decimal(totals?.totalCost ?? 0),
    },
  };
}

/** Every sale there has been: invoices from the beginning to far ahead. */
export const ALL_TIME: SalesRange = {
  start: new Date(Date.UTC(1970, 0, 1)),
  end: new Date(Date.UTC(9999, 0, 1)),
};

export type BuyerSales = {
  /** Invoiced orders. */
  orders: number;
  pieces: number;
  /** Goods value after discounts, without delivery charges or VAT. */
  net: Prisma.Decimal;
  /** What the goods cost: delivered lines at their recorded cost, the rest at average cost. */
  cost: Prisma.Decimal;
};

/** One buyer's invoiced orders, and pieces, net sales and the cost of those goods less returns. */
export async function buyerSales(
  companyId: string,
  buyer: BuyerFilter,
  range: SalesRange = ALL_TIME,
): Promise<BuyerSales> {
  const [row] = await prisma.$queryRaw<
    Array<{
      orders: number;
      pieces: bigint | null;
      net: Prisma.Decimal | null;
      cost: Prisma.Decimal | null;
    }>
  >`
    SELECT (COUNT(DISTINCT s."orderId") FILTER (WHERE s.sold))::int AS orders,
           SUM(s.quantity)::bigint AS pieces, SUM(s.net) AS net, SUM(s.cost) AS cost
    FROM (${soldLines(companyId, range, buyer)}) s`;
  return {
    orders: row?.orders ?? 0,
    pieces: Number(row?.pieces ?? 0),
    net: new Prisma.Decimal(row?.net ?? 0),
    cost: new Prisma.Decimal(row?.cost ?? 0),
  };
}

export type BuyerStyle = {
  id: string;
  code: string;
  name: string;
  orders: number;
  pieces: number;
  net: Prisma.Decimal;
  cost: Prisma.Decimal;
};

/** The styles a buyer bought most (and kept), by sales value (then pieces). */
export async function buyerTopStyles(
  companyId: string,
  buyer: BuyerFilter,
  limit: number,
  range: SalesRange = ALL_TIME,
): Promise<BuyerStyle[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      code: string;
      name: string;
      orders: number;
      pieces: bigint;
      net: Prisma.Decimal;
      cost: Prisma.Decimal;
    }>
  >`
    SELECT st.id, st.code, st.name, (COUNT(DISTINCT s."orderId") FILTER (WHERE s.sold))::int AS orders,
           SUM(s.quantity)::bigint AS pieces, SUM(s.net) AS net, SUM(s.cost) AS cost
    FROM (${soldLines(companyId, range, buyer)}) s
    JOIN "Style" st ON st.id = s."styleId"
    GROUP BY st.id, st.code, st.name
    HAVING SUM(s.quantity) > 0
    ORDER BY SUM(s.net) DESC, SUM(s.quantity) DESC, st.code
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    orders: r.orders,
    pieces: Number(r.pieces),
    net: new Prisma.Decimal(r.net),
    cost: new Prisma.Decimal(r.cost),
  }));
}

export type StyleSales = Record<"wholesale" | "retail", SalesTotals>;

/**
 * One style's sales, all time unless a range is given: wholesale (wholesale and
 * B2B pre-orders) and retail (shop, website and social commerce), with each
 * line's share of its order's discount, less what came back.
 */
export async function styleSales(
  companyId: string,
  styleId: string,
  range: SalesRange = ALL_TIME,
): Promise<StyleSales> {
  const rows = await prisma.$queryRaw<
    Array<{ wholesale: boolean; orders: number; pieces: bigint; net: Prisma.Decimal }>
  >`
    SELECT so.channel::text IN (${Prisma.join(WHOLESALE_CHANNELS)}) AS wholesale,
           (COUNT(DISTINCT s."orderId") FILTER (WHERE s.sold))::int AS orders,
           SUM(s.quantity)::bigint AS pieces, SUM(s.net) AS net
    FROM (${soldLines(companyId, range, { styleId })}) s
    JOIN "SalesOrder" so ON so.id = s."orderId"
    WHERE s."styleId" = ${styleId}
    GROUP BY 1`;
  const side = (wholesale: boolean): SalesTotals => {
    const row = rows.find((r) => r.wholesale === wholesale);
    return {
      orders: row?.orders ?? 0,
      pieces: Number(row?.pieces ?? 0),
      net: new Prisma.Decimal(row?.net ?? 0),
    };
  };
  return { wholesale: side(true), retail: side(false) };
}

export type ProfitLeader = {
  /** The category id, or the buyer's party id. */
  id: string;
  pieces: number;
  net: Prisma.Decimal;
  cost: Prisma.Decimal;
  /** Gross profit: net sales less the cost of the pieces. */
  profit: Prisma.Decimal;
};

export type ProfitLeaders = { categories: ProfitLeader[]; buyers: ProfitLeader[] };

/**
 * The categories (each style's own) and buyers that made the most gross profit
 * in the range, best first. Walk-in sales (no buyer account) are left out of
 * the buyers: they are retail.
 */
export async function profitLeaders(
  companyId: string,
  range: SalesRange,
  limit: number,
): Promise<ProfitLeaders> {
  type Row = { id: string; pieces: bigint; net: Prisma.Decimal; cost: Prisma.Decimal };
  const [categories, buyers] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT st."categoryId" AS id, SUM(s.quantity)::bigint AS pieces,
             SUM(s.net) AS net, SUM(s.cost) AS cost
      FROM (${soldLines(companyId, range)}) s
      JOIN "Style" st ON st.id = s."styleId"
      GROUP BY 1
      ORDER BY SUM(s.net) - SUM(s.cost) DESC, SUM(s.net) DESC, 1
      LIMIT ${limit}`,
    prisma.$queryRaw<Row[]>`
      SELECT so."partyId" AS id, SUM(s.quantity)::bigint AS pieces,
             SUM(s.net) AS net, SUM(s.cost) AS cost
      FROM (${soldLines(companyId, range)}) s
      JOIN "SalesOrder" so ON so.id = s."orderId"
      WHERE so."partyId" IS NOT NULL
      GROUP BY 1
      ORDER BY SUM(s.net) - SUM(s.cost) DESC, SUM(s.net) DESC, 1
      LIMIT ${limit}`,
  ]);
  const present = (r: Row): ProfitLeader => {
    const net = new Prisma.Decimal(r.net);
    const cost = new Prisma.Decimal(r.cost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return { id: r.id, pieces: Number(r.pieces), net, cost, profit: net.minus(cost) };
  };
  return { categories: categories.map(present), buyers: buyers.map(present) };
}

export type TopBuyer = SalesTotals & { partyId: string; code: string; name: string };

/**
 * The buyers who bought the most in the range, by sales after discounts and
 * returns (then pieces), best first; only buyers invoiced in the range. Walk-in
 * sales (no buyer account) are left out: they are retail, not one buyer.
 */
export async function topBuyers(
  companyId: string,
  range: SalesRange,
  limit: number,
): Promise<TopBuyer[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      partyId: string;
      code: string;
      name: string;
      orders: number;
      pieces: bigint;
      net: Prisma.Decimal;
    }>
  >`
    SELECT o."partyId", p.code, p.name, SUM(o.invoices)::int AS orders,
           SUM(o.pieces)::bigint AS pieces, SUM(o.net) AS net
    FROM (${salesEvents(companyId, range)}) o
    JOIN "Party" p ON p.id = o."partyId"
    GROUP BY o."partyId", p.code, p.name
    HAVING SUM(o.invoices) > 0
    ORDER BY SUM(o.net) DESC, SUM(o.pieces) DESC, p.code
    LIMIT ${limit}`;
  return rows.map((r) => ({
    partyId: r.partyId,
    code: r.code,
    name: r.name,
    orders: r.orders,
    pieces: Number(r.pieces),
    net: new Prisma.Decimal(r.net),
  }));
}
