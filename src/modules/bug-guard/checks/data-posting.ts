import { Prisma } from "@prisma/client";

import { accountsHref } from "@/components/accounts/labels";
import { hrHref } from "@/components/hr/labels";
import { materialsHref } from "@/components/materials/labels";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";
import { CONTROL_ACCOUNTS, PARTY_BALANCE_SUBTYPES } from "@/modules/accounts/control-accounts";
import { planProblem } from "@/modules/bug-guard/corrections";

import type { Check, CheckContext, CorrectionPlan } from "../types";
import {
  accountsByCode,
  amount,
  companyOf,
  correctedKeys,
  dayOf,
  dec,
  findings,
  fixed,
  type Item,
  todayOf,
} from "./data-common";
import { mirrorPlan } from "./data-ledger";

/*
 * Every document that moves money is in the books, and only while it stands:
 * a receipt, payment, invoice, refund, return, bill, expense, salary or advance
 * has its live journal entry for its amount, and a voided one has its entry
 * reversed. These are the buyer, supplier, cash and employee balances checked
 * against the papers they come from.
 */

const partySubtypes = Prisma.join(
  PARTY_BALANCE_SUBTYPES.map((s) => Prisma.sql`${s}::"AccountSubType"`),
);

/** One document and its entry, as read. */
type Doc = {
  id: string;
  number: string;
  /** What the entry's debits should add up to (null: not compared). */
  amount: Prisma.Decimal | null;
  /** Voided, cancelled or undone: its entry should be reversed. */
  voided: boolean;
  /** Whether it should have an entry while it stands. */
  needsEntry: boolean;
  entryId: string | null;
  entryNumber: string | null;
  entryReversed: boolean | null;
  /** The entry's total debit. */
  debit: Prisma.Decimal | null;
  at: Date;
};

/** How one kind of document is named and put right. */
type Kind = {
  /** "পেমেন্ট রসিদ" */
  name: string;
  href: (id: string) => string;
  /** How the owner redoes it in the ERP, so it posts as it should (Bengali). */
  redo: string;
};

const DEFAULT_REDO = "হিসাবরক্ষককে দেখান: কাগজ আর খাতার কোনটা ঠিক, তা দেখে ঠিক করতে হবে।";

/** What is wrong with a document's posting, as items (none when it is right). */
async function judge(
  ctx: CheckContext,
  checkKey: string,
  kind: Kind,
  docs: Doc[],
  corrected: Set<string>,
  extra?: (doc: Doc) => Item | null,
): Promise<Item[]> {
  const { timezone } = await companyOf(ctx);
  const today = await todayOf(ctx);
  const items: Item[] = [];
  for (const d of docs) {
    const base = {
      id: d.id,
      href: kind.href(d.id),
      place: d.number,
    };
    const evidence = [
      { label: kind.name, value: d.number },
      { label: "তারিখ", value: dayOf(d.at, timezone) },
      ...(d.amount ? [{ label: "কাগজের টাকা", value: amount(d.amount) }] : []),
      { label: "জার্নাল এন্ট্রি", value: d.entryNumber ?? "নেই" },
    ];
    if (d.voided) {
      if (!d.entryId || d.entryReversed) continue;
      if (corrected.has(`${checkKey}:${d.id}`)) continue;
      const plan = await mirrorPlan(
        ctx,
        { id: d.entryId, number: d.entryNumber ?? "", isReversed: false },
        today,
        `Reversal of ${d.entryNumber}: ${d.number} is void but its entry was not reversed`,
      );
      items.push({
        ...base,
        severity: "URGENT",
        title: `${kind.name} ${d.number} বাতিল (Void), কিন্তু তার জার্নাল এন্ট্রি ${d.entryNumber} এখনো খাতায় চালু`,
        why: "কোনো কাগজ বাতিল করলে ERP তার এন্ট্রিটা উল্টো এন্ট্রি দিয়ে বাতিল করে দেয়। এখানে তা হয়নি, তাই বাতিল কাগজের টাকা এখনো ক্যাশ-ব্যাংক, ক্রেতা বা সরবরাহকারীর ব্যালান্স আর রিপোর্টে গোনা হচ্ছে।",
        fix: plan
          ? `ERP যে উল্টো এন্ট্রিটা দেওয়ার কথা ছিল, Bug Guard ঠিক সেটাই সমন্বয় এন্ট্রি হিসেবে দেবে (${d.entryNumber}-এর প্রতিটি লাইন উল্টে)। আপনার PIN দিয়ে অনুমতি দিলে আগে ব্যাকআপ নিয়ে দেবে, পরে চাইলে Bug Guard থেকেই তা ফিরিয়ে নেওয়া যাবে।`
          : DEFAULT_REDO,
        fixKind: plan ? "DATA" : "MANUAL",
        correction: plan,
        evidence: [...evidence, { label: "এন্ট্রির অবস্থা", value: "চালু (বাতিল হয়নি)" }],
      });
      continue;
    }
    if (!d.needsEntry) continue;
    if (!d.entryId) {
      const custom = extra?.(d);
      if (custom) {
        items.push(custom);
        continue;
      }
      items.push({
        ...base,
        severity: "URGENT",
        title: `${kind.name} ${d.number}-এর কোনো জার্নাল এন্ট্রি নেই`,
        why: "যে কাগজে টাকা আসে বা যায়, ERP তার একটা এন্ট্রি খাতায় দেয়। এন্ট্রি না থাকলে কাগজে টাকাটা আছে, কিন্তু ক্যাশ-ব্যাংক, ক্রেতা বা সরবরাহকারীর ব্যালান্স আর রিপোর্টে নেই।",
        fix: `কোন এন্ট্রি দিলে ঠিক হবে Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। ${kind.redo}`,
        fixKind: "MANUAL",
        evidence,
      });
      continue;
    }
    if (d.entryReversed) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `${kind.name} ${d.number} চালু, কিন্তু তার জার্নাল এন্ট্রি ${d.entryNumber} বাতিল (Reversed) করা`,
        why: "কাগজটা স্ক্রিনে চালু দেখায়, অথচ খাতায় তার টাকা নেই। ফলে কাগজে যা দেখা যায় আর ক্যাশ-ব্যাংক, ব্যালান্স ও রিপোর্টে যা আছে, দুটো আলাদা।",
        fix: `কোনটা ঠিক (কাগজ না খাতা) Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। লেনদেনটা সত্যিই বাতিল হলে কাগজটি বাতিল (Void) করুন। বাতিল না হলে: ${kind.redo}`,
        fixKind: "MANUAL",
        evidence: [...evidence, { label: "এন্ট্রির অবস্থা", value: "বাতিল (Reversed)" }],
      });
      continue;
    }
    if (d.amount && d.debit && !dec(d.debit).equals(d.amount)) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `${kind.name} ${d.number}-এর টাকা ${amount(d.amount)}, কিন্তু খাতার এন্ট্রি ${d.entryNumber}-এ ${amount(d.debit)}`,
        why: "কাগজ আর তার এন্ট্রির টাকা এক হওয়ার কথা। না মিললে ক্যাশ-ব্যাংক বা কারো ব্যালান্স ভুল অঙ্ক দেখায়।",
        fix: `কোন অঙ্কটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। ${kind.redo}`,
        fixKind: "MANUAL",
        evidence: [
          ...evidence,
          { label: "এন্ট্রির টাকা", value: amount(d.debit) },
          { label: "পার্থক্য", value: amount(d.amount.minus(d.debit)) },
        ],
      });
      continue;
    }
    const custom = extra?.(d);
    if (custom) items.push(custom);
  }
  return items;
}

