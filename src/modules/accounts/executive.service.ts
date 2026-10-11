import { type PartyKind, Prisma, type ProductionStatus } from "@prisma/client";

import { localDay, nextDay, startOfDayInZone } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { accountTotals, type DateRange, ZERO } from "@/modules/accounts/balances";
import { CONTROL_ACCOUNTS } from "@/modules/accounts/control-accounts";
import { growth, type ProfitPeriod, profitWindow } from "@/modules/accounts/profit-periods";
import { loadAccounts, profitFigures } from "@/modules/accounts/reports.service";
import type { CompanyContext } from "@/modules/auth/context";
import { profitLeaders } from "@/modules/dashboard/sales-figures";
import { balanceUnitCostSql } from "@/modules/inventory/costs";
import { getReceivablesPayables } from "@/modules/parties/ledger.service";
import { projectCostSummaries } from "@/modules/production/project-costs";

/*
 * The five executive cards on the Accounts Overview and what opens under each:
 *   Cash & bank      the cash, bank and wallet balances (from the overview)
 *   Market due       buyers who owe us, net of their advances, largest first
 *   Market payable   suppliers we owe, net of what we paid them ahead
 *   Inventory & WIP  ready stock by category, raw materials, and the money in
 *                    each open production project
 *   Net profit       gross and net profit today, this month, this financial year
 *                    or for all time, against the same days of the period
 *                    before, and the most profitable categories and buyers
 * Every figure is read from the journal, the stock and the sales documents the
 * rest of Accounts uses: nothing is stored, nothing is posted.
 */

export {
  growth,
  isProfitPeriod,
  PROFIT_PERIODS,
  profitWindow,
} from "@/modules/accounts/profit-periods";
export type { Growth, ProfitPeriod, ProfitWindow } from "@/modules/accounts/profit-periods";

function dayRange(ctx: CompanyContext, from: string | null, to: string): DateRange {
  const tz = ctx.company.timezone;
  return {
    start: from ? startOfDayInZone(from, tz) : undefined,
    end: startOfDayInZone(nextDay(to), tz),
  };
}

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

/**
 * The Net profit card: sales, gross profit (sales less the cost of the goods
 * sold) and net profit (after every other cost and income) for the period,
 * with the same figures for the period before and which way net profit moved.
 */
export async function getProfitCard(ctx: CompanyContext, period: ProfitPeriod) {
  const companyId = ctx.company.id;
  const window = profitWindow(period, today(ctx), ctx.company.fiscalYearStartMonth);
  const [accounts, now, before] = await Promise.all([
    loadAccounts(companyId),
    accountTotals(companyId, dayRange(ctx, window.from, window.to)),
    window.previous
      ? accountTotals(companyId, dayRange(ctx, window.previous.from, window.previous.to))
      : null,
  ]);
  const f = profitFigures(accounts, now);
  const p = before ? profitFigures(accounts, before) : null;
  return {
    period,
    from: window.from,
    to: window.to,
    sales: f.revenue.total.toFixed(2),
    gross: f.grossProfit.toFixed(2),
    net: f.netProfit.toFixed(2),
    previous:
      p && window.previous
        ? { ...window.previous, gross: p.grossProfit.toFixed(2), net: p.netProfit.toFixed(2) }
        : null,
    /** Net profit against the same days of the period before. */
    growth: p ? growth(f.netProfit, p.netProfit) : null,
  };
}

export type ProfitCard = Awaited<ReturnType<typeof getProfitCard>>;

export type MarketRow = {
  id: string;
  code: string;
  name: string;
  kind: PartyKind;
  /** What they owe us, or what we owe them ("12500.00"). */
  amount: string;
  lastTransactionOn: string | null;
};

/**
 * Market due and market payable, party by party: a buyer's balance is what
 * they owe after any advance they paid, a supplier's what we owe after any
 * advance we paid them (a buyer's advance and money a supplier owes back are
 * left out of both). Largest first.
 */
export async function getMarketBalances(ctx: CompanyContext) {
  const o = await getReceivablesPayables(ctx);
  const tz = ctx.company.timezone;
  const row = (r: (typeof o.receivables)[number]): MarketRow => ({
    id: r.partyId,
    code: r.code,
    name: r.name,
    kind: r.kind as PartyKind,
    amount: r.balance,
    lastTransactionOn: r.lastTransactionAt ? localDay(r.lastTransactionAt, tz) : null,
  });
  const side = (rows: MarketRow[]) => ({
    total: rows.reduce((t, r) => t.plus(r.amount), ZERO).toFixed(2),
    count: rows.length,
    rows,
  });
  return {
    due: side(o.receivables.filter((r) => r.kind !== "SUPPLIER").map(row)),
    payable: side(o.payables.filter((r) => r.kind !== "BUYER").map(row)),
    can: { openParty: ctx.can("parties.view") },
  };
}

export type MarketBalances = Awaited<ReturnType<typeof getMarketBalances>>;

/** "Men › Polos": each category's place in the tree, by id. */
async function categoryPaths(ctx: CompanyContext) {
  const rows = await ctx.db.category.findMany({ select: { id: true, name: true, parentId: true } });
  const byId = new Map(rows.map((c) => [c.id, c]));
  const path = (id: string): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (
      let c = byId.get(id);
      c && !seen.has(c.id);
      c = c.parentId ? byId.get(c.parentId) : undefined
    ) {
      seen.add(c.id);
      names.unshift(c.name);
    }
    return names.join(" › ") || "No category";
  };
  return path;
}

const OPEN_PROJECT: ProductionStatus[] = ["PLANNED", "ACTIVE", "ON_HOLD"];

