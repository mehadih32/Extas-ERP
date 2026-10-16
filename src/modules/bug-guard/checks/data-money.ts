import { Prisma } from "@prisma/client";

import { materialsHref } from "@/components/materials/labels";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";

import type { Check, CheckContext } from "../types";
import { amount, companyOf, dec, findings, type Item, quantity } from "./data-common";

/*
 * Money as it is kept: each line's amount is its quantity times its price,
 * rounded to the paisa (half up) as the ERP rounds it, and a costing in
 * another currency than the books has its exchange rate. Money columns keep 2
 * decimals by their type, so "more than 2 decimals" cannot be stored; the
 * rounding is checked on the lines instead.
 */

// -----------------------------------------------------------------------------
// Line amounts: quantity x price, rounded to 2 decimals
// -----------------------------------------------------------------------------

const ROUNDING = "data.money.rounding";

type LineRow = {
  id: string;
  kind: "PO" | "BILL" | "ORDER" | "QUOTATION";
  docId: string;
  number: string;
  isMaterial: boolean | null;
  bookingId: string | null;
  what: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  stored: Prisma.Decimal;
  expected: Prisma.Decimal;
};

async function rounding(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const rows = await ctx.db.$queryRaw<LineRow[]>`
    SELECT * FROM (
      SELECT l.id, 'PO' AS kind, po.id AS "docId", po.number, NULL::boolean AS "isMaterial",
             b.id AS "bookingId", rm.code || ' ' || rm.name AS what,
             l.quantity, l."unitPrice", 0::numeric AS discount, l.amount AS stored,
             ROUND(l.quantity * l."unitPrice", 2) AS expected
      FROM "PurchaseOrderLine" l
      JOIN "PurchaseOrder" po ON po.id = l."orderId"
      JOIN "RawMaterial" rm ON rm.id = l."rawMaterialId"
      LEFT JOIN "Booking" b ON b."orderId" = po.id
      WHERE po."companyId" = ${companyId} AND l.amount <> ROUND(l.quantity * l."unitPrice", 2)
      UNION ALL
      SELECT i.id, 'BILL', sb.id, sb.number, (sb."warehouseId" IS NOT NULL), NULL,
             rm.code || ' ' || rm.name, i.quantity, i."unitPrice", 0, i.amount,
             ROUND(i.quantity * i."unitPrice", 2)
      FROM "SupplierBillItem" i
      JOIN "SupplierBill" sb ON sb.id = i."billId"
      JOIN "RawMaterial" rm ON rm.id = i."rawMaterialId"
      WHERE sb."companyId" = ${companyId} AND i.amount <> ROUND(i.quantity * i."unitPrice", 2)
      UNION ALL
      SELECT i.id, 'ORDER', so.id, so.number, NULL, NULL, pv.sku, i.quantity, i."unitPrice",
             i.discount, i."lineTotal", ROUND(i."unitPrice" * i.quantity, 2) - i.discount
      FROM "SalesOrderItem" i
      JOIN "SalesOrder" so ON so.id = i."orderId"
      JOIN "ProductVariant" pv ON pv.id = i."variantId"
      WHERE so."companyId" = ${companyId}
        AND i."lineTotal" <> ROUND(i."unitPrice" * i.quantity, 2) - i.discount
      UNION ALL
      SELECT i.id, 'QUOTATION', q.id, q.number, NULL, NULL, i.description, i.quantity, i."unitPrice",
             0, i."lineTotal", ROUND(i."unitPrice" * i.quantity, 2)
      FROM "QuotationItem" i
      JOIN "Quotation" q ON q.id = i."quotationId"
      WHERE q."companyId" = ${companyId} AND i."lineTotal" <> ROUND(i."unitPrice" * i.quantity, 2)
    ) lines
    ORDER BY number
    LIMIT 300`;
  const items: Item[] = rows.map((r) => {
    const stored = dec(r.stored);
    const expected = dec(r.expected);
    const diff = stored.minus(expected);
    const small = diff.abs().lte(1);
    const doc =
      r.kind === "PO"
        ? r.bookingId
          ? "বুকিং"
          : "পারচেজ অর্ডার"
        : r.kind === "BILL"
          ? "বিল"
          : r.kind === "ORDER"
            ? "অর্ডার"
            : "কোটেশন";
    const href =
      r.kind === "PO"
        ? r.bookingId
          ? `/production/bookings/${encodeURIComponent(r.bookingId)}`
          : materialsHref.order(r.docId)
        : r.kind === "BILL"
          ? r.isMaterial
            ? materialsHref.purchase(r.docId)
            : productionHref.bill(r.docId)
          : r.kind === "ORDER"
            ? salesHref.order(r.docId)
            : salesHref.quotation(r.docId);
    return {
      id: r.id,
      severity: small ? "LATER" : "IMPORTANT",
      title: `${doc} ${r.number}-এ ${r.what}: ${quantity(r.quantity)} × ${amount(r.unitPrice)}${
        dec(r.discount).isZero() ? "" : ` - ছাড় ${amount(r.discount)}`
      } = ${amount(expected)} হওয়ার কথা, কিন্তু লেখা ${amount(stored)}`,
      href,
      place: r.number,
      why: small
        ? "প্রতিটি লাইনের টাকা = পরিমাণ × দাম, পয়সায় রাউন্ড করে। পার্থক্যটা ছোট (রাউন্ডিংয়ের মতো), তবু মোট আর কাগজে অঙ্ক না মিললে প্রশ্ন ওঠে।"
        : "প্রতিটি লাইনের টাকা = পরিমাণ × দাম (ছাড় বাদে), পয়সায় রাউন্ড করে। এখানে পার্থক্যটা রাউন্ডিংয়ের চেয়ে বড়, তাই কাগজের মোট আর খাতার অঙ্ক ভুল হতে পারে।",
      fix: "কোনটা ঠিক (পরিমাণ, দাম না লাইনের টাকা) Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। কাগজটি খুলে লাইনটা দেখুন; এডিট করা গেলে আবার সেভ করুন, না গেলে হিসাবরক্ষককে দেখান।",
      fixKind: "MANUAL",
      evidence: [
        { label: "কাগজ", value: `${doc} ${r.number}` },
        { label: "লাইন", value: r.what },
        { label: "পরিমাণ", value: quantity(r.quantity) },
        { label: "দাম", value: dec(r.unitPrice).toString() },
        ...(dec(r.discount).isZero() ? [] : [{ label: "ছাড়", value: amount(r.discount) }]),
        { label: "লেখা টাকা", value: amount(stored) },
        { label: "হওয়ার কথা", value: amount(expected) },
        { label: "পার্থক্য", value: amount(diff) },
      ],
    } satisfies Item;
  });
  return findings(ROUNDING, items, "লাইনের টাকার রাউন্ডিং");
}

