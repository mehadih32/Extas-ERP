import { Prisma } from "@prisma/client";

import { accountsHref } from "@/components/accounts/labels";
import { hrHref } from "@/components/hr/labels";
import { materialsHref } from "@/components/materials/labels";
import { partyHref } from "@/components/parties/labels";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";

import type { Check, CheckContext } from "../types";
import { amount, companyOf, dateOf, dayOf, findings, type Item } from "./data-common";

/*
 * How records hang together: every link stays inside the company, the same
 * payment or bill is not entered twice, a record does not stand on a cancelled
 * or voided parent, a booking is on its batch, and dates come in order.
 */

/** The screen of a record of these models, when it has one. */
const SCREENS: Record<string, (id: string) => string> = {
  SalesOrder: salesHref.order,
  Invoice: salesHref.invoice,
  ProformaInvoice: salesHref.proforma,
  Quotation: salesHref.quotation,
  SalesReturn: salesHref.salesReturn,
  PurchaseOrder: materialsHref.order,
  PurchaseReturn: materialsHref.supplierReturn,
  ProductionProject: productionHref.project,
  ProductionBatch: productionHref.batch,
  StockIntake: productionHref.delivery,
  Expense: accountsHref.expense,
  JournalEntry: accountsHref.entry,
  SalaryAdvance: hrHref.advance,
  PayrollRun: hrHref.payrollRun,
  OrderCosting: productionHref.costing,
};

/** What the owner calls a record of these models (Bengali). */
const NAMES: Record<string, string> = {
  Payment: "পেমেন্ট",
  Refund: "রিফান্ড",
  SalesOrder: "অর্ডার",
  Invoice: "ইনভয়েস",
  ProformaInvoice: "প্রোফর্মা",
  Quotation: "কোটেশন",
  SalesReturn: "সেলস রিটার্ন",
  SupplierBill: "বিল",
  PurchaseOrder: "পারচেজ অর্ডার",
  PurchaseReturn: "সরবরাহকারীকে ফেরত",
  Booking: "বুকিং",
  Expense: "খরচ",
  ProductionProject: "প্রজেক্ট",
  ProductionBatch: "ব্যাচ",
  CmSettlement: "CM সেটেলমেন্ট",
  StockIntake: "ডেলিভারি",
  SalaryAdvance: "অগ্রিম",
  PayrollPayment: "বেতন পরিশোধ",
  PayrollItem: "বেতনের লাইন",
  StockBalance: "স্টক",
  StockMovement: "স্টকের আসা-যাওয়া",
  RawMaterialStock: "ম্যাটেরিয়ালের স্টক",
  RawMaterialMovement: "ম্যাটেরিয়ালের আসা-যাওয়া",
  OrderCosting: "কস্টিং",
  SupplierFault: "ফল্ট",
  CreditAllocation: "ক্রেডিট ব্যবহার",
  JournalEntry: "জার্নাল এন্ট্রি",
};

// -----------------------------------------------------------------------------
// Every link stays inside the company
// -----------------------------------------------------------------------------

const COMPANY = "data.links.company";

/** [model, its number column, the link, the model it points at] */
const LINKS: Array<[string, string, string, string]> = [
  ["Payment", "number", "partyId", "Party"],
  ["Payment", "number", "accountId", "LedgerAccount"],
  ["Payment", "number", "orderId", "SalesOrder"],
  ["Payment", "number", "invoiceId", "Invoice"],
  ["Payment", "number", "proformaId", "ProformaInvoice"],
  ["Payment", "number", "supplierBillId", "SupplierBill"],
  ["Payment", "number", "projectId", "ProductionProject"],
  ["Payment", "number", "batchId", "ProductionBatch"],
  ["Refund", "number", "partyId", "Party"],
  ["Refund", "number", "orderId", "SalesOrder"],
  ["Refund", "number", "proformaId", "ProformaInvoice"],
  ["Refund", "number", "accountId", "LedgerAccount"],
  ["SalesOrder", "number", "partyId", "Party"],
  ["SalesOrder", "number", "warehouseId", "Warehouse"],
  ["SalesOrder", "number", "proformaId", "ProformaInvoice"],
  ["Invoice", "number", "orderId", "SalesOrder"],
  ["Invoice", "number", "partyId", "Party"],
  ["ProformaInvoice", "number", "partyId", "Party"],
  ["ProformaInvoice", "number", "quotationId", "Quotation"],
  ["Quotation", "number", "partyId", "Party"],
  ["SalesReturn", "number", "orderId", "SalesOrder"],
  ["SalesReturn", "number", "invoiceId", "Invoice"],
  ["SalesReturn", "number", "partyId", "Party"],
  ["CreditAllocation", "id", "partyId", "Party"],
  ["CreditAllocation", "id", "orderId", "SalesOrder"],
  ["SupplierBill", "number", "supplierId", "Party"],
  ["SupplierBill", "number", "purchaseOrderId", "PurchaseOrder"],
  ["SupplierBill", "number", "warehouseId", "Warehouse"],
  ["PurchaseOrder", "number", "supplierId", "Party"],
  ["PurchaseOrder", "number", "projectId", "ProductionProject"],
  ["PurchaseOrder", "number", "batchId", "ProductionBatch"],
  ["PurchaseReturn", "number", "supplierId", "Party"],
  ["PurchaseReturn", "number", "billId", "SupplierBill"],
  ["Booking", "id", "orderId", "PurchaseOrder"],
  ["Expense", "number", "headId", "ExpenseHead"],
  ["Expense", "number", "paidFromAccountId", "LedgerAccount"],
  ["Expense", "number", "supplierId", "Party"],
  ["Expense", "number", "projectId", "ProductionProject"],
  ["Expense", "number", "employeeId", "Employee"],
  ["ProductionProject", "code", "buyerId", "Party"],
  ["ProductionProject", "code", "factoryId", "Party"],
  ["ProductionProject", "code", "batchId", "ProductionBatch"],
  ["ProductionProject", "code", "styleId", "Style"],
  ["ProductionProject", "code", "salesOrderId", "SalesOrder"],
  ["ProductionBatch", "code", "factoryId", "Party"],
  ["CmSettlement", "number", "batchId", "ProductionBatch"],
  ["CmSettlement", "number", "factoryId", "Party"],
  ["SupplierFault", "number", "supplierId", "Party"],
  ["StockIntake", "number", "projectId", "ProductionProject"],
  ["StockIntake", "number", "warehouseId", "Warehouse"],
  ["OrderCosting", "number", "buyerId", "Party"],
  ["OrderCosting", "number", "salesOrderId", "SalesOrder"],
  ["SalaryAdvance", "number", "employeeId", "Employee"],
  ["PayrollPayment", "number", "runId", "PayrollRun"],
  ["PayrollPayment", "number", "accountId", "LedgerAccount"],
  ["StockBalance", "id", "variantId", "ProductVariant"],
  ["StockBalance", "id", "warehouseId", "Warehouse"],
  ["StockMovement", "id", "variantId", "ProductVariant"],
  ["StockMovement", "id", "warehouseId", "Warehouse"],
  ["RawMaterialStock", "id", "rawMaterialId", "RawMaterial"],
  ["RawMaterialStock", "id", "warehouseId", "Warehouse"],
  ["RawMaterialMovement", "id", "rawMaterialId", "RawMaterial"],
  ["RawMaterialMovement", "id", "warehouseId", "Warehouse"],
];

