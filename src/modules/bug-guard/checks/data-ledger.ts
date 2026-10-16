import { Prisma } from "@prisma/client";

import { accountsHref } from "@/components/accounts/labels";
import { partyHref } from "@/components/parties/labels";
import { isDebitNature } from "@/modules/accounts/chart";
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

/*
 * The books themselves: every entry balances, the trial balance balances, a
 * reversed entry has its reversal, buyer and supplier lines name them (and
 * employee lines the employee), and each opening balance matches its entry.
 */

const partySubtypes = Prisma.join(
  PARTY_BALANCE_SUBTYPES.map((s) => Prisma.sql`${s}::"AccountSubType"`),
);

// -----------------------------------------------------------------------------
// Every journal entry balances
// -----------------------------------------------------------------------------

const ENTRIES = "data.ledger.entries";

async function unbalancedEntries(ctx: CheckContext) {
  const rows = await ctx.db.$queryRaw<
    Array<{
      id: string;
      number: string;
      date: Date;
      description: string | null;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      lines: number;
      bad: number;
    }>
  >`
    SELECT je.id, je.number, je.date, je.description,
           COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit,
           COUNT(jl.id)::int AS lines,
           (COUNT(jl.id) FILTER (WHERE jl.debit < 0 OR jl.credit < 0 OR (jl.debit <> 0 AND jl.credit <> 0)))::int AS bad
    FROM "JournalEntry" je
    LEFT JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${ctx.companyId}
    GROUP BY je.id
    HAVING COALESCE(SUM(jl.debit), 0) <> COALESCE(SUM(jl.credit), 0)
        OR COUNT(jl.id) < 2
        OR COUNT(jl.id) FILTER (WHERE jl.debit < 0 OR jl.credit < 0 OR (jl.debit <> 0 AND jl.credit <> 0)) > 0
    ORDER BY je.date, je.number
    LIMIT 500`;
  const { timezone } = await companyOf(ctx);
  const items: Item[] = rows.map((r) => {
    const debit = dec(r.debit);
    const credit = dec(r.credit);
    const off = !debit.equals(credit);
    return {
      id: r.id,
      severity: "URGENT",
      title: off
        ? `জার্নাল এন্ট্রি ${r.number} মেলে না: ডেবিট ${amount(debit)}, ক্রেডিট ${amount(credit)}`
        : r.lines < 2
          ? `জার্নাল এন্ট্রি ${r.number}-এ ${r.lines}টি লাইন: একটা এন্ট্রিতে কমপক্ষে 2টি লাইন লাগে`
          : `জার্নাল এন্ট্রি ${r.number}-এর ${r.bad}টি লাইনে ডেবিট-ক্রেডিট ভুলভাবে লেখা (মাইনাস, বা একই লাইনে দুটোই)`,
      href: accountsHref.entry(r.id),
      place: r.number,
      why: "প্রতিটি এন্ট্রিতে মোট ডেবিট আর মোট ক্রেডিট সমান হতে হয়, আর প্রতিটি লাইন হয় ডেবিট না হয় ক্রেডিট। না হলে “Trial balance”, ব্যালান্স শিট আর লাভ-ক্ষতি ভুল দেখায়, আর যার খাতায় লাইনটা পড়েছে তার ব্যালান্সও ভুল হয়।",
      fix: "এন্ট্রিটা খুলে দেখুন কোন লাইনটা ভুল। কোন লাইনে কত হওয়া উচিত তা নিশ্চিত না হওয়ায় Bug Guard নিজে কিছু বদলায় না। হাতে লেখা এন্ট্রি হলে “Reverse” চেপে উল্টো এন্ট্রি দিন, তারপর “New journal voucher” দিয়ে সঠিক এন্ট্রি দিন। কোনো বিল, পেমেন্ট বা খরচ থেকে এসে থাকলে সেই কাগজটি বাতিল (Void) করে আবার ঠিকভাবে লিখুন। কিছুই না মিললে হিসাবরক্ষককে দেখান।",
      fixKind: "MANUAL",
      evidence: [
        { label: "এন্ট্রি", value: r.number },
        { label: "তারিখ", value: dayOf(r.date, timezone) },
        { label: "বিবরণ", value: r.description ?? "-" },
        { label: "মোট ডেবিট", value: amount(debit) },
        { label: "মোট ক্রেডিট", value: amount(credit) },
        { label: "পার্থক্য", value: amount(debit.minus(credit)) },
        { label: "লাইন", value: String(r.lines) },
      ],
    };
  });
  return findings(ENTRIES, items, "না-মেলা জার্নাল এন্ট্রি");
}

