import { Prisma } from "@prisma/client";
import { z } from "zod";

import { toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRows } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { lockSupplierAccount, settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { PIN_CHECKED, requirePin } from "@/modules/ai/settings.service";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { openLots } from "@/modules/inventory/lot.service";
import { receiveAtCostTx, stockByVariant } from "@/modules/inventory/stock.service";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";
import { activeMembers } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

import { setHandPrice } from "./stores.service";

/*
 * Business > Shop stock (plan v6 sec 3 and 3a)
 * --------------------------------------------
 * The shops' reserve (see ./reserve.ts) and "Buy ready stock": finished goods
 * bought from a supplier for the shops. A purchase is a supplier bill on credit
 * (Dr Finished Goods Inventory / Cr Supplier Due) and the pieces into stock at
 * cost, with transport and other costs on the bill shared per piece. "Retail
 * only" puts all its pieces on the reserve. Accounts pays the bill like any
 * other; a mistake is put right with a reversing entry, never by editing it.
 */

const IDLE_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;

const id = z.string().trim().min(1).max(40);
const amount = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, message);

export const reserveSchema = z.object({
  styleId: id,
  colorId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  quantity: z.coerce
    .number()
    .int("Whole pieces")
    .min(0, "0 or more pieces")
    .max(1_000_000, "At most 1,000,000"),
  note: z
    .string()
    .trim()
    .max(200, "At most 200 characters")
    .optional()
    .transform((v) => v || null),
});

export const purchaseSchema = z
  .object({
    supplierId: id,
    styleId: id,
    warehouseId: id,
    purchaseDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A date")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    supplierRef: z
      .string()
      .trim()
      .max(60, "At most 60 characters")
      .optional()
      .transform((v) => v || null),
    lines: z
      .array(
        z.object({
          variantId: id,
          quantity: z.coerce.number().int("Whole pieces").min(1).max(100_000),
          unitPrice: amount("A price like 420 or 419.50").refine(
            (v) => Number(v) > 0,
            "A price above 0",
          ),
        }),
      )
      .min(1, "Enter the pieces of at least one colour and size")
      .max(400),
    extraCost: amount("An amount like 1500")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    retailOnly: z.boolean().default(false),
    priceMode: z.enum(["RULE", "FIXED", "AT_COST"]).default("RULE"),
    fixedPrice: amount("A price like 650")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    note: z
      .string()
      .trim()
      .max(300, "At most 300 characters")
      .optional()
      .transform((v) => v || null),
    pin: z.string().trim().max(20).optional(),
  })
  .superRefine((input, issue) => {
    if (input.priceMode === "FIXED" && !(Number(input.fixedPrice ?? 0) > 0)) {
      issue.addIssue({ code: "custom", path: ["fixedPrice"], message: "Give the shops' price" });
    }
    const ids = input.lines.map((l) => l.variantId);
    if (new Set(ids).size !== ids.length) {
      issue.addIssue({ code: "custom", path: ["lines"], message: "Each SKU once" });
    }
  });

function assertCanSee(ctx: CompanyContext) {
  if (!ctx.can("retail.view") && !ctx.can("retail.manage") && !ctx.can("retail.purchases")) {
    throw new AppError("FORBIDDEN", "You may not see the shops' stock.");
  }
}

const canSeeCosts = (ctx: CompanyContext) => ctx.can("retail.purchases") || canSeeFinancials(ctx);

// ---------------------------------------------------------------------------
// The reserve
// ---------------------------------------------------------------------------

