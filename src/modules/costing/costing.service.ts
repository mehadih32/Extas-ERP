import { Prisma } from "@prisma/client";
import { z } from "zod";

import { addDays, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { TRADE_PAYMENTS } from "@/modules/costing/costing-labels";
import { type CostLineInput, costSheet, type PercentLines } from "@/modules/costing/costing-math";
import {
  CHECK_RULES,
  type CheckRow,
  daysBetween,
  judgeFactory,
  judgePayment,
  judgePrice,
  judgeRisks,
  judgeTime,
} from "@/modules/costing/order-check";

/*
 * Order costing (v6.2 rules): a costing sheet per order before it is taken,
 * its styles costed per dozen, supplier fabric quotes per kg (per yard for
 * wovens) beside past booking prices, the CM fixed per style with the factory,
 * the owner's profit % for this order (no default, no minimum), no office
 * overhead, the buyer's way of paying (TT, bank transfer or LC), the Order
 * check card, and the owner's decision. Who may:
 *   costing.view     see sheets, costs, profit, quotes and the card
 *   costing.manage   make and change sheets, add quotes
 *   costing.decide   take or decline the order (the owner's; locked for AI)
 */

function assertView(ctx: CompanyContext) {
  if (!ctx.can("costing.view")) {
    throw new AppError("FORBIDDEN", "Costing sheets are open only to the people given them.");
  }
}

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("costing.manage")) {
    throw new AppError("FORBIDDEN", "Making and changing costing sheets is not part of your role.");
  }
}

const num = (d: Prisma.Decimal | null | undefined) =>
  d === null || d === undefined ? null : Number(d);

// ---------------------------------------------------------------- input

const blank = z.literal("").transform(() => null);
const optionalId = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => v || null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .nullable()
    .transform((v) => v || null);
const optionalAmount = (max: number) =>
  z
    .union([
      blank,
      z.null(),
      z.coerce.number().min(0, "Give 0 or more.").max(max, "That is too big."),
    ])
    .optional()
    .transform((v) => v ?? null);
const amount = (max: number) =>
  z
    .union([
      blank.transform(() => 0),
      z.coerce.number().min(0, "Give 0 or more.").max(max, "That is too big."),
    ])
    .optional()
    .transform((v) => v ?? 0);
const percent = z
  .union([
    blank.transform(() => 0),
    z.coerce.number().min(0, "Give 0 or more.").max(50, "At most 50%."),
  ])
  .optional()
  .transform((v) => v ?? 0);
const optionalDays = z
  .union([blank, z.null(), z.coerce.number().int("Give whole days.").min(1).max(365)])
  .optional()
  .transform((v) => v ?? null);
const optionalDay = z
  .union([blank, z.null(), z.iso.date({ message: "Pick a day." })])
  .optional()
  .transform((v) => v ?? null);

export const costingSchema = z.object({
  title: z.string().trim().min(2, "Name the order.").max(160),
  buyerId: optionalId,
  factoryId: optionalId,
  salesOrderId: optionalId,
  batchId: optionalId,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Pick the currency."),
  exchangeRate: optionalAmount(100_000),
  /** The owner's profit % for this order: no default and no minimum. */
  profitPercent: z
    .union([blank, z.null(), z.coerce.number().min(-50, "At least −50%.").max(80, "At most 80%.")])
    .optional()
    .transform((v) => v ?? null),
  sourceTaxPercent: percent,
  bankChargePercent: percent,
  commissionPercent: percent,
  /** Left out: the buyer's own way of paying is used. */
  tradePayment: z.union([blank, z.null(), z.enum(TRADE_PAYMENTS)]).optional(),
  shipDate: optionalDay,
  fabricDays: optionalDays,
  makingDays: optionalDays,
  risks: z
    .array(z.string().trim().min(1).max(80))
    .max(12)
    .optional()
    .transform((v) => [...new Set(v ?? [])]),
  notes: optionalText(2000),
});

export const styleSchema = z.object({
  styleId: optionalId,
  styleRef: z.string().trim().min(1, "Give the style or the buyer's reference.").max(80),
  description: optionalText(300),
  quantity: z.coerce.number().int("Give whole pieces.").min(1, "Give the pieces.").max(10_000_000),
  fabricQuoteId: optionalId,
  fabricName: optionalText(200),
  fabricUnit: z.enum(["KG", "YARD"]).default("KG"),
  consumption: optionalAmount(1000),
  fabricPrice: optionalAmount(1_000_000),
  trimsPerDozen: amount(1_000_000),
  valueAddPerDozen: amount(1_000_000),
  otherPerDozen: amount(1_000_000),
  cmAmount: optionalAmount(1_000_000),
  cmPer: z.enum(["PIECE", "DOZEN"]).default("PIECE"),
  buyerPrice: optionalAmount(1_000_000),
});

