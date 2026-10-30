import { Prisma, type RetailGrade, type RetailStore } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { PIN_CHECKED, requirePin } from "@/modules/ai/settings.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { createParty } from "@/modules/parties/party.service";

import { costMoved, type HandPrice, ruleText, scopeCost, scopeKeyOf, storePriceOf } from "./prices";

/*
 * Business > Retail stores (plan v6 sec 1, 2 and 4). A store is a special
 * wholesale buyer: adding one also adds it to the buyer list, so its account,
 * statement and Buyer 360 are the buyer's. It buys at its own prices: a rule per
 * grade on the cost, and hand prices on a style, a colour or one SKU. Every price
 * change needs the owner's PIN and is kept in the store's price history. Seeing
 * stores needs retail.view (or retail.manage); changing them retail.manage.
 */

export const FIRST_STORE_NAME = "Extas Retail";

export function assertCanSeeStores(ctx: CompanyContext) {
  if (!ctx.can("retail.view") && !ctx.can("retail.manage")) {
    throw new AppError("FORBIDDEN", "You may not see the retail stores.");
  }
}

export function assertCanManageStores(ctx: CompanyContext) {
  if (!ctx.can("retail.manage")) {
    throw new AppError("FORBIDDEN", "You may not change the retail stores.");
  }
}

const id = z.string().trim().min(1).max(40);
const optionalId = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v) => v || null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .transform((v) => v || null);
const pin = z.string().trim().max(20).optional();

export const storeSchema = z.object({
  name: z.string().trim().min(2, "Give the store a name").max(80, "At most 80 characters"),
  kind: z.enum(["ONLINE", "SHOWROOM"]).default("ONLINE"),
  address: optionalText(300),
  phone: optionalText(40),
  warehouseId: optionalId,
  integrationId: optionalId,
});

/** A money box: up to 2 decimals, above 0. */
const price = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "A price like 650 or 649.50")
  .refine((v) => Number(v) > 0, "A price above 0");

const ruleValue = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "A number like 25 or 120.50")
  .optional()
  .transform((v) => v || null);

export const rulesSchema = z
  .object({
    aRule: z
      .enum(["NONE", "PERCENT", "AMOUNT"])
      .default("NONE")
      .transform((v) => (v === "NONE" ? null : v)),
    aValue: ruleValue,
    bRule: z
      .enum(["NONE", "PERCENT", "AMOUNT", "FIXED"])
      .default("NONE")
      .transform((v) => (v === "NONE" ? null : v)),
    bValue: ruleValue,
    pin,
  })
  .superRefine((input, issue) => {
    if (input.aRule && input.aValue === null) {
      issue.addIssue({ code: "custom", path: ["aValue"], message: "Give the A-grade number" });
    }
    if (input.bRule && input.bValue === null) {
      issue.addIssue({ code: "custom", path: ["bValue"], message: "Give the B-grade number" });
    }
    if (input.bRule === "FIXED" && input.bValue !== null && Number(input.bValue) <= 0) {
      issue.addIssue({ code: "custom", path: ["bValue"], message: "A price above 0" });
    }
  });

export const handPriceSchema = z.object({
  storeId: id,
  grade: z.enum(["A", "B"]),
  styleId: id,
  colorId: optionalId,
  variantId: optionalId,
  price,
  pin,
});

export const removeHandPriceSchema = z.object({ priceId: id, pin });

export const previewSchema = z.object({ search: z.string().trim().max(60).optional() });

export async function storeOrThrow(ctx: CompanyContext, storeId: string) {
  const store = await ctx.db.retailStore.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
  return store;
}