/** Sets the pieces held for the shops on a style or one colour of it (0 takes it off). */
export async function setReserve(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!ctx.can("retail.manage") && !ctx.can("retail.purchases")) {
    throw new AppError("FORBIDDEN", "You may not change the shops' reserve.");
  }
  const input = reserveSchema.parse(raw);
  const style = await ctx.db.style.findUnique({
    where: { id: input.styleId },
    select: { id: true, code: true, variants: { select: { colorId: true } } },
  });
  if (!style) throw new AppError("NOT_FOUND", "There is no such style.");
  if (input.colorId && !style.variants.some((v) => v.colorId === input.colorId)) {
    throw new AppError("VALIDATION", "Pick a colour of this style.", {
      colorId: ["Pick a colour of this style"],
    });
  }
  const rows = await ctx.db.retailReserve.findMany({ where: { styleId: style.id } });
  const other = rows.find(
    (r) => r.quantity > 0 && (input.colorId ? r.colorId === null : r.colorId !== null),
  );
  if (other && input.quantity > 0) {
    const message = input.colorId
      ? "This style has a reserve for the whole style: set that to 0 first"
      : "This style has reserves per colour: set those to 0 first";
    throw new AppError("VALIDATION", `${message}.`, { colorId: [message] });
  }
  const row = rows.find((r) => r.colorId === input.colorId);
  const data = {
    quantity: input.quantity,
    note: input.note,
    activeAt: new Date(),
    remindedAt: null,
    setById: ctx.user.id,
  };
  const saved = row
    ? await ctx.db.retailReserve.update({ where: { id: row.id }, data })
    : await ctx.db.retailReserve.create({
        data: { ...data, companyId: ctx.company.id, styleId: style.id, colorId: input.colorId },
      });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailReserve",
    entityId: saved.id,
    summary: `Shops' reserve on ${style.code}${input.colorId ? " (one colour)" : ""}: ${
      row?.quantity ?? 0
    } -> ${input.quantity} pieces`,
  });
  return saved;
}

/**
 * Nightly: tells the people who look after the shops about reserves untouched
 * for 60 days (once per 60 days each). Returns how many reserves it named.
 */
export async function remindIdleReserves(now: Date = new Date()) {
  const before = new Date(now.getTime() - IDLE_DAYS * DAY);
  const idle = await prisma.retailReserve.findMany({
    where: {
      quantity: { gt: 0 },
      activeAt: { lt: before },
      OR: [{ remindedAt: null }, { remindedAt: { lt: before } }],
    },
    include: { style: { select: { code: true, name: true } } },
  });
  const byCompany = new Map<string, typeof idle>();
  for (const r of idle) byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), r]);
  for (const [companyId, reserves] of byCompany) {
    const to = (await activeMembers(companyId)).filter(
      (m) => m.permissions.has("retail.manage") || m.permissions.has("retail.purchases"),
    );
    const list = reserves.map((r) => `${r.style.code} ${r.style.name}: ${r.quantity}`).join(", ");
    await sendInApp(prisma, companyId, to, {
      subject: `${reserves.length} shop reserve(s) untouched for ${IDLE_DAYS} days`,
      body: `No shop took these pieces for ${IDLE_DAYS} days: ${list}. Lower the reserve in Business > Shop stock to let wholesale sell them, or keep it.`,
      entityType: "RetailReserve",
      entityId: reserves[0]!.id,
    });
    await prisma.retailReserve.updateMany({
      where: { id: { in: reserves.map((r) => r.id) } },
      data: { remindedAt: now },
    });
    await recordAudit({
      companyId,
      userId: null,
      action: "STATUS_CHANGE",
      entityType: "RetailReserve",
      summary: `Reminded about ${reserves.length} shop reserve(s) untouched for ${IDLE_DAYS} days`,
    });
  }
  return idle.length;
}

// ---------------------------------------------------------------------------
// Buy ready stock
// ---------------------------------------------------------------------------

