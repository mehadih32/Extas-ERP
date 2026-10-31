import { PaymentMethod, Prisma } from "@prisma/client";
import { z } from "zod";

import { toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRows } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { assertCanPayMoney } from "@/modules/accounts/money-guards";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import { lockSupplierAccount, settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { PIN_CHECKED, requirePin } from "@/modules/ai/settings.service";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { openLots } from "@/modules/inventory/lot.service";
import { buildSku } from "@/modules/inventory/matrix.service";
import { saveSizeChartTx, sizeChartSchema } from "@/modules/inventory/size-chart.service";
import { receiveAtCostTx, stockByVariant } from "@/modules/inventory/stock.service";
import {
  assertPartyCanTransact,
  nextPartyCode,
  recordPartyActivity,
} from "@/modules/parties/party.service";
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
const ZERO = new Prisma.Decimal(0);
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .transform((v) => v || null);

/** Who sold the pieces: a supplier from the list, a new one, or a one-time ("random") one. */
const supplierChoice = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("PICK"), supplierId: id }),
  z.object({
    mode: z.literal("NEW"),
    name: z.string().trim().min(2, "The supplier's name").max(120, "At most 120 characters"),
    phone: optionalText(30),
    address: optionalText(300),
  }),
  z.object({
    mode: z.literal("RANDOM"),
    name: optionalText(120),
    phone: optionalText(30),
    address: optionalText(300),
  }),
]);

/** Which style: one from Products, or a new one made here. */
const styleChoice = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("PICK"), styleId: id }),
  z.object({
    mode: z.literal("NEW"),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/, "Use letters, numbers and dashes (e.g. EX-PL-001)"),
    name: z.string().trim().min(1, "The style's name").max(200, "At most 200 characters"),
    categoryId: id,
    sizeChart: sizeChartSchema.optional(),
  }),
]);

/** How much is paid now, from which cash, bank or wallet account (for the whole bill). */
const paymentChoice = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("DUE") }),
  z.object({
    mode: z.enum(["PART", "FULL"]),
    amount: amount("An amount like 5000")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    accountId: id,
    method: z.enum(PaymentMethod).default("CASH"),
    reference: optionalText(120),
  }),
]);

export const purchaseSchema = z
  .object({
    supplier: supplierChoice,
    style: styleChoice,
    warehouseId: id,
    purchaseDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A date")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    supplierRef: optionalText(60),
    /** Pieces per colour and size. */
    lines: z
      .array(
        z.object({
          colorId: id,
          sizeId: id,
          quantity: z.coerce.number().int("Whole pieces").min(1).max(100_000),
        }),
      )
      .min(1, "Enter the pieces of at least one colour and size")
      .max(400),
    /** One price for the whole style: per piece, or the total for all the pieces. */
    priceBasis: z.enum(["PIECE", "TOTAL"]).default("PIECE"),
    price: amount("A price like 420 or 419.50").refine((v) => Number(v) > 0, "A price above 0"),
    /** Transport and other costs on the same bill, shared per piece into the cost. */
    extraCosts: z
      .array(
        z.object({
          label: z.string().trim().min(1, "Say what it was for").max(60, "At most 60 characters"),
          amount: amount("An amount like 1500").refine((v) => Number(v) > 0, "Above 0"),
        }),
      )
      .max(10, "At most 10 extra costs")
      .default([]),
    payment: paymentChoice.default({ mode: "DUE" }),
    retailOnly: z.boolean().default(false),
    priceMode: z.enum(["RULE", "FIXED", "AT_COST"]).default("RULE"),
    fixedPrice: amount("A price like 650")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    note: optionalText(300),
    pin: z.string().trim().max(20).optional(),
  })
  .superRefine((input, issue) => {
    if (input.priceMode === "FIXED" && !(Number(input.fixedPrice ?? 0) > 0)) {
      issue.addIssue({ code: "custom", path: ["fixedPrice"], message: "Give the shops' price" });
    }
    const cells = input.lines.map((l) => `${l.colorId}:${l.sizeId}`);
    if (new Set(cells).size !== cells.length) {
      issue.addIssue({ code: "custom", path: ["lines"], message: "Each colour and size once" });
    }
    if (input.payment.mode === "PART" && !(Number(input.payment.amount ?? 0) > 0)) {
      issue.addIssue({
        code: "custom",
        path: ["payment", "amount"],
        message: "How much is paid now",
      });
    }
  });