const entryDebit = (column: Prisma.Sql) => Prisma.sql`(
  SELECT SUM(l.debit) FROM "JournalLine" l WHERE l."entryId" = ${column}
)`;

// -----------------------------------------------------------------------------
// Sales: receipts, invoices, refunds, sales returns
// -----------------------------------------------------------------------------

const SALES = "data.posting.sales";

type PaymentRow = {
  id: string;
  number: string;
  direction: "RECEIVED" | "PAID";
  amount: Prisma.Decimal;
  paymentDate: Date;
  partyId: string | null;
  orderId: string | null;
  accountId: string;
  isAdvance: boolean;
  entryId: string | null;
  entryNumber: string | null;
  entryReversed: boolean | null;
  debit: Prisma.Decimal | null;
  moved: Prisma.Decimal | null;
  otherParty: number;
};

async function paymentRows(ctx: CheckContext) {
  return ctx.db.$queryRaw<PaymentRow[]>`
    SELECT p.id, p.number, p.direction::text AS direction, p.amount, p."paymentDate",
           p."partyId", p."orderId", p."accountId", p."isAdvance",
           je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
           ${entryDebit(Prisma.sql`je.id`)} AS debit,
           (SELECT SUM(CASE WHEN p.direction = 'RECEIVED'::"PaymentDirection" THEN l.debit - l.credit
                            ELSE l.credit - l.debit END)
              FROM "JournalLine" l WHERE l."entryId" = je.id AND l."accountId" = p."accountId") AS moved,
           (SELECT COUNT(*) FROM "JournalLine" l
              JOIN "LedgerAccount" la ON la.id = l."accountId"
             WHERE l."entryId" = je.id AND la."subType" IN (${partySubtypes})
               AND p."partyId" IS NOT NULL AND l."partyId" IS DISTINCT FROM p."partyId")::int AS "otherParty"
    FROM "Payment" p
    LEFT JOIN "JournalEntry" je ON je.id = p."journalEntryId"
    WHERE p."companyId" = ${ctx.companyId}
    ORDER BY p."paymentDate", p.number`;
}

/**
 * The entry receivePaymentTx posts for a buyer's payment (Dr the cash, bank or
 * wallet account, Cr Receivable, or Customer Advance for an advance, naming the
 * buyer or Walk-in customers), when that is certain: not after an invoice void
 * moved the order's payments to advance. Posted only while the payment is still
 * as now and without an entry (its precondition).
 */