export const quoteSchema = z.object({
  supplierId: z.string().trim().min(1, "Pick the supplier."),
  materialId: optionalId,
  fabric: z.string().trim().min(2, "Describe the fabric as quoted.").max(200),
  unit: z.enum(["KG", "YARD"]).default("KG"),
  price: z.coerce.number().positive("Give the quoted price.").max(1_000_000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Pick the currency."),
  quotedOn: z.iso.date({ message: "Give the day of the quote." }),
  validUntil: optionalDay,
  note: optionalText(300),
});

export const decideSchema = z.object({
  decision: z.enum(["TAKE", "DECLINE"]),
  note: optionalText(500),
});

// ---------------------------------------------------------------- checks on linked records

async function checkLinks(
  ctx: CompanyContext,
  input: {
    buyerId: string | null;
    factoryId: string | null;
    salesOrderId: string | null;
    batchId: string | null;
  },
) {
  const [buyer, factory, order, batch] = await Promise.all([
    input.buyerId
      ? ctx.db.party.findFirst({
          where: { id: input.buyerId, kind: { in: ["BUYER", "BOTH"] } },
          select: { id: true, tradePayment: true },
        })
      : null,
    input.factoryId
      ? ctx.db.party.findFirst({
          where: { id: input.factoryId, kind: { in: ["SUPPLIER", "BOTH"] } },
          select: { id: true },
        })
      : null,
    input.salesOrderId
      ? ctx.db.salesOrder.findFirst({ where: { id: input.salesOrderId }, select: { id: true } })
      : null,
    input.batchId
      ? ctx.db.productionBatch.findFirst({ where: { id: input.batchId }, select: { id: true } })
      : null,
  ]);
  const errors: Record<string, string[]> = {};
  if (input.buyerId && !buyer) errors.buyerId = ["Pick one of your buyers."];
  if (input.factoryId && !factory) errors.factoryId = ["Pick one of your factories."];
  if (input.salesOrderId && !order) errors.salesOrderId = ["That order is not in this company."];
  if (input.batchId && !batch) errors.batchId = ["That batch is not in this company."];
  if (Object.keys(errors).length > 0) {
    throw new AppError("VALIDATION", Object.values(errors)[0]![0]!, errors);
  }
  return { buyer };
}

async function loadCosting(ctx: CompanyContext, costingId: string) {
  const costing = await ctx.db.orderCosting.findFirst({ where: { id: costingId } });
  if (!costing) throw new AppError("NOT_FOUND", "That costing sheet was not found.");
  return costing;
}

const dayOf = (day: string | null) => (day ? new Date(`${day}T00:00:00.000Z`) : null);

// ---------------------------------------------------------------- the sheet

export async function createCosting(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const input = costingSchema.parse(raw);
  const { buyer } = await checkLinks(ctx, input);
  if (input.currency !== ctx.company.currency && input.exchangeRate === null) {
    throw new AppError(
      "VALIDATION",
      `Give the ${ctx.company.currency} rate for ${input.currency}.`,
      {
        exchangeRate: [`Give how many ${ctx.company.currency} one ${input.currency} is.`],
      },
    );
  }
  const costing = await runTransaction(async (tx) => {
    const number = await nextDocumentNumber(tx, ctx.company.id, "ORDER_COSTING");
    const saved = await tx.orderCosting.create({
      data: {
        companyId: ctx.company.id,
        number,
        title: input.title,
        buyerId: input.buyerId,
        factoryId: input.factoryId,
        salesOrderId: input.salesOrderId,
        batchId: input.batchId,
        currency: input.currency,
        exchangeRate: input.currency === ctx.company.currency ? null : input.exchangeRate,
        profitPercent: input.profitPercent,
        sourceTaxPercent: input.sourceTaxPercent,
        bankChargePercent: input.bankChargePercent,
        commissionPercent: input.commissionPercent,
        // The buyer's own way of paying, unless this order says otherwise.
        tradePayment:
          input.tradePayment === undefined ? (buyer?.tradePayment ?? null) : input.tradePayment,
        shipDate: dayOf(input.shipDate),
        fabricDays: input.fabricDays,
        makingDays: input.makingDays,
        risks: input.risks,
        notes: input.notes,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "OrderCosting",
        entityId: saved.id,
        summary: `Made the costing sheet ${saved.number} (${input.title})`,
      },
      tx,
    );
    return saved;
  });
  return costing;
}

export async function updateCosting(
  ctx: CompanyContext,
  costingId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const costing = await loadCosting(ctx, costingId);
  const input = costingSchema.parse(raw);
  await checkLinks(ctx, input);
  if (input.currency !== ctx.company.currency && input.exchangeRate === null) {
    throw new AppError(
      "VALIDATION",
      `Give the ${ctx.company.currency} rate for ${input.currency}.`,
      {
        exchangeRate: [`Give how many ${ctx.company.currency} one ${input.currency} is.`],
      },
    );
  }
  await ctx.db.orderCosting.update({
    where: { id: costing.id },
    data: {
      title: input.title,
      buyerId: input.buyerId,
      factoryId: input.factoryId,
      salesOrderId: input.salesOrderId,
      batchId: input.batchId,
      currency: input.currency,
      exchangeRate: input.currency === ctx.company.currency ? null : input.exchangeRate,
      profitPercent: input.profitPercent,
      sourceTaxPercent: input.sourceTaxPercent,
      bankChargePercent: input.bankChargePercent,
      commissionPercent: input.commissionPercent,
      ...(input.tradePayment === undefined ? {} : { tradePayment: input.tradePayment }),
      shipDate: dayOf(input.shipDate),
      fabricDays: input.fabricDays,
      makingDays: input.makingDays,
      risks: input.risks,
      notes: input.notes,
    },
  });
  const profitChange =
    num(costing.profitPercent) !== input.profitPercent
      ? `; profit ${input.profitPercent === null ? "not set" : `${input.profitPercent}%`}`
      : "";
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "OrderCosting",
    entityId: costing.id,
    summary: `Changed the costing sheet ${costing.number}${profitChange}`,
  });
  return { id: costing.id };
}