async function assertNameFree(ctx: CompanyContext, name: string, storeId?: string) {
  const clash = await ctx.db.retailStore.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(storeId ? { id: { not: storeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    const taken = `There is already a store called ${name}.`;
    throw new AppError("CONFLICT", taken, { name: [taken] });
  }
}

/** The warehouse and online shop a store names must be this company's, the shop not another store's. */
async function assertLinks(
  ctx: CompanyContext,
  input: { warehouseId: string | null; integrationId: string | null },
  storeId?: string,
) {
  if (input.warehouseId) {
    const warehouse = await ctx.db.warehouse.findFirst({
      where: { id: input.warehouseId, deletedAt: null },
      select: { id: true },
    });
    if (!warehouse) {
      throw new AppError("VALIDATION", "Pick a warehouse from the list.", {
        warehouseId: ["Pick a warehouse from the list"],
      });
    }
  }
  if (input.integrationId) {
    const shop = await ctx.db.salesChannelIntegration.findFirst({
      where: { id: input.integrationId },
      select: { id: true, retailStore: { select: { id: true, name: true } } },
    });
    if (!shop) {
      throw new AppError("VALIDATION", "Pick an online shop from the list.", {
        integrationId: ["Pick an online shop from the list"],
      });
    }
    if (shop.retailStore && shop.retailStore.id !== storeId) {
      const used = `This online shop already belongs to ${shop.retailStore.name}.`;
      throw new AppError("CONFLICT", used, { integrationId: [used] });
    }
  }
}

async function logChange(
  ctx: CompanyContext,
  storeId: string,
  what: string,
  before: string | null,
  after: string | null,
) {
  await ctx.db.retailPriceChange.create({
    data: {
      companyId: ctx.company.id,
      storeId,
      what,
      before,
      after,
      changedById: ctx.user.id,
    },
  });
}

/** Adds a store, and the store as a buyer in the buyer list. */
export async function createStore(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageStores(ctx);
  const input = storeSchema.parse(raw);
  await assertNameFree(ctx, input.name);
  await assertLinks(ctx, input);
  const { party } = await createParty(
    ctx,
    {
      kind: "BUYER",
      buyerType: "RETAIL",
      name: input.name,
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.address ? { address: input.address } : {}),
    },
    meta,
  );
  const store = await ctx.db.retailStore.create({
    data: {
      companyId: ctx.company.id,
      name: input.name,
      kind: input.kind,
      address: input.address,
      phone: input.phone,
      warehouseId: input.warehouseId,
      integrationId: input.integrationId,
      partyId: party.id,
      createdById: ctx.user.id,
    },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "RetailStore",
    entityId: store.id,
    summary: `Added the retail store "${store.name}" (buyer ${party.code})`,
  });
  return store;
}

/** Changes a store's details; its buyer keeps the same name, phone and address. */
export async function updateStore(
  ctx: CompanyContext,
  storeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageStores(ctx);
  const store = await storeOrThrow(ctx, storeId);
  const input = storeSchema.parse(raw);
  await assertNameFree(ctx, input.name, store.id);
  await assertLinks(ctx, input, store.id);
  await ctx.db.retailStore.update({
    where: { id: store.id },
    data: {
      name: input.name,
      kind: input.kind,
      address: input.address,
      phone: input.phone,
      warehouseId: input.warehouseId,
      integrationId: input.integrationId,
    },
  });
  await ctx.db.party.update({
    where: { id: store.partyId },
    data: { name: input.name, phone: input.phone, address: input.address },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: store.id,
    summary: `Changed the retail store "${input.name}"`,
  });
}

/** Closes a store (its history stays) or opens it again. */
export async function setStoreClosed(
  ctx: CompanyContext,
  storeId: string,
  closed: boolean,
  meta?: RequestMeta,
) {
  assertCanManageStores(ctx);
  const store = await storeOrThrow(ctx, storeId);
  await ctx.db.retailStore.update({
    where: { id: store.id },
    data: { closedAt: closed ? new Date() : null },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: store.id,
    summary: `${closed ? "Closed" : "Opened again"} the retail store "${store.name}"`,
  });
}

/** The store's price rules (A-grade and B-grade), with the PIN. */
export async function setPriceRules(
  ctx: CompanyContext,
  storeId: string,
  raw: unknown,
  meta?: RequestMeta,
  proof?: typeof PIN_CHECKED,
) {
  assertCanManageStores(ctx);
  const store = await storeOrThrow(ctx, storeId);
  const input = rulesSchema.parse(raw);
  await requirePin(ctx, proof ?? input.pin, "change a store's prices");
  const currency = ctx.company.currency;
  const before = {
    a: ruleText({ rule: store.aRule, value: store.aValue }, currency),
    b: ruleText({ rule: store.bRule, value: store.bValue }, currency),
  };
  const after = {
    a: ruleText({ rule: input.aRule, value: input.aValue }, currency),
    b: ruleText({ rule: input.bRule, value: input.bValue }, currency),
  };
  await ctx.db.retailStore.update({
    where: { id: store.id },
    data: {
      aRule: input.aRule,
      aValue: input.aRule ? input.aValue : null,
      bRule: input.bRule,
      bValue: input.bRule ? input.bValue : null,
    },
  });
  if (before.a !== after.a) await logChange(ctx, store.id, "A-grade rule", before.a, after.a);
  if (before.b !== after.b) await logChange(ctx, store.id, "B-grade rule", before.b, after.b);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: store.id,
    summary: `Changed the price rules of "${store.name}": A-grade ${after.a}, B-grade ${after.b}`,
  });
}

