import { type FixedAsset, Prisma } from "@prisma/client";

import { dateColumn, dateOnly, localDay, startOfDayInZone, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { money, ZERO } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { isCashSubType } from "@/modules/accounts/chart";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import {
  type DepreciableAsset,
  depreciationCharges,
  monthlyCharge,
} from "@/modules/accounts/depreciation";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import {
  assertCanManageAccounts,
  assertCanPayMoney,
  assertCanReceiveMoney,
} from "@/modules/accounts/money-guards";
import { addDays, monthStart } from "@/modules/accounts/periods";
import {
  createAssetSchema,
  depreciationRunSchema,
  disposeAssetSchema,
  listAssetsSchema,
  updateAssetSchema,
  voidSchema,
} from "@/modules/accounts/schemas";
import {
  settleSupplierBills,
  settleSuppliersOnLines,
} from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";

/*
 * Fixed asset register (machines, furniture, vehicles, computers):
 *   Bought, paid now      Dr Fixed Assets           Cr Cash / Bank / Wallet
 *   Bought on credit      Dr Fixed Assets           Cr Payable (supplier)
 *   Owned at go-live      Dr Fixed Assets (cost)    Cr Accumulated Depreciation (so far)
 *                                                   Cr Opening Balance Equity (book value)
 *   Depreciation          Dr Depreciation           Cr Accumulated Depreciation
 *   Sold or scrapped      Dr Cash (proceeds) + Accumulated Depreciation, Cr Fixed Assets
 *                         (cost); a gain goes to Other Income, a loss to Loss on Disposal
 * Every entry names the asset in `sourceId`, so its history is its entries.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 60_000 };

function depreciable(asset: FixedAsset): DepreciableAsset {
  return {
    cost: asset.purchaseCost,
    salvage: asset.salvageValue,
    ratePct: asset.depreciationRate,
    method: asset.depreciationMethod,
    bookValue: asset.currentValue,
  };
}

/** The first day not yet depreciated. */
function nextDepreciationDay(asset: FixedAsset, timeZone: string) {
  return asset.depreciatedUntil
    ? addDays(dateOnly(asset.depreciatedUntil)!, 1)
    : localDay(asset.purchaseDate, timeZone);
}

function presentAsset(asset: FixedAsset, timeZone: string) {
  const accumulated = asset.purchaseCost.minus(asset.currentValue);
  const disposed = asset.status === "DISPOSED";
  return {
    ...asset,
    purchaseDay: localDay(asset.purchaseDate, timeZone),
    depreciatedUntil: dateOnly(asset.depreciatedUntil),
    accumulatedDepreciation: accumulated.toFixed(2),
    bookValue: asset.currentValue.toFixed(2),
    monthlyDepreciation: disposed ? "0.00" : monthlyCharge(depreciable(asset)).toFixed(2),
    gainOnDisposal:
      disposed && asset.disposalAmount
        ? asset.disposalAmount.minus(asset.currentValue).toFixed(2)
        : null,
  };
}

export async function listFixedAssets(ctx: CompanyContext, raw: unknown = {}) {
  const q = listAssetsSchema.parse(raw);
  const assets = await ctx.db.fixedAsset.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.category ? { category: { equals: q.category, mode: "insensitive" } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { location: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ purchaseDate: "desc" }, { id: "asc" }],
  });
  // Register totals cover assets still owned.
  const owned = assets.filter((a) => a.status !== "DISPOSED");
  const byCategory = new Map<
    string,
    { count: number; cost: Prisma.Decimal; bookValue: Prisma.Decimal }
  >();
  for (const a of owned) {
    const key = a.category ?? "Uncategorised";
    const row = byCategory.get(key) ?? { count: 0, cost: ZERO, bookValue: ZERO };
    row.count += 1;
    row.cost = row.cost.plus(a.purchaseCost);
    row.bookValue = row.bookValue.plus(a.currentValue);
    byCategory.set(key, row);
  }
  const cost = owned.reduce((s, a) => s.plus(a.purchaseCost), ZERO);
  const bookValue = owned.reduce((s, a) => s.plus(a.currentValue), ZERO);
  return {
    items: assets.map((a) => presentAsset(a, ctx.company.timezone)),
    summary: {
      count: owned.length,
      cost: cost.toFixed(2),
      accumulatedDepreciation: cost.minus(bookValue).toFixed(2),
      bookValue: bookValue.toFixed(2),
      byCategory: [...byCategory].map(([category, r]) => ({
        category,
        count: r.count,
        cost: r.cost.toFixed(2),
        bookValue: r.bookValue.toFixed(2),
      })),
    },
  };
}