// -----------------------------------------------------------------------------
// Currency: the books keep one currency; a costing in another has its rate, and
// a proforma is never made from a quotation in another currency
// -----------------------------------------------------------------------------

const CURRENCY = "data.money.currency";

async function currency(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const { currency: books } = await companyOf(ctx);
  const [costings, proformas] = await Promise.all([
    ctx.db.orderCosting.findMany({
      where: {
        companyId,
        currency: { not: books },
        OR: [{ exchangeRate: null }, { exchangeRate: { lte: 0 } }],
      },
      select: { id: true, number: true, title: true, currency: true, exchangeRate: true },
      orderBy: { number: "asc" },
      take: 200,
    }),
    ctx.db.proformaInvoice.findMany({
      where: { companyId, quotation: { currency: { not: books } } },
      select: {
        id: true,
        number: true,
        total: true,
        quotation: { select: { number: true, currency: true } },
      },
      orderBy: { number: "asc" },
      take: 200,
    }),
  ]);
  const items: Item[] = [];
  for (const c of costings) {
    items.push({
      id: c.id,
      severity: "IMPORTANT",
      title: `কস্টিং ${c.number} ${c.currency}-এ, কিন্তু ${books}-এ বদলানোর রেট ${c.exchangeRate === null ? "দেওয়া নেই" : `${c.exchangeRate.toString()} (শূন্য বা কম)`}`,
      href: productionHref.costing(c.id),
      place: `${c.number} ${c.title}`,
      why: `খাতা ${books}-এ রাখা হয়। অন্য মুদ্রার কস্টিংয়ে রেট না থাকলে খরচ, লাভ আর অর্ডার চেক কার্ডের দাম বনাম খরচ ভুল আসে।`,
      fix: `কস্টিংটি খুলে আজকের রেট দিন (1 ${c.currency} = কত ${books}) আর সেভ করুন। কোন রেট ঠিক Bug Guard জানে না, তাই নিজে কিছু বদলায় না।`,
      fixKind: "MANUAL",
      evidence: [
        { label: "কস্টিং", value: c.number },
        { label: "মুদ্রা", value: c.currency },
        { label: "খাতার মুদ্রা", value: books },
        { label: "রেট", value: c.exchangeRate === null ? "নেই" : c.exchangeRate.toString() },
      ],
    });
  }
  for (const p of proformas) {
    items.push({
      id: p.id,
      severity: "IMPORTANT",
      title: `প্রোফর্মা ${p.number} এসেছে ${p.quotation?.currency}-এর কোটেশন ${p.quotation?.number} থেকে, কিন্তু প্রোফর্মা আর অগ্রিম ${books}-এ হিসাব হয়`,
      href: salesHref.proforma(p.id),
      place: p.number,
      why: `প্রোফর্মা কোটেশনের মোটটাই নেয়, মুদ্রা বদলায় না। খাতা ${books}-এ, তাই ${p.quotation?.currency}-এর অঙ্ক ${books} হিসেবে ধরা হচ্ছে: অগ্রিম কত চাইতে হবে আর কত পাওয়া গেল, দুটোই ভুল হতে পারে।`,
      fix: `প্রোফর্মার মোট (${amount(p.total)}) ${books}-এ ঠিক কি না দেখুন। ঠিক না হলে হিসাবরক্ষককে দেখান; ক্রেতাকে কিছু পাঠানোর আগে আপনি নিজে দেখে নিন। Bug Guard নিজে কিছু বদলায় না।`,
      fixKind: "MANUAL",
      evidence: [
        { label: "প্রোফর্মা", value: p.number },
        { label: "কোটেশন", value: p.quotation?.number ?? "-" },
        { label: "কোটেশনের মুদ্রা", value: p.quotation?.currency ?? "-" },
        { label: "খাতার মুদ্রা", value: books },
        { label: "প্রোফর্মার মোট", value: amount(p.total) },
      ],
    });
  }
  return findings(CURRENCY, items, "মুদ্রা বদলের সমস্যা");
}

export const MONEY_CHECKS: Check[] = [
  { key: ROUNDING, area: "DATA", label: "Line amounts are rounded right", run: rounding },
  { key: CURRENCY, area: "DATA", label: "Other currencies have their rate", run: currency },
];
