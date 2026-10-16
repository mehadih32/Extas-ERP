import { Prisma } from "@prisma/client";

import { hrHref } from "@/components/hr/labels";
import { materialsHref } from "@/components/materials/labels";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";
import { CONTROL_ACCOUNTS } from "@/modules/accounts/control-accounts";
import { billsOutOfStepIn } from "@/modules/accounts/supplier-settlement";
import { planProblem } from "@/modules/bug-guard/corrections";
import { projectCostSummaries } from "@/modules/production/project-costs";

import type { Check, CheckContext, CorrectionPlan, FieldChange } from "../types";
import {
  accountsByCode,
  amount,
  companyOf,
  dayOf,
  dec,
  findings,
  fixed,
  type Item,
  quantity,
  ZERO,
} from "./data-common";

/*
 * Stored totals against the records they add up: purchase orders and their
 * lines, sales orders, invoices, proformas and quotations and theirs, what is
 * paid and due on orders, invoices and supplier bills, salaries, advances, CM
 * settlements and returns. A total that is only a copy of its records' sum is
 * put back with the owner's OK (a SET correction, correctable.ts); anything
 * else is the owner's to decide.
 */

/** A SET plan of the changes that really change something, or null when none is valid. */
function setPlan(changes: FieldChange[]): CorrectionPlan | null {
  const real = changes.filter((c) => !dec(c.before).equals(dec(c.after)));
  if (real.length === 0) return null;
  const plan: CorrectionPlan = { kind: "SET", changes: real };
  return planProblem(plan) ? null : plan;
}

const SET_FIX =
  "এই অঙ্কটা শুধু রেকর্ডগুলোর যোগফলের একটা কপি, তাই ঠিক উত্তর একটাই। আপনার PIN দিয়ে অনুমতি দিলে Bug Guard আগে ব্যাকআপ নিয়ে অঙ্কটা যোগফলে ফিরিয়ে আনবে (আগে → পরে উপরে দেখানো), আর পরে চাইলে Bug Guard থেকেই তা ফিরিয়ে নেওয়া যাবে।";

/** Status of an invoice from what is paid on it (sales/totals.ts invoiceStatusFor). */
const invoiceStatusFor = (total: Prisma.Decimal, paid: Prisma.Decimal) =>
  paid.gte(total) ? "PAID" : paid.gt(0) ? "PARTIALLY_PAID" : "UNPAID";

// -----------------------------------------------------------------------------
// Purchase orders (bookings included): the total is the sum of the lines, and
// each line's received quantity is what arrived on bills that are not void
// -----------------------------------------------------------------------------

const PURCHASE = "data.totals.purchase";

async function purchaseTotals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const [orders, received] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        bookingId: string | null;
        total: Prisma.Decimal;
        lines: Prisma.Decimal;
        count: number;
      }>
    >`
      SELECT po.id, po.number, b.id AS "bookingId", po."totalAmount" AS total,
             COALESCE(SUM(l.amount), 0) AS lines, COUNT(l.id)::int AS count
      FROM "PurchaseOrder" po
      LEFT JOIN "PurchaseOrderLine" l ON l."orderId" = po.id
      LEFT JOIN "Booking" b ON b."orderId" = po.id
      WHERE po."companyId" = ${companyId}
      GROUP BY po.id, b.id
      HAVING po."totalAmount" <> COALESCE(SUM(l.amount), 0)
      ORDER BY po.number
      LIMIT 300`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        orderId: string;
        number: string;
        bookingId: string | null;
        material: string;
        unit: string;
        stored: Prisma.Decimal;
        arrived: Prisma.Decimal;
      }>
    >`
      SELECT l.id, po.id AS "orderId", po.number, b.id AS "bookingId",
             rm.code || ' ' || rm.name AS material, rm.unit::text AS unit,
             l."receivedQty" AS stored, COALESCE(r.arrived, 0) AS arrived
      FROM "PurchaseOrderLine" l
      JOIN "PurchaseOrder" po ON po.id = l."orderId"
      JOIN "RawMaterial" rm ON rm.id = l."rawMaterialId"
      LEFT JOIN "Booking" b ON b."orderId" = po.id
      LEFT JOIN (
        SELECT bi."purchaseOrderLineId", SUM(bi.quantity) AS arrived
        FROM "SupplierBillItem" bi
        JOIN "SupplierBill" sb ON sb.id = bi."billId"
        WHERE sb."companyId" = ${companyId} AND sb.status <> 'VOID'::"BillStatus"
          AND bi."purchaseOrderLineId" IS NOT NULL
        GROUP BY bi."purchaseOrderLineId"
      ) r ON r."purchaseOrderLineId" = l.id
      WHERE po."companyId" = ${companyId} AND l."receivedQty" <> COALESCE(r.arrived, 0)
      ORDER BY po.number
      LIMIT 300`,
  ]);
  const hrefOf = (o: { id: string; bookingId: string | null }) =>
    o.bookingId
      ? `/production/bookings/${encodeURIComponent(o.bookingId)}`
      : materialsHref.order(o.id);
  const items: Item[] = [];
  for (const o of orders) {
    const plan = setPlan([
      {
        model: "PurchaseOrder",
        id: o.id,
        field: "totalAmount",
        before: fixed(o.total),
        after: fixed(o.lines),
        label: `${o.number}-এর মোট`,
      },
    ]);
    items.push({
      id: o.id,
      severity: "IMPORTANT",
      title: `${o.bookingId ? "বুকিং" : "পারচেজ অর্ডার"} ${o.number}-এর মোট ${amount(o.total)} লেখা, কিন্তু তার ${o.count}টি লাইনের যোগফল ${amount(o.lines)}`,
      href: hrefOf(o),
      place: o.number,
      why: "অর্ডারের মোট হলো তার লাইনগুলোর যোগফল। ভুল মোট সরবরাহকারীকে পাঠানো কাগজে, বাজেটে আর কত কেনা বাকি তার হিসাবে চলে যায়।",
      fix: plan
        ? SET_FIX
        : "যোগফলটা টাকার ঘরে বসে না, তাই Bug Guard নিজে কিছু বদলায় না। অর্ডারটি খুলে “Save the changes” দিয়ে আবার সেভ করুন।",
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "অর্ডার", value: o.number },
        { label: "লেখা মোট", value: amount(o.total) },
        { label: "লাইনগুলোর যোগফল", value: amount(o.lines) },
        { label: "লাইন", value: String(o.count) },
        { label: "পার্থক্য", value: amount(dec(o.total).minus(dec(o.lines))) },
      ],
    });
  }
  for (const l of received) {
    items.push({
      id: `received-${l.id}`,
      severity: "IMPORTANT",
      title: `${l.number}-এ ${l.material}: এসেছে লেখা ${quantity(l.stored)}, কিন্তু চালু বিলগুলোতে এসেছে ${quantity(l.arrived)}`,
      href: hrefOf({ id: l.orderId, bookingId: l.bookingId }),
      place: l.number,
      why: "অর্ডারের কতটা এসেছে তা হলো এই লাইনের বিলগুলোর (বাতিল বাদে) পরিমাণের যোগফল। ভুল হলে কতটা আসা বাকি, অর্ডার পুরো এসেছে কি না আর রিমাইন্ডার ভুল দেখায়।",
      fix: "পরিমাণ 3 দশমিক পর্যন্ত আর অর্ডারের অবস্থাও (এসেছে, আংশিক) এর সাথে জড়িত, তাই Bug Guard নিজে এটা বদলায় না। হিসাবরক্ষক বা ডেভেলপারকে দেখান।",
      fixKind: "MANUAL",
      evidence: [
        { label: "অর্ডার", value: l.number },
        { label: "ম্যাটেরিয়াল", value: l.material },
        { label: "এসেছে লেখা", value: quantity(l.stored) },
        { label: "বিলগুলোতে এসেছে", value: quantity(l.arrived) },
      ],
    });
  }
  return findings(PURCHASE, items, "পারচেজ অর্ডারের মোটের অমিল");
}