/**
 * What opens under Inventory & WIP: finished stock by category (pieces at
 * average cost, as the overview values it), raw materials in the store, and
 * the money still in each open production project. Any work in progress the
 * books hold outside an open project shows on its own line, so the parts add
 * up to the card.
 */
export async function getHoldingsBreakdown(ctx: CompanyContext) {
  const companyId = ctx.company.id;
  const [stock, path, projects, ledger] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; pieces: bigint; value: Prisma.Decimal | null }>>`
      SELECT st."categoryId" AS id, SUM(sb.quantity)::bigint AS pieces,
             SUM(sb.quantity * ${balanceUnitCostSql}) AS value
      FROM "StockBalance" sb
      JOIN "ProductVariant" pv ON pv.id = sb."variantId"
      JOIN "Style" st ON st.id = pv."styleId"
      WHERE sb."companyId" = ${companyId}
      GROUP BY 1
      HAVING SUM(sb.quantity) <> 0
      ORDER BY 3 DESC NULLS LAST, 1`,
    categoryPaths(ctx),
    ctx.db.productionProject.findMany({
      where: { status: { in: OPEN_PROJECT } },
      select: { id: true, code: true, name: true, status: true, stage: true },
      orderBy: { code: "asc" },
    }),
    prisma.$queryRaw<Array<{ key: string; balance: Prisma.Decimal | null }>>`
      SELECT CASE WHEN la.code = ${CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code} THEN 'WIP'
                  ELSE 'RAW' END AS key,
             SUM(jl.debit - jl.credit) AS balance
      FROM "JournalLine" jl
      JOIN "JournalEntry" je ON je.id = jl."entryId"
      JOIN "LedgerAccount" la ON la.id = jl."accountId"
      WHERE je."companyId" = ${companyId}
        AND (la.code = ${CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code}
             OR la."subType" = 'RAW_MATERIALS'::"AccountSubType")
      GROUP BY 1`,
  ]);
  const costs = await projectCostSummaries(
    prisma,
    companyId,
    projects.map((p) => p.id),
  );
  const ledgerOf = (key: string) =>
    new Prisma.Decimal(ledger.find((r) => r.key === key)?.balance ?? 0).toDecimalPlaces(2);

  const categories = stock.map((r) => ({
    id: r.id,
    name: path(r.id),
    pieces: Number(r.pieces),
    value: new Prisma.Decimal(r.value ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  }));
  const inProjects = projects
    .map((p) => ({ ...p, wip: costs.get(p.id)?.wip ?? ZERO }))
    .filter((p) => !p.wip.isZero())
    .sort((a, b) => b.wip.comparedTo(a.wip) || a.code.localeCompare(b.code));
  const wip = ledgerOf("WIP");
  const other = wip.minus(inProjects.reduce((t, p) => t.plus(p.wip), ZERO));
  const readyStock = categories.reduce((t, c) => t.plus(c.value), ZERO);
  const rawMaterials = ledgerOf("RAW");

  return {
    total: readyStock.plus(rawMaterials).plus(wip).toFixed(2),
    readyStock: {
      total: readyStock.toFixed(2),
      categories: categories.map((c) => ({ ...c, value: c.value.toFixed(2) })),
    },
    rawMaterials: { total: rawMaterials.toFixed(2) },
    production: {
      total: wip.toFixed(2),
      projects: inProjects.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        stage: p.stage,
        wip: p.wip.toFixed(2),
      })),
      /** Work in progress in the books outside the open projects (a closed one, a voucher). */
      other: other.isZero() ? null : other.toFixed(2),
    },
    can: {
      openCategory: ctx.can("inventory.view"),
      openMaterials: ctx.can("materials.view"),
      openProject: ctx.can("production.view"),
    },
  };
}

export type HoldingsBreakdown = Awaited<ReturnType<typeof getHoldingsBreakdown>>;

const LEADERS_SHOWN = 5;

/**
 * What opens under Net profit: the categories and buyers that made the most
 * gross profit in the period (invoiced sales less the cost of the pieces),
 * from the sales documents. Walk-in sales count for the categories only.
 */
export async function getProfitLeaders(ctx: CompanyContext, period: ProfitPeriod) {
  const window = profitWindow(period, today(ctx), ctx.company.fiscalYearStartMonth);
  const range = dayRange(ctx, window.from, window.to);
  const leaders = await profitLeaders(
    ctx.company.id,
    { start: range.start ?? new Date(Date.UTC(1970, 0, 1)), end: range.end! },
    LEADERS_SHOWN,
  );
  const [path, parties] = await Promise.all([
    leaders.categories.length > 0 ? categoryPaths(ctx) : null,
    ctx.db.party.findMany({
      where: { id: { in: leaders.buyers.map((b) => b.id) } },
      select: { id: true, code: true, name: true, kind: true },
    }),
  ]);
  const partyOf = new Map(parties.map((p) => [p.id, p]));
  const figures = (l: (typeof leaders.categories)[number]) => ({
    pieces: l.pieces,
    sales: l.net.toFixed(2),
    cost: l.cost.toFixed(2),
    profit: l.profit.toFixed(2),
    /** Gross profit as a share of sales, "18.4"; null without sales. */
    margin: l.net.isZero()
      ? null
      : l.profit
          .dividedBy(l.net)
          .times(100)
          .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(1),
  });
  return {
    period,
    from: window.from,
    to: window.to,
    categories: leaders.categories.map((c) => ({ id: c.id, name: path!(c.id), ...figures(c) })),
    buyers: leaders.buyers.flatMap((b) => {
      const party = partyOf.get(b.id);
      return party ? [{ ...party, ...figures(b) }] : [];
    }),
    can: { openCategory: ctx.can("inventory.view"), openParty: ctx.can("parties.view") },
  };
}

export type ProfitLeadersScreen = Awaited<ReturnType<typeof getProfitLeaders>>;