/** The bill's figures from the pieces, the one price and the extra costs. */
export function purchaseFigures(input: {
  lines: Array<{ quantity: number }>;
  priceBasis: "PIECE" | "TOTAL";
  price: string;
  extraCosts: Array<{ amount: string }>;
}) {
  const pieces = input.lines.reduce((t, l) => t + l.quantity, 0);
  const price = new Prisma.Decimal(input.price);
  const goods = money(input.priceBasis === "PIECE" ? price.times(pieces) : price);
  const extra = money(input.extraCosts.reduce((t, c) => t.plus(c.amount), ZERO));
  const total = goods.plus(extra);
  return {
    pieces,
    goods,
    extra,
    total,
    /** The supplier's price per piece (4 places; the bill keeps the exact total). */
    unitPrice: pieces ? goods.dividedBy(pieces).toDecimalPlaces(4) : ZERO,
    /** What each piece cost with its share of the extra costs. */
    unitCost: pieces ? total.dividedBy(pieces).toDecimalPlaces(4) : ZERO,
  };
}

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

/** Records ready stock bought from a supplier, with the PIN. */
export async function buyReadyStock(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!ctx.can("retail.purchases")) {
    throw new AppError("FORBIDDEN", "You may not buy ready stock for the shops.");
  }
  const input = purchaseSchema.parse(raw);
  if (input.priceMode !== "RULE" && !ctx.can("retail.manage")) {
    throw new AppError("FORBIDDEN", "Setting the shops' price also needs the right to set prices.");
  }
  // Money paid now: only those who record payments (checked in the action too).
  if (input.payment.mode !== "DUE") {
    assertCanPayMoney(ctx, "Only Accounts can pay the supplier now: save it as Due instead.");
  }
  if (input.supplier.mode === "NEW" && !ctx.can("parties.manage")) {
    throw new AppError("FORBIDDEN", "Adding a supplier needs the right to manage suppliers.", {
      "supplier.name": ["Pick a supplier, or tick Random supplier"],
    });
  }
  const companyId = ctx.company.id;
  const supplier =
    input.supplier.mode === "PICK"
      ? await assertPartyCanTransact(ctx, input.supplier.supplierId, "PURCHASE")
      : null;
  const pickedStyle =
    input.style.mode === "PICK"
      ? await ctx.db.style.findUnique({
          where: { id: input.style.styleId },
          select: { id: true, code: true, name: true, isActive: true },
        })
      : null;
  if (input.style.mode === "PICK" && (!pickedStyle || !pickedStyle.isActive)) {
    throw new AppError("NOT_FOUND", "There is no such style.");
  }
  if (input.style.mode === "NEW") {
    if (!ctx.can("inventory.manage")) {
      throw new AppError("FORBIDDEN", "Adding a style needs the right to manage products.");
    }
    const code = input.style.code;
    if (await ctx.db.style.findFirst({ where: { code } })) {
      throw new AppError("CONFLICT", `Style code ${code} is already used.`, {
        "style.code": ["This code is taken"],
      });
    }
    if (!(await ctx.db.category.findUnique({ where: { id: input.style.categoryId } }))) {
      throw new AppError("NOT_FOUND", "There is no such category.");
    }
  }
  const colorIds = [...new Set(input.lines.map((l) => l.colorId))];
  const sizeIds = [...new Set(input.lines.map((l) => l.sizeId))];
  const [colors, sizes] = await Promise.all([
    ctx.db.color.findMany({ where: { id: { in: colorIds } }, select: { id: true, name: true } }),
    ctx.db.size.findMany({ where: { id: { in: sizeIds } }, select: { id: true, name: true } }),
  ]);
  if (colors.length !== colorIds.length || sizes.length !== sizeIds.length) {
    throw new AppError("NOT_FOUND", "A colour or size was not found.");
  }
  const warehouse = await ctx.db.warehouse.findUnique({ where: { id: input.warehouseId } });
  if (!warehouse) throw new AppError("NOT_FOUND", "There is no such warehouse.");
  const paidFromId =
    input.payment.mode === "DUE"
      ? null
      : await cashAccountFor(prisma, companyId, input.payment.method, input.payment.accountId);
  await requirePin(ctx, input.pin, "buy ready stock");

  const figures = purchaseFigures(input);
  const { pieces, extra, total } = figures;
  const paidNow =
    input.payment.mode === "DUE"
      ? ZERO
      : input.payment.mode === "FULL"
        ? total
        : money(new Prisma.Decimal(input.payment.amount!));
  if (paidNow.gt(total)) {
    throw new AppError("VALIDATION", "More than the bill: choose Paid in full instead.", {
      "payment.amount": [`At most ${total.toFixed(2)}`],
    });
  }
  const purchaseDate = input.purchaseDate
    ? toInstant(input.purchaseDate, ctx.company.timezone)
    : new Date();
  const colorName = new Map(colors.map((c) => [c.id, c.name]));
  const sizeName = new Map(sizes.map((s) => [s.id, s.name]));

  const result = await runTransaction(async (tx) => {
    // A new or one-time supplier first: its account is locked like any other below.
    const seller = supplier ?? (await newSupplierTx(tx, ctx, input.supplier as NewSupplierChoice));
    // Lock order: the supplier's account first, then the SKUs' costs.
    await lockSupplierAccount(tx, companyId, seller.id);
    const style =
      pickedStyle ??
      (await tx.style.create({
        data: {
          companyId,
          code: (input.style as { code: string }).code,
          name: (input.style as { name: string }).name,
          categoryId: (input.style as { categoryId: string }).categoryId,
        },
        select: { id: true, code: true, name: true, isActive: true },
      }));
    const variants = await skusForTx(tx, ctx, style, input.lines, colorName, sizeName);
    if (input.style.mode === "NEW" && input.style.sizeChart) {
      await saveSizeChartTx(tx, companyId, style.id, input.style.sizeChart, ctx.user.id);
    }
    const lines = input.lines.map((l) => ({
      variantId: variants.get(`${l.colorId}:${l.sizeId}`)!.id,
      quantity: l.quantity,
      unitPrice: figures.unitPrice,
      unitCost: figures.unitCost,
    }));
    await lockRows(
      tx,
      "ProductVariant",
      lines.map((l) => l.variantId),
    );
    const byId = new Map([...variants.values()].map((v) => [v.id, v]));
    const number = await nextDocumentNumber(tx, companyId, "READY_STOCK_PURCHASE");
    const extras = input.extraCosts.map((c) => `${c.label} ${c.amount}`).join(", ");
    const bill = await tx.supplierBill.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "SUPPLIER_BILL"),
        supplierRef: input.supplierRef,
        supplierId: seller.id,
        billDate: purchaseDate,
        totalAmount: total,
        paymentType: "DUE",
        dueAmount: total,
        notes: `Ready stock ${number}: ${style.code} ${style.name}, ${pieces} pieces${
          extras ? ` (with ${extras})` : ""
        }`,
      },
    });
    const created = await tx.readyStockPurchase.create({
      data: {
        companyId,
        number,
        supplierId: seller.id,
        billId: bill.id,
        styleId: style.id,
        warehouseId: warehouse.id,
        purchaseDate,
        supplierRef: input.supplierRef,
        retailOnly: input.retailOnly,
        priceMode: input.priceMode,
        fixedPrice: input.priceMode === "FIXED" ? input.fixedPrice : null,
        extraCost: extra,
        extraCosts: input.extraCosts.length
          ? (input.extraCosts as unknown as Prisma.InputJsonArray)
          : undefined,
        pieces,
        totalAmount: total,
        note: input.note,
        createdById: ctx.user.id,
        lines: { create: lines.map((l) => ({ companyId, ...l })) },
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
      const variant = byId.get(l.variantId)!;
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
          note: `Bought ready: ${number} from ${seller.name}`,
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
      description: `Bill ${bill.number} — ${seller.name}${
        input.supplierRef ? ` (${input.supplierRef})` : ""
      }: ready stock ${number} into ${warehouse.name}`,
      sourceType: "SUPPLIER_BILL",
      sourceId: bill.id,
      postedById: ctx.user.id,
      lines: [
        ...lines.map((l, i) => ({
          accountId: acc.INVENTORY,
          debit: values[i]!,
          memo: `${byId.get(l.variantId)!.sku} × ${l.quantity}`,
        })),
        {
          accountId: acc.PAYABLE,
          partyId: seller.id,
          credit: total,
          memo: input.supplierRef ?? undefined,
        },
      ],
    });
    await tx.supplierBill.update({ where: { id: bill.id }, data: { journalEntryId: entry.id } });
    // Paid now: one payment voucher against this bill, from the account chosen.
    let voucher: string | null = null;
    if (paidNow.gt(0) && paidFromId && input.payment.mode !== "DUE") {
      const payment = await tx.payment.create({
        data: {
          companyId,
          number: await nextDocumentNumber(tx, companyId, "PAYMENT_VOUCHER"),
          direction: "PAID",
          method: input.payment.method,
          partyId: seller.id,
          supplierBillId: bill.id,
          amount: paidNow,
          paymentDate: purchaseDate,
          accountId: paidFromId,
          reference: input.payment.reference,
          notes: `Ready stock ${number}`,
        },
      });
      const paid = await postJournalEntry(tx, {
        companyId,
        date: purchaseDate,
        description: `Payment ${payment.number} to ${seller.name} for bill ${bill.number} (ready stock ${number})`,
        sourceType: "PAYMENT",
        sourceId: payment.id,
        postedById: ctx.user.id,
        lines: [
          { accountId: acc.PAYABLE, partyId: seller.id, debit: paidNow, memo: bill.number },
          { accountId: paidFromId, credit: paidNow, memo: input.payment.reference ?? undefined },
        ],
      });
      await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: paid.id } });
      voucher = payment.number;
    }
    if (input.retailOnly) await holdForShopsTx(tx, ctx, style.id, lines, byId);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ReadyStockPurchase",
        entityId: created.id,
        summary: `Ready stock ${number} (bill ${bill.number}) from ${seller.name}${
          seller.oneTime ? " (one-time supplier)" : ""
        }: ${style.code} × ${pieces} into ${warehouse.name}, ${total.toFixed(2)}${
          extras ? ` with ${extras}` : ""
        }; ${voucher ? `paid ${paidNow.toFixed(2)} (${voucher})` : "due"}${
          input.retailOnly ? ", retail only" : ""
        }`,
      },
      tx,
    );
    // The payment, or an advance already paid to the supplier, settles the bill.
    await settleSupplierBills(tx, companyId, seller.id);
    await recordPartyActivity(seller.id, purchaseDate, tx);
    return { created, style, lines, byId };
  });
  const purchase = result.created;
  const { style, lines } = result;
  const variants = result.byId;

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