// -----------------------------------------------------------------------------
// Sales orders, invoices, proformas and quotations
// -----------------------------------------------------------------------------

const SALES = "data.totals.sales";

type OrderRow = {
  id: string;
  number: string;
  status: string;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  shippingCharge: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  dueAmount: Prisma.Decimal;
  lines: Prisma.Decimal;
  held: Prisma.Decimal;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceTotal: Prisma.Decimal | null;
  invoicePaid: Prisma.Decimal | null;
  invoiceDue: Prisma.Decimal | null;
};

async function salesTotals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const [orders, proformas, quotations] = await Promise.all([
    ctx.db.$queryRaw<OrderRow[]>`
      WITH o AS (
        SELECT so.id, so.number, so.status::text AS status, so.subtotal, so.discount,
               so."shippingCharge", so.tax, so.total, so."paidAmount", so."dueAmount",
               COALESCE((SELECT SUM(i."lineTotal") FROM "SalesOrderItem" i WHERE i."orderId" = so.id), 0) AS lines,
               COALESCE((SELECT SUM(p.amount) FROM "Payment" p
                          WHERE p."orderId" = so.id AND p.direction = 'RECEIVED'::"PaymentDirection"), 0)
             + COALESCE((SELECT SUM(c.amount) FROM "CreditAllocation" c
                          WHERE c."orderId" = so.id AND c."releasedAt" IS NULL), 0)
             - COALESCE((SELECT SUM(r.amount) FROM "Refund" r
                          WHERE r."orderId" = so.id AND r."voidedAt" IS NULL), 0) AS held
        FROM "SalesOrder" so
        WHERE so."companyId" = ${companyId}
      )
      SELECT o.*, inv.id AS "invoiceId", inv.number AS "invoiceNumber",
             inv.status::text AS "invoiceStatus", inv.total AS "invoiceTotal",
             inv."paidAmount" AS "invoicePaid", inv."dueAmount" AS "invoiceDue"
      FROM o
      LEFT JOIN "Invoice" inv ON inv."orderId" = o.id
      WHERE o.subtotal <> o.lines
         OR o.total <> o.subtotal - o.discount + o."shippingCharge" + o.tax
         OR o."paidAmount" <> o.held
         OR o."dueAmount" <> CASE WHEN o.status = 'CANCELLED' THEN 0 ELSE GREATEST(o.total - o.held, 0) END
         OR (o.status <> 'CANCELLED' AND o.held > o.total)
         OR (o.status = 'CANCELLED' AND o.held <> 0)
         OR (inv.id IS NOT NULL AND inv.status <> 'VOID'::"InvoiceStatus" AND (
               inv.total <> o.total OR inv."paidAmount" <> o.held
               OR inv."dueAmount" <> GREATEST(inv.total - o.held, 0)
               OR inv.status::text <> CASE WHEN o.held >= inv.total THEN 'PAID'
                                           WHEN o.held > 0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END))
         OR (inv.status = 'VOID'::"InvoiceStatus" AND inv."dueAmount" <> 0)
      ORDER BY o.number
      LIMIT 300`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: string;
        total: Prisma.Decimal;
        advancePaid: Prisma.Decimal;
        held: Prisma.Decimal;
      }>
    >`
      SELECT pf.id, pf.number, pf.status::text AS status, pf.total, pf."advancePaid",
             COALESCE((SELECT SUM(p.amount) FROM "Payment" p
                        WHERE p."proformaId" = pf.id AND p.direction = 'RECEIVED'::"PaymentDirection"), 0)
           - COALESCE((SELECT SUM(r.amount) FROM "Refund" r
                        WHERE r."proformaId" = pf.id AND r."voidedAt" IS NULL), 0) AS held
      FROM "ProformaInvoice" pf
      WHERE pf."companyId" = ${companyId} AND pf.status <> 'CONVERTED'::"ProformaStatus"
      ORDER BY pf.number`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        subtotal: Prisma.Decimal;
        discount: Prisma.Decimal;
        tax: Prisma.Decimal;
        total: Prisma.Decimal;
        lines: Prisma.Decimal;
      }>
    >`
      SELECT q.id, q.number, q.subtotal, q.discount, q.tax, q.total,
             COALESCE(SUM(i."lineTotal"), 0) AS lines
      FROM "Quotation" q
      LEFT JOIN "QuotationItem" i ON i."quotationId" = q.id
      WHERE q."companyId" = ${companyId}
      GROUP BY q.id
      HAVING q.subtotal <> COALESCE(SUM(i."lineTotal"), 0)
          OR q.total <> q.subtotal - q.discount + q.tax
      ORDER BY q.number
      LIMIT 200`,
  ]);
  const items: Item[] = [];
  for (const o of orders) {
    const href = salesHref.order(o.id);
    const held = dec(o.held);
    const total = dec(o.total);
    const cancelled = o.status === "CANCELLED";
    const live = o.invoiceId !== null && o.invoiceStatus !== "VOID";
    const lines = dec(o.lines);
    const formula = dec(o.subtotal)
      .minus(dec(o.discount))
      .plus(dec(o.shippingCharge))
      .plus(dec(o.tax));

    // The order's own figures: subtotal and total.
    if (!dec(o.subtotal).equals(lines) || !total.equals(formula)) {
      items.push({
        id: `totals-${o.id}`,
        severity: "IMPORTANT",
        title: !dec(o.subtotal).equals(lines)
          ? `অর্ডার ${o.number}-এর সাবটোটাল ${amount(o.subtotal)}, কিন্তু আইটেমগুলোর যোগফল ${amount(lines)}`
          : `অর্ডার ${o.number}-এর মোট ${amount(total)}, কিন্তু সাবটোটাল - ছাড় + ডেলিভারি + ভ্যাট = ${amount(formula)}`,
        href,
        place: o.number,
        why: "অর্ডারের সাবটোটাল হলো আইটেমগুলোর যোগফল, আর মোট হলো সাবটোটাল থেকে ছাড় বাদ দিয়ে ডেলিভারি চার্জ আর ভ্যাট যোগ করে। ভুল মোট ইনভয়েস, ক্রেতার বকেয়া আর বিক্রির হিসাবে চলে যায়।",
        fix: "কোন অঙ্কটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। অর্ডারটি খুলে “Edit order” দিয়ে আইটেম আর চার্জগুলো দেখে আবার সেভ করুন: ERP সব অঙ্ক নতুন করে হিসাব করবে (ইনভয়েস থাকলে সেটাও)।",
        fixKind: "MANUAL",
        evidence: [
          { label: "অর্ডার", value: o.number },
          { label: "আইটেমগুলোর যোগফল", value: amount(lines) },
          { label: "সাবটোটাল", value: amount(o.subtotal) },
          { label: "ছাড়", value: amount(o.discount) },
          { label: "ডেলিভারি চার্জ", value: amount(o.shippingCharge) },
          { label: "ভ্যাট", value: amount(o.tax) },
          { label: "লেখা মোট", value: amount(total) },
        ],
      });
    }

    // Money held on it: never more than its total, and none on a cancelled order.
    if (held.isNegative() || (!cancelled && held.gt(total)) || (cancelled && !held.isZero())) {
      items.push({
        id: `held-${o.id}`,
        severity: "IMPORTANT",
        title: cancelled
          ? `অর্ডার ${o.number} বাতিল, কিন্তু এর উপর এখনো ${amount(held)} টাকা ধরা আছে`
          : held.isNegative()
            ? `অর্ডার ${o.number}-এ যা পাওয়া গেছে তার চেয়ে বেশি ফেরত দেওয়া হয়েছে (${amount(held)})`
            : `অর্ডার ${o.number}-এর মোট ${amount(total)}, কিন্তু এর উপর ${amount(held)} টাকা পাওয়া গেছে`,
        href,
        place: o.number,
        why: "অর্ডারে যা পাওয়া গেছে (পেমেন্ট আর ব্যবহার করা ক্রেডিট থেকে রিফান্ড বাদে) তা কখনো মোটের বেশি হয় না, আর অর্ডার বাতিল হলে সব টাকা ফেরত, ক্রেডিট বা চার্জ হিসেবে মিটিয়ে দেওয়া হয়। না হলে ক্রেতার টাকা ভুল জায়গায় আটকে থাকে।",
        fix: "কোন পেমেন্ট বা রিফান্ড ভুল Bug Guard নিশ্চিত নয়, আর টাকা নড়াচড়া করা Bug Guard-এর কাজ নয়। অর্ডারের পেমেন্ট আর রিফান্ডগুলো দেখুন; বাড়তি টাকা থাকলে Accounts “Refund money paid” দিয়ে মিটিয়ে দিন।",
        fixKind: "MANUAL",
        evidence: [
          { label: "অর্ডার", value: o.number },
          { label: "অবস্থা", value: o.status },
          { label: "মোট", value: amount(total) },
          { label: "অর্ডারে ধরা টাকা", value: amount(held) },
        ],
      });
      continue;
    }

    // An order's invoice bills the order's total.
    if (live && !dec(o.invoiceTotal).equals(total)) {
      items.push({
        id: `invoice-${o.invoiceId}`,
        severity: "IMPORTANT",
        title: `ইনভয়েস ${o.invoiceNumber}-এর মোট ${amount(o.invoiceTotal)}, কিন্তু তার অর্ডার ${o.number}-এর মোট ${amount(total)}`,
        href: salesHref.invoice(o.invoiceId!),
        place: o.invoiceNumber,
        why: "ইনভয়েস অর্ডারের মোটই বিল করে; অর্ডার বদলালে ইনভয়েসও বদলায়। না মিললে ক্রেতা এক অঙ্ক পায় আর খাতায় আরেক অঙ্ক থাকে।",
        fix: "কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। অর্ডারটি খুলে “Edit the invoice” দিয়ে আইটেমগুলো দেখে আবার সেভ করুন: ERP ইনভয়েস আর তার এন্ট্রি নতুন করে দেবে।",
        fixKind: "MANUAL",
        evidence: [
          { label: "ইনভয়েস", value: o.invoiceNumber ?? "-" },
          { label: "ইনভয়েসের মোট", value: amount(o.invoiceTotal) },
          { label: "অর্ডার", value: o.number },
          { label: "অর্ডারের মোট", value: amount(total) },
        ],
      });
      continue;
    }

    // What is paid and due on the order and its invoice: copies of the money held on it.
    const due = cancelled ? ZERO : Prisma.Decimal.max(total.minus(held), ZERO);
    const changes: FieldChange[] = [
      {
        model: "SalesOrder",
        id: o.id,
        field: "paidAmount",
        before: fixed(o.paidAmount),
        after: fixed(held),
        label: `${o.number}-এ পাওয়া`,
      },
      {
        model: "SalesOrder",
        id: o.id,
        field: "dueAmount",
        before: fixed(o.dueAmount),
        after: fixed(due),
        label: `${o.number}-এ বাকি`,
      },
    ];
    let statusOff = false;
    if (live) {
      const invoiceTotal = dec(o.invoiceTotal);
      changes.push(
        {
          model: "Invoice",
          id: o.invoiceId!,
          field: "paidAmount",
          before: fixed(o.invoicePaid),
          after: fixed(held),
          label: `${o.invoiceNumber}-এ পাওয়া`,
        },
        {
          model: "Invoice",
          id: o.invoiceId!,
          field: "dueAmount",
          before: fixed(o.invoiceDue),
          after: fixed(Prisma.Decimal.max(invoiceTotal.minus(held), ZERO)),
          label: `${o.invoiceNumber}-এ বাকি`,
        },
      );
      statusOff = invoiceStatusFor(invoiceTotal, held) !== o.invoiceStatus;
    } else if (o.invoiceId && !dec(o.invoiceDue).isZero()) {
      changes.push({
        model: "Invoice",
        id: o.invoiceId,
        field: "dueAmount",
        before: fixed(o.invoiceDue),
        after: "0.00",
        label: `বাতিল ইনভয়েস ${o.invoiceNumber}-এ বাকি`,
      });
    }
    const real = changes.filter((c) => !dec(c.before).equals(dec(c.after)));
    if (real.length === 0 && !statusOff) continue;
    // The invoice's status follows what is paid; it is not a figure Bug Guard may set, so a
    // change that would move it is left to the owner.
    const plan = statusOff ? null : setPlan(real);
    items.push({
      id: o.id,
      severity: "IMPORTANT",
      title:
        real.length === 0
          ? `ইনভয়েস ${o.invoiceNumber}-এর অবস্থা ${o.invoiceStatus}, কিন্তু যা পাওয়া গেছে তাতে হওয়ার কথা ${invoiceStatusFor(dec(o.invoiceTotal), held)}`
          : `অর্ডার ${o.number}${live ? ` আর ইনভয়েস ${o.invoiceNumber}` : ""}-এ পাওয়া আর বাকির অঙ্ক তার পেমেন্টগুলোর সাথে মেলে না`,
      href,
      place: o.number,
      why: "অর্ডার আর ইনভয়েসে কত পাওয়া গেছে তা হলো তার পেমেন্ট আর ব্যবহার করা ক্রেডিট থেকে রিফান্ড বাদ দিয়ে, আর বাকি হলো মোট থেকে সেটা বাদ দিয়ে। ভুল হলে ক্রেতার বকেয়া, রিমাইন্ডার আর “Dues” তালিকা ভুল দেখায়।",
      fix: plan
        ? SET_FIX
        : "এটা ঠিক করলে ইনভয়েসের অবস্থাও (Paid, Partly paid) বদলাতে হয়, যা Bug Guard নিজে বদলায় না। হিসাবরক্ষক বা ডেভেলপারকে দেখান।",
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "অর্ডার", value: o.number },
        { label: "মোট", value: amount(total) },
        { label: "পেমেন্ট থেকে পাওয়া", value: amount(held) },
        { label: "অর্ডারে লেখা পাওয়া", value: amount(o.paidAmount) },
        { label: "অর্ডারে লেখা বাকি", value: amount(o.dueAmount) },
        ...(o.invoiceId
          ? [
              { label: "ইনভয়েস", value: `${o.invoiceNumber} (${o.invoiceStatus})` },
              { label: "ইনভয়েসে লেখা পাওয়া", value: amount(o.invoicePaid) },
              { label: "ইনভয়েসে লেখা বাকি", value: amount(o.invoiceDue) },
            ]
          : []),
      ],
    });
  }
  for (const p of proformas) {
    const held = dec(p.held);
    if (dec(p.advancePaid).equals(held)) continue;
    const plan = held.isNegative()
      ? null
      : setPlan([
          {
            model: "ProformaInvoice",
            id: p.id,
            field: "advancePaid",
            before: fixed(p.advancePaid),
            after: fixed(held),
            label: `${p.number}-এ পাওয়া অগ্রিম`,
          },
        ]);
    items.push({
      id: p.id,
      severity: "IMPORTANT",
      title: `প্রোফর্মা ${p.number}-এ অগ্রিম পাওয়া লেখা ${amount(p.advancePaid)}, কিন্তু তার পেমেন্ট থেকে রিফান্ড বাদে ${amount(held)}`,
      href: salesHref.proforma(p.id),
      place: p.number,
      why: "প্রোফর্মায় কত অগ্রিম পাওয়া গেছে তা হলো তার পেমেন্ট থেকে রিফান্ড বাদ দিয়ে। এর উপর নির্ভর করে প্রোডাকশন শুরু হবে কি না আর ক্রেতাকে কত চাইতে হবে।",
      fix: plan
        ? SET_FIX
        : "রিফান্ড পেমেন্টের চেয়ে বেশি, তাই Bug Guard নিজে কিছু বদলায় না। হিসাবরক্ষককে দেখান।",
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "প্রোফর্মা", value: p.number },
        { label: "মোট", value: amount(p.total) },
        { label: "লেখা অগ্রিম", value: amount(p.advancePaid) },
        { label: "পেমেন্ট থেকে রিফান্ড বাদে", value: amount(held) },
      ],
    });
  }
  for (const q of quotations) {
    const lines = dec(q.lines);
    const formula = dec(q.subtotal).minus(dec(q.discount)).plus(dec(q.tax));
    items.push({
      id: q.id,
      severity: "IMPORTANT",
      title: !dec(q.subtotal).equals(lines)
        ? `কোটেশন ${q.number}-এর সাবটোটাল ${amount(q.subtotal)}, কিন্তু লাইনগুলোর যোগফল ${amount(lines)}`
        : `কোটেশন ${q.number}-এর মোট ${amount(q.total)}, কিন্তু সাবটোটাল - ছাড় + ভ্যাট = ${amount(formula)}`,
      href: salesHref.quotation(q.id),
      place: q.number,
      why: "কোটেশনের মোট ক্রেতার কাছে যায়, আর তা থেকে প্রোফর্মা হয়। মোট লাইনগুলোর সাথে না মিললে ক্রেতা ভুল দাম পায়।",
      fix: "কোন অঙ্কটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। কোটেশনটি খুলে এডিট করে লাইনগুলো দেখে আবার সেভ করুন; ক্রেতাকে পাঠানো হয়ে থাকলে ঠিক কোটেশনটি আবার পাঠানোর আগে আপনি নিজে দেখে নিন।",
      fixKind: "MANUAL",
      evidence: [
        { label: "কোটেশন", value: q.number },
        { label: "লাইনগুলোর যোগফল", value: amount(lines) },
        { label: "সাবটোটাল", value: amount(q.subtotal) },
        { label: "ছাড়", value: amount(q.discount) },
        { label: "ভ্যাট", value: amount(q.tax) },
        { label: "লেখা মোট", value: amount(q.total) },
      ],
    });
  }
  return findings(SALES, items, "বিক্রির কাগজের মোটের অমিল");
}