/** What a linked record is, in the owner's words. */
const TARGET_NAMES: Record<string, string> = {
  Party: "ক্রেতা বা সরবরাহকারী",
  LedgerAccount: "খাতা",
  SalesOrder: "অর্ডার",
  Invoice: "ইনভয়েস",
  ProformaInvoice: "প্রোফর্মা",
  Quotation: "কোটেশন",
  SupplierBill: "বিল",
  PurchaseOrder: "পারচেজ অর্ডার",
  ProductionProject: "প্রজেক্ট",
  ProductionBatch: "ব্যাচ",
  Warehouse: "গুদাম",
  ExpenseHead: "খরচের খাত",
  Employee: "কর্মী",
  Style: "স্টাইল",
  PayrollRun: "বেতনের মাস",
  ProductVariant: "SKU",
  RawMaterial: "ম্যাটেরিয়াল",
};

/** Links that say more than what they point at. */
const LINK_NAMES: Record<string, string> = {
  buyerId: "ক্রেতা",
  factoryId: "ফ্যাক্টরি",
  supplierId: "সরবরাহকারী",
  paidFromAccountId: "যে খাতা থেকে টাকা গেছে",
};

const ident = (name: string) => Prisma.raw(`"${name}"`);

async function sameCompany(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const parts = LINKS.map(
    ([model, ref, field, target]) => Prisma.sql`
      SELECT ${model}::text AS model, x.id, x.${ident(ref)}::text AS ref, ${field}::text AS field,
             ${target}::text AS target
      FROM ${ident(model)} x
      JOIN ${ident(target)} t ON t.id = x.${ident(field)}
      WHERE x."companyId" = ${companyId} AND t."companyId" <> x."companyId"`,
  );
  const [links, lines, payroll] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{ model: string; id: string; ref: string; field: string; target: string }>
    >`SELECT * FROM (${Prisma.join(parts, " UNION ALL ")}) links LIMIT 200`,
    ctx.db.$queryRaw<
      Array<{ id: string; number: string; accounts: number; parties: number; employees: number }>
    >`
      SELECT je.id, je.number,
             (COUNT(*) FILTER (WHERE la."companyId" <> je."companyId"))::int AS accounts,
             (COUNT(*) FILTER (WHERE p."companyId" <> je."companyId"))::int AS parties,
             (COUNT(*) FILTER (WHERE e."companyId" <> je."companyId"))::int AS employees
      FROM "JournalLine" jl
      JOIN "JournalEntry" je ON je.id = jl."entryId"
      JOIN "LedgerAccount" la ON la.id = jl."accountId"
      LEFT JOIN "Party" p ON p.id = jl."partyId"
      LEFT JOIN "Employee" e ON e.id = jl."employeeId"
      WHERE je."companyId" = ${companyId}
        AND (la."companyId" <> je."companyId" OR p."companyId" <> je."companyId"
             OR e."companyId" <> je."companyId")
      GROUP BY je.id
      LIMIT 200`,
    ctx.db.$queryRaw<Array<{ id: string; runId: string; year: number; month: number }>>`
      SELECT i.id, r.id AS "runId", r.year, r.month
      FROM "PayrollItem" i
      JOIN "PayrollRun" r ON r.id = i."runId"
      JOIN "Employee" e ON e.id = i."employeeId"
      WHERE r."companyId" = ${companyId} AND e."companyId" <> r."companyId"
      LIMIT 200`,
  ]);
  const why =
    "প্রতিটি কোম্পানির হিসাব আলাদা থাকে; এক কোম্পানির কাগজ বা খাতা কখনো আরেক কোম্পানির ক্রেতা, খাতা, কর্মী বা অর্ডারে যায় না। গেলে দুই কোম্পানির ব্যালান্স আর রিপোর্টই ভুল হয়, আর একজনের তথ্য আরেকজন দেখে ফেলতে পারে।";
  const fix =
    "কীভাবে এমন হলো তা ডেভেলপারকে দিয়ে দেখাতে হবে, আর কাগজটা ঠিক কোম্পানিতে আবার লিখতে হবে। Bug Guard নিজে কিছু বদলায় না।";
  const items: Item[] = [];
  // A payment opens on the sales or the supplier side, by its direction.
  const paymentIds = links.filter((l) => l.model === "Payment").map((l) => l.id);
  const paid = new Set(
    paymentIds.length === 0
      ? []
      : (
          await ctx.db.payment.findMany({
            where: { id: { in: paymentIds }, companyId, direction: "PAID" },
            select: { id: true },
          })
        ).map((p) => p.id),
  );
  const screenOf = (l: { model: string; id: string }) =>
    l.model === "Payment"
      ? paid.has(l.id)
        ? accountsHref.payment(l.id)
        : salesHref.payment(l.id)
      : (SCREENS[l.model]?.(l.id) ?? null);
  for (const l of links) {
    const name = NAMES[l.model] ?? l.model;
    const link = LINK_NAMES[l.field] ?? TARGET_NAMES[l.target] ?? l.target;
    items.push({
      id: `${l.id}-${l.field}`,
      severity: "URGENT",
      title: `${name} ${l.ref}-এর ${link} অন্য কোম্পানির`,
      href: screenOf(l),
      place: `${name} ${l.ref}`,
      why,
      fix,
      fixKind: "MANUAL",
      evidence: [
        { label: "রেকর্ড", value: `${name} ${l.ref}` },
        { label: "যে লিংক", value: link },
        { label: "যার দিকে", value: TARGET_NAMES[l.target] ?? l.target },
      ],
    });
  }
  for (const e of lines) {
    items.push({
      id: e.id,
      severity: "URGENT",
      title: `জার্নাল এন্ট্রি ${e.number}-এর লাইন অন্য কোম্পানির ${[
        e.accounts > 0 ? "খাতায়" : "",
        e.parties > 0 ? "ক্রেতা বা সরবরাহকারীর নামে" : "",
        e.employees > 0 ? "কর্মীর নামে" : "",
      ]
        .filter(Boolean)
        .join(", ")} পড়েছে`,
      href: accountsHref.entry(e.id),
      place: e.number,
      why,
      fix,
      fixKind: "MANUAL",
      evidence: [
        { label: "এন্ট্রি", value: e.number },
        { label: "অন্য কোম্পানির খাতা", value: String(e.accounts) },
        { label: "অন্য কোম্পানির ক্রেতা/সরবরাহকারী", value: String(e.parties) },
        { label: "অন্য কোম্পানির কর্মী", value: String(e.employees) },
      ],
    });
  }
  for (const p of payroll) {
    const month = `${p.year}-${String(p.month).padStart(2, "0")}`;
    items.push({
      id: p.id,
      severity: "URGENT",
      title: `${month} মাসের বেতনে অন্য কোম্পানির একজন কর্মী আছেন`,
      href: hrHref.payrollRun(p.runId),
      place: `Payroll ${month}`,
      why,
      fix,
      fixKind: "MANUAL",
      evidence: [{ label: "মাস", value: month }],
    });
  }
  return findings(COMPANY, items, "অন্য কোম্পানির রেকর্ডে লিংক");
}