const ZERO = new Prisma.Decimal(0);
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Records ready stock bought from a supplier, with the PIN. */
export async function buyReadyStock(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!ctx.can("retail.purchases")) {
    throw new AppError("FORBIDDEN", "You may not buy ready stock for the shops.");
  }
  const input = purchaseSchema.parse(raw);
  if (input.priceMode !== "RULE" && !ctx.can("retail.manage")) {
    throw new AppError("FORBIDDEN", "Setting the shops' price also needs the right to set prices.");
  }
  const companyId = ctx.company.id;
  const supplier = await assertPartyCanTransact(ctx, input.supplierId, "PURCHASE");
  const style = await ctx.db.style.findUnique({
    where: { id: input.styleId },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      variants: { where: { removedAt: null }, select: { id: true, sku: true, colorId: true } },
    },
  });
  if (!style || !style.isActive) throw new AppError("NOT_FOUND", "There is no such style.");
  const variants = new Map(style.variants.map((v) => [v.id, v]));
  input.lines.forEach((l, i) => {
    if (!variants.has(l.variantId)) {
      throw new AppError("VALIDATION", "A SKU is not of this style.", {
        [`lines.${i}.variantId`]: ["Pick a colour and size of this style"],
      });
    }
  });
  const warehouse = await ctx.db.warehouse.findUnique({ where: { id: input.warehouseId } });
  if (!warehouse) throw new AppError("NOT_FOUND", "There is no such warehouse.");
  await requirePin(ctx, input.pin, "buy ready stock");

  // The extra costs are shared per piece: each piece costs its price plus the share.
  const pieces = input.lines.reduce((t, l) => t + l.quantity, 0);
  const extra = new Prisma.Decimal(input.extraCost ?? 0);
  const share = extra.dividedBy(pieces);
  const lines = input.lines.map((l) => {
    const unitPrice = new Prisma.Decimal(l.unitPrice);
    return { ...l, unitPrice, unitCost: unitPrice.plus(share).toDecimalPlaces(4) };
  });
  const goods = lines.reduce((t, l) => t.plus(l.unitPrice.times(l.quantity)), ZERO);
  const total = money(goods.plus(extra));
  const purchaseDate = input.purchaseDate
    ? toInstant(input.purchaseDate, ctx.company.timezone)
    : new Date();

  const purchase = await runTransaction(async (tx) => {
    // Lock order: the supplier's account first, then the SKUs' costs.
    await lockSupplierAccount(tx, companyId, supplier.id);
    await lockRows(
      tx,
      "ProductVariant",
      lines.map((l) => l.variantId),
    );
    const number = await nextDocumentNumber(tx, companyId, "READY_STOCK_PURCHASE");
    const bill = await tx.supplierBill.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "SUPPLIER_BILL"),
        supplierRef: input.supplierRef,
        supplierId: supplier.id,
        billDate: purchaseDate,
        totalAmount: total,
        paymentType: "DUE",
        dueAmount: total,
        notes: `Ready stock ${number}: ${style.code} ${style.name}, ${pieces} pieces`,
      },
    });
    const created = await tx.readyStockPurchase.create({
      data: {
        companyId,
        number,
        supplierId: supplier.id,
        billId: bill.id,
        styleId: style.id,
        warehouseId: warehouse.id,
        purchaseDate,
        supplierRef: input.supplierRef,
        retailOnly: input.retailOnly,
        priceMode: input.priceMode,
        fixedPrice: input.priceMode === "FIXED" ? input.fixedPrice : null,
        extraCost: money(extra),
        pieces,
        totalAmount: total,
        note: input.note,
        createdById: ctx.user.id,
        lines: {
          create: lines.map((l) => ({
            companyId,
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitCost: l.unitCost,
          })),
        },
      },
    });
    const lots = await openLots(tx, ctx, {
      variantIds: lines.map((l) => l.variantId),
      warehouseId: warehouse.id,
      source: "PURCHASE",
    });
    // Stock value per line; the last line takes the rounding so the books match the bill.
    let booked = ZERO;
    const values = lines.map((l, i) => {
      const value =
        i === lines.length - 1 ? total.minus(booked) : money(l.unitCost.times(l.quantity));
      booked = booked.plus(value);
      return value;
    });
    for (const l of lines) {
      const variant = variants.get(l.variantId)!;
      const costs = await tx.productVariant.findUniqueOrThrow({
        where: { id: l.variantId },
        select: { avgCost: true },
      });
      const onHand = await tx.stockBalance.aggregate({
        where: { variantId: l.variantId, grade: "A_GRADE" },
        _sum: { quantity: true },
      });
      const key = { variantId: l.variantId, warehouseId: warehouse.id, grade: "A_GRADE" as const };
      await tx.stockBalance.upsert({
        where: { variantId_warehouseId_grade: key },
        create: { ...key, companyId, quantity: l.quantity },
        update: { quantity: { increment: l.quantity } },
      });
      const movement = await tx.stockMovement.create({
        data: {
          ...key,
          companyId,
          type: "PURCHASE_IN",
          quantity: l.quantity,
          unitCost: l.unitCost,
          referenceType: "ReadyStockPurchase",
          referenceId: created.id,
          lotId: lots.get(l.variantId),
          note: `Bought ready: ${number} from ${supplier.name}`,
          createdById: ctx.user.id,
        },
      });
      await receiveAtCostTx(tx, ctx, {
        variant,
        grade: "A_GRADE",
        onHand: onHand._sum.quantity ?? 0,
        average: costs.avgCost,
        quantity: l.quantity,
        unitCost: l.unitCost,
        movementId: movement.id,
      });
    }
    const acc = await ensureControlAccounts(companyId, tx);
    const entry = await postJournalEntry(tx, {
      companyId,
      date: purchaseDate,
      description: `Bill ${bill.number} — ${supplier.name}${
        input.supplierRef ? ` (${input.supplierRef})` : ""
      }: ready stock ${number} into ${warehouse.name}`,
      sourceType: "SUPPLIER_BILL",
      sourceId: bill.id,
      postedById: ctx.user.id,
      lines: [
        ...lines.map((l, i) => ({
          accountId: acc.INVENTORY,
          debit: values[i]!,
          memo: `${variants.get(l.variantId)!.sku} × ${l.quantity}`,
        })),
        {
          accountId: acc.PAYABLE,
          partyId: supplier.id,
          credit: total,
          memo: input.supplierRef ?? undefined,
        },
      ],
    });
    await tx.supplierBill.update({ where: { id: bill.id }, data: { journalEntryId: entry.id } });
    if (input.retailOnly) await holdForShopsTx(tx, ctx, style.id, lines, variants);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ReadyStockPurchase",
        entityId: created.id,
        summary: `Ready stock ${number} (bill ${bill.number}) from ${supplier.name}: ${style.code} × ${pieces} into ${
          warehouse.name
        }, ${total.toFixed(2)} due${input.retailOnly ? ", retail only" : ""}`,
      },
      tx,
    );
    // An advance already paid to the supplier settles the bill straight away.
    await settleSupplierBills(tx, companyId, supplier.id);
    await recordPartyActivity(supplier.id, purchaseDate, tx);
    return created;
  });

  // The shops' price for these pieces, at every open shop (the PIN was asked above).
  if (input.priceMode !== "RULE") {
    const stores = await ctx.db.retailStore.findMany({
      where: { closedAt: null },
      select: { id: true },
    });
    for (const store of stores) {
      if (input.priceMode === "FIXED") {
        await setHandPrice(
          ctx,
          { storeId: store.id, grade: "A", styleId: style.id, price: input.fixedPrice },
          meta,
          PIN_CHECKED,
        );
        continue;
      }
      for (const l of lines) {
        await setHandPrice(
          ctx,
          {
            storeId: store.id,
            grade: "A",
            styleId: style.id,
            colorId: variants.get(l.variantId)!.colorId,
            variantId: l.variantId,
            price: money(l.unitCost).toFixed(2),
          },
          meta,
          PIN_CHECKED,
        );
      }
    }
  }
  return purchase;
}