// -----------------------------------------------------------------------------
// Supplier bills: the total is their lines (or their split across projects),
// and what is paid and due is what their supplier's ledger has settled
// -----------------------------------------------------------------------------

const BILLS = "data.totals.bills";

async function billTotals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const codes = Object.values(CONTROL_ACCOUNTS).map((a) => a.code);
  // Working out what each bill should show reads the control accounts and would add one that
  // is missing: only while they are all there.
  const allAccounts = (await accountsByCode(ctx, codes)).size === codes.length;
  const [bills, planned] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: string;
        isMaterial: boolean;
        total: Prisma.Decimal;
        paid: Prisma.Decimal;
        due: Prisma.Decimal;
        items: Prisma.Decimal;
        itemCount: number;
        allocations: Prisma.Decimal;
        allocationCount: number;
      }>
    >`
      SELECT b.id, b.number, b.status::text AS status, (b."warehouseId" IS NOT NULL) AS "isMaterial",
             b."totalAmount" AS total, b."paidAmount" AS paid, b."dueAmount" AS due,
             COALESCE(i.amount, 0) AS items, COALESCE(i.n, 0)::int AS "itemCount",
             COALESCE(a.amount, 0) AS allocations, COALESCE(a.n, 0)::int AS "allocationCount"
      FROM "SupplierBill" b
      LEFT JOIN (
        SELECT "billId", SUM(amount) AS amount, COUNT(*) AS n FROM "SupplierBillItem" GROUP BY "billId"
      ) i ON i."billId" = b.id
      LEFT JOIN (
        SELECT "billId", SUM(amount) AS amount, COUNT(*) AS n FROM "SupplierBillAllocation" GROUP BY "billId"
      ) a ON a."billId" = b.id
      WHERE b."companyId" = ${companyId}
      ORDER BY b.number`,
    allAccounts ? billsOutOfStepIn(ctx.db, companyId) : Promise.resolve([]),
  ]);
  const byId = new Map(bills.map((b) => [b.id, b]));
  const hrefOf = (b: { id: string; isMaterial: boolean }) =>
    b.isMaterial ? materialsHref.purchase(b.id) : productionHref.bill(b.id);
  const voidLabel = (b: { isMaterial: boolean }) =>
    b.isMaterial ? "Void the purchase" : "Void the bill";
  const items: Item[] = [];
  for (const b of bills) {
    const total = dec(b.total);
    const expected =
      b.itemCount > 0 ? dec(b.items) : b.allocationCount > 0 ? dec(b.allocations) : null;
    if (expected && !expected.equals(total)) {
      items.push({
        id: `total-${b.id}`,
        severity: "IMPORTANT",
        title: `বিল ${b.number}-এর মোট ${amount(total)}, কিন্তু তার ${b.itemCount > 0 ? "আইটেমগুলোর" : "খরচের ভাগগুলোর"} যোগফল ${amount(expected)}`,
        href: hrefOf(b),
        place: b.number,
        why: "বিলের মোট হলো তার আইটেমগুলোর (ম্যাটেরিয়াল কেনার বিলে) বা প্রজেক্টে ভাগ করা খরচগুলোর যোগফল। সরবরাহকারীর দেনা আর খাতার এন্ট্রি এই মোট থেকেই হয়, তাই না মিললে দুটোই ভুল।",
        fix: `কোন অঙ্কটা ঠিক Bug Guard নিশ্চিত নয়, আর মোট বদলালে খাতাও বদলাতে হয়, তাই নিজে কিছু বদলায় না। সরবরাহকারীর আসল বিলের সাথে মিলিয়ে দেখুন; ভুল হলে বিলটি “${voidLabel(b)}” দিয়ে বাতিল করে আবার লিখুন।`,
        fixKind: "MANUAL",
        evidence: [
          { label: "বিল", value: b.number },
          { label: "লেখা মোট", value: amount(total) },
          { label: "লাইনগুলোর যোগফল", value: amount(expected) },
          { label: "পার্থক্য", value: amount(total.minus(expected)) },
        ],
      });
    }
    // A void bill owes nothing and has nothing paid on it.
    if (b.status === "VOID" && (!dec(b.paid).isZero() || !dec(b.due).isZero())) {
      const plan = setPlan([
        {
          model: "SupplierBill",
          id: b.id,
          field: "paidAmount",
          before: fixed(b.paid),
          after: "0.00",
          label: `বাতিল বিল ${b.number}-এ পরিশোধ`,
        },
        {
          model: "SupplierBill",
          id: b.id,
          field: "dueAmount",
          before: fixed(b.due),
          after: "0.00",
          label: `বাতিল বিল ${b.number}-এ বাকি`,
        },
      ]);
      items.push({
        id: b.id,
        severity: "IMPORTANT",
        title: `বিল ${b.number} বাতিল, কিন্তু তাতে এখনো পরিশোধ ${amount(b.paid)} আর বাকি ${amount(b.due)} লেখা`,
        href: hrefOf(b),
        place: b.number,
        why: "বাতিল বিলে কিছু দেওয়া বা বাকি থাকে না; তার টাকা সরবরাহকারীর বাকি বিলগুলোতে চলে যায়। না হলে “Dues” তালিকায় বাতিল বিলের টাকা দেখায়।",
        fix: plan ? SET_FIX : DEFAULT_MANUAL,
        fixKind: plan ? "DATA" : "MANUAL",
        correction: plan,
        evidence: [
          { label: "বিল", value: b.number },
          { label: "অবস্থা", value: "VOID" },
          { label: "লেখা পরিশোধ", value: amount(b.paid) },
          { label: "লেখা বাকি", value: amount(b.due) },
        ],
      });
    }
  }
  for (const p of planned) {
    const b = byId.get(p.id);
    if (!b) continue;
    const overpaid = p.paid.gt(dec(b.total));
    const statusOff = p.status !== p.recorded.status;
    const plan =
      overpaid || statusOff
        ? null
        : setPlan([
            {
              model: "SupplierBill",
              id: b.id,
              field: "paidAmount",
              before: fixed(p.recorded.paid),
              after: fixed(p.paid),
              label: `${b.number}-এ পরিশোধ`,
            },
            {
              model: "SupplierBill",
              id: b.id,
              field: "dueAmount",
              before: fixed(p.recorded.due),
              after: fixed(p.due),
              label: `${b.number}-এ বাকি`,
            },
          ]);
    items.push({
      id: b.id,
      severity: "IMPORTANT",
      title: overpaid
        ? `বিল ${b.number}-এর মোট ${amount(b.total)}, কিন্তু এর উপর সরাসরি ${amount(p.paid)} দেওয়া হয়েছে`
        : `বিল ${b.number}-এ বাকি ${amount(p.recorded.due)} লেখা, কিন্তু সরবরাহকারীর খাতা অনুযায়ী বাকি ${amount(p.due)}`,
      href: hrefOf(b),
      place: b.number,
      why: "সরবরাহকারীর বিলে কত দেওয়া হয়েছে আর কত বাকি, তা তার দেনার খাতা থেকে আসে (পুরনো বাকি আগে মেটে)। না মিললে “Dues” তালিকা, বিলের পাতা আর সরবরাহকারীর স্টেটমেন্ট আলাদা অঙ্ক দেখায়, আর ভুল বিলে টাকা দেওয়া হতে পারে।",
      fix: plan
        ? SET_FIX
        : overpaid
          ? "বিলের চেয়ে বেশি টাকা দেওয়া হয়েছে। টাকা নড়াচড়া করা Bug Guard-এর কাজ নয়: সরবরাহকারীর স্টেটমেন্ট দেখে বাড়তি পেমেন্টটি “Void the payment” দিয়ে বাতিল করে সঠিক অঙ্কে আবার দিন, বা হিসাবরক্ষককে দেখান।"
          : "এটা ঠিক করলে বিলের অবস্থাও (Paid, Partly paid) বদলাতে হয়, যা Bug Guard নিজে বদলায় না। হিসাবরক্ষক বা ডেভেলপারকে দেখান।",
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "বিল", value: b.number },
        { label: "মোট", value: amount(b.total) },
        { label: "লেখা পরিশোধ", value: amount(p.recorded.paid) },
        { label: "খাতা অনুযায়ী পরিশোধ", value: amount(p.paid) },
        { label: "লেখা বাকি", value: amount(p.recorded.due) },
        { label: "খাতা অনুযায়ী বাকি", value: amount(p.due) },
        { label: "অবস্থা", value: `${p.recorded.status} → ${p.status}` },
      ],
    });
  }
  return findings(BILLS, items, "সরবরাহকারীর বিলের অমিল");
}