// -----------------------------------------------------------------------------
// The same payment or bill entered twice; the same party made twice
// -----------------------------------------------------------------------------

const DUPLICATES = "data.links.duplicates";

async function duplicates(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const { timezone } = await companyOf(ctx);
  const [payments, bills, parties] = await Promise.all([
    // Same direction, party, amount, account, day, reference and document, both standing.
    ctx.db.$queryRaw<
      Array<{
        ids: string[];
        numbers: string[];
        direction: "RECEIVED" | "PAID";
        party: string;
        amount: Prisma.Decimal;
        account: string;
        day: Date;
      }>
    >`
      WITH live AS (
        SELECT p.*, ((p."paymentDate" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}::text)::date AS day
        FROM "Payment" p
        JOIN "JournalEntry" je ON je.id = p."journalEntryId" AND je."isReversed" = false
        WHERE p."companyId" = ${companyId}
      )
      SELECT ARRAY_AGG(p.id ORDER BY p."createdAt", p.id) AS ids,
             ARRAY_AGG(p.number ORDER BY p."createdAt", p.id) AS numbers,
             p.direction::text AS direction, MIN(pa.name) AS party, p.amount, MIN(la.name) AS account,
             p.day
      FROM live p
      JOIN "Party" pa ON pa.id = p."partyId"
      JOIN "LedgerAccount" la ON la.id = p."accountId"
      GROUP BY p.direction, p."partyId", p.amount, p."accountId", p.day,
               COALESCE(p.reference, ''), COALESCE(p."orderId", ''), COALESCE(p."invoiceId", ''),
               COALESCE(p."proformaId", ''), COALESCE(p."supplierBillId", '')
      HAVING COUNT(*) > 1
      LIMIT 200`,
    // The supplier's own bill number twice.
    ctx.db.$queryRaw<
      Array<{
        ids: string[];
        numbers: string[];
        ref: string;
        supplier: string;
        material: boolean[];
      }>
    >`
      SELECT ARRAY_AGG(b.id ORDER BY b."createdAt", b.id) AS ids,
             ARRAY_AGG(b.number ORDER BY b."createdAt", b.id) AS numbers,
             MIN(b."supplierRef") AS ref, MIN(pa.name) AS supplier,
             ARRAY_AGG(b."warehouseId" IS NOT NULL ORDER BY b."createdAt", b.id) AS material
      FROM "SupplierBill" b
      JOIN "Party" pa ON pa.id = b."supplierId"
      WHERE b."companyId" = ${companyId} AND b.status <> 'VOID'::"BillStatus"
        AND b."supplierRef" IS NOT NULL AND TRIM(b."supplierRef") <> ''
      GROUP BY b."supplierId", LOWER(TRIM(b."supplierRef"))
      HAVING COUNT(*) > 1
      LIMIT 200`,
    // The same name and phone (the last 10 digits) on two parties.
    ctx.db.$queryRaw<
      Array<{ ids: string[]; codes: string[]; kinds: string[]; name: string; phone: string }>
    >`
      SELECT ARRAY_AGG(p.id ORDER BY p."createdAt", p.id) AS ids,
             ARRAY_AGG(p.code ORDER BY p."createdAt", p.id) AS codes,
             ARRAY_AGG(p.kind::text ORDER BY p."createdAt", p.id) AS kinds,
             MIN(p.name) AS name, MIN(p.phone) AS phone
      FROM "Party" p
      WHERE p."companyId" = ${companyId} AND p."systemRole" IS NULL
        AND LENGTH(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g')) >= 7
      GROUP BY LOWER(REGEXP_REPLACE(TRIM(p.name), '[[:space:]]+', ' ', 'g')),
               RIGHT(REGEXP_REPLACE(p.phone, '[^0-9]', '', 'g'), 10)
      HAVING COUNT(*) > 1
      LIMIT 200`,
  ]);
  const items: Item[] = [];
  for (const p of payments) {
    const later = p.ids[1]!;
    const received = p.direction === "RECEIVED";
    items.push({
      id: later,
      severity: "IMPORTANT",
      title: `${p.party}-${received ? "এর কাছ থেকে" : "কে"} একই দিনে একই খাতায় ${amount(p.amount)} করে ${p.ids.length}টি পেমেন্ট: ${p.numbers.join(", ")}`,
      href: received ? salesHref.payment(later) : accountsHref.payment(later),
      place: p.numbers[1],
      why: "একই টাকা দুবার লেখা হলে ক্যাশ-ব্যাংকে টাকা বেশি দেখায়, আর ক্রেতার বকেয়া কম বা সরবরাহকারীর দেনা কম দেখায়। সত্যিই দুটো আলাদা পেমেন্ট হলে কোনো সমস্যা নেই।",
      fix: received
        ? "ব্যাংক বা ক্যাশের হিসাবের সাথে মিলিয়ে দেখুন সত্যিই দুবার টাকা এসেছে কি না। একটা ভুল হলে হিসাবরক্ষককে দেখান (ক্রেতার পেমেন্ট বাতিল করা যায় না, তাই উল্টো এন্ট্রি দিয়ে ঠিক করতে হয়)। কোনটা ভুল Bug Guard জানে না, তাই নিজে কিছু বদলায় না।"
        : "ব্যাংক বা ক্যাশের হিসাবের সাথে মিলিয়ে দেখুন সত্যিই দুবার টাকা গেছে কি না। একটা ভুল হলে সেটা খুলে “Void the payment” দিয়ে বাতিল করুন। কোনটা ভুল Bug Guard জানে না, তাই নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: received ? "ক্রেতা" : "সরবরাহকারী", value: p.party },
        { label: "তারিখ", value: dateOf(p.day) },
        { label: "টাকা", value: amount(p.amount) },
        { label: "খাতা", value: p.account },
        { label: "পেমেন্ট", value: p.numbers.join(", ") },
      ],
    });
  }
  for (const b of bills) {
    const later = b.ids[1]!;
    const material = b.material[1] ?? false;
    items.push({
      id: later,
      severity: "IMPORTANT",
      title: `${b.supplier}-এর একই বিল নম্বর (${b.ref}) ${b.ids.length}টি বিলে লেখা: ${b.numbers.join(", ")}`,
      href: material ? materialsHref.purchase(later) : productionHref.bill(later),
      place: b.numbers[1],
      why: "সরবরাহকারীর একটা বিল একবারই লেখার কথা। দুবার লেখা হলে তার দেনা দ্বিগুণ দেখায়, আর একই টাকা দুবার দেওয়া হতে পারে।",
      fix: `দুটো বিল সরবরাহকারীর আসল বিলের সাথে মিলিয়ে দেখুন। একটা বাড়তি হলে সেটা খুলে “${material ? "Void the purchase" : "Void the bill"}” দিয়ে বাতিল করুন। কোনটা বাড়তি Bug Guard জানে না, তাই নিজে কিছু বদলায় না।`,
      fixKind: "MANUAL",
      evidence: [
        { label: "সরবরাহকারী", value: b.supplier },
        { label: "সরবরাহকারীর বিল নম্বর", value: b.ref },
        { label: "বিলগুলো", value: b.numbers.join(", ") },
      ],
    });
  }
  for (const p of parties) {
    const later = p.ids[1]!;
    const kind = (p.kinds[1] ?? "BUYER") as "BUYER" | "SUPPLIER" | "BOTH";
    items.push({
      id: later,
      severity: "LATER",
      title: `একই নাম আর ফোনে ${p.ids.length}টি প্রোফাইল: ${p.name} (${p.codes.join(", ")})`,
      href: partyHref({ id: later, kind }),
      place: `${p.codes[1]} ${p.name}`,
      why: "একজন ক্রেতা বা সরবরাহকারীর দুটো প্রোফাইল থাকলে তার লেনদেন দুই জায়গায় ভাগ হয়ে যায়: বকেয়া, ইতিহাস আর রিপোর্ট কোনোটাই পুরো দেখায় না।",
      fix: "দুটো প্রোফাইল খুলে দেখুন একই মানুষ বা প্রতিষ্ঠান কি না। একই হলে এখন থেকে একটাতেই কাজ করুন, আর পুরনো বকেয়া থাকলে হিসাবরক্ষককে দিয়ে মিলিয়ে নিন। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "নাম", value: p.name },
        { label: "ফোন", value: p.phone },
        { label: "প্রোফাইল", value: p.codes.join(", ") },
      ],
    });
  }
  return findings(DUPLICATES, items, "সম্ভাব্য দুবার লেখা");
}

