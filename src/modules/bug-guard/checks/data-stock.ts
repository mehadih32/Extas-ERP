import { Prisma } from "@prisma/client";

import { accountsHref } from "@/components/accounts/labels";
import { hrHref } from "@/components/hr/labels";
import { materialsHref } from "@/components/materials/labels";
import { productionHref } from "@/components/production/labels";
import { isDebitNature } from "@/modules/accounts/chart";
import { CONTROL_ACCOUNTS } from "@/modules/accounts/control-accounts";
import { balanceUnitCostSql } from "@/modules/inventory/costs";
import { projectCostSummaries } from "@/modules/production/project-costs";

import type { Check, CheckContext, CorrectionPlan } from "../types";
import {
  accountsByCode,
  amount,
  companyOf,
  dayOf,
  dec,
  findings,
  type Item,
  quantity,
  ZERO,
} from "./data-common";

/*
 * Stock and the registers kept beside the books: finished goods against their
 * stock movements, raw materials against theirs, factory deliveries against
 * the pieces they brought in, and each register (stock, raw materials, work in
 * progress, fixed assets, loans and capital, employee advances and unpaid
 * salaries) against its ledger account, as “Books check” compares them.
 */

const BOOKS_CHECK = "/accounts/reports/books-check";

const gradeName = (grade: string) => (grade === "B_GRADE" ? "B-grade" : "A-grade");

// -----------------------------------------------------------------------------
// Finished goods: each stock balance is the sum of its movements
// -----------------------------------------------------------------------------

const BALANCE = "data.stock.balance";

type BalanceRow = {
  id: string | null;
  variantId: string;
  warehouseId: string;
  grade: string;
  stored: number | null;
  moved: number;
  movements: number;
  sku: string;
  styleId: string;
  warehouse: string;
};