export async function getFixedAsset(ctx: CompanyContext, assetId: string) {
  const asset = await ctx.db.fixedAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new AppError("NOT_FOUND", "Fixed asset not found.");
  const entries = await ctx.db.journalEntry.findMany({
    where: { sourceId: asset.id, sourceType: { in: ["FIXED_ASSET", "DEPRECIATION"] } },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: { account: { select: { code: true, name: true } } },
      },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return {
    ...presentAsset(asset, ctx.company.timezone),
    history: entries.map((e) => ({
      id: e.id,
      number: e.number,
      date: e.date,
      description: e.description,
      sourceType: e.sourceType,
      isReversed: e.isReversed,
      lines: e.lines.map((l) => ({
        account: l.account,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
      })),
    })),
  };
}

export async function createFixedAsset(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can add fixed assets.");
  const input = createAssetSchema.parse(raw);
  const { acquisition } = input;
  if (acquisition.kind === "PAID") assertCanPayMoney(ctx);
  const tz = ctx.company.timezone;
  const companyId = ctx.company.id;
  const cost = money(input.purchaseCost);
  const salvage = money(input.salvageValue ?? 0);
  if (salvage.gt(cost)) throw new AppError("VALIDATION", "Salvage value is more than the cost.");
  const purchaseDate = toInstant(input.purchaseDate, tz);
  const supplier =
    acquisition.kind === "CREDIT"
      ? await assertPartyCanTransact(ctx, acquisition.supplierId, "PURCHASE")
      : null;
  const accumulated =
    acquisition.kind === "OPENING" ? money(acquisition.accumulatedDepreciation) : ZERO;
  if (accumulated.gt(cost)) {
    throw new AppError("VALIDATION", "Depreciation so far is more than the cost.");
  }
  const openingDate =
    acquisition.kind === "OPENING"
      ? acquisition.asOf
        ? toInstant(acquisition.asOf, tz)
        : new Date()
      : null;
  if (openingDate && openingDate < purchaseDate) {
    throw new AppError("VALIDATION", "The go-live day is before the purchase date.");
  }

  const asset = await prisma.$transaction(async (tx) => {
    const acc = await ensureControlAccounts(companyId, tx);
    const created = await tx.fixedAsset.create({
      data: {
        companyId,
        name: input.name,
        category: input.category ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        purchaseDate,
        purchaseCost: cost,
        depreciationRate: input.depreciationRate ?? null,
        depreciationMethod: input.depreciationMethod ?? "STRAIGHT_LINE",
        salvageValue: salvage,
        currentValue: cost.minus(accumulated),
        // Brought-forward assets were depreciated up to the day before go-live.
        depreciatedUntil: openingDate ? dateColumn(addDays(localDay(openingDate, tz), -1)) : null,
      },
    });
    let lines;
    let description: string;
    if (acquisition.kind === "PAID") {
      const paidFrom = await cashAccountFor(
        tx,
        companyId,
        acquisition.method,
        acquisition.accountId,
      );
      description = `Bought ${created.name} (paid, ${acquisition.method})`;
      lines = [
        { accountId: acc.FIXED_ASSETS, debit: cost, memo: created.name },
        { accountId: paidFrom, credit: cost, memo: acquisition.reference ?? undefined },
      ];
    } else if (acquisition.kind === "CREDIT") {
      description = `Bought ${created.name} on credit from ${supplier!.name}`;
      lines = [
        { accountId: acc.FIXED_ASSETS, debit: cost, memo: created.name },
        {
          accountId: acc.PAYABLE,
          partyId: supplier!.id,
          credit: cost,
          memo: acquisition.supplierRef ?? created.name,
        },
      ];
    } else {
      description = `Opening balance — ${created.name} (owned before go-live)`;
      lines = [
        { accountId: acc.FIXED_ASSETS, debit: cost, memo: created.name },
        { accountId: acc.ACCUMULATED_DEPRECIATION, credit: accumulated, memo: created.name },
        { accountId: acc.OPENING_EQUITY, credit: cost.minus(accumulated) },
      ];
    }
    await postJournalEntry(tx, {
      companyId,
      date: openingDate ?? purchaseDate,
      description,
      sourceType: "FIXED_ASSET",
      sourceId: created.id,
      postedById: ctx.user.id,
      lines,
    });
    if (supplier) {
      await settleSupplierBills(tx, companyId, supplier.id);
      await recordPartyActivity(supplier.id, purchaseDate, tx);
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "FixedAsset",
        entityId: created.id,
        summary: `Added fixed asset ${created.name}: cost ${cost.toFixed(2)} (${acquisition.kind.toLowerCase()})`,
      },
      tx,
    );
    return created;
  }, TX_OPTIONS);
  return getFixedAsset(ctx, asset.id);
}