// -----------------------------------------------------------------------------
// Records on cancelled or voided parents, and bookings off their batch
// -----------------------------------------------------------------------------

const PARENTS = "data.links.parents";

async function parents(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const [invoices, returns, bills, payments, billSuppliers, bookings, shares, openOrders] =
    await Promise.all([
      // A standing invoice on a cancelled order (cancelling voids it).
      ctx.db.$queryRaw<Array<{ id: string; number: string; order: string; total: Prisma.Decimal }>>`
        SELECT i.id, i.number, o.number AS order, i.total
        FROM "Invoice" i JOIN "SalesOrder" o ON o.id = i."orderId"
        WHERE i."companyId" = ${companyId} AND i.status <> 'VOID'::"InvoiceStatus"
          AND o.status = 'CANCELLED'::"SalesOrderStatus"`,
      // A standing sales return on a void invoice (an invoice with returns cannot be voided).
      ctx.db.$queryRaw<
        Array<{ id: string; number: string; invoice: string; amount: Prisma.Decimal }>
      >`
        SELECT r.id, r.number, i.number AS invoice, r.amount
        FROM "SalesReturn" r JOIN "Invoice" i ON i.id = r."invoiceId"
        WHERE r."companyId" = ${companyId} AND r."voidedAt" IS NULL
          AND i.status = 'VOID'::"InvoiceStatus"`,
      // A standing bill on a cancelled purchase order.
      ctx.db.$queryRaw<
        Array<{
          id: string;
          number: string;
          order: string;
          isMaterial: boolean;
          total: Prisma.Decimal;
        }>
      >`
        SELECT b.id, b.number, po.number AS order, (b."warehouseId" IS NOT NULL) AS "isMaterial",
               b."totalAmount" AS total
        FROM "SupplierBill" b JOIN "PurchaseOrder" po ON po.id = b."purchaseOrderId"
        WHERE b."companyId" = ${companyId} AND b.status <> 'VOID'::"BillStatus"
          AND po.status = 'CANCELLED'::"PurchaseOrderStatus"`,
      // A buyer's payment on another buyer's order.
      ctx.db.$queryRaw<
        Array<{ id: string; number: string; order: string; payer: string; owner: string }>
      >`
        SELECT p.id, p.number, o.number AS order, pa.name AS payer, ob.name AS owner
        FROM "Payment" p
        JOIN "SalesOrder" o ON o.id = p."orderId"
        JOIN "Party" pa ON pa.id = p."partyId"
        JOIN "Party" ob ON ob.id = o."partyId"
        WHERE p."companyId" = ${companyId} AND p.direction = 'RECEIVED'::"PaymentDirection"
          AND p."partyId" <> o."partyId"`,
      // A supplier's bill on another supplier's purchase order.
      ctx.db.$queryRaw<
        Array<{
          id: string;
          number: string;
          order: string;
          isMaterial: boolean;
          billed: string;
          ordered: string;
        }>
      >`
        SELECT b.id, b.number, po.number AS order, (b."warehouseId" IS NOT NULL) AS "isMaterial",
               s.name AS billed, os.name AS ordered
        FROM "SupplierBill" b
        JOIN "PurchaseOrder" po ON po.id = b."purchaseOrderId"
        JOIN "Party" s ON s.id = b."supplierId"
        JOIN "Party" os ON os.id = po."supplierId"
        WHERE b."companyId" = ${companyId} AND b."supplierId" <> po."supplierId"`,
      // A booking for a style whose batch it is not on.
      ctx.db.$queryRaw<
        Array<{
          bookingId: string;
          number: string;
          project: string;
          projectBatchId: string;
          projectBatch: string;
          batch: string | null;
        }>
      >`
        SELECT bk.id AS "bookingId", po.number, pp.code AS project, pp."batchId" AS "projectBatchId",
               pb.code AS "projectBatch", ob.code AS batch
        FROM "Booking" bk
        JOIN "PurchaseOrder" po ON po.id = bk."orderId"
        JOIN "ProductionProject" pp ON pp.id = po."projectId"
        JOIN "ProductionBatch" pb ON pb.id = pp."batchId"
        LEFT JOIN "ProductionBatch" ob ON ob.id = po."batchId"
        WHERE bk."companyId" = ${companyId} AND po.status <> 'CANCELLED'::"PurchaseOrderStatus"
          AND po."batchId" IS DISTINCT FROM pp."batchId"`,
      // What a booking orders for styles that are not on its batch.
      ctx.db.$queryRaw<
        Array<{ bookingId: string; number: string; batch: string | null; projects: string[] }>
      >`
        SELECT bk.id AS "bookingId", po.number, ob.code AS batch,
               ARRAY_AGG(DISTINCT pp.code) AS projects
        FROM "PurchaseOrderLineShare" s
        JOIN "PurchaseOrderLine" l ON l.id = s."lineId"
        JOIN "PurchaseOrder" po ON po.id = l."orderId"
        JOIN "Booking" bk ON bk."orderId" = po.id
        JOIN "ProductionProject" pp ON pp.id = s."projectId"
        LEFT JOIN "ProductionBatch" ob ON ob.id = po."batchId"
        WHERE po."companyId" = ${companyId} AND po.status <> 'CANCELLED'::"PurchaseOrderStatus"
          AND pp."batchId" IS DISTINCT FROM po."batchId"
        GROUP BY bk.id, po.number, ob.code`,
      // An open purchase order for a cancelled style.
      ctx.db.$queryRaw<
        Array<{ id: string; number: string; project: string; bookingId: string | null }>
      >`
        SELECT po.id, po.number, pp.code AS project, bk.id AS "bookingId"
        FROM "PurchaseOrder" po
        JOIN "ProductionProject" pp ON pp.id = po."projectId"
        LEFT JOIN "Booking" bk ON bk."orderId" = po.id
        WHERE po."companyId" = ${companyId}
          AND po.status IN ('OPEN'::"PurchaseOrderStatus", 'PARTIALLY_RECEIVED'::"PurchaseOrderStatus")
          AND pp.status = 'CANCELLED'::"ProductionStatus"`,
    ]);
  const bookingHref = (id: string) => `/production/bookings/${encodeURIComponent(id)}`;
  const items: Item[] = [];
  for (const i of invoices) {
    items.push({
      id: i.id,
      severity: "IMPORTANT",
      title: `অর্ডার ${i.order} বাতিল, কিন্তু তার ইনভয়েস ${i.number} (${amount(i.total)}) এখনো চালু`,
      href: salesHref.invoice(i.id),
      place: i.number,
      why: "অর্ডার বাতিল করলে ERP তার ইনভয়েসও বাতিল করে। চালু থাকলে বাতিল অর্ডারের টাকা ক্রেতার বকেয়া আর বিক্রিতে থেকে যায়।",
      fix: "ইনভয়েসটি খুলে “Void the invoice” দিয়ে বাতিল করুন। Bug Guard নিজে কিছু বাতিল করে না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "অর্ডার", value: `${i.order} (CANCELLED)` },
        { label: "ইনভয়েস", value: i.number },
        { label: "মোট", value: amount(i.total) },
      ],
    });
  }
  for (const r of returns) {
    items.push({
      id: r.id,
      severity: "IMPORTANT",
      title: `ইনভয়েস ${r.invoice} বাতিল, কিন্তু তার সেলস রিটার্ন ${r.number} (${amount(r.amount)}) এখনো চালু`,
      href: salesHref.salesReturn(r.id),
      place: r.number,
      why: "রিটার্ন থাকা ইনভয়েস বাতিল করা যায় না, কারণ রিটার্নের টাকা সেই ইনভয়েস থেকেই কমে। এখন রিটার্নের টাকা এমন ইনভয়েস থেকে কমছে যা আর নেই, তাই ক্রেতার ব্যালান্স ভুল হতে পারে।",
      fix: "হিসাবরক্ষককে দেখান: রিটার্নটি “Void the return” দিয়ে বাতিল করে নতুন ইনভয়েসের উপর আবার লিখতে হতে পারে। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "রিটার্ন", value: r.number },
        { label: "ইনভয়েস", value: `${r.invoice} (VOID)` },
        { label: "টাকা", value: amount(r.amount) },
      ],
    });
  }
  for (const b of bills) {
    items.push({
      id: b.id,
      severity: "LATER",
      title: `পারচেজ অর্ডার ${b.order} বাতিল, কিন্তু তার উপর বিল ${b.number} (${amount(b.total)}) চালু`,
      href: b.isMaterial ? materialsHref.purchase(b.id) : productionHref.bill(b.id),
      place: b.number,
      why: "বাতিল অর্ডারের উপর মাল আসার কথা নয়। বিলটা সত্যিই এই অর্ডারের হলে অর্ডারটা বাতিল না করে বন্ধ (Close) করা উচিত ছিল, যাতে কতটা এসেছে তা ঠিক দেখায়।",
      fix: "বিল আর অর্ডার দুটো দেখুন। বিলটা ঠিক থাকলে কিছু করার নেই; ভুল অর্ডারে লেখা হলে হিসাবরক্ষককে দেখান। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "অর্ডার", value: `${b.order} (CANCELLED)` },
        { label: "বিল", value: b.number },
        { label: "মোট", value: amount(b.total) },
      ],
    });
  }
  for (const p of payments) {
    items.push({
      id: p.id,
      severity: "IMPORTANT",
      title: `পেমেন্ট ${p.number} ${p.payer}-এর, কিন্তু তা অর্ডার ${p.order}-এ বসানো, যা ${p.owner}-এর`,
      href: salesHref.payment(p.id),
      place: p.number,
      why: "একজনের টাকা আরেকজনের অর্ডারে বসলে একজনের অর্ডার শোধ দেখায় অথচ তার বকেয়া থাকে, আর আরেকজনের উল্টো।",
      fix: "দুজনের স্টেটমেন্ট মিলিয়ে হিসাবরক্ষককে দেখান। কার টাকা কোথায় যাবে Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "পেমেন্ট", value: p.number },
        { label: "যিনি দিয়েছেন", value: p.payer },
        { label: "অর্ডার", value: p.order },
        { label: "অর্ডার যার", value: p.owner },
      ],
    });
  }
  for (const b of billSuppliers) {
    items.push({
      id: `supplier-${b.id}`,
      severity: "IMPORTANT",
      title: `বিল ${b.number} ${b.billed}-এর, কিন্তু তা পারচেজ অর্ডার ${b.order}-এর উপর, যা ${b.ordered}-কে দেওয়া`,
      href: b.isMaterial ? materialsHref.purchase(b.id) : productionHref.bill(b.id),
      place: b.number,
      why: "একজন সরবরাহকারীর বিল আরেকজনের অর্ডারে বসলে কার কাছ থেকে কতটা এসেছে আর কার কত পাওনা, দুটোই ভুল দেখায়।",
      fix: `বিলটা সত্যিই কার, দেখুন। ভুল হলে বিলটি “${b.isMaterial ? "Void the purchase" : "Void the bill"}” দিয়ে বাতিল করে ঠিক অর্ডারে আবার লিখুন। Bug Guard নিজে কিছু বদলায় না।`,
      fixKind: "MANUAL",
      evidence: [
        { label: "বিল", value: b.number },
        { label: "বিলের সরবরাহকারী", value: b.billed },
        { label: "অর্ডার", value: b.order },
        { label: "অর্ডারের সরবরাহকারী", value: b.ordered },
      ],
    });
  }
  for (const b of bookings) {
    items.push({
      id: b.bookingId,
      severity: "IMPORTANT",
      title: b.batch
        ? `বুকিং ${b.number} স্টাইল ${b.project}-এর, যা ব্যাচ ${b.projectBatch}-এ, কিন্তু বুকিংটা ব্যাচ ${b.batch}-এ লাগানো`
        : `বুকিং ${b.number} স্টাইল ${b.project}-এর, যা ব্যাচ ${b.projectBatch}-এ, কিন্তু বুকিংটা কোনো ব্যাচে লাগানো নেই`,
      href: bookingHref(b.bookingId),
      place: b.number,
      why: "বুকিং তার ব্যাচে লাগানো থাকলে তবেই ব্যাচের ম্যাটেরিয়াল প্ল্যান, বুকিং বুক আর কতটা অর্ডার হয়েছে তাতে আসে। না থাকলে ব্যাচে মনে হয় এই ম্যাটেরিয়াল এখনো অর্ডারই হয়নি, আর আবার অর্ডার হয়ে যেতে পারে।",
      fix: b.batch
        ? `বুকিংটি খুলে “Take it off” দিয়ে ব্যাচ ${b.batch} থেকে সরান, তারপর “Attach” দিয়ে ব্যাচ ${b.projectBatch}-এ লাগান। Bug Guard নিজে কিছু বদলায় না।`
        : `বুকিংটি খুলে “Attach” দিয়ে ব্যাচ ${b.projectBatch}-এ লাগান। Bug Guard নিজে কিছু বদলায় না।`,
      fixKind: "MANUAL",
      evidence: [
        { label: "বুকিং", value: b.number },
        { label: "স্টাইল", value: b.project },
        { label: "স্টাইলের ব্যাচ", value: b.projectBatch },
        { label: "বুকিংয়ের ব্যাচ", value: b.batch ?? "নেই" },
      ],
    });
  }
  for (const s of shares) {
    if (bookings.some((b) => b.bookingId === s.bookingId)) continue;
    items.push({
      id: `shares-${s.bookingId}`,
      severity: "IMPORTANT",
      title: `বুকিং ${s.number}-এর পরিমাণ ${s.projects.join(", ")} স্টাইলের জন্য ধরা, কিন্তু সেগুলো ${s.batch ? `ব্যাচ ${s.batch}-এ নেই` : "বুকিংয়ের কোনো ব্যাচ নেই"}`,
      href: bookingHref(s.bookingId),
      place: s.number,
      why: "বুকিংয়ের প্রতিটি লাইনের পরিমাণ তার ব্যাচের স্টাইলগুলোর মধ্যে ভাগ করা থাকে। অন্য ব্যাচের স্টাইলে ভাগ থাকলে দুই ব্যাচেরই “কতটা অর্ডার হয়েছে” ভুল দেখায়।",
      fix: "বুকিংটি খুলে “Take it off” দিয়ে ব্যাচ থেকে সরান, তারপর “Attach” দিয়ে ঠিক ব্যাচে আবার লাগান: ERP ভাগগুলো নতুন করে করবে। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "বুকিং", value: s.number },
        { label: "বুকিংয়ের ব্যাচ", value: s.batch ?? "নেই" },
        { label: "অন্য ব্যাচের স্টাইল", value: s.projects.join(", ") },
      ],
    });
  }
  for (const o of openOrders) {
    items.push({
      id: `open-${o.id}`,
      severity: "LATER",
      title: `স্টাইল ${o.project} বাতিল, কিন্তু তার ${o.bookingId ? "বুকিং" : "পারচেজ অর্ডার"} ${o.number} এখনো খোলা`,
      href: o.bookingId ? bookingHref(o.bookingId) : materialsHref.order(o.id),
      place: o.number,
      why: "বাতিল স্টাইলের জন্য খোলা অর্ডার থাকলে সরবরাহকারী মাল পাঠাতে পারে, আর রিমাইন্ডারও আসতে থাকে।",
      fix: o.bookingId
        ? "মাল আর না লাগলে বুকিংটি খুলে “Cancel the booking” (কিছু এসে থাকলে “Close the booking”) দিন। কী করবেন আপনিই ঠিক করুন; Bug Guard নিজে কিছু বাতিল করে না।"
        : "মাল আর না লাগলে অর্ডারটি খুলে “Cancel the order” (কিছু এসে থাকলে “Close the order”) দিন। কী করবেন আপনিই ঠিক করুন; Bug Guard নিজে কিছু বাতিল করে না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "স্টাইল", value: `${o.project} (CANCELLED)` },
        { label: "অর্ডার", value: o.number },
      ],
    });
  }
  return findings(PARENTS, items, "বাতিল কাগজে লিংক");
}

