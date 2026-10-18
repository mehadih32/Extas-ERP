import type { AssetStatus, DepreciationMethod } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import {
  getFixedAsset,
  listFixedAssets,
  previewDepreciation,
} from "@/modules/accounts/asset.service";
import { ZERO } from "@/modules/accounts/balances";
import { isCashSubType } from "@/modules/accounts/chart";
import { accountsKeys } from "@/modules/accounts/rules";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * The fixed asset screens (Accounts > Overview > Asset purchases): the
 * register with its value after depreciation, recording a purchase (paid now,
 * on credit from a supplier, or owned before the books started), one asset
 * with its entries, and selling, scrapping or removing it. The postings are
 * asset.service's; these only gather what each screen shows.
 */

/** Machines, furniture… offered when naming a category (any other name can be typed). */
const SUGGESTED_CATEGORIES = [
  "Machinery",
  "Furniture",
  "Computers & IT",
  "Air conditioners",
  "Electrical",
  "Office equipment",
  "Vehicles",
];

async function categoriesInUse(ctx: CompanyContext) {
  const used = await ctx.db.fixedAsset.findMany({
    where: { category: { not: null }, voidedAt: null },
    select: { category: true },
    distinct: ["category"],
  });
  const names = new Set([...SUGGESTED_CATEGORIES, ...used.flatMap((a) => a.category ?? [])]);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The register: every asset with its book value, the totals, and the depreciation not yet posted. */
export async function getAssetRegister(ctx: CompanyContext, raw: unknown = {}) {
  const keys = accountsKeys(ctx);
  const [list, pending] = await Promise.all([listFixedAssets(ctx, raw), previewDepreciation(ctx)]);
  return {
    summary: list.summary,
    assets: list.items.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      location: a.location,
      boughtOn: a.purchaseDay,
      cost: a.purchaseCost.toFixed(2),
      bookValue: a.bookValue,
      accumulatedDepreciation: a.accumulatedDepreciation,
      depreciatedUntil: a.depreciatedUntil,
      status: a.status as AssetStatus,
    })),
    /** Depreciation up to the end of last month that is not posted yet. */
    depreciation: {
      through: pending.through,
      total: pending.total,
      assets: pending.items.map((i) => ({
        id: i.assetId,
        name: i.name,
        amount: i.amount,
        bookValueAfter: i.bookValueAfter,
      })),
    },
    can: { record: keys.manage, depreciate: keys.manage },
  };
}

export type AssetRegister = Awaited<ReturnType<typeof getAssetRegister>>;

/** Recording a purchase, or changing an asset's details (assetId). */
export async function getAssetForm(ctx: CompanyContext, assetId?: string) {
  const keys = accountsKeys(ctx);
  if (!keys.manage) throw new AppError("FORBIDDEN", "Only Accounts can add fixed assets.");
  const [categories, accounts, asset] = await Promise.all([
    categoriesInUse(ctx),
    keys.pay && !assetId ? listMoneyAccounts(ctx) : [],
    assetId ? ctx.db.fixedAsset.findFirst({ where: { id: assetId, voidedAt: null } }) : null,
  ]);
  if (assetId && !asset) throw new AppError("NOT_FOUND", "Fixed asset not found.");
  return {
    today: localDay(new Date(), ctx.company.timezone),
    categories,
    /** Where a purchase paid now comes from (only for people who pay money out). */
    accounts,
    asset: asset
      ? {
          id: asset.id,
          name: asset.name,
          category: asset.category,
          location: asset.location,
          notes: asset.notes,
          status: asset.status as AssetStatus,
          depreciationRate: asset.depreciationRate?.toFixed(2) ?? null,
          depreciationMethod: asset.depreciationMethod as DepreciationMethod,
          salvageValue: asset.salvageValue.toFixed(2),
          cost: asset.purchaseCost.toFixed(2),
        }
      : null,
    can: { payNow: keys.pay },
  };
}

export type AssetForm = Awaited<ReturnType<typeof getAssetForm>>;

/** How the asset came into the books: paid from an account, owed to a supplier, or brought forward. */
async function acquiredHow(ctx: CompanyContext, assetId: string) {
  const entry = await ctx.db.journalEntry.findFirst({
    where: { sourceType: "FIXED_ASSET", sourceId: assetId, reversalOfId: null },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: {
      lines: {
        where: { credit: { gt: 0 } },
        select: {
          account: { select: { id: true, name: true, subType: true } },
          party: { select: { id: true, name: true, kind: true } },
        },
      },
    },
  });
  const lines = entry?.lines ?? [];
  const cash = lines.find((l) => isCashSubType(l.account.subType));
  if (cash) return { kind: "PAID" as const, account: cash.account.name, supplier: null };
  const owed = lines.find((l) => l.party);
  if (owed?.party) return { kind: "CREDIT" as const, account: null, supplier: owed.party };
  return { kind: "OPENING" as const, account: null, supplier: null };
}

/** One asset: its value after depreciation, how it was bought, its entries, and what can be done. */
export async function getAssetScreen(ctx: CompanyContext, assetId: string) {
  const keys = accountsKeys(ctx);
  const asset = await getFixedAsset(ctx, assetId);
  const disposed = asset.status === "DISPOSED";
  const [how, accounts] = await Promise.all([
    acquiredHow(ctx, asset.id),
    keys.manage && keys.receive && !disposed ? listMoneyAccounts(ctx) : [],
  ]);
  const tz = ctx.company.timezone;
  return {
    today: localDay(new Date(), tz),
    asset: {
      id: asset.id,
      name: asset.name,
      category: asset.category,
      location: asset.location,
      notes: asset.notes,
      status: asset.status as AssetStatus,
      boughtOn: asset.purchaseDay,
      cost: asset.purchaseCost.toFixed(2),
      bookValue: asset.bookValue,
      accumulatedDepreciation: asset.accumulatedDepreciation,
      monthlyDepreciation: asset.monthlyDepreciation,
      depreciationRate: asset.depreciationRate?.toFixed(2) ?? null,
      depreciationMethod: asset.depreciationMethod as DepreciationMethod,
      salvageValue: asset.salvageValue.toFixed(2),
      depreciatedUntil: asset.depreciatedUntil,
      disposedOn: asset.disposedAt ? localDay(asset.disposedAt, tz) : null,
      disposalAmount: asset.disposalAmount?.toFixed(2) ?? null,
      gainOnDisposal: asset.gainOnDisposal,
    },
    acquired: how,
    entries: asset.history.map((e) => ({
      id: e.id,
      number: e.number,
      day: localDay(e.date, tz),
      description: e.description,
      kind: e.sourceType,
      isReversed: e.isReversed,
      amount: e.lines.reduce((t, l) => t.plus(l.debit), ZERO).toFixed(2),
    })),
    /** Where sale money is received (for people who take money in). */
    accounts,
    can: {
      edit: keys.manage,
      dispose: keys.manage && !disposed,
      /** Selling it for money (taking money in); scrapping needs only Accounts. */
      sell: keys.manage && keys.receive && !disposed,
      remove: keys.manage && !disposed,
      openSupplier: ctx.can("parties.view"),
    },
  };
}

export type AssetScreen = Awaited<ReturnType<typeof getAssetScreen>>;