/** What a hand price covers, in words: "LP-02 Polo", "LP-02 Polo, Black" or "LP-02-BLK-L". */
async function placeOf(
  ctx: CompanyContext,
  input: { styleId: string; colorId: string | null; variantId: string | null },
) {
  const style = await ctx.db.style.findUnique({
    where: { id: input.styleId },
    select: { id: true, code: true, name: true },
  });
  if (!style) {
    throw new AppError("VALIDATION", "Pick a style from the list.", {
      styleId: ["Pick a style from the list"],
    });
  }
  const variants = await ctx.db.productVariant.findMany({
    where: {
      styleId: style.id,
      removedAt: null,
      ...(input.variantId
        ? { id: input.variantId }
        : input.colorId
          ? { colorId: input.colorId }
          : {}),
    },
    select: {
      id: true,
      sku: true,
      avgCost: true,
      bGradeAvgCost: true,
      color: { select: { name: true } },
    },
  });
  if (variants.length === 0) {
    const field = input.variantId ? "variantId" : input.colorId ? "colorId" : "styleId";
    const message = input.variantId
      ? "Pick a size of this style"
      : input.colorId
        ? "Pick a colour of this style"
        : "This style has no colours and sizes yet";
    throw new AppError("VALIDATION", `${message}.`, { [field]: [message] });
  }
  const text = input.variantId
    ? `${style.code} ${variants[0]!.sku}`
    : input.colorId
      ? `${style.code} ${style.name}, ${variants[0]!.color.name}`
      : `${style.code} ${style.name}`;
  return { style, variants, text };
}

/** Sets a hand price (it replaces the one at the same place), with the PIN. */
export async function setHandPrice(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  proof?: typeof PIN_CHECKED,
) {
  assertCanManageStores(ctx);
  const input = handPriceSchema.parse(raw);
  const store = await storeOrThrow(ctx, input.storeId);
  const place = await placeOf(ctx, input);
  await requirePin(ctx, proof ?? input.pin, "change a store's prices");
  const scopeKey = scopeKeyOf(input);
  const cost = scopeCost(
    place.variants.map((v) => (input.grade === "A" ? v.avgCost : v.bGradeAvgCost)),
  );
  const currency = ctx.company.currency;
  const live = await ctx.db.retailPrice.findFirst({
    where: { storeId: store.id, grade: input.grade, scopeKey, removedAt: null },
  });
  if (live) {
    await ctx.db.retailPrice.update({ where: { id: live.id }, data: { removedAt: new Date() } });
  }
  const created = await ctx.db.retailPrice.create({
    data: {
      companyId: ctx.company.id,
      storeId: store.id,
      grade: input.grade,
      styleId: place.style.id,
      colorId: input.variantId ? null : input.colorId,
      variantId: input.variantId,
      scopeKey,
      price: input.price,
      costWhenSet: cost,
      setById: ctx.user.id,
    },
  });
  const what = `${input.grade}-grade hand price: ${place.text}`;
  await logChange(
    ctx,
    store.id,
    what,
    live ? `${currency} ${new Prisma.Decimal(live.price).toFixed(2)}` : null,
    `${currency} ${new Prisma.Decimal(created.price).toFixed(2)}`,
  );
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: store.id,
    summary: `${store.name}: ${what} = ${currency} ${new Prisma.Decimal(created.price).toFixed(2)}`,
  });
  return created;
}