export async function updateFixedAsset(
  ctx: CompanyContext,
  assetId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can change fixed assets.");
  const input = updateAssetSchema.parse(raw);
  const asset = await ctx.db.fixedAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new AppError("NOT_FOUND", "Fixed asset not found.");
  const changesValue =
    input.status !== undefined ||
    input.depreciationRate !== undefined ||
    input.depreciationMethod !== undefined ||
    input.salvageValue !== undefined;
  if (asset.status === "DISPOSED" && changesValue) {
    throw new AppError("CONFLICT", `${asset.name} was disposed of; only its details can change.`);
  }
  if (input.salvageValue !== undefined && money(input.salvageValue).gt(asset.purchaseCost)) {
    throw new AppError("VALIDATION", "Salvage value is more than the cost.");
  }
  await ctx.db.fixedAsset.update({
    where: { id: asset.id },
    data: {
      name: input.name,
      category: input.category,
      location: input.location,
      notes: input.notes,
      status: input.status,
      depreciationRate: input.depreciationRate,
      depreciationMethod: input.depreciationMethod,
      salvageValue: input.salvageValue !== undefined ? money(input.salvageValue) : undefined,
    },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "FixedAsset",
    entityId: asset.id,
    summary: `Updated fixed asset ${asset.name}: ${Object.keys(input).join(", ")}`,
  });
  return getFixedAsset(ctx, asset.id);
}

/** Last day of the previous month in company time: the usual month-end run. */
function defaultThrough(ctx: CompanyContext) {
  return addDays(monthStart(localDay(new Date(), ctx.company.timezone)), -1);
}

function assertNotFuture(ctx: CompanyContext, day: string) {
  if (day > localDay(new Date(), ctx.company.timezone)) {
    throw new AppError("VALIDATION", "Depreciation can only run up to today.");
  }
}

/** Posts depreciation for one locked asset up to `through`; returns the charge. */
async function depreciateTx(
  tx: Tx,
  ctx: CompanyContext,
  assetId: string,
  through: string,
): Promise<{ asset: FixedAsset; total: Prisma.Decimal; months: number }> {
  const tz = ctx.company.timezone;
  await lockRow(tx, "FixedAsset", assetId);
  const asset = await tx.fixedAsset.findFirstOrThrow({
    where: { id: assetId, companyId: ctx.company.id },
  });
  const from = nextDepreciationDay(asset, tz);
  if (asset.status === "DISPOSED" || from > through) return { asset, total: ZERO, months: 0 };
  const { charges, total, bookValueAfter } = depreciationCharges(depreciable(asset), from, through);
  if (total.gt(0)) {
    const acc = await ensureControlAccounts(ctx.company.id, tx);
    const span =
      charges.length === 1
        ? charges[0]!.month
        : `${charges[0]!.month} to ${charges[charges.length - 1]!.month}`;
    await postJournalEntry(tx, {
      companyId: ctx.company.id,
      date: startOfDayInZone(through, tz),
      description: `Depreciation ${span} — ${asset.name}`,
      sourceType: "DEPRECIATION",
      sourceId: asset.id,
      postedById: ctx.user.id,
      lines: [
        { accountId: acc.DEPRECIATION, debit: total, memo: asset.name },
        { accountId: acc.ACCUMULATED_DEPRECIATION, credit: total, memo: asset.name },
      ],
    });
  }
  const updated = await tx.fixedAsset.update({
    where: { id: asset.id },
    data: { currentValue: bookValueAfter, depreciatedUntil: dateColumn(through) },
  });
  return { asset: updated, total, months: charges.length };
}