const DEFAULT_MANUAL = "হিসাবরক্ষককে দেখান। Bug Guard নিজে কিছু বদলায় না।";

// -----------------------------------------------------------------------------
// Payroll and advances
// -----------------------------------------------------------------------------

const PAYROLL = "data.totals.payroll";

const monthName = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

async function payrollTotals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const { timezone } = await companyOf(ctx);
  const [runs, lines, payments, advances] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{
        id: string;
        year: number;
        month: number;
        totalGross: Prisma.Decimal;
        totalNet: Prisma.Decimal;
        gross: Prisma.Decimal;
        net: Prisma.Decimal;
        people: number;
      }>
    >`
      SELECT r.id, r.year, r.month, r."totalGross", r."totalNet",
             COALESCE(SUM(i.basic + i.allowances + i.overtime + i.bonus - i."unpaidLeaveDeduction"), 0) AS gross,
             COALESCE(SUM(i."netPay"), 0) AS net, COUNT(i.id)::int AS people
      FROM "PayrollRun" r
      LEFT JOIN "PayrollItem" i ON i."runId" = r.id
      WHERE r."companyId" = ${companyId}
      GROUP BY r.id
      HAVING r."totalGross" <> COALESCE(SUM(i.basic + i.allowances + i.overtime + i.bonus - i."unpaidLeaveDeduction"), 0)
          OR r."totalNet" <> COALESCE(SUM(i."netPay"), 0)`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        runId: string;
        year: number;
        month: number;
        status: string;
        employee: string;
        netPay: Prisma.Decimal;
        formula: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        paid: Prisma.Decimal;
      }>
    >`
      SELECT i.id, r.id AS "runId", r.year, r.month, r.status::text AS status,
             e.code || ' ' || e.name AS employee, i."netPay",
             i.basic + i.allowances + i.overtime + i.bonus - i."unpaidLeaveDeduction" + i.reimbursements
               - i."advanceDeduction" - i."taxDeduction" - i."otherDeductions" AS formula,
             i."paidAmount", COALESCE(pl.paid, 0) AS paid
      FROM "PayrollItem" i
      JOIN "PayrollRun" r ON r.id = i."runId"
      JOIN "Employee" e ON e.id = i."employeeId"
      LEFT JOIN (
        SELECT l."itemId", SUM(l.amount) AS paid
        FROM "PayrollPaymentLine" l
        JOIN "PayrollPayment" pp ON pp.id = l."paymentId"
        WHERE pp."companyId" = ${companyId} AND pp."voidedAt" IS NULL
        GROUP BY l."itemId"
      ) pl ON pl."itemId" = i.id
      WHERE r."companyId" = ${companyId}
        AND (i."netPay" <> i.basic + i.allowances + i.overtime + i.bonus - i."unpaidLeaveDeduction"
                           + i.reimbursements - i."advanceDeduction" - i."taxDeduction" - i."otherDeductions"
             OR i."paidAmount" <> COALESCE(pl.paid, 0)
             OR COALESCE(pl.paid, 0) > i."netPay")
      LIMIT 300`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        runId: string;
        amount: Prisma.Decimal;
        employeeCount: number;
        lines: Prisma.Decimal;
        count: number;
      }>
    >`
      SELECT pp.id, pp.number, pp."runId", pp.amount, pp."employeeCount",
             COALESCE(SUM(l.amount), 0) AS lines, COUNT(l.id)::int AS count
      FROM "PayrollPayment" pp
      LEFT JOIN "PayrollPaymentLine" l ON l."paymentId" = pp.id
      WHERE pp."companyId" = ${companyId}
      GROUP BY pp.id
      HAVING pp.amount <> COALESCE(SUM(l.amount), 0) OR pp."employeeCount" <> COUNT(l.id)`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: string;
        employee: string;
        givenAt: Date;
        amount: Prisma.Decimal;
        outstanding: Prisma.Decimal;
        settled: Prisma.Decimal;
      }>
    >`
      SELECT a.id, a.number, a.status::text AS status, e.code || ' ' || e.name AS employee,
             a."givenAt", a.amount, a.outstanding,
             COALESCE((SELECT SUM(s.amount) FROM "AdvanceSettlement" s
                        WHERE s."advanceId" = a.id AND s."reversedAt" IS NULL), 0) AS settled
      FROM "SalaryAdvance" a
      JOIN "Employee" e ON e.id = a."employeeId"
      WHERE a."companyId" = ${companyId}
      ORDER BY a.number`,
  ]);
  const items: Item[] = [];
  for (const r of runs) {
    const month = monthName(r.year, r.month);
    const plan = setPlan([
      {
        model: "PayrollRun",
        id: r.id,
        field: "totalGross",
        before: fixed(r.totalGross),
        after: fixed(r.gross),
        label: `${month}-এর মোট বেতন (Gross)`,
      },
      {
        model: "PayrollRun",
        id: r.id,
        field: "totalNet",
        before: fixed(r.totalNet),
        after: fixed(r.net),
        label: `${month}-এর মোট হাতে পাওয়া বেতন (Net)`,
      },
    ]);
    items.push({
      id: r.id,
      severity: "IMPORTANT",
      title: `${month} মাসের বেতনের মোট (Gross ${amount(r.totalGross)}, Net ${amount(r.totalNet)}) তার ${r.people} জনের লাইনের যোগফলের (Gross ${amount(r.gross)}, Net ${amount(r.net)}) সাথে মেলে না`,
      href: hrHref.payrollRun(r.id),
      place: `Payroll ${month}`,
      why: "মাসের মোট বেতন হলো প্রত্যেক কর্মীর লাইনের যোগফল। ভুল মোট বেতনের তালিকা, রিপোর্ট আর অনুমোদনের সময় যে অঙ্ক দেখা হয় তাতে চলে যায়।",
      fix: plan ? SET_FIX : DEFAULT_MANUAL,
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "মাস", value: month },
        { label: "লেখা Gross", value: amount(r.totalGross) },
        { label: "লাইনগুলোর Gross", value: amount(r.gross) },
        { label: "লেখা Net", value: amount(r.totalNet) },
        { label: "লাইনগুলোর Net", value: amount(r.net) },
      ],
    });
  }
  for (const l of lines) {
    const month = monthName(l.year, l.month);
    const href = hrHref.payrollRun(l.runId);
    const netPay = dec(l.netPay);
    const paid = dec(l.paid);
    if (!netPay.equals(dec(l.formula))) {
      items.push({
        id: `net-${l.id}`,
        severity: "IMPORTANT",
        title: `${month}: ${l.employee}-এর নিট বেতন ${amount(netPay)} লেখা, কিন্তু তার লাইনের হিসাবে হয় ${amount(l.formula)}`,
        href,
        place: `Payroll ${month}`,
        why: "নিট বেতন = মোট বেতন + ফেরত পাওয়া খরচ - অগ্রিম কাটা - ট্যাক্স - অন্য কাটা। না মিললে কর্মীকে ভুল টাকা দেওয়া হতে পারে।",
        fix:
          l.status === "DRAFT"
            ? "কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। মাসটি খুলে “Work it out again” চাপুন: ERP লাইনগুলো নতুন করে হিসাব করবে।"
            : "কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। বেতন দেওয়া না হয়ে থাকলে মাসটি “Reopen” করে “Work it out again” চাপুন, তারপর আবার “Approve” দিন; দেওয়া হয়ে থাকলে হিসাবরক্ষককে দেখান।",
        fixKind: "MANUAL",
        evidence: [
          { label: "মাস", value: month },
          { label: "কর্মী", value: l.employee },
          { label: "লেখা নিট বেতন", value: amount(netPay) },
          { label: "লাইনের হিসাবে", value: amount(l.formula) },
        ],
      });
      continue;
    }
    if (paid.gt(netPay)) {
      items.push({
        id: `overpaid-${l.id}`,
        severity: "IMPORTANT",
        title: `${month}: ${l.employee}-কে নিট বেতন ${amount(netPay)}-এর বেশি (${amount(paid)}) দেওয়া হয়েছে`,
        href,
        place: `Payroll ${month}`,
        why: "একজন কর্মীকে তার মাসের নিট বেতনের বেশি দেওয়া হয় না। বেশি দেওয়া টাকা হয় ভুল, নয়তো অগ্রিম হিসেবে লেখা উচিত ছিল।",
        fix: "টাকা নড়াচড়া করা Bug Guard-এর কাজ নয়। বাড়তি পরিশোধটি “Void the payment” দিয়ে বাতিল করে সঠিক অঙ্কে আবার দিন, বা বাড়তিটা অগ্রিম হিসেবে লিখুন। হিসাবরক্ষককে দেখান।",
        fixKind: "MANUAL",
        evidence: [
          { label: "মাস", value: month },
          { label: "কর্মী", value: l.employee },
          { label: "নিট বেতন", value: amount(netPay) },
          { label: "দেওয়া হয়েছে", value: amount(paid) },
        ],
      });
      continue;
    }
    // Paid in full or not decides the run's status and the line's payment link: a change that
    // would move it is left to the owner.
    const fullBefore = dec(l.paidAmount).gte(netPay);
    const fullAfter = paid.gte(netPay);
    const plan =
      fullBefore === fullAfter
        ? setPlan([
            {
              model: "PayrollItem",
              id: l.id,
              field: "paidAmount",
              before: fixed(l.paidAmount),
              after: fixed(paid),
              label: `${month}: ${l.employee}-কে দেওয়া`,
            },
          ])
        : null;
    items.push({
      id: l.id,
      severity: "IMPORTANT",
      title: `${month}: ${l.employee}-কে দেওয়া লেখা ${amount(l.paidAmount)}, কিন্তু বেতন পরিশোধগুলোতে (বাতিল বাদে) ${amount(paid)}`,
      href,
      place: `Payroll ${month}`,
      why: "কর্মীকে কত দেওয়া হয়েছে তা হলো তার বেতন পরিশোধগুলোর (বাতিল বাদে) যোগফল। ভুল হলে কাকে কত দেওয়া বাকি তা ভুল দেখায়, আর আবার বা কম দেওয়া হতে পারে।",
      fix: plan
        ? SET_FIX
        : "এটা ঠিক করলে বেতন পুরো দেওয়া হয়েছে কি না তাও বদলায়, যা Bug Guard নিজে বদলায় না। হিসাবরক্ষক বা ডেভেলপারকে দেখান।",
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "মাস", value: month },
        { label: "কর্মী", value: l.employee },
        { label: "নিট বেতন", value: amount(netPay) },
        { label: "লেখা দেওয়া", value: amount(l.paidAmount) },
        { label: "পরিশোধগুলোতে", value: amount(paid) },
      ],
    });
  }
  for (const p of payments) {
    items.push({
      id: `payment-${p.id}`,
      severity: "IMPORTANT",
      title: `বেতন পরিশোধ ${p.number}: ${amount(p.amount)} আর ${p.employeeCount} জন লেখা, কিন্তু তার লাইনে ${amount(p.lines)} আর ${p.count} জন`,
      href: hrHref.payrollRun(p.runId),
      place: p.number,
      why: "বেতন পরিশোধের মোট আর কর্মীর সংখ্যা তার লাইনগুলো থেকে আসে, আর খাতার এন্ট্রিও সেই মোটের। না মিললে কাকে কত দেওয়া হলো আর ক্যাশ-ব্যাংক থেকে কত গেল তা আলাদা দেখায়।",
      fix: "কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। পরিশোধটি “Void the payment” দিয়ে বাতিল করে আবার দিন, বা হিসাবরক্ষককে দেখান।",
      fixKind: "MANUAL",
      evidence: [
        { label: "পরিশোধ", value: p.number },
        { label: "লেখা টাকা", value: amount(p.amount) },
        { label: "লাইনগুলোর যোগফল", value: amount(p.lines) },
        { label: "লেখা কর্মী", value: String(p.employeeCount) },
        { label: "লাইন", value: String(p.count) },
      ],
    });
  }
  for (const a of advances) {
    const isVoid = a.status === "VOID";
    const left = isVoid ? ZERO : dec(a.amount).minus(dec(a.settled));
    if (dec(a.outstanding).equals(left)) continue;
    // Open or settled follows what is left: a change that would move it is left to the owner.
    const statusAfter = left.isZero() ? "SETTLED" : "OPEN";
    const plan =
      !left.isNegative() && (isVoid || statusAfter === a.status)
        ? setPlan([
            {
              model: "SalaryAdvance",
              id: a.id,
              field: "outstanding",
              before: fixed(a.outstanding),
              after: fixed(left),
              label: `অগ্রিম ${a.number}-এ বাকি`,
            },
          ])
        : null;
    items.push({
      id: a.id,
      severity: "IMPORTANT",
      title: `অগ্রিম ${a.number} (${a.employee}): বাকি ${amount(a.outstanding)} লেখা, কিন্তু ${isVoid ? "বাতিল অগ্রিমে বাকি থাকে না" : `অগ্রিম ${amount(a.amount)} থেকে ফেরত ${amount(a.settled)} বাদে ${amount(left)}`}`,
      href: hrHref.advance(a.id),
      place: a.number,
      why: "অগ্রিমের বাকি = অগ্রিম - যা বেতন থেকে কাটা বা ফেরত দেওয়া হয়েছে (বাতিল করা বাদে)। ভুল হলে বেতন থেকে ভুল অঙ্ক কাটা হতে পারে।",
      fix: plan
        ? SET_FIX
        : "এটা ঠিক করলে অগ্রিমের অবস্থাও (চালু, শোধ) বদলায়, যা Bug Guard নিজে বদলায় না। হিসাবরক্ষক বা ডেভেলপারকে দেখান।",
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "অগ্রিম", value: a.number },
        { label: "কর্মী", value: a.employee },
        { label: "তারিখ", value: dayOf(a.givenAt, timezone) },
        { label: "অগ্রিম", value: amount(a.amount) },
        { label: "ফেরত/কাটা", value: amount(a.settled) },
        { label: "লেখা বাকি", value: amount(a.outstanding) },
        { label: "অবস্থা", value: a.status },
      ],
    });
  }
  return findings(PAYROLL, items, "বেতন আর অগ্রিমের অমিল");
}