async function checkStyleLinks(ctx: CompanyContext, input: z.infer<typeof styleSchema>) {
  const [style, quote] = await Promise.all([
    input.styleId
      ? ctx.db.style.findFirst({ where: { id: input.styleId }, select: { id: true } })
      : null,
    input.fabricQuoteId
      ? ctx.db.fabricQuote.findFirst({ where: { id: input.fabricQuoteId }, select: { id: true } })
      : null,
  ]);
  if (input.styleId && !style) {
    throw new AppError("VALIDATION", "Pick one of your styles.", {
      styleId: ["Pick one of your styles."],
    });
  }
  if (input.fabricQuoteId && !quote) {
    throw new AppError("VALIDATION", "That quote is not in this company.", {
      fabricQuoteId: ["Pick one of the quotes shown."],
    });
  }
}

const styleData = (input: z.infer<typeof styleSchema>) => ({
  styleId: input.styleId,
  styleRef: input.styleRef,
  description: input.description,
  quantity: input.quantity,
  fabricQuoteId: input.fabricQuoteId,
  fabricName: input.fabricName,
  fabricUnit: input.fabricUnit,
  consumption: input.consumption,
  fabricPrice: input.fabricPrice,
  trimsPerDozen: input.trimsPerDozen,
  valueAddPerDozen: input.valueAddPerDozen,
  otherPerDozen: input.otherPerDozen,
  cmAmount: input.cmAmount,
  cmPer: input.cmPer,
  buyerPrice: input.buyerPrice,
});