async function stockBalances(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const rows = await ctx.db.$queryRaw<BalanceRow[]>`
    WITH mv AS (
      SELECT "variantId", "warehouseId", grade, SUM(quantity)::int AS moved, COUNT(*)::int AS movements
      FROM "StockMovement"
      WHERE "companyId" = ${companyId}
      GROUP BY "variantId", "warehouseId", grade
    ), keyed AS (
      SELECT sb.id, sb."variantId", sb."warehouseId", sb.grade, sb.quantity AS stored,
             COALESCE(mv.moved, 0) AS moved, COALESCE(mv.movements, 0) AS movements
      FROM "StockBalance" sb
      LEFT JOIN mv ON mv."variantId" = sb."variantId" AND mv."warehouseId" = sb."warehouseId"
                  AND mv.grade = sb.grade
      WHERE sb."companyId" = ${companyId}
        AND (sb.quantity <> COALESCE(mv.moved, 0) OR sb.quantity < 0)
      UNION ALL
      SELECT NULL, mv."variantId", mv."warehouseId", mv.grade, NULL, mv.moved, mv.movements
      FROM mv
      WHERE mv.moved <> 0 AND NOT EXISTS (
        SELECT 1 FROM "StockBalance" sb
        WHERE sb."variantId" = mv."variantId" AND sb."warehouseId" = mv."warehouseId"
          AND sb.grade = mv.grade
      )
    )
    SELECT k.id, k."variantId", k."warehouseId", k.grade::text AS grade, k.stored, k.moved,
           k.movements, pv.sku, pv."styleId", w.name AS warehouse
    FROM keyed k
    JOIN "ProductVariant" pv ON pv.id = k."variantId"
    JOIN "Warehouse" w ON w.id = k."warehouseId"
    ORDER BY pv.sku
    LIMIT 500`;
  const items: Item[] = [];
  for (const r of rows) {
    const place = `${r.sku} (${r.warehouse}, ${gradeName(r.grade)})`;
    const href = `/products/${encodeURIComponent(r.styleId)}`;
    const evidence = [
      { label: "SKU", value: r.sku },
      { label: "গুদাম", value: r.warehouse },
      { label: "গ্রেড", value: gradeName(r.grade) },
      { label: "স্টকে লেখা", value: r.stored === null ? "কোনো লাইন নেই" : quantity(r.stored) },
      { label: "আসা-যাওয়ার যোগফল", value: quantity(r.moved) },
      { label: "আসা-যাওয়ার সংখ্যা", value: String(r.movements) },
    ];
    if (r.id === null) {
      items.push({
        id: `${r.variantId}:${r.warehouseId}:${r.grade}`,
        severity: "IMPORTANT",
        title: `${place}: আসা-যাওয়া মিলে ${quantity(r.moved)} পিস হওয়ার কথা, কিন্তু স্টকে এর কোনো লাইনই নেই`,
        href,
        place,
        why: "প্রতিটি SKU-র প্রতিটি গুদাম আর গ্রেডের স্টক একটা লাইনে রাখা হয়, আর প্রতিটি আসা-যাওয়া সেই লাইন বাড়ায় বা কমায়। লাইন না থাকায় এই পিসগুলো স্টক, বিক্রি আর স্টকের দামে আসছে না।",
        fix: "নতুন লাইন খোলা Bug Guard-এর কাজ নয়, তাই নিজে কিছু বদলায় না। গুদামে গুনে দেখুন, তারপর “Stock count” পাতায় আসল সংখ্যাটা দিন; না মিললে ডেভেলপারকে দেখান।",
        fixKind: "MANUAL",
        evidence,
      });
      continue;
    }
    const stored = r.stored ?? 0;
    if (stored !== r.moved) {
      // Sales, deliveries and the books have gone by the stock kept; Bug Guard never
      // overwrites it (v6.4.1 B4). It records the difference as one movement instead,
      // so the movements add up to the stock again, and the stock's value is unchanged.
      const plan: CorrectionPlan | null =
        stored >= 0
          ? {
              kind: "STOCK",
              balanceId: r.id,
              variantId: r.variantId,
              warehouseId: r.warehouseId,
              grade: r.grade === "B_GRADE" ? "B_GRADE" : "A_GRADE",
              stored,
              moved: r.moved,
              label: place,
            }
          : null;
      items.push({
        id: r.id,
        severity: "IMPORTANT",
        title: `${place}: স্টকে ${quantity(stored)} পিস লেখা, কিন্তু আসা-যাওয়া মিলে ${quantity(r.moved)} পিস`,
        href,
        place,
        why: "স্টকের সংখ্যা হলো সব আসা-যাওয়ার (কেনা, তৈরি, বিক্রি, ফেরত, গণনা) যোগফল। না মিললে কোনটা ঠিক বোঝা যায় না: আসা-যাওয়ার তালিকা আর আগের দিনের স্টকের রিপোর্ট এক অঙ্ক দেখায়, স্টকের পাতা আরেক অঙ্ক।",
        fix: plan
          ? `Bug Guard কোনো লেখা অঙ্ক বদলায় না। স্টকে লেখা ${quantity(stored)} পিস দিয়েই এতদিন বিক্রি আর হিসাব চলেছে, তাই আপনার PIN দিয়ে অনুমতি দিলে Bug Guard আগে ব্যাকআপ নিয়ে আসা-যাওয়ার খাতায় পার্থক্যের (${quantity(stored - r.moved)} পিস) একটি নতুন লাইন যোগ করবে; স্টক আর স্টকের দাম একই থাকবে। পরে চাইলে উল্টো লাইন দিয়ে ফিরিয়ে নেওয়া যাবে। তারপর গুদামে গুনে দেখুন; আসল সংখ্যা আলাদা হলে “Stock count” পাতায় দিন।`
          : "স্টক মাইনাস, তাই কোনটা ঠিক Bug Guard নিশ্চিত নয় আর নিজে কিছু বদলায় না। গুদামে গুনে “Stock count” পাতায় আসল সংখ্যাটা দিন, আর ডেভেলপারকে দেখান।",
        fixKind: plan ? "DATA" : "MANUAL",
        correction: plan,
        evidence: [...evidence, { label: "পার্থক্য", value: quantity(stored - r.moved) }],
      });
      continue;
    }
    items.push({
      id: `negative-${r.id}`,
      severity: "IMPORTANT",
      title: `${place}: স্টক মাইনাস (${quantity(stored)} পিস)`,
      href,
      place,
      why: "হাতে যা নেই তার চেয়ে বেশি বের হয়েছে। স্টক মাইনাস থাকলে স্টকের দাম, বিক্রির খরচ আর পরের অর্ডারের হিসাব ভুল আসে।",
      fix: "গুদামে গুনে দেখুন, তারপর “Stock count” পাতায় আসল সংখ্যাটা দিন। কোনো ডেলিভারি বা কেনা লেখা বাকি থাকলে আগে সেটা লিখুন। কত পিস আছে Bug Guard জানে না, তাই নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence,
    });
  }
  return findings(BALANCE, items, "স্টক আর আসা-যাওয়ার অমিল");
}

// -----------------------------------------------------------------------------
// Raw materials: each material and each store is the sum of its movements
// -----------------------------------------------------------------------------

const MATERIALS = "data.stock.materials";