type NewSupplierChoice = Exclude<z.infer<typeof supplierChoice>, { mode: "PICK" }>;

/** A supplier added from the form: a regular one, or a one-time one (Other suppliers). */
async function newSupplierTx(
  tx: Prisma.TransactionClient,
  ctx: CompanyContext,
  choice: NewSupplierChoice,
) {
  const oneTime = choice.mode === "RANDOM";
  const name =
    choice.name ??
    `Random supplier ${new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: ctx.company.timezone,
    })}`;
  const party = await tx.party.create({
    data: {
      companyId: ctx.company.id,
      code: await nextPartyCode(tx, ctx.company.id, "SUPPLIER"),
      kind: "SUPPLIER",
      name,
      phone: choice.phone,
      address: choice.address,
      oneTime,
      notes: oneTime ? "One-time supplier, added while buying ready stock." : null,
    },
    select: { id: true, name: true, oneTime: true },
  });
  await auditInCompany(
    ctx,
    undefined,
    {
      action: "CREATE",
      entityType: "Party",
      entityId: party.id,
      summary: `Created ${oneTime ? "one-time supplier" : "supplier"} "${party.name}" from Buy ready stock`,
    },
    tx,
  );
  return party;
}

/**
 * The style's SKU of each colour and size bought: an existing one, one taken
 * off the matrix earlier (brought back), or a new one. Adding or bringing back
 * a SKU needs the right to manage products.
 */