// -----------------------------------------------------------------------------
// CM settlements: payable = total CM - deductions - paid, one standing
// settlement per batch, and faults taken off only on a standing one
// -----------------------------------------------------------------------------

const CM = "data.totals.cm";

async function cmTotals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const [settlements, doubles, faults] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        batchId: string;
        totalCm: Prisma.Decimal;
        deductions: Prisma.Decimal;
        paid: Prisma.Decimal;
        payable: Prisma.Decimal;
      }>
    >`
      SELECT s.id, s.number, s."batchId", s."totalCm", s.deductions, s.paid, s.payable
      FROM "CmSettlement" s
      WHERE s."companyId" = ${companyId} AND s."undoneAt" IS NULL
        AND s.payable <> s."totalCm" - s.deductions - s.paid`,
    ctx.db.$queryRaw<Array<{ batchId: string; code: string; numbers: string[]; count: number }>>`
      SELECT s."batchId", b.code, ARRAY_AGG(s.number ORDER BY s.number) AS numbers, COUNT(*)::int AS count
      FROM "CmSettlement" s
      JOIN "ProductionBatch" b ON b.id = s."batchId"
      WHERE s."companyId" = ${companyId} AND s."undoneAt" IS NULL
      GROUP BY s."batchId", b.code
      HAVING COUNT(*) > 1`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        amount: Prisma.Decimal | null;
        settlement: string;
        batchId: string;
      }>
    >`
      SELECT f.id, f.number, f.amount, s.number AS settlement, s."batchId"
      FROM "SupplierFault" f
      JOIN "CmSettlement" s ON s.id = f."cmSettlementId"
      WHERE f."companyId" = ${companyId} AND f.status = 'DEDUCTED'::"SupplierFaultStatus"
        AND s."undoneAt" IS NOT NULL`,
  ]);
  const settlementHref = (batchId: string) => `${productionHref.batch(batchId)}/cm-settlement`;
  const items: Item[] = [];
  for (const s of settlements) {
    const formula = dec(s.totalCm).minus(dec(s.deductions)).minus(dec(s.paid));
    items.push({
      id: s.id,
      severity: "IMPORTANT",
      title: `CM সেটেলমেন্ট ${s.number}: চূড়ান্ত পাওনা ${amount(s.payable)} লেখা, কিন্তু মোট CM - কাটতি - দেওয়া = ${amount(formula)}`,
      href: settlementHref(s.batchId),
      place: s.number,
      why: "ফ্যাক্টরির চূড়ান্ত পাওনা = মোট CM - কাটতি (ফল্ট, বাড়তি রিজেক্ট, C-গ্রেড) - আগে দেওয়া টাকা। ভুল হলে ফ্যাক্টরিকে বেশি বা কম টাকা দেওয়া হতে পারে।",
      fix: "কোন অঙ্কটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। সেটেলমেন্ট পাতায় “Undo the settlement” চেপে আবার সেটেল করুন: ERP সব অঙ্ক নতুন করে হিসাব করবে।",
      fixKind: "MANUAL",
      evidence: [
        { label: "সেটেলমেন্ট", value: s.number },
        { label: "মোট CM", value: amount(s.totalCm) },
        { label: "কাটতি", value: amount(s.deductions) },
        { label: "আগে দেওয়া", value: amount(s.paid) },
        { label: "লেখা পাওনা", value: amount(s.payable) },
        { label: "হিসাবে পাওনা", value: amount(formula) },
      ],
    });
  }
  for (const d of doubles) {
    items.push({
      id: `batch-${d.batchId}`,
      severity: "IMPORTANT",
      title: `ব্যাচ ${d.code}-এর ${d.count}টি CM সেটেলমেন্ট একসাথে চালু: ${d.numbers.join(", ")}`,
      href: settlementHref(d.batchId),
      place: d.code,
      why: "একটা ব্যাচের CM একবারই সেটেল হয়; আবার করতে হলে আগেরটা বাতিল (Undo) করতে হয়। দুটো চালু থাকলে কাটতি ফ্যাক্টরির দেনা থেকে দুবার কাটা হয়।",
      fix: "কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। ভুলটা খুলে “Undo the settlement” চাপুন।",
      fixKind: "MANUAL",
      evidence: [
        { label: "ব্যাচ", value: d.code },
        { label: "চালু সেটেলমেন্ট", value: d.numbers.join(", ") },
      ],
    });
  }
  for (const f of faults) {
    items.push({
      id: `fault-${f.id}`,
      severity: "IMPORTANT",
      title: `ফল্ট ${f.number} কাটা হয়েছে (Deducted) দেখায়, কিন্তু যে সেটেলমেন্টে কাটা হয়েছিল (${f.settlement}) তা বাতিল করা হয়েছে`,
      href: settlementHref(f.batchId),
      place: f.number,
      why: "সেটেলমেন্ট বাতিল করলে তার ফল্টগুলো আবার খোলা হয়, যাতে পরের সেটেলমেন্টে কাটা যায়। এটা খোলা না হওয়ায় ফ্যাক্টরির কাছ থেকে এই টাকা আর কাটা হবে না।",
      fix: "Bug Guard নিজে কিছু বদলায় না। হিসাবরক্ষককে দেখান: ফল্টটি আবার খুলে পরের সেটেলমেন্টে কাটতে হবে।",
      fixKind: "MANUAL",
      evidence: [
        { label: "ফল্ট", value: f.number },
        { label: "টাকা", value: f.amount ? amount(f.amount) : "-" },
        { label: "বাতিল সেটেলমেন্ট", value: f.settlement },
      ],
    });
  }
  return findings(CM, items, "CM সেটেলমেন্টের অমিল");
}