async function rawMaterials(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const [materials, stores] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        unit: string;
        quantity: Prisma.Decimal;
        stockValue: Prisma.Decimal;
        moved: Prisma.Decimal;
        value: Prisma.Decimal;
        movements: number;
      }>
    >`
      SELECT rm.id, rm.code, rm.name, rm.unit::text AS unit, rm.quantity, rm."stockValue",
             COALESCE(mv.quantity, 0) AS moved, COALESCE(mv.value, 0) AS value,
             COALESCE(mv.movements, 0)::int AS movements
      FROM "RawMaterial" rm
      LEFT JOIN (
        SELECT "rawMaterialId", SUM(quantity) AS quantity, SUM(value) AS value, COUNT(*) AS movements
        FROM "RawMaterialMovement" WHERE "companyId" = ${companyId}
        GROUP BY "rawMaterialId"
      ) mv ON mv."rawMaterialId" = rm.id
      WHERE rm."companyId" = ${companyId}
        AND (rm.quantity <> COALESCE(mv.quantity, 0) OR rm."stockValue" <> COALESCE(mv.value, 0)
             OR rm.quantity < 0 OR rm."stockValue" < 0)
      ORDER BY rm.code
      LIMIT 300`,
    ctx.db.$queryRaw<
      Array<{
        id: string | null;
        rawMaterialId: string;
        code: string;
        name: string;
        unit: string;
        warehouse: string;
        stored: Prisma.Decimal | null;
        moved: Prisma.Decimal;
      }>
    >`
      WITH mv AS (
        SELECT "rawMaterialId", "warehouseId", SUM(quantity) AS moved
        FROM "RawMaterialMovement" WHERE "companyId" = ${companyId}
        GROUP BY "rawMaterialId", "warehouseId"
      ), keyed AS (
        SELECT st.id, st."rawMaterialId", st."warehouseId", st.quantity AS stored,
               COALESCE(mv.moved, 0) AS moved
        FROM "RawMaterialStock" st
        LEFT JOIN mv ON mv."rawMaterialId" = st."rawMaterialId" AND mv."warehouseId" = st."warehouseId"
        WHERE st."companyId" = ${companyId}
          AND (st.quantity <> COALESCE(mv.moved, 0) OR st.quantity < 0)
        UNION ALL
        SELECT NULL, mv."rawMaterialId", mv."warehouseId", NULL, mv.moved
        FROM mv
        WHERE mv.moved <> 0 AND NOT EXISTS (
          SELECT 1 FROM "RawMaterialStock" st
          WHERE st."rawMaterialId" = mv."rawMaterialId" AND st."warehouseId" = mv."warehouseId"
        )
      )
      SELECT k.id, k."rawMaterialId", rm.code, rm.name, rm.unit::text AS unit, w.name AS warehouse,
             k.stored, k.moved
      FROM keyed k
      JOIN "RawMaterial" rm ON rm.id = k."rawMaterialId"
      JOIN "Warehouse" w ON w.id = k."warehouseId"
      ORDER BY rm.code
      LIMIT 300`,
  ]);
  const unitOf = (unit: string) => unit.toLowerCase();
  const items: Item[] = [];
  const fixByHand =
    "আসা-যাওয়ার খাতাই আসল হিসাব। ম্যাটেরিয়ালের পরিমাণ 3 দশমিক পর্যন্ত আর তার গড় দামও এর সাথে জড়িত, তাই Bug Guard নিজে এটা বদলায় না। হিসাবরক্ষক বা ডেভেলপারকে দেখান; স্টোরে গুনে “Save the count” দিলে নতুন আসা-যাওয়া যোগ হয়, কিন্তু এই পুরনো অমিলটা থেকেই যায়।";
  for (const m of materials) {
    const place = `${m.code} ${m.name}`;
    const href = materialsHref.material(m.id);
    const offQuantity = !dec(m.quantity).equals(dec(m.moved));
    const offValue = !dec(m.stockValue).equals(dec(m.value));
    if (offQuantity || offValue) {
      items.push({
        id: m.id,
        severity: "IMPORTANT",
        title: offQuantity
          ? `${place}: স্টকে ${quantity(m.quantity)} ${unitOf(m.unit)} লেখা, কিন্তু আসা-যাওয়া মিলে ${quantity(m.moved)}`
          : `${place}: স্টকের দাম ${amount(m.stockValue)} লেখা, কিন্তু আসা-যাওয়া মিলে ${amount(m.value)}`,
        href,
        place,
        why: "ম্যাটেরিয়ালের পরিমাণ আর দাম হলো তার সব আসা-যাওয়ার (কেনা, ইস্যু, ফেরত, গণনা) যোগফল, আর “Raw Materials & Accessories” খাতা এই দামের সাথেই মেলে। না মিললে স্টোরে যা আছে তা ভুল দেখায়, আর প্রোডাকশনে ইস্যু করা ম্যাটেরিয়ালের খরচও ভুল আসে।",
        fix: fixByHand,
        fixKind: "MANUAL",
        evidence: [
          { label: "ম্যাটেরিয়াল", value: place },
          { label: "স্টকে লেখা পরিমাণ", value: quantity(m.quantity) },
          { label: "আসা-যাওয়ার পরিমাণ", value: quantity(m.moved) },
          { label: "স্টকে লেখা দাম", value: amount(m.stockValue) },
          { label: "আসা-যাওয়ার দাম", value: amount(m.value) },
          { label: "আসা-যাওয়ার সংখ্যা", value: String(m.movements) },
        ],
      });
      continue;
    }
    items.push({
      id: `negative-${m.id}`,
      severity: "IMPORTANT",
      title: `${place}: স্টক মাইনাস (${quantity(m.quantity)} ${unitOf(m.unit)}, দাম ${amount(m.stockValue)})`,
      href,
      place,
      why: "স্টোরে যা ছিল তার চেয়ে বেশি বের হয়েছে। মাইনাস স্টক থাকলে ম্যাটেরিয়ালের গড় দাম আর প্রোডাকশনের খরচ ভুল আসে।",
      fix: "কোনো কেনা (বিল) লেখা বাকি আছে কি না দেখুন, থাকলে আগে সেটা লিখুন। তারপর স্টোরে গুনে “Save the count” দিয়ে আসল পরিমাণটা দিন। কত আছে Bug Guard জানে না, তাই নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "ম্যাটেরিয়াল", value: place },
        { label: "পরিমাণ", value: quantity(m.quantity) },
        { label: "দাম", value: amount(m.stockValue) },
      ],
    });
  }
  for (const s of stores) {
    const place = `${s.code} ${s.name} (${s.warehouse})`;
    const href = materialsHref.material(s.rawMaterialId);
    const stored = s.stored === null ? null : dec(s.stored);
    const moved = dec(s.moved);
    if (stored !== null && stored.equals(moved)) {
      items.push({
        id: `negative-${s.id}`,
        severity: "IMPORTANT",
        title: `${place}: এই স্টোরে স্টক মাইনাস (${quantity(stored)} ${unitOf(s.unit)})`,
        href,
        place,
        why: "এই স্টোরে যা ছিল তার চেয়ে বেশি বের হয়েছে, বা অন্য স্টোর থেকে বের করা ম্যাটেরিয়াল এখান থেকে লেখা হয়েছে।",
        fix: "স্টোরে গুনে “Save the count” দিয়ে আসল পরিমাণটা দিন, বা ভুল স্টোর থেকে লেখা হয়ে থাকলে “Move it” দিয়ে ঠিক স্টোরে সরান। Bug Guard নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence: [
          { label: "ম্যাটেরিয়াল", value: `${s.code} ${s.name}` },
          { label: "স্টোর", value: s.warehouse },
          { label: "পরিমাণ", value: quantity(stored) },
        ],
      });
      continue;
    }
    items.push({
      id: s.id ? `store-${s.id}` : `store-${s.rawMaterialId}-${s.warehouse}`,
      severity: "IMPORTANT",
      title:
        stored === null
          ? `${place}: আসা-যাওয়া মিলে ${quantity(moved)} ${unitOf(s.unit)} হওয়ার কথা, কিন্তু এই স্টোরে এর কোনো লাইন নেই`
          : `${place}: এই স্টোরে ${quantity(stored)} ${unitOf(s.unit)} লেখা, কিন্তু আসা-যাওয়া মিলে ${quantity(moved)}`,
      href,
      place,
      why: "প্রতিটি স্টোরে কত ম্যাটেরিয়াল আছে তা সেই স্টোরের আসা-যাওয়ার যোগফল। না মিললে কোন স্টোর থেকে ইস্যু করা যাবে তা ভুল দেখায়।",
      fix: fixByHand,
      fixKind: "MANUAL",
      evidence: [
        { label: "ম্যাটেরিয়াল", value: `${s.code} ${s.name}` },
        { label: "স্টোর", value: s.warehouse },
        { label: "স্টোরে লেখা", value: stored === null ? "কোনো লাইন নেই" : quantity(stored) },
        { label: "আসা-যাওয়ার যোগফল", value: quantity(moved) },
      ],
    });
  }
  return findings(MATERIALS, items, "ম্যাটেরিয়ালের স্টক আর আসা-যাওয়ার অমিল");
}