/** "Retail only": every piece goes on the shops' reserve (per colour where the style has those). */
async function holdForShopsTx(
  tx: Prisma.TransactionClient,
  ctx: CompanyContext,
  styleId: string,
  lines: Array<{ variantId: string; quantity: number }>,
  variants: Map<string, { colorId: string }>,
) {
  const rows = await tx.retailReserve.findMany({ where: { companyId: ctx.company.id, styleId } });
  const perColour = rows.some((r) => r.colorId !== null && r.quantity > 0);
  const adds = new Map<string | null, number>();
  for (const l of lines) {
    const key = perColour ? variants.get(l.variantId)!.colorId : null;
    adds.set(key, (adds.get(key) ?? 0) + l.quantity);
  }
  for (const [colorId, quantity] of adds) {
    const row = rows.find((r) => r.colorId === colorId);
    if (row) {
      await tx.retailReserve.update({
        where: { id: row.id },
        data: { quantity: { increment: quantity }, activeAt: new Date(), remindedAt: null },
      });
    } else {
      await tx.retailReserve.create({
        data: { companyId: ctx.company.id, styleId, colorId, quantity, setById: ctx.user.id },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Business > Shop stock: the reserves, the purchases and what each one did. */
export async function shopStockPage(ctx: CompanyContext, now: Date = new Date()) {
  assertCanSee(ctx);
  const costs = canSeeCosts(ctx);
  const [reserves, purchases, styles, suppliers, warehouses] = await Promise.all([
    ctx.db.retailReserve.findMany({
      where: { quantity: { gt: 0 } },
      include: { style: { select: { code: true, name: true } } },
      orderBy: [{ style: { code: "asc" } }, { createdAt: "asc" }],
    }),
    ctx.db.readyStockPurchase.findMany({
      include: {
        supplier: { select: { name: true } },
        style: { select: { code: true, name: true } },
        warehouse: { select: { name: true } },
        bill: { select: { number: true, dueAmount: true } },
        lines: true,
      },
      orderBy: { purchaseDate: "desc" },
      take: 50,
    }),
    ctx.db.style.findMany({
      where: { isActive: true, variants: { some: { removedAt: null } } },
      select: {
        id: true,
        code: true,
        name: true,
        variants: {
          where: { removedAt: null },
          select: {
            id: true,
            sku: true,
            colorId: true,
            color: { select: { name: true } },
            size: { select: { name: true } },
          },
          orderBy: [{ color: { sortOrder: "asc" } }, { size: { sortOrder: "asc" } }],
        },
      },
      orderBy: { code: "asc" },
      take: 300,
    }),
    ctx.can("retail.purchases")
      ? ctx.db.party.findMany({
          where: { kind: { in: ["SUPPLIER", "BOTH"] } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    ctx.db.warehouse.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const colourName = new Map(
    styles.flatMap((s) => s.variants.map((v) => [v.colorId, v.color.name] as const)),
  );

  // Stock now of each reserve's pieces (all warehouses).
  const reservedVariants = await ctx.db.productVariant.findMany({
    where: { styleId: { in: reserves.map((r) => r.styleId) } },
    select: { id: true, styleId: true, colorId: true },
  });
  const purchaseVariants = purchases.flatMap((p) => p.lines.map((l) => l.variantId));
  const stock = await stockByVariant(ctx, [
    ...new Set([...reservedVariants.map((v) => v.id), ...purchaseVariants]),
  ]);
  const available = (ids: string[]) => ids.reduce((t, v) => t + (stock.get(v)?.available ?? 0), 0);

  // What the shops took of each purchase's SKUs since it came (billed, not dropped).
  const taken = await ctx.db.retailOrderLine.findMany({
    where: {
      variantId: { in: purchaseVariants },
      cancelledAt: null,
      order: { billedAt: { not: null } },
    },
    select: {
      variantId: true,
      quantity: true,
      shopPrice: true,
      order: { select: { billedAt: true } },
    },
  });

  return {
    currency: ctx.company.currency,
    canSeeCosts: costs,
    canSetReserve: ctx.can("retail.manage") || ctx.can("retail.purchases"),
    canBuy: ctx.can("retail.purchases"),
    reserves: reserves.map((r) => {
      const ids = reservedVariants
        .filter((v) => v.styleId === r.styleId && (r.colorId === null || v.colorId === r.colorId))
        .map((v) => v.id);
      const idleDays = Math.floor((now.getTime() - r.activeAt.getTime()) / DAY);
      return {
        id: r.id,
        styleId: r.styleId,
        colorId: r.colorId,
        style: `${r.style.code} ${r.style.name}`,
        colour: r.colorId ? (colourName.get(r.colorId) ?? "") : "All colours",
        quantity: r.quantity,
        inStock: available(ids),
        note: r.note,
        idleDays,
        idle: idleDays >= IDLE_DAYS,
      };
    }),
    purchases: purchases.map((p) => {
      const ids = new Set(p.lines.map((l) => l.variantId));
      const since = taken.filter((t) => ids.has(t.variantId) && t.order.billedAt! >= p.createdAt);
      const toShops = since.reduce((n, t) => n + t.quantity, 0);
      const sales = since.reduce((s, t) => s.plus(t.shopPrice.times(t.quantity)), ZERO);
      const costEach = p.lines.length
        ? p.lines.reduce((s, l) => s.plus(l.unitCost.times(l.quantity)), ZERO).dividedBy(p.pieces)
        : ZERO;
      return {
        id: p.id,
        number: p.number,
        date: p.purchaseDate.toISOString(),
        supplier: p.supplier.name,
        style: `${p.style.code} ${p.style.name}`,
        warehouse: p.warehouse.name,
        bill: p.bill.number,
        supplierRef: p.supplierRef,
        retailOnly: p.retailOnly,
        priceMode: p.priceMode,
        pieces: p.pieces,
        toShops,
        left: available([...ids]),
        ...(costs
          ? {
              total: p.totalAmount.toFixed(2),
              due: p.bill.dueAmount.toFixed(2),
              sales: money(sales).toFixed(2),
              profit: money(sales.minus(costEach.times(toShops))).toFixed(2),
            }
          : {}),
      };
    }),
    styles: styles.map((s) => ({
      id: s.id,
      label: `${s.code} ${s.name}`,
      colours: [
        ...new Map(s.variants.map((v) => [v.colorId, { id: v.colorId, name: v.color.name }])),
      ].map(([, c]) => c),
      variants: s.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        colour: v.color.name,
        size: v.size.name,
      })),
    })),
    suppliers,
    warehouses,
  };
}

export type ShopStockPage = Awaited<ReturnType<typeof shopStockPage>>;