// -----------------------------------------------------------------------------
// Dates in order, and none far in the future or long ago
// -----------------------------------------------------------------------------

const DATES = "data.links.dates";

/** Documents dated by these columns (a date column, or a moment). */
const DATED: Array<[string, string, string]> = [
  ["Payment", "number", "paymentDate"],
  ["Refund", "number", "refundDate"],
  ["SalesOrder", "number", "orderDate"],
  ["Invoice", "number", "issueDate"],
  ["ProformaInvoice", "number", "issueDate"],
  ["Quotation", "number", "issueDate"],
  ["SupplierBill", "number", "billDate"],
  ["PurchaseOrder", "number", "orderDate"],
  ["Expense", "number", "date"],
  ["SalaryAdvance", "number", "givenAt"],
  ["JournalEntry", "number", "date"],
];

async function dates(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const { timezone } = await companyOf(ctx);
  // A month ahead is still a plan (a month-end salary entry, a post-dated cheque); past that a typo.
  const late = new Date(ctx.now.getTime() + 31 * 24 * 60 * 60 * 1000);
  const early = new Date("2000-01-01T00:00:00.000Z");
  const local = (column: Prisma.Sql) =>
    Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}::text)::date`;
  const [odd, orders, projects, challans, invoices, payments] = await Promise.all([
    ctx.db.$queryRaw<Array<{ model: string; id: string; ref: string; at: Date }>>`
      SELECT * FROM (${Prisma.join(
        DATED.map(
          ([model, ref, column]) => Prisma.sql`
            SELECT ${model}::text AS model, x.id, x.${ident(ref)}::text AS ref, x.${ident(column)} AS at
            FROM ${ident(model)} x
            WHERE x."companyId" = ${companyId}
              AND (x.${ident(column)} > ${late} OR x.${ident(column)} < ${early})`,
        ),
        " UNION ALL ",
      )}) dated
      ORDER BY at
      LIMIT 200`,
    ctx.db.$queryRaw<
      Array<{ id: string; number: string; ordered: Date; expected: Date; bookingId: string | null }>
    >`
      SELECT po.id, po.number, po."orderDate" AS ordered, po."expectedDate" AS expected, bk.id AS "bookingId"
      FROM "PurchaseOrder" po
      LEFT JOIN "Booking" bk ON bk."orderId" = po.id
      WHERE po."companyId" = ${companyId} AND po."expectedDate" < po."orderDate"`,
    ctx.db.$queryRaw<
      Array<{ id: string; code: string; started: Date; target: Date; completed: Date | null }>
    >`
      SELECT p.id, p.code, p."startDate" AS started, p."targetDate" AS target, p."completedAt" AS completed
      FROM "ProductionProject" p
      WHERE p."companyId" = ${companyId}
        AND (${local(Prisma.sql`p."targetDate"`)} < ${local(Prisma.sql`p."startDate"`)}
             OR ${local(Prisma.sql`p."completedAt"`)} < ${local(Prisma.sql`p."startDate"`)})`,
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        orderId: string;
        order: string;
        delivered: Date;
        ordered: Date;
      }>
    >`
      SELECT c.id, c.number, o.id AS "orderId", o.number AS order, c."deliveryDate" AS delivered,
             o."orderDate" AS ordered
      FROM "DeliveryChallan" c JOIN "SalesOrder" o ON o.id = c."orderId"
      WHERE c."companyId" = ${companyId}
        AND ${local(Prisma.sql`c."deliveryDate"`)} < ${local(Prisma.sql`o."orderDate"`)}`,
    ctx.db.$queryRaw<Array<{ id: string; number: string; issued: Date; due: Date }>>`
      SELECT i.id, i.number, i."issueDate" AS issued, i."dueDate" AS due
      FROM "Invoice" i
      WHERE i."companyId" = ${companyId} AND i.status <> 'VOID'::"InvoiceStatus"
        AND ${local(Prisma.sql`i."dueDate"`)} < ${local(Prisma.sql`i."issueDate"`)}`,
    // Paid on an invoice before it was issued (money before an invoice is an advance).
    ctx.db.$queryRaw<
      Array<{ id: string; number: string; invoice: string; paid: Date; issued: Date }>
    >`
      SELECT p.id, p.number, i.number AS invoice, p."paymentDate" AS paid, i."issueDate" AS issued
      FROM "Payment" p JOIN "Invoice" i ON i.id = p."invoiceId"
      WHERE p."companyId" = ${companyId} AND p.direction = 'RECEIVED'::"PaymentDirection"
        AND p."isAdvance" = false AND i.status <> 'VOID'::"InvoiceStatus"
        AND ${local(Prisma.sql`p."paymentDate"`)} < ${local(Prisma.sql`i."issueDate"`)}`,
  ]);
  const items: Item[] = [];
  for (const d of odd) {
    const name = NAMES[d.model] ?? d.model;
    const future = d.at > late;
    items.push({
      id: `${future ? "future" : "past"}-${d.id}`,
      severity: "LATER",
      title: future
        ? `${name} ${d.ref}-এর তারিখ ${dayOf(d.at, timezone)}: এক মাসেরও বেশি পরের`
        : `${name} ${d.ref}-এর তারিখ ${dayOf(d.at, timezone)}: 2000 সালের আগের`,
      href: SCREENS[d.model]?.(d.id) ?? null,
      place: `${name} ${d.ref}`,
      why: "এমন তারিখ সাধারণত টাইপের ভুল (যেমন 2026-এর জায়গায় 2062)। ভুল তারিখে কাগজটা ভুল মাসের রিপোর্ট, স্টেটমেন্ট আর বকেয়ার হিসাবে পড়ে, বা কোথাও দেখায়ই না।",
      fix: "কাগজটা খুলে তারিখটা দেখুন। ভুল হলে এডিট করা গেলে ঠিক করুন, না গেলে বাতিল করে ঠিক তারিখে আবার লিখুন। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "কাগজ", value: `${name} ${d.ref}` },
        { label: "তারিখ", value: dayOf(d.at, timezone) },
      ],
    });
  }
  for (const o of orders) {
    items.push({
      id: `expected-${o.id}`,
      severity: "LATER",
      title: `${o.bookingId ? "বুকিং" : "পারচেজ অর্ডার"} ${o.number}: মাল আসার তারিখ (${dateOf(o.expected)}) অর্ডারের তারিখের (${dateOf(o.ordered)}) আগে`,
      href: o.bookingId
        ? `/production/bookings/${encodeURIComponent(o.bookingId)}`
        : materialsHref.order(o.id),
      place: o.number,
      why: "অর্ডার দেওয়ার আগে মাল আসতে পারে না। ভুল তারিখে রিমাইন্ডার আর দেরির হিসাব ভুল আসে।",
      fix: "অর্ডারটি খুলে মাল আসার তারিখ ঠিক করুন। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "অর্ডারের তারিখ", value: dateOf(o.ordered) },
        { label: "মাল আসার তারিখ", value: dateOf(o.expected) },
      ],
    });
  }
  for (const p of projects) {
    const completedEarly = p.completed !== null && p.completed < p.started;
    items.push({
      id: `project-${p.id}`,
      severity: "LATER",
      title: completedEarly
        ? `প্রজেক্ট ${p.code} শেষ হয়েছে (${dayOf(p.completed!, timezone)}) শুরুর (${dayOf(p.started, timezone)}) আগে`
        : `প্রজেক্ট ${p.code}-এর টার্গেট তারিখ (${dayOf(p.target, timezone)}) শুরুর (${dayOf(p.started, timezone)}) আগে`,
      href: productionHref.project(p.id),
      place: p.code,
      why: "শুরুর আগে শেষ বা টার্গেট হতে পারে না। ভুল তারিখে কত দিন বাকি, দেরি আর ফ্যাক্টরির ক্ষমতার হিসাব ভুল আসে।",
      fix: "প্রজেক্টটি খুলে তারিখগুলো ঠিক করুন। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "শুরু", value: dayOf(p.started, timezone) },
        { label: "টার্গেট", value: dayOf(p.target, timezone) },
        ...(p.completed ? [{ label: "শেষ", value: dayOf(p.completed, timezone) }] : []),
      ],
    });
  }
  for (const c of challans) {
    items.push({
      id: `challan-${c.id}`,
      severity: "LATER",
      title: `চালান ${c.number}-এর ডেলিভারি তারিখ (${dayOf(c.delivered, timezone)}) অর্ডার ${c.order}-এর তারিখের (${dayOf(c.ordered, timezone)}) আগে`,
      href: salesHref.order(c.orderId),
      place: c.number,
      why: "অর্ডারের আগে মাল ডেলিভারি হতে পারে না। ভুল তারিখে ডেলিভারির রিপোর্ট আর ক্রেতার ইতিহাস ভুল দেখায়।",
      fix: "অর্ডারের তারিখ আর চালানের তারিখ দুটো দেখে যেটা ভুল সেটা ঠিক করুন। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "অর্ডারের তারিখ", value: dayOf(c.ordered, timezone) },
        { label: "ডেলিভারির তারিখ", value: dayOf(c.delivered, timezone) },
      ],
    });
  }
  for (const i of invoices) {
    items.push({
      id: `due-${i.id}`,
      severity: "LATER",
      title: `ইনভয়েস ${i.number}-এর শেষ তারিখ (${dayOf(i.due, timezone)}) ইনভয়েসের তারিখের (${dayOf(i.issued, timezone)}) আগে`,
      href: salesHref.invoice(i.id),
      place: i.number,
      why: "টাকা দেওয়ার শেষ তারিখ ইনভয়েসের আগে হতে পারে না। ভুল তারিখে ইনভয়েস দেওয়ার দিন থেকেই বকেয়া দেরি (Overdue) দেখায় আর রিমাইন্ডার যায়।",
      fix: "ইনভয়েসের শেষ তারিখ ঠিক করুন। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "ইনভয়েসের তারিখ", value: dayOf(i.issued, timezone) },
        { label: "শেষ তারিখ", value: dayOf(i.due, timezone) },
      ],
    });
  }
  for (const p of payments) {
    items.push({
      id: `paid-${p.id}`,
      severity: "LATER",
      title: `পেমেন্ট ${p.number} (${dayOf(p.paid, timezone)}) ইনভয়েস ${p.invoice}-এর (${dayOf(p.issued, timezone)}) আগে, অথচ অগ্রিম হিসেবে লেখা নয়`,
      href: salesHref.payment(p.id),
      place: p.number,
      why: "ইনভয়েসের আগে পাওয়া টাকা অগ্রিম হিসেবে লেখা হয়। এখানে তারিখ বা কোন ইনভয়েসে বসানো হয়েছে তা ভুল হতে পারে, তাই স্টেটমেন্টে ক্রমটা উল্টো দেখায়।",
      fix: "পেমেন্ট আর ইনভয়েসের তারিখ দেখুন; ভুল হলে হিসাবরক্ষককে দেখান। Bug Guard নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "পেমেন্টের তারিখ", value: dayOf(p.paid, timezone) },
        { label: "ইনভয়েসের তারিখ", value: dayOf(p.issued, timezone) },
      ],
    });
  }
  return findings(DATES, items, "উল্টোপাল্টা তারিখ");
}

export const LINK_CHECKS: Check[] = [
  { key: COMPANY, area: "DATA", label: "Records stay in their company", run: sameCompany },
  { key: DUPLICATES, area: "DATA", label: "Nothing entered twice", run: duplicates },
  { key: PARENTS, area: "DATA", label: "Records stand on live parents", run: parents },
  { key: DATES, area: "DATA", label: "Dates are in order", run: dates },
];