async function receiptPlan(
  ctx: CheckContext,
  p: PaymentRow,
  day: string,
): Promise<CorrectionPlan | null> {
  if (p.direction !== "RECEIVED") return null;
  if (p.orderId) {
    const moved = await ctx.db.journalEntry.count({
      where: { companyId: ctx.companyId, sourceType: "PAYMENT", sourceId: p.orderId },
    });
    if (moved > 0) return null;
  }
  const codes = await accountsByCode(ctx, [
    CONTROL_ACCOUNTS.RECEIVABLE.code,
    CONTROL_ACCOUNTS.CUSTOMER_ADVANCE.code,
  ]);
  const credit = codes.get(
    p.isAdvance ? CONTROL_ACCOUNTS.CUSTOMER_ADVANCE.code : CONTROL_ACCOUNTS.RECEIVABLE.code,
  );
  const cash = await ctx.db.ledgerAccount.findFirst({
    where: { id: p.accountId, companyId: ctx.companyId },
    select: { name: true },
  });
  const partyId =
    p.partyId ??
    (
      await ctx.db.party.findFirst({
        where: { companyId: ctx.companyId, systemRole: "WALK_IN" },
        select: { id: true },
      })
    )?.id;
  if (!credit || !cash || !partyId) return null;
  const value = fixed(p.amount);
  const plan: CorrectionPlan = {
    kind: "JOURNAL",
    date: day,
    description: `Payment ${p.number} received, which had no entry`,
    lines: [
      { accountId: p.accountId, account: cash.name, debit: value, credit: "0.00" },
      {
        accountId: credit.id,
        account: credit.name,
        partyId,
        debit: "0.00",
        credit: value,
        memo: p.isAdvance ? "Advance" : undefined,
      },
    ],
    precondition: {
      kind: "PAYMENT",
      paymentId: p.id,
      amount: value,
      accountId: p.accountId,
      isAdvance: p.isAdvance,
      partyId: p.partyId,
    },
  };
  return planProblem(plan) ? null : plan;
}