/** What a depreciation run would post, without posting it. */
export async function previewDepreciation(ctx: CompanyContext, raw: unknown = {}) {
  const q = depreciationRunSchema.parse(raw);
  const through = q.through ?? defaultThrough(ctx);
  assertNotFuture(ctx, through);
  const assets = await ctx.db.fixedAsset.findMany({
    where: { status: { not: "DISPOSED" } },
    orderBy: { purchaseDate: "asc" },
  });
  const items = assets.flatMap((asset) => {
    const from = nextDepreciationDay(asset, ctx.company.timezone);
    const { charges, total, bookValueAfter } = depreciationCharges(
      depreciable(asset),
      from,
      through,
    );
    return total.gt(0)
      ? [
          {
            assetId: asset.id,
            name: asset.name,
            from,
            through,
            months: charges.map((c) => ({ ...c, amount: c.amount.toFixed(2) })),
            amount: total.toFixed(2),
            bookValueAfter: bookValueAfter.toFixed(2),
          },
        ]
      : [];
  });
  const total = items.reduce((s, i) => s.plus(i.amount), ZERO);
  return { through, items, total: total.toFixed(2) };
}

/**
 * Posts depreciation for every asset up to `through` (default: the end of last
 * month). Running it again for the same day posts nothing new; missed months
 * are caught up in one entry per asset.
 */
export async function runDepreciation(ctx: CompanyContext, raw: unknown = {}, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can post depreciation.");
  const q = depreciationRunSchema.parse(raw);
  const through = q.through ?? defaultThrough(ctx);
  assertNotFuture(ctx, through);
  const ids = (
    await ctx.db.fixedAsset.findMany({
      where: { status: { not: "DISPOSED" } },
      select: { id: true },
      orderBy: { purchaseDate: "asc" },
    })
  ).map((a) => a.id);

  return prisma.$transaction(async (tx) => {
    const posted: Array<{ assetId: string; name: string; months: number; amount: string }> = [];
    let total = ZERO;
    for (const id of ids) {
      const result = await depreciateTx(tx, ctx, id, through);
      if (result.total.gt(0)) {
        total = total.plus(result.total);
        posted.push({
          assetId: id,
          name: result.asset.name,
          months: result.months,
          amount: result.total.toFixed(2),
        });
      }
    }
    if (posted.length > 0) {
      await auditInCompany(
        ctx,
        meta,
        {
          action: "CREATE",
          entityType: "Depreciation",
          summary: `Posted depreciation through ${through}: ${total.toFixed(2)} on ${posted.length} asset(s)`,
        },
        tx,
      );
    }
    return { through, items: posted, total: total.toFixed(2) };
  }, TX_OPTIONS);
}