// -----------------------------------------------------------------------------
// Factory deliveries: a confirmed delivery brought its pieces in, an undone one
// took them out again, and its cost moved to stock in the books
// -----------------------------------------------------------------------------

const INTAKES = "data.stock.intakes";

async function intakes(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const { timezone } = await companyOf(ctx);
  // The delivery's own entry moves its cost out of work in progress. Undoing a
  // delivery whose pieces were worth more or less by then posts a "Stock value
  // difference" under the same delivery, between stock and production loss: not its cost.
  const fromWorkInProgress = Prisma.sql`EXISTS (
    SELECT 1 FROM "JournalLine" wl JOIN "LedgerAccount" wa ON wa.id = wl."accountId"
    WHERE wl."entryId" = je.id AND wa.code = ${CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code})`;
  const rows = await ctx.db.$queryRaw<
    Array<{
      id: string;
      number: string;
      status: string;
      at: Date;
      totalCost: Prisma.Decimal;
      pieces: number;
      moved: number;
      live: number;
      reversed: number;
      debit: Prisma.Decimal | null;
      entryNumber: string | null;
    }>
  >`
    SELECT i.id, i.number, i.status::text AS status, COALESCE(i."confirmedAt", i."createdAt") AS at,
           i."totalCost",
           COALESCE((SELECT SUM(l.quantity) FROM "StockIntakeLine" l WHERE l."intakeId" = i.id), 0)::int AS pieces,
           COALESCE((SELECT SUM(m.quantity) FROM "StockMovement" m
                      WHERE m."companyId" = i."companyId" AND m."referenceType" = 'StockIntake'
                        AND m."referenceId" = i.id), 0)::int AS moved,
           (SELECT COUNT(*) FROM "JournalEntry" je
             WHERE je."companyId" = i."companyId" AND je."sourceType" = 'STOCK_INTAKE'::"JournalSource"
               AND je."sourceId" = i.id AND ${fromWorkInProgress} AND je."reversalOfId" IS NULL AND je."isReversed" = false)::int AS live,
           (SELECT COUNT(*) FROM "JournalEntry" je
             WHERE je."companyId" = i."companyId" AND je."sourceType" = 'STOCK_INTAKE'::"JournalSource"
               AND je."sourceId" = i.id AND ${fromWorkInProgress} AND je."reversalOfId" IS NULL AND je."isReversed" = true)::int AS reversed,
           (SELECT SUM(jl.debit) FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
             WHERE je."companyId" = i."companyId" AND je."sourceType" = 'STOCK_INTAKE'::"JournalSource"
               AND je."sourceId" = i.id AND ${fromWorkInProgress} AND je."reversalOfId" IS NULL AND je."isReversed" = false) AS debit,
           (SELECT MIN(je.number) FROM "JournalEntry" je
             WHERE je."companyId" = i."companyId" AND je."sourceType" = 'STOCK_INTAKE'::"JournalSource"
               AND je."sourceId" = i.id AND ${fromWorkInProgress} AND je."reversalOfId" IS NULL) AS "entryNumber"
    FROM "StockIntake" i
    WHERE i."companyId" = ${companyId}
    ORDER BY i.number`;
  const items: Item[] = [];
  for (const r of rows) {
    const confirmed = r.status === "CONFIRMED";
    const expected = confirmed ? r.pieces : 0;
    const href = productionHref.delivery(r.id);
    const evidence = [
      { label: "ডেলিভারি", value: r.number },
      { label: "তারিখ", value: dayOf(r.at, timezone) },
      { label: "অবস্থা", value: r.status },
      { label: "ডেলিভারির পিস", value: quantity(r.pieces) },
      { label: "স্টকে ঢুকেছে (নিট)", value: quantity(r.moved) },
      { label: "খরচ", value: amount(r.totalCost) },
      { label: "জার্নাল এন্ট্রি", value: r.entryNumber ?? "নেই" },
    ];
    if (r.moved !== expected) {
      items.push({
        id: r.id,
        severity: "IMPORTANT",
        title: confirmed
          ? `ডেলিভারি ${r.number}-এ ${quantity(r.pieces)} পিস, কিন্তু স্টকে ঢুকেছে ${quantity(r.moved)} পিস`
          : `ডেলিভারি ${r.number} ${r.status === "REVERSED" ? "বাতিল করা হয়েছে" : "এখনো নিশ্চিত হয়নি"}, অথচ এর ${quantity(r.moved)} পিস স্টকে রয়ে গেছে`,
        href,
        place: r.number,
        why: "ফ্যাক্টরির ডেলিভারি নিশ্চিত করলে তার প্রতিটি পিস স্টকে ঢোকে, আর বাতিল করলে আবার বের হয়ে যায়। না মিললে স্টক আর প্রোডাকশনের হিসাব (কত পিস এল, কত খরচ) আলাদা দেখায়।",
        fix: "কত পিস সত্যিই এসেছে Bug Guard জানে না, তাই নিজে কিছু বদলায় না। গুদামে গুনে দেখুন; ডেলিভারিটা ভুল হলে “Undo the delivery” দিয়ে বাতিল করে আবার লিখুন, আর না হলে “Stock count” পাতায় আসল সংখ্যা দিন।",
        fixKind: "MANUAL",
        evidence,
      });
      continue;
    }
    const cost = dec(r.totalCost);
    const posted = r.live > 0;
    const wrongBooks = confirmed
      ? cost.gt(0) && (r.live !== 1 || !dec(r.debit).equals(cost))
      : r.status === "REVERSED" && posted;
    if (wrongBooks) {
      items.push({
        id: r.id,
        severity: "URGENT",
        title: confirmed
          ? r.live === 0
            ? `ডেলিভারি ${r.number}-এর খরচ ${amount(cost)} স্টকে যাওয়ার এন্ট্রি খাতায় নেই`
            : r.live > 1
              ? `ডেলিভারি ${r.number}-এর খরচ খাতায় ${r.live} বার স্টকে নেওয়া হয়েছে`
              : `ডেলিভারি ${r.number}-এর খরচ ${amount(cost)}, কিন্তু খাতায় স্টকে নেওয়া হয়েছে ${amount(r.debit)}`
          : `ডেলিভারি ${r.number} বাতিল, কিন্তু তার খরচ এখনো খাতায় স্টকে আছে`,
        href,
        place: r.number,
        why: "ডেলিভারি নিশ্চিত হলে তার খরচ “Work in Progress (Production)” থেকে “Finished Goods Inventory”-তে যায়, আর বাতিল হলে ফিরে আসে। না মিললে স্টকের দাম আর চলমান প্রোডাকশনের খরচ খাতায় ভুল দেখায়।",
        fix: "কোন এন্ট্রি ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। হিসাবরক্ষককে দেখান: ডেলিভারিটা “Undo the delivery” দিয়ে বাতিল করে আবার নিশ্চিত করলে ERP ঠিক এন্ট্রি দেবে।",
        fixKind: "MANUAL",
        evidence: [
          ...evidence,
          { label: "চালু এন্ট্রি", value: String(r.live) },
          ...(r.debit ? [{ label: "এন্ট্রির টাকা", value: amount(r.debit) }] : []),
        ],
      });
    }
  }
  return findings(INTAKES, items, "ফ্যাক্টরি ডেলিভারি আর স্টকের অমিল");
}