// -----------------------------------------------------------------------------
// Returns: a sales return's figures are its items', a supplier return's its lines'
// -----------------------------------------------------------------------------

const RETURNS = "data.totals.returns";

async function returnTotals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const [sales, purchases] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        goodsValue: Prisma.Decimal;
        discount: Prisma.Decimal;
        tax: Prisma.Decimal;
        amount: Prisma.Decimal;
        items: Prisma.Decimal;
      }>
    >`
      SELECT r.id, r.number, r."goodsValue", r.discount, r.tax, r.amount,
             COALESCE(SUM(i.amount), 0) AS items
      FROM "SalesReturn" r
      LEFT JOIN "SalesReturnItem" i ON i."returnId" = r.id
      WHERE r."companyId" = ${companyId}
      GROUP BY r.id
      HAVING r."goodsValue" <> COALESCE(SUM(i.amount), 0)
          OR r.amount <> r."goodsValue" - r.discount + r.tax`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        totalAmount: Prisma.Decimal;
        stockValue: Prisma.Decimal;
        lines: Prisma.Decimal;
        lineStock: Prisma.Decimal;
      }>
    >`
      SELECT r.id, r.number, r."totalAmount", r."stockValue",
             COALESCE(SUM(l.amount), 0) AS lines, COALESCE(SUM(l."stockValue"), 0) AS "lineStock"
      FROM "PurchaseReturn" r
      LEFT JOIN "PurchaseReturnLine" l ON l."purchaseReturnId" = r.id
      WHERE r."companyId" = ${companyId}
      GROUP BY r.id
      HAVING r."totalAmount" <> COALESCE(SUM(l.amount), 0)
          OR r."stockValue" <> COALESCE(SUM(l."stockValue"), 0)`,
  ]);
  const items: Item[] = [];
  for (const r of sales) {
    const formula = dec(r.goodsValue).minus(dec(r.discount)).plus(dec(r.tax));
    items.push({
      id: r.id,
      severity: "IMPORTANT",
      title: !dec(r.goodsValue).equals(dec(r.items))
        ? `সেলস রিটার্ন ${r.number}-এ মালের দাম ${amount(r.goodsValue)} লেখা, কিন্তু আইটেমগুলোর যোগফল ${amount(r.items)}`
        : `সেলস রিটার্ন ${r.number}-এর টাকা ${amount(r.amount)}, কিন্তু মালের দাম - ছাড় + ভ্যাট = ${amount(formula)}`,
      href: salesHref.salesReturn(r.id),
      place: r.number,
      why: "ফেরতের টাকা হলো ফেরত আসা আইটেমগুলোর দাম থেকে তাদের ভাগের ছাড় বাদ দিয়ে ভ্যাট যোগ করে। এই টাকাই ক্রেতার বকেয়া থেকে কমে, তাই ভুল হলে ক্রেতার ব্যালান্স ভুল।",
      fix: "কোন অঙ্কটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। রিটার্নটি “Void the return” দিয়ে বাতিল করে আবার লিখুন।",
      fixKind: "MANUAL",
      evidence: [
        { label: "রিটার্ন", value: r.number },
        { label: "আইটেমগুলোর যোগফল", value: amount(r.items) },
        { label: "মালের দাম", value: amount(r.goodsValue) },
        { label: "ছাড়", value: amount(r.discount) },
        { label: "ভ্যাট", value: amount(r.tax) },
        { label: "লেখা টাকা", value: amount(r.amount) },
      ],
    });
  }
  for (const r of purchases) {
    items.push({
      id: r.id,
      severity: "IMPORTANT",
      title: `সরবরাহকারীকে ফেরত ${r.number}: ${amount(r.totalAmount)} আর স্টকের দাম ${amount(r.stockValue)} লেখা, কিন্তু লাইনগুলোতে ${amount(r.lines)} আর ${amount(r.lineStock)}`,
      href: materialsHref.supplierReturn(r.id),
      place: r.number,
      why: "সরবরাহকারী যা ফেরত দেবে আর স্টোর থেকে যে দামের মাল বের হলো, দুটোই ফেরতের লাইনগুলোর যোগফল। ভুল হলে সরবরাহকারীর দেনা আর ম্যাটেরিয়ালের দাম ভুল দেখায়।",
      fix: "কোন অঙ্কটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। ফেরতটি “Void the return” দিয়ে বাতিল করে আবার লিখুন।",
      fixKind: "MANUAL",
      evidence: [
        { label: "ফেরত", value: r.number },
        { label: "লেখা টাকা", value: amount(r.totalAmount) },
        { label: "লাইনগুলোর টাকা", value: amount(r.lines) },
        { label: "লেখা স্টকের দাম", value: amount(r.stockValue) },
        { label: "লাইনগুলোর স্টকের দাম", value: amount(r.lineStock) },
      ],
    });
  }
  return findings(RETURNS, items, "ফেরতের মোটের অমিল");
}