/** Takes a hand price off (the rule prices it again), with the PIN. */
export async function removeHandPrice(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageStores(ctx);
  const input = removeHandPriceSchema.parse(raw);
  const row = await ctx.db.retailPrice.findFirst({
    where: { id: input.priceId, removedAt: null },
    include: { store: { select: { id: true, name: true } } },
  });
  if (!row) throw new AppError("NOT_FOUND", "This hand price is already off.");
  await requirePin(ctx, input.pin, "change a store's prices");
  const place = await placeOf(ctx, row);
  await ctx.db.retailPrice.update({ where: { id: row.id }, data: { removedAt: new Date() } });
  const currency = ctx.company.currency;
  const what = `${row.grade}-grade hand price: ${place.text}`;
  await logChange(
    ctx,
    row.store.id,
    what,
    `${currency} ${new Prisma.Decimal(row.price).toFixed(2)}`,
    "Off (the rule prices it)",
  );
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailStore",
    entityId: row.store.id,
    summary: `${row.store.name}: took off the ${what}`,
  });
}

// =============================================================================
// Screens
// =============================================================================

const money2 = (value: Prisma.Decimal.Value | null) =>
  value === null ? null : new Prisma.Decimal(value).toFixed(2);

/** The hand prices of stores whose cost moved since they were set. */
/** The ERP's cost and its books on a store: for those who run the stores or see the financials. */
export const canSeeStoreCosts = (ctx: CompanyContext) =>
  ctx.can("retail.manage") || canSeeFinancials(ctx);

async function handPricesWithCosts(ctx: CompanyContext, storeIds: string[]) {
  const costs = canSeeStoreCosts(ctx);
  const rows = await ctx.db.retailPrice.findMany({
    where: { storeId: { in: storeIds }, removedAt: null },
    include: {
      style: { select: { code: true, name: true } },
      variant: { select: { sku: true } },
    },
    orderBy: [{ setAt: "desc" }],
  });
  const styleIds = [...new Set(rows.map((r) => r.styleId))];
  const variants = await ctx.db.productVariant.findMany({
    where: { styleId: { in: styleIds }, removedAt: null },
    select: {
      id: true,
      styleId: true,
      colorId: true,
      avgCost: true,
      bGradeAvgCost: true,
      color: { select: { id: true, name: true } },
    },
  });
  return rows.map((row) => {
    const covered = variants.filter((v) =>
      row.variantId
        ? v.id === row.variantId
        : row.colorId
          ? v.styleId === row.styleId && v.colorId === row.colorId
          : v.styleId === row.styleId,
    );
    const costNow = scopeCost(
      covered.map((v) => (row.grade === "A" ? v.avgCost : v.bGradeAvgCost)),
    );
    const colorName = row.colorId
      ? (variants.find((v) => v.colorId === row.colorId)?.color.name ?? null)
      : null;
    return {
      id: row.id,
      storeId: row.storeId,
      grade: row.grade,
      styleCode: row.style.code,
      styleName: row.style.name,
      color: colorName,
      sku: row.variant?.sku ?? null,
      price: money2(row.price)!,
      costWhenSet: costs ? money2(row.costWhenSet)! : null,
      costNow: costs ? money2(costNow)! : null,
      costChanged: costs && costMoved(row.costWhenSet, costNow),
      setAt: row.setAt,
    };
  });
}