// -----------------------------------------------------------------------------
// Registers against their ledger accounts
// -----------------------------------------------------------------------------

const REGISTERS = "data.stock.registers";

type Account = { id: string; code: string; name: string; type: string };

async function registers(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const codes = await accountsByCode(ctx, [
    CONTROL_ACCOUNTS.INVENTORY.code,
    CONTROL_ACCOUNTS.RAW_MATERIALS.code,
    CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code,
    CONTROL_ACCOUNTS.FIXED_ASSETS.code,
    CONTROL_ACCOUNTS.ACCUMULATED_DEPRECIATION.code,
    CONTROL_ACCOUNTS.EMPLOYEE_ADVANCES.code,
    CONTROL_ACCOUNTS.SALARIES_PAYABLE.code,
  ]);
  const totals = await ctx.db.$queryRaw<
    Array<{ accountId: string; employeeId: string | null; net: Prisma.Decimal }>
  >`
    SELECT jl."accountId", jl."employeeId", SUM(jl.debit - jl.credit) AS net
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId}
    GROUP BY jl."accountId", jl."employeeId"`;
  const byAccount = new Map<string, Prisma.Decimal>();
  const byEmployee = new Map<string, Map<string, Prisma.Decimal>>();
  for (const t of totals) {
    byAccount.set(t.accountId, (byAccount.get(t.accountId) ?? ZERO).plus(dec(t.net)));
    if (t.employeeId) {
      const m = byEmployee.get(t.accountId) ?? new Map<string, Prisma.Decimal>();
      m.set(t.employeeId, (m.get(t.employeeId) ?? ZERO).plus(dec(t.net)));
      byEmployee.set(t.accountId, m);
    }
  }
  // The account's balance as it is read: debit less credit for assets, the other way round otherwise.
  const natural = (a: { type: string }, net: Prisma.Decimal) =>
    isDebitNature(a.type as Parameters<typeof isDebitNature>[0]) ? net : net.neg();
  const balanceOf = (a: Account | undefined) =>
    a ? natural(a, byAccount.get(a.id) ?? ZERO) : ZERO;

  const [valuation, materials, projects, assets, sources, advances, unpaid, employees] =
    await Promise.all([
      ctx.db.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
        SELECT SUM(sb.quantity * ${balanceUnitCostSql}) AS value
        FROM "StockBalance" sb
        JOIN "ProductVariant" pv ON pv.id = sb."variantId"
        WHERE sb."companyId" = ${companyId}`,
      ctx.db.rawMaterial.aggregate({ where: { companyId }, _sum: { stockValue: true } }),
      ctx.db.productionProject.findMany({ where: { companyId }, select: { id: true } }),
      ctx.db.fixedAsset.findMany({
        where: { companyId, status: { not: "DISPOSED" } },
        select: { purchaseCost: true, currentValue: true },
      }),
      ctx.db.capitalSource.findMany({
        where: { companyId },
        select: {
          id: true,
          name: true,
          outstanding: true,
          ledgerAccountId: true,
          ledgerAccount: { select: { id: true, code: true, name: true, type: true } },
        },
      }),
      ctx.db.salaryAdvance.groupBy({
        by: ["employeeId"],
        where: { companyId, status: "OPEN" },
        _sum: { outstanding: true },
      }),
      ctx.db.$queryRaw<Array<{ employeeId: string; owed: Prisma.Decimal }>>`
        SELECT i."employeeId", SUM(i."netPay" - i."paidAmount") AS owed
        FROM "PayrollItem" i
        JOIN "PayrollRun" r ON r.id = i."runId"
        WHERE r."companyId" = ${companyId} AND r.status IN ('APPROVED'::"PayrollStatus", 'PAID'::"PayrollStatus")
        GROUP BY i."employeeId"`,
      ctx.db.employee.findMany({
        where: { companyId },
        select: { id: true, code: true, name: true },
      }),
    ]);
  const wip = [
    ...(
      await projectCostSummaries(
        ctx.db,
        companyId,
        projects.map((p) => p.id),
      )
    ).values(),
  ].reduce((t, s) => t.plus(s.wip), ZERO);

  const items: Item[] = [];
  const compare = (args: {
    id: string;
    what: string;
    account: Account | undefined;
    books: Prisma.Decimal;
    register: Prisma.Decimal;
    registerName: string;
    tolerance?: Prisma.Decimal;
    why: string;
    fix: string;
    href?: string;
    place?: string;
  }) => {
    const diff = args.books.minus(args.register);
    if (diff.abs().lte(args.tolerance ?? ZERO)) return;
    items.push({
      id: args.id,
      severity: "IMPORTANT",
      title: `${args.what}: খাতায় ${amount(args.books)}, কিন্তু ${args.registerName} ${amount(args.register)}`,
      href: args.href ?? BOOKS_CHECK,
      place: args.place ?? (args.account ? `${args.account.code} ${args.account.name}` : args.what),
      why: args.why,
      fix: args.fix,
      fixKind: "MANUAL",
      evidence: [
        ...(args.account
          ? [{ label: "খাতা", value: `${args.account.code} ${args.account.name}` }]
          : []),
        { label: "খাতার ব্যালান্স", value: amount(args.books) },
        { label: args.registerName, value: amount(args.register) },
        { label: "পার্থক্য", value: amount(diff) },
      ],
    });
  };

  const stockValue = dec(valuation[0]?.value).toDecimalPlaces(2);
  const inventory = codes.get(CONTROL_ACCOUNTS.INVENTORY.code);
  compare({
    id: "inventory",
    what: "তৈরি মালের স্টক",
    account: inventory,
    books: balanceOf(inventory),
    register: stockValue,
    registerName: "স্টকের পিস × গড় খরচ",
    // Average costs are kept to 4 decimals: a little rounding is expected.
    tolerance: Prisma.Decimal.max(1, stockValue.abs().times(0.001)),
    why: "“Finished Goods Inventory” খাতা আর হাতে থাকা পিসের দাম (পিস × গড় খরচ) সমান থাকার কথা। না মিললে ব্যালান্স শিটে স্টকের দাম আর বিক্রির খরচ (লাভ) ভুল আসে।",
    fix: "“Books check” খুলে দেখুন। স্টকের অমিল (উপরে আলাদা করে দেখানো) আগে ঠিক করুন; তারপরও না মিললে হিসাবরক্ষককে দেখান। কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে খাতায় কিছু দেয় না।",
  });
  const rm = codes.get(CONTROL_ACCOUNTS.RAW_MATERIALS.code);
  compare({
    id: "raw-materials",
    what: "ম্যাটেরিয়ালের স্টক",
    account: rm,
    books: balanceOf(rm),
    register: dec(materials._sum.stockValue),
    registerName: "ম্যাটেরিয়ালগুলোর দামের যোগফল",
    why: "“Raw Materials & Accessories” খাতা আর স্টোরে থাকা সব ম্যাটেরিয়ালের দাম সমান থাকার কথা। না মিললে ব্যালান্স শিট আর প্রোডাকশনের খরচ ভুল আসে।",
    fix: "“Books check” খুলে দেখুন কোন ম্যাটেরিয়াল মেলে না (উপরে আলাদা করে দেখানো), আর হিসাবরক্ষককে দেখান। Bug Guard নিজে খাতায় কিছু দেয় না।",
  });
  const wipAccount = codes.get(CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code);
  compare({
    id: "wip",
    what: "চলমান প্রোডাকশন",
    account: wipAccount,
    books: balanceOf(wipAccount),
    register: wip,
    registerName: "প্রজেক্টগুলোর বাকি খরচ",
    why: "“Work in Progress (Production)” খাতা আর প্রজেক্টগুলোর খরচ (বিল, সরাসরি খরচ, ইস্যু করা ম্যাটেরিয়াল, স্টকে যাওয়া আর বাদ দেওয়া বাদে) সমান থাকার কথা। না মিললে প্রোডাকশনের খরচ আর ব্যালান্স শিট ভুল আসে।",
    fix: "“Books check” খুলে দেখুন, আর হিসাবরক্ষককে দেখান। Bug Guard নিজে খাতায় কিছু দেয় না।",
  });
  const fixed = codes.get(CONTROL_ACCOUNTS.FIXED_ASSETS.code);
  const cost = assets.reduce((t, a) => t.plus(a.purchaseCost), ZERO);
  const bookValue = assets.reduce((t, a) => t.plus(a.currentValue), ZERO);
  compare({
    id: "fixed-assets",
    what: "স্থায়ী সম্পদ",
    account: fixed,
    books: balanceOf(fixed),
    register: cost,
    registerName: "সম্পদের তালিকায় কেনা দাম",
    why: "“Fixed Assets (at cost)” খাতা আর সম্পদের তালিকার (মেশিন, ফার্নিচার, গাড়ি) কেনা দামের যোগফল সমান থাকার কথা।",
    fix: "“Books check” খুলে দেখুন, আর হিসাবরক্ষককে দেখান। Bug Guard নিজে খাতায় কিছু দেয় না।",
  });
  const depreciation = codes.get(CONTROL_ACCOUNTS.ACCUMULATED_DEPRECIATION.code);
  compare({
    id: "depreciation",
    what: "জমা অবচয় (Depreciation)",
    account: depreciation,
    books: balanceOf(depreciation),
    register: cost.minus(bookValue),
    registerName: "সম্পদের তালিকায় অবচয়",
    why: "“Accumulated Depreciation” খাতা আর সম্পদের তালিকায় এখন পর্যন্ত কাটা অবচয় সমান থাকার কথা।",
    fix: "“Books check” খুলে দেখুন, আর হিসাবরক্ষককে দেখান। Bug Guard নিজে খাতায় কিছু দেয় না।",
  });
  for (const s of sources) {
    const account = s.ledgerAccount ?? undefined;
    compare({
      id: `capital-${s.id}`,
      what: `${s.name}-এর মূলধন বা ঋণ`,
      account,
      books: balanceOf(account),
      register: dec(s.outstanding),
      registerName: "তালিকায় বাকি",
      why: "প্রতিটি ঋণ, বিনিয়োগকারী আর মালিকের মূলধনের বাকি অঙ্ক তার নিজের খাতার ব্যালান্সের সাথে মেলার কথা। না মিললে কাকে কত ফেরত দিতে হবে তা ভুল দেখায়।",
      fix: "খাতাটি খুলে কিস্তিগুলো মিলিয়ে দেখুন, আর হিসাবরক্ষককে দেখান। Bug Guard নিজে খাতায় কিছু দেয় না।",
      href: account ? accountsHref.account(account.id) : BOOKS_CHECK,
      place: s.name,
    });
  }
  const names = new Map(employees.map((e) => [e.id, `${e.code} ${e.name}`]));
  const perEmployee = (
    account: Account | undefined,
    register: Map<string, Prisma.Decimal>,
    args: { prefix: string; what: string; registerName: string; why: string; fix: string },
  ) => {
    if (!account) return;
    const books = byEmployee.get(account.id) ?? new Map<string, Prisma.Decimal>();
    for (const employeeId of new Set([...books.keys(), ...register.keys()])) {
      compare({
        id: `${args.prefix}-${employeeId}`,
        what: `${names.get(employeeId) ?? "একজন কর্মী"}: ${args.what}`,
        account,
        books: natural(account, books.get(employeeId) ?? ZERO),
        register: register.get(employeeId) ?? ZERO,
        registerName: args.registerName,
        why: args.why,
        fix: args.fix,
        href: hrHref.employee(employeeId),
        place: names.get(employeeId) ?? employeeId,
      });
    }
  };
  perEmployee(
    codes.get(CONTROL_ACCOUNTS.EMPLOYEE_ADVANCES.code),
    new Map(advances.map((a) => [a.employeeId, dec(a._sum.outstanding)])),
    {
      prefix: "advances",
      what: "অগ্রিম",
      registerName: "চালু অগ্রিমে বাকি",
      why: "কর্মীর কাছে অগ্রিম বাবদ যা পাওনা, তা খাতায় আর তার চালু অগ্রিমগুলোর বাকিতে এক থাকার কথা। না মিললে বেতন থেকে ভুল অঙ্ক কাটা হতে পারে।",
      fix: "কর্মীর অগ্রিমগুলো আর তার স্টেটমেন্ট মিলিয়ে দেখুন, আর হিসাবরক্ষককে দেখান। Bug Guard নিজে খাতায় কিছু দেয় না।",
    },
  );
  perEmployee(
    codes.get(CONTROL_ACCOUNTS.SALARIES_PAYABLE.code),
    new Map(unpaid.map((u) => [u.employeeId, dec(u.owed)])),
    {
      prefix: "salaries",
      what: "বাকি বেতন",
      registerName: "অনুমোদিত বেতনে বাকি",
      why: "কর্মীকে যে বেতন দেওয়া বাকি, তা খাতায় আর অনুমোদিত বেতনের হিসাবে (নিট বেতন থেকে যা দেওয়া হয়েছে তা বাদে) এক থাকার কথা। না মিললে কাকে কত দিতে হবে তা ভুল দেখায়।",
      fix: "কর্মীর বেতনের মাসগুলো আর তার স্টেটমেন্ট মিলিয়ে দেখুন, আর হিসাবরক্ষককে দেখান। Bug Guard নিজে খাতায় কিছু দেয় না।",
    },
  );
  return findings(REGISTERS, items, "খাতা আর রেজিস্টারের অমিল");
}

export const STOCK_CHECKS: Check[] = [
  { key: BALANCE, area: "DATA", label: "Stock matches its movements", run: stockBalances },
  { key: MATERIALS, area: "DATA", label: "Raw materials match their movements", run: rawMaterials },
  { key: INTAKES, area: "DATA", label: "Factory deliveries are in stock", run: intakes },
  { key: REGISTERS, area: "DATA", label: "Ledgers match their registers", run: registers },
];