async function salesPosting(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const corrected = await correctedKeys(ctx, SALES);
  const today = await todayOf(ctx);
  const { timezone } = await companyOf(ctx);
  const [payments, invoices, refunds, returns] = await Promise.all([
    paymentRows(ctx),
    ctx.db.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: string;
        total: Prisma.Decimal;
        issueDate: Date;
        live: number;
        income: Prisma.Decimal | null;
        entryNumber: string | null;
      }>
    >`
      SELECT i.id, i.number, i.status::text AS status, i.total, i."issueDate",
             COUNT(je.id)::int AS live, MIN(je.number) AS "entryNumber",
             SUM((SELECT SUM(l.credit - l.debit) FROM "JournalLine" l
                    JOIN "LedgerAccount" la ON la.id = l."accountId"
                   WHERE l."entryId" = je.id AND la."subType" NOT IN (${partySubtypes}))) AS income
      FROM "Invoice" i
      LEFT JOIN "JournalEntry" je
        ON je."companyId" = i."companyId" AND je."sourceType" = 'SALE'::"JournalSource"
       AND je."sourceId" = i.id AND je."isReversed" = false AND je."reversalOfId" IS NULL
      WHERE i."companyId" = ${companyId}
      GROUP BY i.id`,
    ctx.db.$queryRaw<
      Array<
        Doc & {
          orderId: string | null;
          proformaId: string | null;
          partyId: string | null;
          salesReturnId: string | null;
        }
      >
    >`
      SELECT r.id, r.number, r.amount, (r."voidedAt" IS NOT NULL) AS voided, true AS "needsEntry",
             r."orderId", r."proformaId", r."partyId", r."salesReturnId",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, r."refundDate" AS at
      FROM "Refund" r
      LEFT JOIN "JournalEntry" je ON je.id = r."journalEntryId"
      WHERE r."companyId" = ${companyId}`,
    ctx.db.$queryRaw<Doc[]>`
      SELECT r.id, r.number, NULL AS amount, (r."voidedAt" IS NOT NULL) AS voided,
             (r.amount > 0 OR r."costValue" > 0) AS "needsEntry",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             NULL AS debit, r."receivedAt" AS at
      FROM "SalesReturn" r
      LEFT JOIN "JournalEntry" je ON je.id = r."journalEntryId"
      WHERE r."companyId" = ${companyId}`,
  ]);

  const items: Item[] = [];

  // Buyers' payments (supplier payments are with purchases).
  const received = payments.filter((p) => p.direction === "RECEIVED");
  for (const p of received) {
    const evidence = [
      { label: "পেমেন্ট", value: p.number },
      { label: "তারিখ", value: dayOf(p.paymentDate, timezone) },
      { label: "টাকা", value: amount(p.amount) },
      { label: "জার্নাল এন্ট্রি", value: p.entryNumber ?? "নেই" },
    ];
    const base = { id: p.id, href: salesHref.payment(p.id), place: p.number };
    if (!p.entryId) {
      if (corrected.has(`${SALES}:${p.id}`)) continue;
      const plan = await receiptPlan(ctx, p, today);
      items.push({
        ...base,
        severity: "URGENT",
        title: `পেমেন্ট ${p.number} (${amount(p.amount)}) নেওয়া হয়েছে, কিন্তু খাতায় তার কোনো এন্ট্রি নেই`,
        why: "ক্রেতার টাকা এলে ERP খাতায় এন্ট্রি দেয়: ক্যাশ বা ব্যাংকে টাকা বাড়ে, ক্রেতার পাওনা কমে। এন্ট্রি না থাকায় ক্যাশ-ব্যাংকে টাকাটা নেই আর ক্রেতার ব্যালান্সে এখনো বকেয়া দেখায়।",
        fix: plan
          ? "ERP যে এন্ট্রিটা দেওয়ার কথা ছিল, Bug Guard ঠিক সেটাই সমন্বয় এন্ট্রি হিসেবে দেবে: যে খাতায় টাকা এসেছে সেখানে ডেবিট, আর ক্রেতার পাওনায় (অগ্রিম হলে অগ্রিমে) ক্রেডিট। আপনার PIN দিয়ে অনুমতি দিলে আগে ব্যাকআপ নিয়ে দেবে, পরে চাইলে Bug Guard থেকেই তা ফিরিয়ে নেওয়া যাবে।"
          : "ঠিক কোন খাতায় এন্ট্রি হবে Bug Guard নিশ্চিত নয় (এই অর্ডারের ইনভয়েস একবার বাতিল হয়েছিল)। হিসাবরক্ষককে দিয়ে “New journal voucher”-এ এন্ট্রিটা দিন।",
        fixKind: plan ? "DATA" : "MANUAL",
        correction: plan,
        evidence,
      });
      continue;
    }
    if (p.entryReversed) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `পেমেন্ট ${p.number} চালু, কিন্তু তার এন্ট্রি ${p.entryNumber} বাতিল (Reversed) করা`,
        why: "ক্রেতার পেমেন্ট বাতিল করা যায় না (টাকা ফেরত দিতে “Refund money paid” লাগে), তাই এর এন্ট্রি বাতিল থাকার কথা নয়। এখন অর্ডারে টাকাটা জমা দেখায়, কিন্তু খাতায় নেই।",
        fix: "কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। টাকা সত্যিই এসে থাকলে হিসাবরক্ষককে দিয়ে “New journal voucher”-এ এন্ট্রিটা আবার দিন; না এসে থাকলে “Refund money paid” দিয়ে অর্ডার থেকে টাকাটা সরান।",
        fixKind: "MANUAL",
        evidence,
      });
      continue;
    }
    if (!dec(p.moved).equals(p.amount)) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `পেমেন্ট ${p.number}-এর টাকা ${amount(p.amount)}, কিন্তু খাতায় ${amount(p.moved)} এসেছে`,
        why: "পেমেন্টের টাকা আর ক্যাশ-ব্যাংক খাতায় যা ঢুকেছে, তা সমান হওয়ার কথা। না মিললে ক্যাশ-ব্যাংকের ব্যালান্স ভুল।",
        fix: "কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। হিসাবরক্ষককে দিয়ে ব্যাংক স্টেটমেন্টের সাথে মিলিয়ে “New journal voucher”-এ পার্থক্যটা ঠিক করুন।",
        fixKind: "MANUAL",
        evidence: [...evidence, { label: "খাতায় এসেছে", value: amount(p.moved) }],
      });
      continue;
    }
    if (p.otherParty > 0) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `পেমেন্ট ${p.number}-এর টাকা খাতায় অন্য একজনের ব্যালান্সে পড়েছে`,
        why: "যে ক্রেতা টাকা দিয়েছেন, তার এন্ট্রিতে তারই নাম থাকার কথা। অন্যের নামে পড়লে একজনের বকেয়া বেশি আর আরেকজনের কম দেখায়।",
        fix: "হিসাবরক্ষককে দিয়ে দুজনের স্টেটমেন্ট মিলিয়ে “New journal voucher”-এ টাকাটা সঠিক ক্রেতার নামে সরান। কার টাকা Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence,
      });
    }
  }

  // Invoices: a live one has exactly one live sale entry for its total; a void one none.
  for (const i of invoices) {
    const isVoid = i.status === "VOID";
    const total = dec(i.total);
    const shouldPost = !isVoid && total.gt(0);
    const income = dec(i.income);
    const evidence = [
      { label: "ইনভয়েস", value: i.number },
      { label: "তারিখ", value: dayOf(i.issueDate, timezone) },
      { label: "মোট", value: amount(total) },
      { label: "চালু বিক্রির এন্ট্রি", value: String(i.live) },
      ...(i.live > 0 ? [{ label: "এন্ট্রিতে আয়", value: amount(income) }] : []),
    ];
    const base = { id: i.id, href: salesHref.invoice(i.id), place: i.number };
    if (shouldPost && i.live === 0) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `ইনভয়েস ${i.number} (${amount(total)}) চালু, কিন্তু খাতায় তার বিক্রির এন্ট্রি নেই`,
        why: "ইনভয়েস দিলে ERP খাতায় বিক্রি আর ক্রেতার পাওনা লেখে। এন্ট্রি না থাকায় বিক্রি, লাভ আর ক্রেতার বকেয়া কম দেখায়।",
        fix: "ইনভয়েসটি “Void the invoice” দিয়ে বাতিল করে অর্ডার থেকে “Issue the invoice” দিয়ে আবার দিন: ERP তখন ঠিক এন্ট্রি দেবে। কোন এন্ট্রি লাগবে (আগের অগ্রিমসহ) Bug Guard নিশ্চিত নয়, তাই নিজে দেয় না।",
        fixKind: "MANUAL",
        evidence,
      });
    } else if (shouldPost && i.live > 1) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `ইনভয়েস ${i.number}-এর বিক্রি খাতায় ${i.live} বার লেখা`,
        why: "একটা ইনভয়েসের বিক্রি খাতায় একবারই থাকার কথা। বারবার থাকলে বিক্রি, লাভ আর ক্রেতার বকেয়া বেশি দেখায়।",
        fix: "হিসাবরক্ষককে দেখান: কোন এন্ট্রিটা বাড়তি তা দেখে ইনভয়েসটি “Void the invoice” করে আবার দিন। Bug Guard নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence,
      });
    } else if (shouldPost && !income.equals(total)) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `ইনভয়েস ${i.number}-এর মোট ${amount(total)}, কিন্তু খাতায় বিক্রি লেখা ${amount(income)}`,
        why: "ইনভয়েসের মোট আর খাতায় তার বিক্রির অঙ্ক এক হওয়ার কথা। না মিললে বিক্রি, লাভ আর ক্রেতার বকেয়া ভুল।",
        fix: "অর্ডার খুলে “Edit order” দিয়ে কিছু না বদলে সেভ করুন: ERP ইনভয়েস আর তার এন্ট্রি আবার হিসাব করবে। না হলে হিসাবরক্ষককে দেখান। Bug Guard নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence,
      });
    } else if (isVoid && i.live > 0) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `ইনভয়েস ${i.number} বাতিল (Void), কিন্তু তার বিক্রির এন্ট্রি এখনো খাতায় চালু`,
        why: "বাতিল ইনভয়েসের বিক্রি খাতা থেকে উল্টো এন্ট্রি দিয়ে সরে যাওয়ার কথা। না সরায় বিক্রি, লাভ আর ক্রেতার বকেয়া বেশি দেখায়।",
        fix: "হিসাবরক্ষককে দেখান। কোন এন্ট্রিগুলো বাতিল হবে তা নিশ্চিত হলে “New journal voucher”-এ উল্টো এন্ট্রি দিন। Bug Guard নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence,
      });
    }
  }

  items.push(
    ...(await judge(
      ctx,
      SALES,
      {
        name: "রিফান্ড",
        // A refund has no page of its own: it shows on its order, proforma, sales return or buyer.
        href: (id) => {
          const r = refunds.find((x) => x.id === id);
          if (r?.orderId) return salesHref.order(r.orderId);
          if (r?.proformaId) return salesHref.proforma(r.proformaId);
          if (r?.salesReturnId) return salesHref.salesReturn(r.salesReturnId);
          return r?.partyId ? salesHref.buyer(r.partyId) : "/sales/payments";
        },
        redo: "রিফান্ডটি “Void the refund” দিয়ে বাতিল করে আবার দিন।",
      },
      refunds,
      corrected,
    )),
    ...(await judge(
      ctx,
      SALES,
      {
        name: "সেলস রিটার্ন",
        href: salesHref.salesReturn,
        redo: "রিটার্নটি “Void the return” দিয়ে বাতিল করে আবার লিখুন।",
      },
      returns,
      corrected,
    )),
  );
  return findings(SALES, items, "বিক্রির কাগজ আর খাতার অমিল");
}