/** Business > Retail stores: every store, its buyer, warehouse, shop and prices to look at. */
export async function listStores(ctx: CompanyContext) {
  assertCanSeeStores(ctx);
  const stores = await ctx.db.retailStore.findMany({
    include: {
      party: { select: { id: true, code: true } },
      warehouse: { select: { id: true, name: true } },
      integration: { select: { id: true, name: true, apiKeyRef: true, apiKeyRevokedAt: true } },
    },
    orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  });
  const hand = await handPricesWithCosts(
    ctx,
    stores.map((s) => s.id),
  );
  const currency = ctx.company.currency;
  return {
    canManage: ctx.can("retail.manage"),
    currency,
    firstStoreName: FIRST_STORE_NAME,
    ...(await pickers(ctx)),
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      closedAt: s.closedAt,
      buyer: s.party,
      warehouse: s.warehouse,
      onlineShop: s.integration
        ? {
            id: s.integration.id,
            name: s.integration.name,
            hasKey: Boolean(s.integration.apiKeyRef && !s.integration.apiKeyRevokedAt),
          }
        : null,
      aRule: ruleText({ rule: s.aRule, value: s.aValue }, currency),
      bRule: ruleText({ rule: s.bRule, value: s.bValue }, currency),
      handPrices: hand.filter((h) => h.storeId === s.id).length,
      costChanged: hand.filter((h) => h.storeId === s.id && h.costChanged).length,
    })),
  };
}

