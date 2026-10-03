import { Prisma } from "@prisma/client";

import { localDay, nextDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { accountTotals, ZERO } from "@/modules/accounts/balances";
import { CONTROL_ACCOUNTS } from "@/modules/accounts/control-accounts";
import { addDays, addMonths, financialYearStart, monthStart } from "@/modules/accounts/periods";
import {
  type AccountInfo,
  loadAccounts,
  natural,
  netProfitFor,
} from "@/modules/accounts/reports.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { hiddenMetricsFor } from "@/modules/dashboard/preferences.service";
import { salesTotals } from "@/modules/dashboard/sales-figures";
import type { MetricCardKey } from "@/modules/dashboard/schemas";
import { stockOnHand } from "@/modules/dashboard/stock-figures";

/*
 * The owner's metric cards (blueprint: Total Active Stock Value, Fixed Assets,
 * Liabilities (Loans / Investors), Today's Sales, Net Profit), each with the
 * figures behind it. Money comes from the books, so the cards agree with the
 * Accounts overview and the statements; pieces and invoice counts come from
 * stock and the sales documents. Each card says whether the person chose to
 * hide it (the eye icon); hiding is a display choice, the figures still come.
 */

const pct = (part: Prisma.Decimal, whole: Prisma.Decimal) =>
  whole.isZero() ? null : part.minus(whole).dividedBy(whole.abs()).times(100).toFixed(1);

export async function getMetricCards(ctx: CompanyContext, now: Date = new Date()) {
  if (!canSeeFinancials(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to see the money cards.");
  }
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const day = localDay(now, tz);
  const yesterday = addDays(day, -1);
  const at = (d: string) => startOfDayInZone(d, tz);
  const dayStart = at(day);
  const dayEnd = at(nextDay(day));
  const monthFrom = monthStart(day);
  const lastMonthFrom = addMonths(monthFrom, -1);
  const fyFrom = financialYearStart(day, ctx.company.fiscalYearStartMonth);

  const accounts = await loadAccounts(companyId);
  const [
    totals,
    todayTotals,
    yesterdayTotals,
    stock,
    todayInvoiced,
    monthProfit,
    lastMonthProfit,
    yearProfit,
    assets,
    hidden,
  ] = await Promise.all([
    accountTotals(companyId),
    accountTotals(companyId, { start: dayStart, end: dayEnd }),
    accountTotals(companyId, { start: at(yesterday), end: dayStart }),
    stockOnHand(companyId),
    salesTotals(companyId, { start: dayStart, end: dayEnd }),
    netProfitFor(companyId, { start: at(monthFrom), end: dayEnd }),
    netProfitFor(companyId, { start: at(lastMonthFrom), end: at(monthFrom) }),
    netProfitFor(companyId, { start: at(fyFrom), end: dayEnd }),
    prisma.fixedAsset.count({ where: { companyId, status: { not: "DISPOSED" } } }),
    hiddenMetricsFor(ctx.user.id),
  ]);

  const sum = (
    t: Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>,
    pick: (a: AccountInfo) => boolean,
  ) => accounts.filter(pick).reduce((s, a) => s.plus(natural(a, t)), ZERO);
  const finishedGoods = stock.aGradeValue.plus(stock.bGradeValue);
  const rawMaterials = sum(totals, (a) => a.subType === "RAW_MATERIALS");
  const workInProgress = sum(totals, (a) => a.code === CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code);
  const assetCost = sum(totals, (a) => a.subType === "FIXED_ASSET");
  // Accumulated depreciation is a credit balance on an asset account (negative here).
  const depreciation = sum(totals, (a) => a.subType === "ACCUMULATED_DEPRECIATION").neg();
  const loans = sum(totals, (a) => a.subType === "LOAN");
  const investors = sum(totals, (a) => a.subType === "INVESTOR");
  const todaySales = sum(todayTotals, (a) => a.subType === "SALES");
  const yesterdaySales = sum(yesterdayTotals, (a) => a.subType === "SALES");

  const hiddenSet = new Set<MetricCardKey>(hidden);
  // Keeps each card's key as a literal type, so screens can tell the cards' details apart.
  const card = <K extends MetricCardKey, D extends Record<string, unknown>>(
    key: K,
    label: string,
    value: Prisma.Decimal,
    details: D,
  ) => ({ key, label, value: value.toFixed(2), hidden: hiddenSet.has(key), details });

  return {
    asOf: day,
    currency: ctx.company.currency,
    hiddenMetrics: hidden,
    cards: [
      card("STOCK_VALUE", "Total active stock value", finishedGoods, {
        /** Finished goods on hand at average cost, by grade (the card's value). */
        aGrade: { pieces: stock.aGradePieces, value: stock.aGradeValue.toFixed(2) },
        bGrade: { pieces: stock.bGradePieces, value: stock.bGradeValue.toFixed(2) },
        /** Also held: fabric and trims in the stores, and costs in production not yet in stock. */
        rawMaterials: rawMaterials.toFixed(2),
        workInProgress: workInProgress.toFixed(2),
        allStock: finishedGoods.plus(rawMaterials).plus(workInProgress).toFixed(2),
      }),
      card("FIXED_ASSETS", "Fixed assets", assetCost.minus(depreciation), {
        /** Book value = cost less depreciation so far. */
        cost: assetCost.toFixed(2),
        accumulatedDepreciation: depreciation.toFixed(2),
        /** Assets in the register that are not disposed of. */
        assetCount: assets,
      }),
      card("LIABILITIES", "Liabilities (loans / investors)", loans.plus(investors), {
        loans: loans.toFixed(2),
        investors: investors.toFixed(2),
      }),
      card("TODAY_SALES", "Today's sales", todaySales, {
        /** Net of discounts, without delivery charges or VAT (the Sales account). */
        invoices: todayInvoiced.orders,
        pieces: todayInvoiced.pieces,
        yesterday: yesterdaySales.toFixed(2),
        /** Change against yesterday, in percent (null when yesterday had no sales). */
        changePct: pct(todaySales, yesterdaySales),
      }),
      card("NET_PROFIT", "Net profit (this month)", monthProfit, {
        monthFrom,
        lastMonth: lastMonthProfit.toFixed(2),
        thisFinancialYear: yearProfit.toFixed(2),
        financialYearFrom: fyFrom,
      }),
    ],
  };
}