// -----------------------------------------------------------------------------
// Purchases: supplier bills and payments, supplier returns, expenses, material
// issues and CM settlements
// -----------------------------------------------------------------------------

const PURCHASES = "data.posting.purchases";

async function purchasePosting(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const corrected = await correctedKeys(ctx, PURCHASES);
  const { timezone } = await companyOf(ctx);
  const payable = (await accountsByCode(ctx, [CONTROL_ACCOUNTS.PAYABLE.code])).get(
    CONTROL_ACCOUNTS.PAYABLE.code,
  );
  const [bills, payments, returns, expenses, issues, settlements] = await Promise.all([
    ctx.db.$queryRaw<
      Array<Doc & { supplierId: string; owed: Prisma.Decimal | null; isMaterial: boolean | null }>
    >`
      SELECT b.id, b.number, b."totalAmount" AS amount, (b.status = 'VOID'::"BillStatus") AS voided,
             true AS "needsEntry", b."supplierId", (b."warehouseId" IS NOT NULL) AS "isMaterial",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, b."billDate" AS at,
             (SELECT SUM(l.credit - l.debit) FROM "JournalLine" l
               WHERE l."entryId" = je.id AND l."accountId" = ${payable?.id ?? ""}
                 AND l."partyId" = b."supplierId") AS owed
      FROM "SupplierBill" b
      LEFT JOIN "JournalEntry" je ON je.id = b."journalEntryId"
      WHERE b."companyId" = ${companyId}`,
    paymentRows(ctx),
    ctx.db.$queryRaw<Doc[]>`
      SELECT r.id, r.number, NULL AS amount, (r."voidedAt" IS NOT NULL) AS voided,
             (r."totalAmount" > 0 OR r."stockValue" > 0) AS "needsEntry",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             NULL AS debit, r.date AS at
      FROM "PurchaseReturn" r
      LEFT JOIN "JournalEntry" je ON je.id = r."journalEntryId"
      WHERE r."companyId" = ${companyId}`,
    // A claim waits for Accounts to approve it without an entry (a rejected one stays so).
    ctx.db.$queryRaw<Doc[]>`
      SELECT e.id, e.number, e.amount, (e."voidedAt" IS NOT NULL) AS voided,
             (e."journalEntryId" IS NOT NULL) AS "needsEntry",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, e.date AS at
      FROM "Expense" e
      LEFT JOIN "JournalEntry" je ON je.id = e."journalEntryId"
      WHERE e."companyId" = ${companyId}`,
    ctx.db.$queryRaw<Doc[]>`
      SELECT m.id, m.number, m."totalValue" AS amount, false AS voided, (m."totalValue" > 0) AS "needsEntry",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, m.date AS at
      FROM "MaterialIssue" m
      LEFT JOIN "JournalEntry" je ON je.id = m."journalEntryId"
      WHERE m."companyId" = ${companyId}`,
    ctx.db.$queryRaw<
      Array<Doc & { batchId: string; factoryId: string; owedOff: Prisma.Decimal | null }>
    >`
      SELECT s.id, s.number, s.deductions AS amount, (s."undoneAt" IS NOT NULL) AS voided,
             (s.deductions > 0) AS "needsEntry", s."batchId", s."factoryId",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, s."createdAt" AS at,
             (SELECT SUM(l.debit - l.credit) FROM "JournalLine" l
               WHERE l."entryId" = je.id AND l."accountId" = ${payable?.id ?? ""}
                 AND l."partyId" = s."factoryId") AS "owedOff"
      FROM "CmSettlement" s
      LEFT JOIN "JournalEntry" je ON je.id = s."journalEntryId"
      WHERE s."companyId" = ${companyId}`,
  ]);

  const items: Item[] = [];
  const billKind = (b: { isMaterial: boolean | null }): Kind => ({
    name: "সরবরাহকারীর বিল",
    href: (id) => (b.isMaterial ? materialsHref.purchase(id) : productionHref.bill(id)),
    redo: `বিলটি “${b.isMaterial ? "Void the purchase" : "Void the bill"}” দিয়ে বাতিল করে আবার লিখুন: ERP তখন ঠিক এন্ট্রি দেবে।`,
  });
  for (const b of bills) {
    const found = await judge(ctx, PURCHASES, billKind(b), [b], corrected, (d) => {
      // A standing bill owes its total to its supplier.
      if (d.voided || !d.entryId || d.entryReversed) return null;
      if (dec(b.owed).equals(dec(b.amount))) return null;
      return {
        id: b.id,
        severity: "URGENT",
        title: `বিল ${b.number}-এর মোট ${amount(b.amount)}, কিন্তু খাতায় সরবরাহকারীর দেনা হিসেবে লেখা ${amount(b.owed)}`,
        href: billKind(b).href(b.id),
        place: b.number,
        why: "বিলের পুরো টাকা ওই সরবরাহকারীর দেনায় (Supplier Due) যাওয়ার কথা। না গেলে তার ব্যালান্স আর বিলের বাকি দুটো আলাদা দেখায়।",
        fix: `কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না। ${billKind(b).redo} না হলে হিসাবরক্ষককে দেখান।`,
        fixKind: "MANUAL",
        evidence: [
          { label: "বিল", value: b.number },
          { label: "বিলের মোট", value: amount(b.amount) },
          { label: "খাতায় দেনা", value: amount(b.owed) },
          { label: "জার্নাল এন্ট্রি", value: b.entryNumber ?? "-" },
        ],
      };
    });
    items.push(...found);
  }

  // Payments to suppliers: a void one has its entry reversed (that is how it is voided).
  for (const p of payments.filter((x) => x.direction === "PAID")) {
    const base = { id: p.id, href: accountsHref.payment(p.id), place: p.number };
    const evidence = [
      { label: "পেমেন্ট", value: p.number },
      { label: "তারিখ", value: dayOf(p.paymentDate, timezone) },
      { label: "টাকা", value: amount(p.amount) },
      { label: "জার্নাল এন্ট্রি", value: p.entryNumber ?? "নেই" },
    ];
    if (!p.entryId) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `সরবরাহকারীকে পেমেন্ট ${p.number} (${amount(p.amount)})-এর কোনো জার্নাল এন্ট্রি নেই`,
        why: "সরবরাহকারীকে টাকা দিলে ERP খাতায় এন্ট্রি দেয়: ক্যাশ বা ব্যাংক কমে, তার দেনা কমে। এন্ট্রি না থাকায় ক্যাশ-ব্যাংকে টাকাটা এখনো দেখায়, আর তার বিলগুলো এই টাকা পায় না।",
        fix: "হিসাবরক্ষককে দেখান: টাকা সত্যিই দেওয়া হয়ে থাকলে “New journal voucher”-এ এন্ট্রিটা দিন, আর পেমেন্টটি নতুন করে লিখুন। Bug Guard নিজে কিছু বদলায় না, কারণ এই পেমেন্টের সাথে বিলের হিসাব জড়িত।",
        fixKind: "MANUAL",
        evidence,
      });
    } else if (!p.entryReversed && !dec(p.moved).equals(p.amount)) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `সরবরাহকারীকে পেমেন্ট ${p.number}-এর টাকা ${amount(p.amount)}, কিন্তু খাতা থেকে গেছে ${amount(p.moved)}`,
        why: "পেমেন্টের টাকা আর ক্যাশ-ব্যাংক খাতা থেকে যা গেছে, তা সমান হওয়ার কথা। না মিললে ক্যাশ-ব্যাংকের ব্যালান্স ভুল।",
        fix: "পেমেন্টটি “Void the payment” দিয়ে বাতিল করে সঠিক টাকায় আবার দিন। Bug Guard নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence: [...evidence, { label: "খাতা থেকে গেছে", value: amount(p.moved) }],
      });
    } else if (!p.entryReversed && p.otherParty > 0) {
      items.push({
        ...base,
        severity: "URGENT",
        title: `সরবরাহকারীকে পেমেন্ট ${p.number}-এর টাকা খাতায় অন্য একজনের দেনা থেকে কাটা হয়েছে`,
        why: "যাকে টাকা দেওয়া হয়েছে, এন্ট্রিতে তারই নাম থাকার কথা। অন্যের নামে পড়লে একজনের দেনা কম আর আরেকজনের বেশি দেখায়।",
        fix: "পেমেন্টটি “Void the payment” দিয়ে বাতিল করে সঠিক সরবরাহকারীর নামে আবার দিন। Bug Guard নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence,
      });
    }
  }

  items.push(
    ...(await judge(
      ctx,
      PURCHASES,
      {
        name: "সরবরাহকারীকে ফেরত (Purchase return)",
        href: materialsHref.supplierReturn,
        redo: "ফেরতটি “Void the return” দিয়ে বাতিল করে আবার লিখুন।",
      },
      returns,
      corrected,
    )),
    ...(await judge(
      ctx,
      PURCHASES,
      {
        name: "খরচ",
        href: accountsHref.expense,
        redo: "খরচটি “Void it” দিয়ে বাতিল করে আবার লিখুন: ERP তখন ঠিক এন্ট্রি দেবে।",
      },
      expenses,
      corrected,
    )),
    ...(await judge(
      ctx,
      PURCHASES,
      { name: "ম্যাটেরিয়াল ইস্যু", href: materialsHref.issue, redo: DEFAULT_REDO },
      issues,
      corrected,
    )),
  );
  for (const s of settlements) {
    const kind: Kind = {
      name: "CM সেটেলমেন্ট",
      href: () => `${productionHref.batch(s.batchId)}/cm-settlement`,
      redo: "ব্যাচের CM সেটেলমেন্ট পাতায় “Undo the settlement” চেপে আবার সেটেল করুন: ERP তখন কাটতিগুলো ফ্যাক্টরির দেনা থেকে ঠিকভাবে কাটবে।",
    };
    items.push(
      ...(await judge(ctx, PURCHASES, kind, [s], corrected, (d) => {
        if (d.voided || !d.entryId || d.entryReversed) return null;
        if (dec(s.owedOff).equals(dec(s.amount))) return null;
        return {
          id: s.id,
          severity: "URGENT",
          title: `CM সেটেলমেন্ট ${s.number}-এর কাটতি ${amount(s.amount)}, কিন্তু ফ্যাক্টরির দেনা থেকে কাটা হয়েছে ${amount(s.owedOff)}`,
          href: kind.href(s.id),
          place: s.number,
          why: "CM সেটেলমেন্টের কাটতি (ফল্ট, বাড়তি রিজেক্ট, C-গ্রেড) পুরোটাই ফ্যাক্টরির Supplier Due থেকে কাটার কথা। না হলে ফ্যাক্টরিকে বেশি বা কম টাকা দেওয়া হতে পারে।",
          fix: kind.redo,
          fixKind: "MANUAL",
          evidence: [
            { label: "সেটেলমেন্ট", value: s.number },
            { label: "কাটতি", value: amount(s.amount) },
            { label: "দেনা থেকে কাটা", value: amount(s.owedOff) },
            { label: "জার্নাল এন্ট্রি", value: s.entryNumber ?? "-" },
          ],
        };
      })),
    );
  }
  return findings(PURCHASES, items, "কেনাকাটার কাগজ আর খাতার অমিল");
}