/** A style on the sheet, new (styleLineId null) or changed. */
export async function saveCostingStyle(
  ctx: CompanyContext,
  costingId: string,
  styleLineId: string | null,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const costing = await loadCosting(ctx, costingId);
  const input = styleSchema.parse(raw);
  await checkStyleLinks(ctx, input);
  let id: string;
  if (styleLineId) {
    const line = await ctx.db.orderCostingStyle.findFirst({
      where: { id: styleLineId, costingId: costing.id },
      select: { id: true },
    });
    if (!line) throw new AppError("NOT_FOUND", "That style is not on this costing sheet.");
    await ctx.db.orderCostingStyle.update({ where: { id: line.id }, data: styleData(input) });
    id = line.id;
  } else {
    const count = await ctx.db.orderCostingStyle.count({ where: { costingId: costing.id } });
    if (count >= 40) throw new AppError("CONFLICT", "A costing sheet holds at most 40 styles.");
    id = (
      await ctx.db.orderCostingStyle.create({
        data: {
          companyId: ctx.company.id,
          costingId: costing.id,
          sortOrder: count,
          ...styleData(input),
        },
        select: { id: true },
      })
    ).id;
  }
  await auditInCompany(ctx, meta, {
    action: styleLineId ? "UPDATE" : "CREATE",
    entityType: "OrderCosting",
    entityId: costing.id,
    summary: `${costing.number}: ${styleLineId ? "changed" : "added"} ${input.styleRef} (${input.quantity} pieces${input.cmAmount !== null ? `, CM ${input.cmAmount} per ${input.cmPer === "PIECE" ? "piece" : "dozen"}` : ""})`,
  });
  return { id };
}

export async function removeCostingStyle(
  ctx: CompanyContext,
  costingId: string,
  styleLineId: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const costing = await loadCosting(ctx, costingId);
  const line = await ctx.db.orderCostingStyle.findFirst({
    where: { id: styleLineId, costingId: costing.id },
    select: { id: true, styleRef: true },
  });
  if (!line) throw new AppError("NOT_FOUND", "That style is not on this costing sheet.");
  await ctx.db.orderCostingStyle.delete({ where: { id: line.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "OrderCosting",
    entityId: costing.id,
    summary: `${costing.number}: took ${line.styleRef} off the sheet`,
  });
  return { id: line.id };
}

/** The owner's word after the Order check card: never made by the system or the AI. */
export async function decideCosting(
  ctx: CompanyContext,
  costingId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!ctx.can("costing.decide")) {
    throw new AppError("FORBIDDEN", "Taking or declining an order is the owner's decision.");
  }
  const costing = await loadCosting(ctx, costingId);
  const input = decideSchema.parse(raw);
  await ctx.db.orderCosting.update({
    where: { id: costing.id },
    data: {
      decision: input.decision,
      decisionNote: input.note,
      decidedById: ctx.user.id,
      decidedAt: new Date(),
    },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "OrderCosting",
    entityId: costing.id,
    summary: `${costing.number}: ${input.decision === "TAKE" ? "took the order" : "declined the order"}${input.note ? ` (${input.note.slice(0, 120)})` : ""}`,
  });
  return { id: costing.id };
}

// ---------------------------------------------------------------- fabric quotes and past prices

export async function addFabricQuote(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const input = quoteSchema.parse(raw);
  const [supplier, material] = await Promise.all([
    ctx.db.party.findFirst({
      where: { id: input.supplierId, kind: { in: ["SUPPLIER", "BOTH"] } },
      select: { id: true, name: true },
    }),
    input.materialId
      ? ctx.db.rawMaterial.findFirst({ where: { id: input.materialId }, select: { id: true } })
      : null,
  ]);
  if (!supplier) {
    throw new AppError("VALIDATION", "Pick one of your suppliers.", {
      supplierId: ["Pick one of your suppliers."],
    });
  }
  if (input.materialId && !material) {
    throw new AppError("VALIDATION", "Pick one of your materials.", {
      materialId: ["Pick one of your materials."],
    });
  }
  if (input.validUntil && input.validUntil < input.quotedOn) {
    throw new AppError("VALIDATION", "The quote cannot end before it was given.", {
      validUntil: ["Pick a day on or after the quote."],
    });
  }
  const quote = await ctx.db.fabricQuote.create({
    data: {
      companyId: ctx.company.id,
      supplierId: supplier.id,
      materialId: input.materialId,
      fabric: input.fabric,
      unit: input.unit,
      price: input.price,
      currency: input.currency,
      quotedOn: dayOf(input.quotedOn)!,
      validUntil: dayOf(input.validUntil),
      note: input.note,
      createdById: ctx.user.id,
    },
    select: { id: true },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "FabricQuote",
    entityId: quote.id,
    summary: `${supplier.name} quoted ${input.fabric} at ${input.currency} ${input.price} per ${input.unit === "KG" ? "kg" : "yard"}`,
  });
  return { id: quote.id };
}