async function skusForTx(
  tx: Prisma.TransactionClient,
  ctx: CompanyContext,
  style: { id: string; code: string },
  cells: Array<{ colorId: string; sizeId: string }>,
  colorName: Map<string, string>,
  sizeName: Map<string, string>,
) {
  const existing = await tx.productVariant.findMany({
    where: { styleId: style.id },
    select: { id: true, sku: true, colorId: true, sizeId: true, removedAt: true },
  });
  const byCell = new Map(existing.map((v) => [`${v.colorId}:${v.sizeId}`, v]));
  const back = cells.flatMap((c) => {
    const v = byCell.get(`${c.colorId}:${c.sizeId}`);
    return v?.removedAt ? [v.id] : [];
  });
  const missing = cells.filter((c) => !byCell.has(`${c.colorId}:${c.sizeId}`));
  if ((back.length || missing.length) && !ctx.can("inventory.manage")) {
    throw new AppError(
      "FORBIDDEN",
      "A colour or size is not on this style yet: adding it needs the right to manage products.",
      { lines: ["Use the style's own colours and sizes"] },
    );
  }
  if (back.length) {
    await tx.productVariant.updateMany({
      where: { id: { in: back } },
      data: { removedAt: null, isActive: true },
    });
  }
  if (missing.length) {
    // Two colours can shorten to the same code ("Navy Blue" / "Navy Blush"): add a suffix.
    const taken = new Set(
      (
        await tx.productVariant.findMany({
          where: { companyId: ctx.company.id, sku: { startsWith: `${style.code}-` } },
          select: { sku: true },
        })
      ).map((v) => v.sku),
    );
    await tx.productVariant.createMany({
      data: missing.map((c) => {
        const base = buildSku(style.code, colorName.get(c.colorId)!, sizeName.get(c.sizeId)!);
        let sku = base;
        for (let i = 2; taken.has(sku); i++) sku = `${base}-${i}`;
        taken.add(sku);
        return {
          companyId: ctx.company.id,
          styleId: style.id,
          colorId: c.colorId,
          sizeId: c.sizeId,
          sku,
        };
      }),
    });
  }
  const variants = await tx.productVariant.findMany({
    where: { styleId: style.id, removedAt: null },
    select: { id: true, sku: true, colorId: true, sizeId: true },
  });
  return new Map(variants.map((v) => [`${v.colorId}:${v.sizeId}`, v]));
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
  const buying = ctx.can("retail.purchases");
  const canPay = buying && ctx.can("accounts.payments.record");
  const canAddStyle = buying && ctx.can("inventory.manage");
  const [reserves, purchases, styles, suppliers, warehouses, colours, sizes, categories, accounts] =
    await Promise.all([
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
        where: { isActive: true },
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
              sizeId: true,
              color: { select: { name: true } },
              size: { select: { name: true } },
            },
            orderBy: [{ color: { sortOrder: "asc" } }, { size: { sortOrder: "asc" } }],
          },
        },
        orderBy: { code: "asc" },
        take: 300,
      }),
      buying
        ? ctx.db.party.findMany({
            // One-time suppliers stay under Other suppliers, out of this list.
            where: {
              kind: { in: ["SUPPLIER", "BOTH"] },
              oneTime: false,
              status: { not: "CLOSED" },
            },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      ctx.db.warehouse.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      buying
        ? ctx.db.color.findMany({
            select: { id: true, name: true, hexCode: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          })
        : Promise.resolve([]),
      buying
        ? ctx.db.size.findMany({
            select: { id: true, name: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          })
        : Promise.resolve([]),
      canAddStyle
        ? ctx.db.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      canPay ? listMoneyAccounts(ctx) : Promise.resolve([]),
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
    canBuy: buying,
    canPay,
    canAddStyle,
    canAddSupplier: buying && ctx.can("parties.manage"),
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
        colorId: v.colorId,
        sizeId: v.sizeId,
        colour: v.color.name,
        size: v.size.name,
      })),
    })),
    suppliers,
    warehouses,
    colours,
    sizes,
    categories,
    accounts,
  };
}

export type ShopStockPage = Awaited<ReturnType<typeof shopStockPage>>;
