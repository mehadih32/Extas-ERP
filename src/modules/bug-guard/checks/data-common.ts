import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";

import type { CheckContext, CorrectionPlan, Found, Severity } from "../types";

/*
 * What Bug Guard's data and accounts checks share: figures written the way the
 * owner reads them, the company's own settings, the cap on findings per check,
 * and the corrections already applied for a finding (an adjusting entry Bug
 * Guard posted with the owner's PIN counts as the missing posting it stands for,
 * until it is undone).
 */

export const ZERO = new Prisma.Decimal(0);

export const dec = (v: Prisma.Decimal.Value | null | undefined) =>
  new Prisma.Decimal(v === null || v === undefined ? 0 : v);

/** Money as kept in the books ("1250.00"), for corrections. */
export const fixed = (v: Prisma.Decimal.Value | null | undefined) => dec(v).toFixed(2);

const grouped = (text: string) => {
  const [whole = "0", part] = text.replace(/^-/, "").split(".");
  const sign = text.startsWith("-") ? "-" : "";
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${part ? `.${part}` : ""}`;
};

/** Money for the owner: "12,500.00" (Western digits). */
export const amount = (v: Prisma.Decimal.Value | null | undefined) => grouped(fixed(v));

/** A quantity for the owner: "12.5", "1,200" (up to 3 decimals, no trailing zeros). */
export const quantity = (v: Prisma.Decimal.Value | null | undefined) =>
  grouped(dec(v).toDecimalPlaces(3).toString());

/** A day ("2026-10-16") of a timestamp in the company's time. */
export const dayOf = (at: Date, timeZone: string) => localDay(at, timeZone);

/** A @db.Date column's day. */
export const dateOf = (at: Date) => at.toISOString().slice(0, 10);

type CompanyFacts = { timezone: string; currency: string; name: string };
const companies = new WeakMap<CheckContext, Promise<CompanyFacts>>();

/** The company's time zone and currency (read once per run). */
export function companyOf(ctx: CheckContext): Promise<CompanyFacts> {
  let found = companies.get(ctx);
  if (!found) {
    found = ctx.db.company
      .findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { timezone: true, currency: true, name: true },
      })
      .then((c) => ({ timezone: c.timezone, currency: c.currency, name: c.name }));
    companies.set(ctx, found);
  }
  return found;
}

/** Today in the company's time ("YYYY-MM-DD"). */
export async function todayOf(ctx: CheckContext) {
  return localDay(ctx.now, (await companyOf(ctx)).timezone);
}

/** What one check found about one record, before its key and area are added. */
export type Item = {
  /** The record the problem is about: the key is "<check>:<id>". */
  id: string;
  severity: Severity;
  title: string;
  href?: string | null;
  place?: string | null;
  why: string;
  fix: string;
  fixKind: Found["fixKind"];
  evidence?: Array<{ label: string; value: string }>;
  correction?: CorrectionPlan | null;
};

const RANK: Record<Severity, number> = { URGENT: 0, IMPORTANT: 1, LATER: 2 };

/** Most findings one check reports; past that, the rest are one summary finding. */
export const MAX_FINDINGS = 20;

/**
 * The findings of a check: one per item, the worst first, at most 20. When there
 * are more, the first 19 are kept as they are and the rest become one finding
 * that counts them and names the first few (they come one by one as these are
 * put right).
 */
export function findings(checkKey: string, items: Item[], what: string): Found[] {
  const sorted = [...items].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      (a.place ?? "").localeCompare(b.place ?? "") ||
      a.id.localeCompare(b.id),
  );
  const toFound = (item: Item): Found => ({
    key: `${checkKey}:${item.id}`,
    area: "DATA",
    severity: item.severity,
    title: item.title,
    href: item.href ?? null,
    place: item.place ?? null,
    why: item.why,
    fix: item.fix,
    fixKind: item.fixKind,
    evidence: item.evidence ?? [],
    correction: item.correction ?? null,
  });
  if (sorted.length <= MAX_FINDINGS) return sorted.map(toFound);
  const kept = sorted.slice(0, MAX_FINDINGS - 1);
  const rest = sorted.slice(MAX_FINDINGS - 1);
  const worst = rest.reduce<Severity>(
    (w, i) => (RANK[i.severity] < RANK[w] ? i.severity : w),
    "LATER",
  );
  const examples = rest.slice(0, 5).map((i) => i.place ?? i.title);
  return [
    ...kept.map(toFound),
    {
      key: `${checkKey}:more`,
      area: "DATA",
      severity: worst,
      title: `${what}: আরও ${rest.length}টি একই রকম সমস্যা আছে`,
      href: rest[0]?.href ?? null,
      place: null,
      why: "একসাথে অনেকগুলো দেখালে আসল কাজ হারিয়ে যায়, তাই প্রথম 19টি আলাদা করে দেখানো হয়েছে।",
      fix: "উপরের গুলো ঠিক করার পর পরের বার Bug Guard বাকিগুলো একটা একটা করে দেখাবে, প্রত্যেকটার প্রমাণ আর ঠিক করার উপায়সহ।",
      fixKind: "MANUAL",
      evidence: [
        { label: "মোট বাকি", value: String(rest.length) },
        ...examples.map((e, n) => ({ label: `উদাহরণ ${n + 1}`, value: e })),
      ],
      correction: null,
    },
  ];
}

/**
 * Finding keys (starting with `prefix`) that have an adjusting entry Bug Guard
 * posted for them with the owner's PIN and that is not undone: the check counts
 * that entry as the posting it stands for. An undone correction's entry is
 * reversed, so its finding comes back.
 */
export async function correctedKeys(ctx: CheckContext, prefix: string): Promise<Set<string>> {
  const rows = await ctx.db.$queryRaw<Array<{ key: string }>>`
    SELECT DISTINCT f.key
    FROM "JournalEntry" je
    JOIN "BugGuardCorrection" c ON c.id = je."sourceId" AND c."companyId" = je."companyId"
    JOIN "BugGuardFinding" f ON f.id = c."findingId"
    WHERE je."companyId" = ${ctx.companyId}
      AND je."sourceType" = 'CORRECTION'::"JournalSource"
      AND je."isReversed" = false AND je."reversalOfId" IS NULL
      AND f.key LIKE ${`${prefix}%`}`;
  return new Set(rows.map((r) => r.key));
}

/** The company's ledger accounts the ERP posts to by code (only those that exist). */
export async function accountsByCode(ctx: CheckContext, codes: string[]) {
  const rows = await ctx.db.ledgerAccount.findMany({
    where: { companyId: ctx.companyId, code: { in: codes } },
    select: { id: true, code: true, name: true, type: true, subType: true },
  });
  return new Map(rows.map((r) => [r.code, r]));
}