export async function removeFabricQuote(ctx: CompanyContext, quoteId: string, meta?: RequestMeta) {
  assertManage(ctx);
  const quote = await ctx.db.fabricQuote.findFirst({
    where: { id: quoteId },
    select: { id: true, fabric: true, supplier: { select: { name: true } } },
  });
  if (!quote) throw new AppError("NOT_FOUND", "That quote was not found.");
  await ctx.db.fabricQuote.delete({ where: { id: quote.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "FabricQuote",
    entityId: quote.id,
    summary: `Took off ${quote.supplier.name}'s quote for ${quote.fabric}`,
  });
  return { id: quote.id };
}

export const fabricPriceSchema = z.object({
  materialId: optionalId,
  search: z.string().trim().max(80).optional().default(""),
});

/**
 * Several suppliers' quotes and the prices paid on past bookings, side by side:
 * for one fabric in the materials list, or found by a word of its name.
 */
export async function fabricPrices(ctx: CompanyContext, raw: unknown) {
  assertView(ctx);
  const input = fabricPriceSchema.parse(raw);
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const word = input.search;
  const [quotes, past] = await Promise.all([
    ctx.db.fabricQuote.findMany({
      where: input.materialId
        ? { materialId: input.materialId }
        : word
          ? { fabric: { contains: word, mode: "insensitive" } }
          : {},
      orderBy: [{ quotedOn: "desc" }, { createdAt: "desc" }],
      take: 20,
      include: { supplier: { select: { name: true } } },
    }),
    input.materialId || word
      ? prisma.purchaseOrderLine.findMany({
          where: {
            order: { companyId: ctx.company.id, status: { not: "CANCELLED" } },
            unitPrice: { gt: 0 },
            ...(input.materialId
              ? { rawMaterialId: input.materialId }
              : { rawMaterial: { kind: "FABRIC", name: { contains: word, mode: "insensitive" } } }),
          },
          orderBy: { order: { orderDate: "desc" } },
          take: 12,
          select: {
            unitPrice: true,
            quantity: true,
            rawMaterial: { select: { name: true, unit: true } },
            order: {
              select: { number: true, orderDate: true, supplier: { select: { name: true } } },
            },
          },
        })
      : [],
  ]);
  return {
    quotes: quotes.map((q) => {
      const validUntil = q.validUntil ? localDay(q.validUntil, "UTC") : null;
      return {
        id: q.id,
        supplier: q.supplier.name,
        fabric: q.fabric,
        unit: q.unit,
        price: Number(q.price),
        currency: q.currency,
        quotedOn: localDay(q.quotedOn, "UTC"),
        validUntil,
        expired: validUntil !== null && validUntil < today,
        note: q.note,
      };
    }),
    past: past.map((l) => ({
      number: l.order.number,
      supplier: l.order.supplier.name,
      fabric: l.rawMaterial.name,
      unit: l.rawMaterial.unit,
      price: Number(l.unitPrice),
      currency: ctx.company.currency,
      quantity: Number(l.quantity),
      on: localDay(l.order.orderDate, "UTC"),
    })),
  };
}

export type FabricPrices = Awaited<ReturnType<typeof fabricPrices>>;

/** The CM agreed on past styles: of the same style, else of the same factory (to compare only). */
async function pastCm(ctx: CompanyContext, styleIds: string[], factoryId: string | null) {
  if (styleIds.length === 0 && !factoryId) return [];
  const rows = await ctx.db.productionProject.findMany({
    where: {
      cmRate: { not: null },
      OR: [
        ...(styleIds.length > 0 ? [{ styleId: { in: styleIds } }] : []),
        ...(factoryId ? [{ factoryId }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      code: true,
      styleId: true,
      cmRate: true,
      factory: { select: { name: true } },
      style: { select: { code: true } },
    },
  });
  return rows.map((r) => ({
    project: r.code,
    styleId: r.styleId,
    style: r.style?.code ?? null,
    factory: r.factory?.name ?? null,
    cm: Number(r.cmRate),
  }));
}

/** The profit % given on this buyer's earlier sheets: a hint, never a default. */
async function pastProfit(ctx: CompanyContext, buyerId: string | null, except: string) {
  if (!buyerId) return [];
  const rows = await ctx.db.orderCosting.findMany({
    where: { buyerId, id: { not: except }, profitPercent: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { number: true, profitPercent: true, decision: true },
  });
  return rows.map((r) => ({
    number: r.number,
    profit: Number(r.profitPercent),
    decision: r.decision,
  }));
}

// ---------------------------------------------------------------- reading

const percentsOf = (c: {
  sourceTaxPercent: Prisma.Decimal;
  bankChargePercent: Prisma.Decimal;
  commissionPercent: Prisma.Decimal;
  profitPercent: Prisma.Decimal | null;
}): PercentLines => ({
  sourceTax: Number(c.sourceTaxPercent),
  bankCharge: Number(c.bankChargePercent),
  commission: Number(c.commissionPercent),
  profit: num(c.profitPercent),
});

const lineInput = (s: {
  quantity: number;
  consumption: Prisma.Decimal | null;
  fabricPrice: Prisma.Decimal | null;
  trimsPerDozen: Prisma.Decimal;
  valueAddPerDozen: Prisma.Decimal;
  otherPerDozen: Prisma.Decimal;
  cmAmount: Prisma.Decimal | null;
  cmPer: "PIECE" | "DOZEN";
  buyerPrice: Prisma.Decimal | null;
}): CostLineInput => ({
  quantity: s.quantity,
  consumption: num(s.consumption),
  fabricPrice: num(s.fabricPrice),
  trimsPerDozen: Number(s.trimsPerDozen),
  valueAddPerDozen: Number(s.valueAddPerDozen),
  otherPerDozen: Number(s.otherPerDozen),
  cmAmount: num(s.cmAmount),
  cmPer: s.cmPer,
  buyerPrice: num(s.buyerPrice),
});

export const listCostingsSchema = z.object({ search: z.string().trim().max(80).optional() });

export async function listCostings(ctx: CompanyContext, raw: unknown = {}) {
  assertView(ctx);
  const { search } = listCostingsSchema.parse(raw ?? {});
  const rows = await ctx.db.orderCosting.findMany({
    where: search
      ? {
          OR: [
            { number: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
            { buyer: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      buyer: { select: { name: true } },
      styles: { orderBy: { sortOrder: "asc" } },
    },
  });
  const tz = ctx.company.timezone;
  return rows.map((c) => {
    const sheet = costSheet(c.styles.map(lineInput), percentsOf(c));
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      buyer: c.buyer?.name ?? null,
      currency: c.currency,
      styles: c.styles.length,
      pieces: sheet.pieces,
      cost: sheet.cost,
      value: sheet.valueAtBuyerPrice,
      profitPercent: num(c.profitPercent),
      shipDate: c.shipDate ? localDay(c.shipDate, "UTC") : null,
      decision: c.decision,
      createdOn: localDay(c.createdAt, tz),
    };
  });
}

export type CostingListItem = Awaited<ReturnType<typeof listCostings>>[number];

export async function getCosting(ctx: CompanyContext, costingId: string) {
  assertView(ctx);
  const c = await ctx.db.orderCosting.findFirst({
    where: { id: costingId },
    include: {
      buyer: { select: { id: true, code: true, name: true, tradePayment: true } },
      factory: { select: { id: true, code: true, name: true, monthlyCapacity: true } },
      salesOrder: { select: { id: true, number: true } },
      batch: { select: { id: true, code: true, name: true } },
      decidedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
      styles: {
        orderBy: { sortOrder: "asc" },
        include: {
          style: { select: { id: true, code: true, name: true } },
          quote: { include: { supplier: { select: { name: true } } } },
        },
      },
    },
  });
  if (!c) throw new AppError("NOT_FOUND", "That costing sheet was not found.");
  const tz = ctx.company.timezone;
  const percents = percentsOf(c);
  const sheet = costSheet(c.styles.map(lineInput), percents);
  const styleIds = c.styles.flatMap((s) => (s.styleId ? [s.styleId] : []));
  const [card, cmHints, profitHints] = await Promise.all([
    orderCheck(ctx, c.id),
    pastCm(ctx, styleIds, c.factoryId),
    pastProfit(ctx, c.buyerId, c.id),
  ]);
  return {
    id: c.id,
    number: c.number,
    title: c.title,
    buyer: c.buyer,
    factory: c.factory,
    salesOrder: c.salesOrder,
    batch: c.batch,
    currency: c.currency,
    companyCurrency: ctx.company.currency,
    exchangeRate: num(c.exchangeRate),
    profitPercent: percents.profit,
    sourceTaxPercent: percents.sourceTax,
    bankChargePercent: percents.bankCharge,
    commissionPercent: percents.commission,
    tradePayment: c.tradePayment,
    shipDate: c.shipDate ? localDay(c.shipDate, "UTC") : null,
    fabricDays: c.fabricDays,
    makingDays: c.makingDays,
    risks: c.risks,
    notes: c.notes,
    decision: c.decision,
    decisionNote: c.decisionNote,
    decidedBy: c.decidedBy?.name ?? null,
    decidedOn: c.decidedAt ? localDay(c.decidedAt, tz) : null,
    createdBy: c.createdBy?.name ?? null,
    createdOn: localDay(c.createdAt, tz),
    styles: c.styles.map((s, i) => ({
      id: s.id,
      styleId: s.styleId,
      style: s.style,
      styleRef: s.styleRef,
      description: s.description,
      quantity: s.quantity,
      fabricQuoteId: s.fabricQuoteId,
      quote: s.quote
        ? {
            supplier: s.quote.supplier.name,
            price: Number(s.quote.price),
            unit: s.quote.unit,
            currency: s.quote.currency,
            quotedOn: localDay(s.quote.quotedOn, "UTC"),
          }
        : null,
      fabricName: s.fabricName,
      fabricUnit: s.fabricUnit,
      consumption: num(s.consumption),
      fabricPrice: num(s.fabricPrice),
      trimsPerDozen: Number(s.trimsPerDozen),
      valueAddPerDozen: Number(s.valueAddPerDozen),
      otherPerDozen: Number(s.otherPerDozen),
      cmAmount: num(s.cmAmount),
      cmPer: s.cmPer,
      buyerPrice: num(s.buyerPrice),
      cost: sheet.lines[i]!,
    })),
    sheet,
    card,
    hints: { cm: cmHints, profit: profitHints },
    can: {
      manage: ctx.can("costing.manage"),
      decide: ctx.can("costing.decide"),
    },
  };
}

export type CostingScreen = Awaited<ReturnType<typeof getCosting>>;

// ---------------------------------------------------------------- the Order check card

const OPEN_PROJECT = ["PLANNED", "ACTIVE", "ON_HOLD"] as const;

/** Pieces still to make, due between today and the end of the period, per factory. */
async function bookedPieces(companyId: string, until: Date, factoryIds?: string[]) {
  const rows = await prisma.productionProject.findMany({
    where: {
      companyId,
      status: { in: [...OPEN_PROJECT] },
      factoryId: factoryIds ? { in: factoryIds } : { not: null },
      targetDate: { lte: until },
    },
    select: { factoryId: true, targetQuantity: true, producedQtyA: true, producedQtyB: true },
  });
  const booked = new Map<string, number>();
  for (const r of rows) {
    const left = Math.max(0, r.targetQuantity - r.producedQtyA - r.producedQtyB);
    booked.set(r.factoryId!, (booked.get(r.factoryId!) ?? 0) + left);
  }
  return booked;
}

/**
 * The buyer's invoices of the last two years: how many, how many were paid
 * more than the grace days after their due day, and what is overdue now
 * (calendar days in company time).
 */
async function paymentFacts(companyId: string, buyerId: string, tz: string, today: string) {
  const since = new Date(Date.now() - 2 * 365 * 86_400_000);
  const invoices = await prisma.invoice.findMany({
    where: { companyId, partyId: buyerId, status: { not: "VOID" }, issueDate: { gte: since } },
    select: { id: true, orderId: true, dueDate: true, dueAmount: true, status: true },
  });
  const dueDay = (i: { dueDate: Date | null }) => (i.dueDate ? localDay(i.dueDate, tz) : null);
  const overdue = invoices.filter((i) => {
    const due = dueDay(i);
    return due !== null && due < today && Number(i.dueAmount) > 0;
  });
  const paid = invoices.filter((i) => i.status === "PAID" && i.dueDate);
  const payments = paid.length
    ? await prisma.payment.findMany({
        where: {
          companyId,
          direction: "RECEIVED",
          OR: [
            { invoiceId: { in: paid.map((i) => i.id) } },
            { orderId: { in: paid.map((i) => i.orderId) } },
          ],
        },
        select: { invoiceId: true, orderId: true, paymentDate: true },
      })
    : [];
  const late = paid.filter((i) => {
    const last = payments
      .filter((p) => p.invoiceId === i.id || p.orderId === i.orderId)
      .reduce<Date | null>((m, p) => (!m || p.paymentDate > m ? p.paymentDate : m), null);
    return last !== null && daysBetween(dueDay(i)!, localDay(last, tz)) > CHECK_RULES.graceDays;
  }).length;
  const oldest = overdue.map((i) => dueDay(i)!).sort()[0];
  return {
    invoices: invoices.length,
    late,
    overdue: oldest
      ? {
          amount: overdue.reduce((sum, i) => sum + Number(i.dueAmount), 0),
          count: overdue.length,
          days: daysBetween(oldest, today),
        }
      : null,
  };
}

/**
 * The Order check card: price vs cost, time to ship, factory, the buyer's
 * payment history and risks, each green, yellow or red with its reason. It
 * never declines an order; the owner decides.
 */
export async function orderCheck(ctx: CompanyContext, costingId: string): Promise<CheckRow[]> {
  assertView(ctx);
  const c = await ctx.db.orderCosting.findFirst({
    where: { id: costingId },
    include: {
      buyer: { select: { id: true, name: true } },
      factory: { select: { id: true, name: true, monthlyCapacity: true } },
      styles: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!c) throw new AppError("NOT_FOUND", "That costing sheet was not found.");
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const percents = percentsOf(c);
  const sheet = costSheet(c.styles.map(lineInput), percents);
  const shipDate = c.shipDate ? localDay(c.shipDate, "UTC") : null;
  const periodEnd = shipDate ?? addDays(today, 60);
  const until = startOfDayInZone(addDays(periodEnd, 1), tz);
  const months = Math.max(1, Math.ceil(Math.max(0, daysBetween(today, periodEnd)) / 30));

  const price = judgePrice(
    c.styles.map((s, i) => ({
      ref: s.styleRef,
      costPerPiece: sheet.lines[i]!.costPerPiece,
      missing: sheet.lines[i]!.missing,
      buyerPrice: num(s.buyerPrice),
      buyerProfit: sheet.lines[i]!.buyerProfit,
    })),
    percents.profit,
  );
  const time = judgeTime({ today, shipDate, fabricDays: c.fabricDays, makingDays: c.makingDays });

  const capacities = await ctx.db.party.findMany({
    where: { monthlyCapacity: { not: null }, kind: { in: ["SUPPLIER", "BOTH"] } },
    select: { id: true, name: true, monthlyCapacity: true },
  });
  const booked = await bookedPieces(ctx.company.id, until, [
    ...new Set([...capacities.map((f) => f.id), ...(c.factoryId ? [c.factoryId] : [])]),
  ]);
  const factory = judgeFactory({
    factory: c.factory,
    booked: c.factoryId ? (booked.get(c.factoryId) ?? 0) : 0,
    pieces: sheet.pieces,
    months,
    others: capacities
      .filter((f) => f.id !== c.factoryId)
      .map((f) => ({ name: f.name, room: f.monthlyCapacity! * months - (booked.get(f.id) ?? 0) })),
  });

  const facts = c.buyer ? await paymentFacts(ctx.company.id, c.buyer.id, tz, today) : null;
  const payment = judgePayment({
    buyer: c.buyer?.name ?? null,
    invoices: facts?.invoices ?? 0,
    late: facts?.late ?? 0,
    overdue: facts?.overdue ?? null,
    currency: ctx.company.currency,
  });

  const holidays = await ctx.db.holiday.findMany({
    where: {
      date: { gte: dayOf(today)!, lte: dayOf(periodEnd)! },
      name: { contains: "eid", mode: "insensitive" },
    },
    orderBy: { date: "asc" },
    select: { date: true, name: true },
  });
  const risks: string[] = [];
  let eidClose = false;
  for (const h of holidays) {
    const day = localDay(h.date, "UTC");
    const beforeShip = shipDate ? daysBetween(day, shipDate) : null;
    if (beforeShip !== null && beforeShip <= CHECK_RULES.eidBeforeShipDays) eidClose = true;
    risks.push(
      `${h.name} on ${day}${beforeShip !== null && beforeShip <= CHECK_RULES.eidBeforeShipDays ? `, ${beforeShip} days before the ship date` : " falls in the production time"}`,
    );
  }
  if (c.buyer && facts && facts.invoices === 0) risks.push("New buyer");
  if (c.tradePayment === "LC") risks.push("LC: the papers must match the LC exactly");
  risks.push(...c.risks);
  return [price, time, factory, payment, judgeRisks({ risks, eidClose })];
}