/** Sells or scraps an asset: depreciation to the day before, then the disposal entry. */
export async function disposeFixedAsset(
  ctx: CompanyContext,
  assetId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can dispose of fixed assets.");
  const input = disposeAssetSchema.parse(raw);
  const proceeds = money(input.proceeds);
  if (proceeds.gt(0)) assertCanReceiveMoney(ctx);
  const tz = ctx.company.timezone;
  const date = input.date ? toInstant(input.date, tz) : new Date();
  const disposalDay = localDay(date, tz);
  const companyId = ctx.company.id;
  const existing = await ctx.db.fixedAsset.findUnique({ where: { id: assetId } });
  if (!existing) throw new AppError("NOT_FOUND", "Fixed asset not found.");
  if (date < existing.purchaseDate) {
    throw new AppError("VALIDATION", "The disposal date is before the purchase date.");
  }

  await prisma.$transaction(async (tx) => {
    const { asset } = await depreciateTx(tx, ctx, assetId, addDays(disposalDay, -1));
    if (asset.status === "DISPOSED") {
      throw new AppError("CONFLICT", `${asset.name} was already disposed of.`);
    }
    const acc = await ensureControlAccounts(companyId, tx);
    const bookValue = asset.currentValue;
    const accumulated = asset.purchaseCost.minus(bookValue);
    const gain = proceeds.minus(bookValue);
    const receivedInto = proceeds.gt(0)
      ? await cashAccountFor(tx, companyId, input.method, input.accountId)
      : null;
    await postJournalEntry(tx, {
      companyId,
      date,
      description: `${proceeds.gt(0) ? "Sold" : "Scrapped"} ${asset.name}: ${input.reason}`,
      sourceType: "FIXED_ASSET",
      sourceId: asset.id,
      postedById: ctx.user.id,
      lines: [
        ...(receivedInto
          ? [{ accountId: receivedInto, debit: proceeds, memo: input.reference ?? undefined }]
          : []),
        { accountId: acc.ACCUMULATED_DEPRECIATION, debit: accumulated, memo: asset.name },
        { accountId: acc.FIXED_ASSETS, credit: asset.purchaseCost, memo: asset.name },
        gain.gt(0)
          ? { accountId: acc.OTHER_INCOME, credit: gain, memo: `Gain on ${asset.name}` }
          : { accountId: acc.DISPOSAL_LOSS, debit: gain.neg(), memo: asset.name },
      ],
    });
    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: { status: "DISPOSED", disposedAt: date, disposalAmount: proceeds },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "FixedAsset",
        entityId: asset.id,
        summary: `Disposed of ${asset.name}: book value ${bookValue.toFixed(2)}, proceeds ${proceeds.toFixed(2)} (${
          gain.gte(0) ? "gain" : "loss"
        } ${gain.abs().toFixed(2)}): ${input.reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getFixedAsset(ctx, assetId);
}

/**
 * Removes an asset entered by mistake: its purchase and depreciation entries are
 * reversed (both stay in the books) and it leaves the register.
 */
export async function voidFixedAsset(
  ctx: CompanyContext,
  assetId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can remove fixed assets.");
  const { reason } = voidSchema.parse(raw);
  const found = await ctx.db.fixedAsset.findUnique({ where: { id: assetId } });
  if (!found) throw new AppError("NOT_FOUND", "Fixed asset not found.");

  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "FixedAsset", found.id);
    const asset = await tx.fixedAsset.findFirst({
      where: { id: found.id, companyId: ctx.company.id },
    });
    if (!asset) throw new AppError("NOT_FOUND", "Fixed asset not found.");
    if (asset.status === "DISPOSED") {
      throw new AppError("CONFLICT", `${asset.name} was disposed of and stays in the books.`);
    }
    const entries = await tx.journalEntry.findMany({
      where: {
        companyId: ctx.company.id,
        sourceId: asset.id,
        sourceType: { in: ["FIXED_ASSET", "DEPRECIATION"] },
        isReversed: false,
        reversalOfId: null,
      },
      include: { lines: { include: { account: { select: { subType: true } } } } },
      orderBy: { date: "desc" },
    });
    // The reversal moves money the other way: undoing a cash purchase puts the
    // money back into the cash or bank account.
    const cashLines = entries
      .flatMap((e) => e.lines)
      .filter((l) => isCashSubType(l.account.subType));
    if (cashLines.some((l) => l.credit.gt(0))) assertCanReceiveMoney(ctx);
    if (cashLines.some((l) => l.debit.gt(0))) assertCanPayMoney(ctx);
    for (const entry of entries) {
      await reverseJournalEntry(tx, entry.id, {
        description: `Void ${entry.number} (${asset.name}): ${reason}`,
        postedById: ctx.user.id,
      });
    }
    // Bought on credit: the supplier no longer owes for it, so their bills settle again.
    await settleSuppliersOnLines(
      tx,
      ctx.company.id,
      entries.flatMap((e) => e.lines),
    );
    await tx.fixedAsset.delete({ where: { id: asset.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "FixedAsset",
        entityId: asset.id,
        summary: `Removed fixed asset ${asset.name} (cost ${asset.purchaseCost.toFixed(2)}), ${entries.length} entr${
          entries.length === 1 ? "y" : "ies"
        } reversed: ${reason}`,
      },
      tx,
    );
    return { id: asset.id, removed: true, reversedEntries: entries.length };
  }, TX_OPTIONS);
}