// -----------------------------------------------------------------------------
// Production projects: the cost kept on each is its bills, costs and materials
// -----------------------------------------------------------------------------

const PROJECTS = "data.totals.projects";

async function projectTotals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const projects = await ctx.db.productionProject.findMany({
    where: { companyId },
    select: { id: true, code: true, name: true, totalCost: true },
    orderBy: { code: "asc" },
  });
  const costs = await projectCostSummaries(
    ctx.db,
    companyId,
    projects.map((p) => p.id),
  );
  const items: Item[] = [];
  for (const p of projects) {
    const c = costs.get(p.id);
    if (!c || c.totalCost.equals(p.totalCost)) continue;
    const plan = setPlan([
      {
        model: "ProductionProject",
        id: p.id,
        field: "totalCost",
        before: fixed(p.totalCost),
        after: fixed(c.totalCost),
        label: `${p.code}-এর মোট খরচ`,
      },
    ]);
    items.push({
      id: p.id,
      severity: "IMPORTANT",
      title: `প্রজেক্ট ${p.code}-এর মোট খরচ ${amount(p.totalCost)} লেখা, কিন্তু তার বিল, খরচ আর ম্যাটেরিয়াল মিলে ${amount(c.totalCost)}`,
      href: productionHref.project(p.id),
      place: `${p.code} ${p.name}`,
      why: "প্রজেক্টের মোট খরচ = তার ভাগের সরবরাহকারীর বিল + সরাসরি খরচ + স্টোর থেকে দেওয়া ম্যাটেরিয়াল (ফেরত বাদে)। এই অঙ্ক থেকেই প্রতি পিসের খরচ আর খরচের সতর্কতা (টার্গেট দামের কাছে বা উপরে) দেখানো হয়, তাই ভুল হলে ভুল সতর্কতা আসে বা আসল সতর্কতা আসে না।",
      fix: plan ? SET_FIX : DEFAULT_MANUAL,
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "প্রজেক্ট", value: `${p.code} ${p.name}` },
        { label: "লেখা মোট খরচ", value: amount(p.totalCost) },
        { label: "বিল", value: amount(c.billCost) },
        { label: "সরাসরি খরচ", value: amount(c.directCost) },
        { label: "ম্যাটেরিয়াল", value: amount(c.materialCost) },
        { label: "যোগফল", value: amount(c.totalCost) },
      ],
    });
  }
  return findings(PROJECTS, items, "প্রজেক্টের খরচের অমিল");
}

export const TOTALS_CHECKS: Check[] = [
  { key: PURCHASE, area: "DATA", label: "Purchase orders add up", run: purchaseTotals },
  { key: SALES, area: "DATA", label: "Sales documents add up", run: salesTotals },
  { key: BILLS, area: "DATA", label: "Supplier bills add up", run: billTotals },
  { key: PAYROLL, area: "DATA", label: "Payroll and advances add up", run: payrollTotals },
  { key: CM, area: "DATA", label: "CM settlements add up", run: cmTotals },
  { key: RETURNS, area: "DATA", label: "Returns add up", run: returnTotals },
  { key: PROJECTS, area: "DATA", label: "Production costs add up", run: projectTotals },
];