// -----------------------------------------------------------------------------
// The trial balance balances
// -----------------------------------------------------------------------------

const TRIAL = "data.ledger.trial";

async function trialBalance(ctx: CheckContext) {
  const [row] = await ctx.db.$queryRaw<
    Array<{ debit: Prisma.Decimal | null; credit: Prisma.Decimal | null; entries: number }>
  >`
    SELECT SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${ctx.companyId}`;
  const debit = dec(row?.debit);
  const credit = dec(row?.credit);
  if (debit.equals(credit)) return [];
  const [count] = await ctx.db.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT je.id
      FROM "JournalEntry" je
      JOIN "JournalLine" jl ON jl."entryId" = je.id
      WHERE je."companyId" = ${ctx.companyId}
      GROUP BY je.id
      HAVING SUM(jl.debit) <> SUM(jl.credit)
    ) off`;
  return findings(
    TRIAL,
    [
      {
        id: ctx.companyId,
        severity: "URGENT",
        title: `“Trial balance” মেলে না: মোট ডেবিট ${amount(debit)}, মোট ক্রেডিট ${amount(credit)}`,
        href: "/accounts/reports/trial-balance",
        place: "Trial balance",
        why: "পুরো খাতার মোট ডেবিট আর মোট ক্রেডিট সবসময় সমান থাকার কথা। না মিললে ব্যালান্স শিট, লাভ-ক্ষতি আর ক্যাশ-ব্যাংকের হিসাবে ভরসা করা যায় না, আর হিসাবরক্ষক বা অডিটর খাতা মানবে না।",
        fix: "পার্থক্যটা আসে যে এন্ট্রিগুলো নিজেরাই মেলে না সেগুলো থেকে। Bug Guard সেগুলো আলাদা করে দেখাচ্ছে: সেগুলো ঠিক করলেই “Trial balance” মিলে যাবে। Bug Guard নিজে খাতায় কিছু বদলায় না।",
        fixKind: "MANUAL",
        evidence: [
          { label: "মোট ডেবিট", value: amount(debit) },
          { label: "মোট ক্রেডিট", value: amount(credit) },
          { label: "পার্থক্য", value: amount(debit.minus(credit)) },
          { label: "না-মেলা এন্ট্রি", value: String(count?.n ?? 0) },
        ],
      },
    ],
    "ট্রায়াল ব্যালান্স",
  );
}

// -----------------------------------------------------------------------------
// A reversed entry has its reversal
// -----------------------------------------------------------------------------

const REVERSALS = "data.ledger.reversals";

type EntryRow = {
  id: string;
  number: string;
  date: Date;
  description: string | null;
  debit: Prisma.Decimal;
};

/**
 * The mirror image of an entry, as reverseJournalEntry posts it (every line's
 * debit and credit swapped), as an adjusting entry; null when it cannot be one.
 */
export async function mirrorPlan(
  ctx: CheckContext,
  entry: { id: string; number: string },
  day: string,
  description = `Reversal of ${entry.number}, which shows as reversed but had no reversal`,
): Promise<CorrectionPlan | null> {
  const lines = await ctx.db.journalLine.findMany({
    where: { entryId: entry.id },
    select: {
      accountId: true,
      partyId: true,
      employeeId: true,
      debit: true,
      credit: true,
      memo: true,
      account: { select: { name: true, companyId: true } },
    },
    orderBy: { id: "asc" },
  });
  // Only lines inside the company (another check reports any that are not).
  if (lines.some((l) => l.account.companyId !== ctx.companyId)) return null;
  const plan: CorrectionPlan = {
    kind: "JOURNAL",
    date: day,
    description,
    lines: lines
      .filter((l) => !l.debit.isZero() || !l.credit.isZero())
      .map((l) => ({
        accountId: l.accountId,
        account: l.account.name,
        partyId: l.partyId,
        employeeId: l.employeeId,
        debit: fixed(l.credit),
        credit: fixed(l.debit),
        memo: l.memo ?? `Reverses ${entry.number}`,
      })),
  };
  return planProblem(plan) ? null : plan;
}

async function reversals(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const { timezone } = await companyOf(ctx);
  const [missing, unflagged, mismatched, corrected] = await Promise.all([
    // Marked reversed, but no entry reverses it.
    ctx.db.$queryRaw<EntryRow[]>`
      SELECT je.id, je.number, je.date, je.description,
             (SELECT COALESCE(SUM(l.debit), 0) FROM "JournalLine" l WHERE l."entryId" = je.id) AS debit
      FROM "JournalEntry" je
      WHERE je."companyId" = ${companyId} AND je."isReversed" = true
        AND NOT EXISTS (SELECT 1 FROM "JournalEntry" r WHERE r."reversalOfId" = je.id)
      ORDER BY je.date, je.number
      LIMIT 200`,
    // A reversal whose entry is not marked reversed.
    ctx.db.$queryRaw<Array<EntryRow & { reversalId: string; reversal: string }>>`
      SELECT o.id, o.number, o.date, o.description, r.id AS "reversalId", r.number AS reversal,
             (SELECT COALESCE(SUM(l.debit), 0) FROM "JournalLine" l WHERE l."entryId" = o.id) AS debit
      FROM "JournalEntry" r
      JOIN "JournalEntry" o ON o.id = r."reversalOfId"
      WHERE r."companyId" = ${companyId} AND o."isReversed" = false
      LIMIT 200`,
    // A reversal that does not undo its entry account by account.
    ctx.db.$queryRaw<
      Array<EntryRow & { reversalId: string; reversal: string; net: Prisma.Decimal }>
    >`
      WITH pairs AS (
        SELECT r.id AS "reversalId", r.number AS reversal, o.id AS "originalId"
        FROM "JournalEntry" r
        JOIN "JournalEntry" o ON o.id = r."reversalOfId"
        WHERE r."companyId" = ${companyId}
      ), nets AS (
        SELECT p."originalId", jl."accountId", COALESCE(jl."partyId", '') AS party,
               SUM(jl.debit - jl.credit) AS net
        FROM pairs p
        JOIN "JournalLine" jl ON jl."entryId" IN (p."reversalId", p."originalId")
        GROUP BY p."originalId", jl."accountId", COALESCE(jl."partyId", '')
        HAVING SUM(jl.debit - jl.credit) <> 0
      )
      SELECT o.id, o.number, o.date, o.description, p."reversalId", p.reversal,
             (SELECT COALESCE(SUM(l.debit), 0) FROM "JournalLine" l WHERE l."entryId" = o.id) AS debit,
             (SELECT SUM(ABS(n.net)) FROM nets n WHERE n."originalId" = o.id) AS net
      FROM pairs p
      JOIN "JournalEntry" o ON o.id = p."originalId"
      WHERE EXISTS (SELECT 1 FROM nets n WHERE n."originalId" = o.id)
      LIMIT 200`,
    correctedKeys(ctx, REVERSALS),
  ]);
  const today = await todayOf(ctx);
  const items: Item[] = [];
  for (const e of missing) {
    if (corrected.has(`${REVERSALS}:${e.id}`)) continue;
    const plan = await mirrorPlan(ctx, e, today);
    items.push({
      id: e.id,
      severity: "URGENT",
      title: `জার্নাল এন্ট্রি ${e.number} বাতিল (Reversed) দেখায়, কিন্তু তার উল্টো এন্ট্রিটা খাতায় নেই`,
      href: accountsHref.entry(e.id),
      place: e.number,
      why: "ERP কোনো এন্ট্রি বাতিল করলে একটা উল্টো এন্ট্রি দিয়ে তার টাকা খাতা থেকে বের করে দেয়। এখানে এন্ট্রিটা বাতিল লেখা, অথচ উল্টো এন্ট্রি নেই: তাই স্ক্রিনে যেটা বাতিল দেখায়, তার টাকা এখনো ক্যাশ-ব্যাংক, ক্রেতা-সরবরাহকারীর ব্যালান্স আর রিপোর্টে গোনা হচ্ছে।",
      fix: plan
        ? "ERP যে উল্টো এন্ট্রিটা দেওয়ার কথা ছিল, Bug Guard ঠিক সেটাই একটা সমন্বয় এন্ট্রি হিসেবে দেবে: প্রতিটি লাইনের ডেবিট আর ক্রেডিট উল্টে। আপনার PIN দিয়ে অনুমতি দিলে আগে ব্যাকআপ নিয়ে এন্ট্রিটা দেবে, আর চাইলে পরে Bug Guard থেকেই তা ফিরিয়ে নেওয়া যাবে।"
        : "এন্ট্রিটা নিজেই মেলে না বা তার কোনো লাইন অন্য খাতার, তাই Bug Guard উল্টো এন্ট্রি বানাতে পারছে না। হিসাবরক্ষককে দিয়ে “New journal voucher”-এ লাইনগুলো উল্টে একটা এন্ট্রি দিন।",
      fixKind: plan ? "DATA" : "MANUAL",
      correction: plan,
      evidence: [
        { label: "এন্ট্রি", value: e.number },
        { label: "তারিখ", value: dayOf(e.date, timezone) },
        { label: "বিবরণ", value: e.description ?? "-" },
        { label: "মোট টাকা", value: amount(e.debit) },
        { label: "উল্টো এন্ট্রি", value: "নেই" },
      ],
    });
  }
  for (const e of unflagged) {
    items.push({
      id: e.id,
      severity: "URGENT",
      title: `জার্নাল এন্ট্রি ${e.number}-এর উল্টো এন্ট্রি ${e.reversal} আছে, কিন্তু ${e.number} বাতিল (Reversed) দেখায় না`,
      href: accountsHref.entry(e.id),
      place: e.number,
      why: "খাতায় দুটো এন্ট্রি মিলে টাকাটা শূন্য হয়ে গেছে, কিন্তু স্ক্রিনে আসল এন্ট্রি আর তার কাগজ (বিল, পেমেন্ট, খরচ) চালু দেখায়। তাই কাগজে যা দেখা যায় আর খাতায় যা আছে, দুটো আলাদা।",
      fix: "কোনটা ঠিক, তা Bug Guard নিশ্চিত জানে না, তাই নিজে কিছু বদলায় না। দুটো এন্ট্রি খুলে দেখুন: লেনদেনটা সত্যিই বাতিল হলে তার কাগজটি বাতিল (Void) করুন; বাতিল না হলে হিসাবরক্ষককে দিয়ে উল্টো এন্ট্রির বিপরীতে নতুন এন্ট্রি দিন।",
      fixKind: "MANUAL",
      evidence: [
        { label: "এন্ট্রি", value: e.number },
        { label: "উল্টো এন্ট্রি", value: e.reversal },
        { label: "মোট টাকা", value: amount(e.debit) },
      ],
    });
  }
  for (const e of mismatched) {
    if (items.some((i) => i.id === e.id)) continue;
    items.push({
      id: e.id,
      severity: "URGENT",
      title: `উল্টো এন্ট্রি ${e.reversal} তার আসল এন্ট্রি ${e.number}-কে পুরোপুরি বাতিল করে না`,
      href: accountsHref.entry(e.reversalId),
      place: e.reversal,
      why: "উল্টো এন্ট্রির প্রতিটি লাইন আসল এন্ট্রির লাইনের ঠিক উল্টো হওয়ার কথা। না হলে বাতিল করার পরও কিছু টাকা কোনো খাতায় থেকে যায়।",
      fix: "দুটো এন্ট্রি পাশাপাশি খুলে দেখুন কোন খাতায় কত বাকি থেকে গেছে। কোনটা ঠিক Bug Guard নিশ্চিত নয়, তাই নিজে কিছু বদলায় না: হিসাবরক্ষককে দিয়ে “New journal voucher”-এ বাকিটা ঠিক করুন।",
      fixKind: "MANUAL",
      evidence: [
        { label: "আসল এন্ট্রি", value: e.number },
        { label: "উল্টো এন্ট্রি", value: e.reversal },
        { label: "আসল এন্ট্রির টাকা", value: amount(e.debit) },
        { label: "যা মেলে না", value: amount(e.net) },
      ],
    });
  }
  return findings(REVERSALS, items, "বাতিল এন্ট্রির সমস্যা");
}

// -----------------------------------------------------------------------------
// Buyer and supplier lines name them; employee lines name the employee
// -----------------------------------------------------------------------------

const NAMED = "data.ledger.named";

async function namedLines(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const accounts = await accountsByCode(ctx, [
    CONTROL_ACCOUNTS.EMPLOYEE_ADVANCES.code,
    CONTROL_ACCOUNTS.SALARIES_PAYABLE.code,
  ]);
  const employeeAccounts = [...accounts.values()].map((a) => a.id);
  const [noParty, partyOnOther, noEmployee] = await Promise.all([
    ctx.db.$queryRaw<
      Array<{ id: string; number: string; account: string; total: Prisma.Decimal; n: number }>
    >`
      SELECT je.id, je.number, MIN(la.name) AS account,
             SUM(jl.debit + jl.credit) AS total, COUNT(*)::int AS n
      FROM "JournalLine" jl
      JOIN "JournalEntry" je ON je.id = jl."entryId"
      JOIN "LedgerAccount" la ON la.id = jl."accountId"
      WHERE je."companyId" = ${companyId} AND jl."partyId" IS NULL
        AND la."subType" IN (${partySubtypes})
      GROUP BY je.id
      LIMIT 200`,
    ctx.db.$queryRaw<
      Array<{ id: string; number: string; account: string; total: Prisma.Decimal; n: number }>
    >`
      SELECT je.id, je.number, MIN(la.name) AS account,
             SUM(jl.debit + jl.credit) AS total, COUNT(*)::int AS n
      FROM "JournalLine" jl
      JOIN "JournalEntry" je ON je.id = jl."entryId"
      JOIN "LedgerAccount" la ON la.id = jl."accountId"
      WHERE je."companyId" = ${companyId} AND jl."partyId" IS NOT NULL
        AND la."subType" NOT IN (${partySubtypes})
      GROUP BY je.id
      LIMIT 200`,
    employeeAccounts.length === 0
      ? Promise.resolve([])
      : ctx.db.$queryRaw<
          Array<{ id: string; number: string; account: string; total: Prisma.Decimal; n: number }>
        >`
      SELECT je.id, je.number, MIN(la.name) AS account,
             SUM(jl.debit + jl.credit) AS total, COUNT(*)::int AS n
      FROM "JournalLine" jl
      JOIN "JournalEntry" je ON je.id = jl."entryId"
      JOIN "LedgerAccount" la ON la.id = jl."accountId"
      WHERE je."companyId" = ${companyId} AND jl."employeeId" IS NULL
        AND jl."accountId" IN (${Prisma.join(employeeAccounts)})
      GROUP BY je.id
      LIMIT 200`,
  ]);
  const items: Item[] = [];
  for (const r of noParty) {
    items.push({
      id: r.id,
      severity: "IMPORTANT",
      title: `জার্নাল এন্ট্রি ${r.number}-এ “${r.account}” খাতার ${r.n}টি লাইনে কোনো ক্রেতা বা সরবরাহকারীর নাম নেই`,
      href: accountsHref.entry(r.id),
      place: r.number,
      why: "পাওনা, দেনা আর অগ্রিমের প্রতিটি লাইনে কার টাকা তা লেখা থাকতে হয়। নাম না থাকলে টাকাটা খাতায় আছে, কিন্তু কোনো ক্রেতা বা সরবরাহকারীর ব্যালান্সে নেই: “Dues” তালিকা আর খাতার মোট মেলে না।",
      fix: "এন্ট্রিটা খুলে দেখুন টাকাটা কার। পোস্ট করা এন্ট্রি বদলানো যায় না, তাই হাতে লেখা এন্ট্রি হলে “Reverse” করে সঠিক ক্রেতা বা সরবরাহকারীর নাম দিয়ে আবার দিন; অন্য কাগজ থেকে এলে সেটা বাতিল (Void) করে আবার লিখুন। কার টাকা Bug Guard নিশ্চিত জানে না, তাই নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "এন্ট্রি", value: r.number },
        { label: "খাতা", value: r.account },
        { label: "নামহীন লাইন", value: String(r.n) },
        { label: "লাইনগুলোর টাকা", value: amount(r.total) },
      ],
    });
  }
  for (const r of partyOnOther) {
    items.push({
      id: `party-${r.id}`,
      severity: "LATER",
      title: `জার্নাল এন্ট্রি ${r.number}-এ “${r.account}” খাতার লাইনে ক্রেতা বা সরবরাহকারীর নাম আছে, যা ওই খাতায় থাকার কথা নয়`,
      href: accountsHref.entry(r.id),
      place: r.number,
      why: "ক্রেতা বা সরবরাহকারীর ব্যালান্স শুধু পাওনা, দেনা আর অগ্রিমের খাতা থেকে হিসাব হয়। অন্য খাতার লাইনে নাম থাকলে টাকাটা কারো ব্যালান্সে যায় না, তবে কেউ ভাবতে পারে গেছে।",
      fix: "টাকা ঠিক খাতায় আছে কি না দেখুন। খাতা ঠিক থাকলে কিছু করার দরকার নেই; ভুল খাতা হলে হিসাবরক্ষককে দিয়ে উল্টো এন্ট্রি দিয়ে ঠিক করুন।",
      fixKind: "MANUAL",
      evidence: [
        { label: "এন্ট্রি", value: r.number },
        { label: "খাতা", value: r.account },
        { label: "লাইন", value: String(r.n) },
        { label: "লাইনগুলোর টাকা", value: amount(r.total) },
      ],
    });
  }
  for (const r of noEmployee) {
    items.push({
      id: `employee-${r.id}`,
      severity: "IMPORTANT",
      title: `জার্নাল এন্ট্রি ${r.number}-এ “${r.account}” খাতার ${r.n}টি লাইনে কর্মীর নাম নেই`,
      href: accountsHref.entry(r.id),
      place: r.number,
      why: "কর্মীদের অগ্রিম আর বাকি বেতনের প্রতিটি লাইনে কর্মীর নাম থাকতে হয়, নইলে কার কাছে কত পাওনা বা কাকে কত দেওয়া বাকি তা কর্মীর হিসাবে আসে না।",
      fix: "এন্ট্রিটা কোন কাগজ থেকে এসেছে দেখুন (বেতন, অগ্রিম, খরচ)। সেই কাগজ বাতিল করে আবার ঠিকভাবে লিখুন। কার টাকা Bug Guard নিশ্চিত জানে না, তাই নিজে কিছু বদলায় না।",
      fixKind: "MANUAL",
      evidence: [
        { label: "এন্ট্রি", value: r.number },
        { label: "খাতা", value: r.account },
        { label: "নামহীন লাইন", value: String(r.n) },
        { label: "লাইনগুলোর টাকা", value: amount(r.total) },
      ],
    });
  }
  return findings(NAMED, items, "নামহীন খাতার লাইন");
}

// -----------------------------------------------------------------------------
// Opening balances match their entries
// -----------------------------------------------------------------------------

const OPENINGS = "data.ledger.openings";

async function openings(ctx: CheckContext) {
  const companyId = ctx.companyId;
  const { timezone } = await companyOf(ctx);
  const [parties, accounts] = await Promise.all([
    // A party's opening: + they owe us, - we owe them (their lines on the opening entry).
    ctx.db.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        kind: "BUYER" | "SUPPLIER" | "BOTH";
        stored: Prisma.Decimal;
        posted: Prisma.Decimal;
        entries: number;
        at: Date | null;
      }>
    >`
      SELECT p.id, p.code, p.name, p.kind::text AS kind, p."openingBalance" AS stored,
             COALESCE(o.posted, 0) AS posted, COALESCE(o.entries, 0)::int AS entries, o.at
      FROM "Party" p
      LEFT JOIN (
        SELECT je."sourceId" AS "partyId", SUM(jl.debit - jl.credit) AS posted,
               COUNT(DISTINCT je.id) AS entries, MIN(je.date) AS at
        FROM "JournalEntry" je
        JOIN "JournalLine" jl ON jl."entryId" = je.id AND jl."partyId" = je."sourceId"
        JOIN "LedgerAccount" la ON la.id = jl."accountId" AND la."subType" IN (${partySubtypes})
        WHERE je."companyId" = ${companyId} AND je."sourceType" = 'OPENING_BALANCE'::"JournalSource"
        GROUP BY je."sourceId"
      ) o ON o."partyId" = p.id
      WHERE p."companyId" = ${companyId}
        AND p."openingBalance" <> COALESCE(o.posted, 0)
      LIMIT 200`,
    // An account's opening: in its normal direction (its own lines on the opening entry).
    ctx.db.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
        stored: Prisma.Decimal;
        debit: Prisma.Decimal;
        at: Date | null;
      }>
    >`
      SELECT la.id, la.code, la.name, la.type::text AS type, la."openingBalance" AS stored,
             COALESCE(o.debit, 0) AS debit, o.at
      FROM "LedgerAccount" la
      LEFT JOIN (
        SELECT je."sourceId" AS "accountId", SUM(jl.debit - jl.credit) AS debit, MIN(je.date) AS at
        FROM "JournalEntry" je
        JOIN "JournalLine" jl ON jl."entryId" = je.id AND jl."accountId" = je."sourceId"
        WHERE je."companyId" = ${companyId} AND je."sourceType" = 'OPENING_BALANCE'::"JournalSource"
        GROUP BY je."sourceId"
      ) o ON o."accountId" = la.id
      WHERE la."companyId" = ${companyId}
      LIMIT 2000`,
  ]);
  const items: Item[] = [];
  for (const p of parties) {
    const stored = dec(p.stored);
    const posted = dec(p.posted);
    items.push({
      id: p.id,
      severity: "IMPORTANT",
      title: `${p.name}-এর “Opening balance” ${amount(stored)}, কিন্তু খাতায় তার শুরুর এন্ট্রি ${amount(posted)}`,
      href: partyHref({ id: p.id, kind: p.kind }),
      place: `${p.code} ${p.name}`,
      why: "ERP চালুর আগের পাওনা বা দেনা (Opening balance) খাতায় একটা এন্ট্রি হিসেবে থাকে, আর ক্রেতা বা সরবরাহকারীর ব্যালান্স সেই এন্ট্রি থেকেই হিসাব হয়। দুটো না মিললে প্রোফাইলে এক অঙ্ক আর তার স্টেটমেন্ট ও “Dues”-এ আরেক অঙ্ক দেখায়।",
      fix: `প্রোফাইল খুলে “Opening balance” আবার সঠিক অঙ্কে সেট করুন (যদি ${amount(stored)} ঠিক হয়, সেটাই আবার দিন)। ERP পুরনো শুরুর এন্ট্রি সরিয়ে নতুনটা দেবে, তখন দুটো মিলে যাবে। কোন অঙ্কটা ঠিক Bug Guard জানে না, তাই নিজে কিছু বদলায় না।`,
      fixKind: "MANUAL",
      evidence: [
        { label: "প্রোফাইলে লেখা", value: amount(stored) },
        { label: "খাতার শুরুর এন্ট্রিতে", value: amount(posted) },
        { label: "পার্থক্য", value: amount(stored.minus(posted)) },
        { label: "শুরুর এন্ট্রির সংখ্যা", value: String(p.entries) },
        ...(p.at ? [{ label: "এন্ট্রির তারিখ", value: dayOf(p.at, timezone) }] : []),
      ],
    });
  }
  for (const a of accounts) {
    const stored = dec(a.stored);
    const posted = isDebitNature(a.type) ? dec(a.debit) : dec(a.debit).neg();
    if (stored.equals(posted)) continue;
    items.push({
      id: a.id,
      severity: "IMPORTANT",
      title: `“${a.code} ${a.name}” খাতার “Opening balance” ${amount(stored)}, কিন্তু তার শুরুর এন্ট্রিতে ${amount(posted)}`,
      href: accountsHref.account(a.id),
      place: `${a.code} ${a.name}`,
      why: "খাতার শুরুর ব্যালান্স একটা এন্ট্রি হিসেবে থাকে, আর রিপোর্ট সেই এন্ট্রি থেকেই হিসাব করে। দুটো না মিললে খাতার পাতায় এক অঙ্ক আর রিপোর্টে আরেক অঙ্ক দেখায়।",
      fix: `খাতাটি খুলে “Opening balance” আবার সঠিক অঙ্কে সেট করুন (যদি ${amount(stored)} ঠিক হয়, সেটাই আবার দিন)। ERP পুরনো শুরুর এন্ট্রি সরিয়ে নতুনটা দেবে। কোনটা ঠিক Bug Guard জানে না, তাই নিজে কিছু বদলায় না।`,
      fixKind: "MANUAL",
      evidence: [
        { label: "খাতায় লেখা", value: amount(stored) },
        { label: "শুরুর এন্ট্রিতে", value: amount(posted) },
        { label: "পার্থক্য", value: amount(stored.minus(posted)) },
        ...(a.at ? [{ label: "এন্ট্রির তারিখ", value: dayOf(a.at, timezone) }] : []),
      ],
    });
  }
  return findings(OPENINGS, items, "শুরুর ব্যালান্সের অমিল");
}

export const LEDGER_CHECKS: Check[] = [
  { key: ENTRIES, area: "DATA", label: "Journal entries balance", run: unbalancedEntries },
  { key: TRIAL, area: "DATA", label: "Trial balance balances", run: trialBalance },
  { key: REVERSALS, area: "DATA", label: "Reversed entries are reversed", run: reversals },
  { key: NAMED, area: "DATA", label: "Ledger lines name who they are for", run: namedLines },
  { key: OPENINGS, area: "DATA", label: "Opening balances match the books", run: openings },
];