// -----------------------------------------------------------------------------
// Salaries and advances
// -----------------------------------------------------------------------------

const HR = "data.posting.hr";

async function hrPosting(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const corrected = await correctedKeys(ctx, HR);
  const [runs, payments, advances] = await Promise.all([
    ctx.db.$queryRaw<
      Array<
        Doc & {
          status: "DRAFT" | "APPROVED" | "PAID";
          year: number;
          month: number;
        }
      >
    >`
      SELECT r.id, (r.year::text || '-' || LPAD(r.month::text, 2, '0')) AS number,
             r.status::text AS status, r.year, r.month,
             (SELECT SUM(i.basic + i.allowances + i.overtime + i.bonus - i."unpaidLeaveDeduction" + i.reimbursements)
                FROM "PayrollItem" i WHERE i."runId" = r.id) AS amount,
             false AS voided,
             (r.status <> 'DRAFT'::"PayrollStatus" AND EXISTS (
                SELECT 1 FROM "PayrollItem" i WHERE i."runId" = r.id
                  AND (i.basic + i.allowances + i.overtime + i.bonus - i."unpaidLeaveDeduction" > 0 OR i.reimbursements > 0)
             )) AS "needsEntry",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, COALESCE(r."approvedAt", r."createdAt") AS at
      FROM "PayrollRun" r
      LEFT JOIN "JournalEntry" je ON je.id = r."journalEntryId"
      WHERE r."companyId" = ${companyId}`,
    ctx.db.$queryRaw<Array<Doc & { runId: string }>>`
      SELECT p.id, p.number, p.amount, (p."voidedAt" IS NOT NULL) AS voided, true AS "needsEntry",
             p."runId", je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, p.date AS at
      FROM "PayrollPayment" p
      LEFT JOIN "JournalEntry" je ON je.id = p."journalEntryId"
      WHERE p."companyId" = ${companyId}`,
    ctx.db.$queryRaw<Doc[]>`
      SELECT a.id, a.number, a.amount, (a.status = 'VOID'::"AdvanceStatus") AS voided, true AS "needsEntry",
             je.id AS "entryId", je.number AS "entryNumber", je."isReversed" AS "entryReversed",
             ${entryDebit(Prisma.sql`je.id`)} AS debit, a."givenAt" AS at
      FROM "SalaryAdvance" a
      LEFT JOIN "JournalEntry" je ON je.id = a."journalEntryId"
      WHERE a."companyId" = ${companyId}`,
  ]);
  const items: Item[] = [];
  // A draft keeps no accrual entry: reopening reverses it and lets it go.
  for (const r of runs) {
    if (r.status === "DRAFT" && r.entryId && !r.entryReversed) {
      items.push({
        id: r.id,
        severity: "URGENT",
        title: `বেতনের হিসাব ${r.number} খসড়া (Draft), কিন্তু তার অনুমোদনের এন্ট্রি ${r.entryNumber} এখনো খাতায় চালু`,
        href: hrHref.payrollRun(r.id),
        place: `Payroll ${r.number}`,
        why: "খসড়া বেতনের হিসাব খাতায় থাকে না; অনুমোদন দিলে এন্ট্রি হয়, আবার খুললে বাতিল হয়। এখানে খসড়া অবস্থায় এন্ট্রি চালু, তাই অনুমোদন দিলে বেতন খাতায় দুবার উঠবে।",
        fix: "হিসাবরক্ষককে দেখান। এই মাস অনুমোদন দেওয়ার আগে পুরনো এন্ট্রিটা বাতিল হতে হবে। Bug Guard নিজে কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence: [
          { label: "মাস", value: r.number },
          { label: "অবস্থা", value: "Draft" },
          { label: "চালু এন্ট্রি", value: r.entryNumber ?? "-" },
        ],
      });
    }
  }
  items.push(
    ...(await judge(
      ctx,
      HR,
      {
        name: "বেতনের হিসাব",
        href: (id) => hrHref.payrollRun(id),
        redo: "মাসটি “Reopen” করে “Work it out again” চাপুন, তারপর আবার “Approve” দিন: ERP তখন ঠিক এন্ট্রি দেবে।",
      },
      runs.filter((r) => r.status !== "DRAFT"),
      corrected,
    )),
    ...(await judge(
      ctx,
      HR,
      {
        name: "বেতন পরিশোধ",
        href: (id) => hrHref.payrollRun(payments.find((p) => p.id === id)?.runId ?? ""),
        redo: "বেতন পরিশোধটি “Void the payment” দিয়ে বাতিল করে আবার দিন।",
      },
      payments,
      corrected,
    )),
    ...(await judge(
      ctx,
      HR,
      {
        name: "অগ্রিম",
        href: hrHref.advance,
        redo: "অগ্রিমটি “Void the advance” দিয়ে বাতিল করে আবার দিন।",
      },
      advances,
      corrected,
    )),
  );
  return findings(HR, items, "বেতন ও অগ্রিমের কাগজ আর খাতার অমিল");
}

export const POSTING_CHECKS: Check[] = [
  { key: SALES, area: "DATA", label: "Sales are in the books", run: salesPosting },
  { key: PURCHASES, area: "DATA", label: "Purchases are in the books", run: purchasePosting },
  { key: HR, area: "DATA", label: "Salaries and advances are in the books", run: hrPosting },
];