/** The warehouses and online shops a store may name, and the styles a hand price may sit on. */
async function pickers(ctx: CompanyContext) {
  const [warehouses, onlineShops] = await Promise.all([
    ctx.db.warehouse.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: { name: "asc" },
    }),
    ctx.db.salesChannelIntegration.findMany({
      select: { id: true, name: true, retailStore: { select: { id: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    warehouses,
    onlineShops: onlineShops.map((s) => ({
      id: s.id,
      name: s.name,
      storeId: s.retailStore?.id ?? null,
    })),
  };
}

/** One store's page: details, rules, hand prices, the prices it sees, and the history. */
export async function getStore(ctx: CompanyContext, storeId: string, raw: unknown = {}) {
  assertCanSeeStores(ctx);
  const q = previewSchema.parse(raw);
  const store = await ctx.db.retailStore.findUnique({
    where: { id: storeId },
    include: {
      party: { select: { id: true, code: true } },
      warehouse: { select: { id: true, name: true } },
      integration: { select: { id: true, name: true, apiKeyRef: true, apiKeyRevokedAt: true } },
    },
  });
  if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
  const currency = ctx.company.currency;
  const [hand, history, styles, picks] = await Promise.all([
    handPricesWithCosts(ctx, [store.id]),
    ctx.db.retailPriceChange.findMany({
      where: { storeId: store.id },
      orderBy: { changedAt: "desc" },
      take: 50,
    }),
    ctx.db.style.findMany({
      where: {
        isActive: true,
        variants: { some: { removedAt: null } },
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: "insensitive" } },
                { name: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        variants: {
          where: { removedAt: null },
          select: {
            id: true,
            sku: true,
            styleId: true,
            colorId: true,
            avgCost: true,
            bGradeAvgCost: true,
            color: { select: { id: true, name: true } },
            size: { select: { name: true, sortOrder: true } },
          },
          orderBy: [{ color: { sortOrder: "asc" } }, { size: { sortOrder: "asc" } }],
        },
      },
      orderBy: { code: "asc" },
      take: 40,
    }),
    pickers(ctx),
  ]);
  const names = await ctx.db.user.findMany({
    where: {
      id: { in: [...new Set(history.map((h) => h.changedById).filter(Boolean))] as string[] },
    },
    select: { id: true, name: true },
  });
  const live = await ctx.db.retailPrice.findMany({
    where: { storeId: store.id, removedAt: null, styleId: { in: styles.map((s) => s.id) } },
    select: { grade: true, styleId: true, colorId: true, variantId: true, price: true },
  });
  const rules = {
    a: { rule: store.aRule, value: store.aValue },
    b: { rule: store.bRule, value: store.bValue },
  };
  const range = (values: (Prisma.Decimal | null)[]) => {
    const known = values.filter((v): v is Prisma.Decimal => v !== null);
    if (known.length === 0) return null;
    const low = Prisma.Decimal.min(...known);
    const high = Prisma.Decimal.max(...known);
    return { low: low.toFixed(2), high: high.toFixed(2) };
  };
  return {
    canManage: ctx.can("retail.manage"),
    currency,
    store: {
      id: store.id,
      name: store.name,
      kind: store.kind,
      address: store.address,
      phone: store.phone,
      /** The logo on its pad: its file id (a new one when it changes), or null. */
      logoId: store.logoFileId,
      closedAt: store.closedAt,
      warehouseId: store.warehouseId,
      warehouse: store.warehouse,
      integrationId: store.integrationId,
      onlineShop: store.integration
        ? {
            id: store.integration.id,
            name: store.integration.name,
            hasKey: Boolean(store.integration.apiKeyRef && !store.integration.apiKeyRevokedAt),
          }
        : null,
      buyer: store.party,
      aRule: store.aRule,
      aValue:
        store.aValue === null
          ? null
          : new Prisma.Decimal(store.aValue).toDecimalPlaces(2).toString(),
      bRule: store.bRule,
      bValue:
        store.bValue === null
          ? null
          : new Prisma.Decimal(store.bValue).toDecimalPlaces(2).toString(),
      aRuleText: ruleText(rules.a, currency),
      bRuleText: ruleText(rules.b, currency),
    },
    handPrices: hand,
    history: history.map((h) => ({
      id: h.id,
      what: h.what,
      before: h.before,
      after: h.after,
      by: names.find((n) => n.id === h.changedById)?.name ?? null,
      at: h.changedAt,
    })),
    search: q.search ?? "",
    styles: styles.map((style) => {
      const a = style.variants.map((v) => storePriceOf(rules, live as HandPrice[], v, "A").price);
      const b = style.variants.map((v) => storePriceOf(rules, live as HandPrice[], v, "B").price);
      return {
        id: style.id,
        code: style.code,
        name: style.name,
        skus: style.variants.length,
        a: range(a),
        b: range(b),
        aMissing: a.filter((p) => p === null).length,
        colors: [...new Map(style.variants.map((v) => [v.color.id, v.color.name])).entries()].map(
          ([colorId, name]) => ({ id: colorId, name }),
        ),
        variants: style.variants.map((v) => ({ id: v.id, sku: v.sku, colorId: v.colorId })),
      };
    }),
    ...picks,
  };
}

export type StoreList = Awaited<ReturnType<typeof listStores>>;
export type StorePage = Awaited<ReturnType<typeof getStore>>;

/** A store's prices for SKUs, per grade (for the shop's catalog and its orders). */
export async function storePrices(
  ctx: CompanyContext,
  storeId: string,
  variantIds: string[],
  grade: RetailGrade,
) {
  const store = await storeOrThrow(ctx, storeId);
  return pricesOfStore(store, variantIds, grade);
}

/**
 * The same prices without a signed-in user (the webhooks to the store's own
 * site): read straight from the store's company, never another's.
 */
export async function pricesOfStore(
  store: Pick<RetailStore, "id" | "companyId" | "aRule" | "aValue" | "bRule" | "bValue">,
  variantIds: string[],
  grade: RetailGrade,
) {
  const variants = await prisma.productVariant.findMany({
    where: { companyId: store.companyId, id: { in: variantIds } },
    select: { id: true, styleId: true, colorId: true, avgCost: true, bGradeAvgCost: true },
  });
  const live = await prisma.retailPrice.findMany({
    where: {
      companyId: store.companyId,
      storeId: store.id,
      removedAt: null,
      styleId: { in: [...new Set(variants.map((v) => v.styleId))] },
    },
    select: { grade: true, styleId: true, colorId: true, variantId: true, price: true },
  });
  const rules = {
    a: { rule: store.aRule, value: store.aValue },
    b: { rule: store.bRule, value: store.bValue },
  };
  return new Map(variants.map((v) => [v.id, storePriceOf(rules, live, v, grade).price]));
}
