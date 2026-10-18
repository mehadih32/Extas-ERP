import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { getJournalEntryScreen } from "@/modules/accounts/screens.service";
import { buildDocument } from "@/modules/documents/builders";
import type { Block } from "@/modules/documents/model";
import * as printing from "@/modules/documents/print.service";
import { printRequestSchema } from "@/modules/documents/schemas";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import { applyCredit, creditPosition } from "@/modules/sales/credit.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as returnScreens from "@/modules/sales/return-screens.service";
import * as returns from "@/modules/sales/return.service";
import * as screens from "@/modules/sales/screens.service";

import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company with a polo style (Navy / White x S M L XL, wholesale 900), 10 pcs of
 * each SKU at cost 500, a wholesale buyer, a Sales Executive and an Accounts user.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const admin = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(admin.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(admin.id, company.id);
  const seller = await makeUser(`sales@${company.slug}.test`);
  await addToCompany(seller.id, company.id, roles.SALES_EXECUTIVE);
  const salesCtx = await contextFor(seller.id, company.id);
  const accountant = await makeUser(`accounts@${company.slug}.test`);
  await addToCompany(accountant.id, company.id, roles.ACCOUNTS);
  const accountsCtx = await contextFor(accountant.id, company.id);

  const sizes = [];
  for (const name of ["S", "M", "L", "XL"]) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { color: true, size: true },
  });
  const sku = (color: string, size: string) =>
    variants.find((v) => v.color.name === color && v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(ctx, { variantId: v.id, quantity: 10, type: "OPENING", unitCost: 500 });
  }
  const buyer = (
    await parties.createParty(ctx, {
      kind: "BUYER",
      name: "Rahim Traders",
      phone: "01711223344",
      paymentTermsDays: 30,
    })
  ).party;
  return { ctx, salesCtx, accountsCtx, company, style, sku, buyer };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/** Navy S/M/L/XL = 2/4/4/2 at 900 (10,800), invoiced, with the charges given. */
const navyOrder = (env: Env, extra: Record<string, unknown> = {}) =>
  orders.createOrder(env.ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    matrix: [
      {
        styleId: env.style.id,
        quantities: {
          [env.sku("Navy", "S")]: 2,
          [env.sku("Navy", "M")]: 4,
          [env.sku("Navy", "L")]: 4,
          [env.sku("Navy", "XL")]: 2,
        },
      },
    ],
    ...extra,
  });

/** The order's invoice line for a SKU. */
async function lineOf(orderId: string, variantId: string) {
  return prisma.salesOrderItem.findFirstOrThrow({
    where: { orderId, variantId },
    select: { id: true },
  });
}

const cell = async (env: Env, variantId: string) =>
  (await stock.stockByVariant(env.ctx, [variantId])).get(variantId)!;

/** Debit less credit on a ledger account. */
async function accountNet(accountId: string) {
  const agg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });
  return new Prisma.Decimal(agg._sum.debit ?? 0).minus(agg._sum.credit ?? 0).toFixed(2);
}

async function expectBooksBalanced(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT je.number FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${companyId}
    GROUP BY je.id HAVING SUM(jl.debit) <> SUM(jl.credit)`;
  expect(rows).toEqual([]);
}

const creditOf = async (env: Env) =>
  (await creditPosition(prisma, env.company.id, env.buyer.id)).credit.toFixed(2);

/** A day in company time, `days` from today. */
const dayFrom = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Dhaka",
  });

const tables = (blocks: Block[]) =>
  blocks.filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");
const totalsOf = (blocks: Block[]) =>
  blocks.find((b): b is Extract<Block, { kind: "totals" }> => b.kind === "totals")!;

run("sales returns (credit notes)", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-sales-return-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("credits the prices billed with their discount and VAT share, moving the pieces to the rejects", async () => {
    const env = await setup();
    // 10,800 less 800 discount, plus 200 delivery and 500 VAT: 10,700.
    const order = await navyOrder(env, { discount: 800, shippingCharge: 200, tax: 500 });
    const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
    expect(invoice.total.toFixed(2)).toBe("10700.00");
    await documents.createDeliveryChallan(env.ctx, order.id);
    const navyM = env.sku("Navy", "M");
    expect(await cell(env, navyM)).toMatchObject({ aGrade: 6, available: 6 });
    const acc = await ensureControlAccounts(env.company.id);
    const before = {
      sales: await accountNet(acc.SALES),
      vat: await accountNet(acc.VAT_PAYABLE),
      cogs: await accountNet(acc.COGS),
      loss: await accountNet(acc.INVENTORY_LOSS),
      inventory: await accountNet(acc.INVENTORY),
    };
    expect(await creditOf(env)).toBe("0.00");

    // Sales Executives never put money on a buyer's account.
    const denied = await expectAppError(
      returns.createSalesReturn(env.salesCtx, {
        invoiceId: invoice.id,
        items: [{ orderItemId: (await lineOf(order.id, navyM)).id, quantity: 2 }],
        reason: "Size problem",
      }),
      "FORBIDDEN",
    );
    expect(denied.message).toBe(
      "Only Accounts can record a sales return: its value goes onto the buyer's account.",
    );

    const ret = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: (await lineOf(order.id, navyM)).id, quantity: 2 }],
      reason: "Size problem",
      notes: "Two came back in the wrong size",
    });
    expect(ret.number).toMatch(/^CN-\d{4}-00001$/);
    // 2 × 900 = 1,800; discount 800 × 1,800 / 10,800 = 133.33;
    // VAT 500 × 1,666.67 / 10,000 = 83.33; credit 1,800 − 133.33 + 83.33 = 1,750.
    expect({
      goods: ret.goodsValue.toFixed(2),
      discount: ret.discount.toFixed(2),
      tax: ret.tax.toFixed(2),
      amount: ret.amount.toFixed(2),
      cost: ret.costValue?.toFixed(2),
      status: ret.status,
      partyId: ret.partyId,
      invoice: ret.invoice?.number,
    }).toEqual({
      goods: "1800.00",
      discount: "133.33",
      tax: "83.33",
      amount: "1750.00",
      cost: "1000.00",
      status: "COMPLETED",
      partyId: env.buyer.id,
      invoice: invoice.number,
    });
    expect(
      ret.items.map((i) => ({
        sku: i.variant.sku,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toFixed(2),
        amount: i.amount.toFixed(2),
        unitCost: i.unitCost?.toFixed(2),
        rejects: i.badStockEntry?.lossValue?.toFixed(2),
      })),
    ).toEqual([
      {
        sku: "EX-PL-001-NAVY-M",
        quantity: 2,
        unitPrice: "900.00",
        amount: "1800.00",
        unitCost: "500.00",
        rejects: "1000.00",
      },
    ]);

    // The pieces came back and went to Damage & QC Rejects: sellable stock is as it was.
    expect(await cell(env, navyM)).toMatchObject({ aGrade: 6, available: 6 });
    const rejects = await stock.listBadStock(env.ctx);
    expect(rejects.items).toHaveLength(1);
    expect(rejects.items[0]).toMatchObject({ quantity: 2, source: "RETURN_QC" });
    expect(rejects.items[0]!.reason).toBe(
      `Sales return ${ret.number} (${invoice.number}): Size problem`,
    );
    const movements = await prisma.stockMovement.findMany({
      where: { variantId: navyM, type: { in: ["RETURN_RESTOCK", "BAD_STOCK_OUT"] } },
      select: { type: true, quantity: true, unitCost: true },
      orderBy: { createdAt: "asc" },
    });
    expect(movements.map((m) => [m.type, m.quantity, m.unitCost?.toFixed(2)])).toEqual([
      ["RETURN_RESTOCK", 2, "500.00"],
      ["BAD_STOCK_OUT", -2, "500.00"],
    ]);

    // Books: Dr Sales 1,666.67, Dr VAT 83.33, Cr Receivable 1,750; Dr Loss 1,000, Cr COGS 1,000.
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "RETURN", sourceId: ret.id },
      include: { lines: true },
    });
    expect(entry.id).toBe(ret.journalEntryId);
    const lines = entry.lines.map((l) => [l.accountId, l.debit.toFixed(2), l.credit.toFixed(2)]);
    expect(lines).toEqual(
      expect.arrayContaining([
        [acc.SALES, "1666.67", "0.00"],
        [acc.VAT_PAYABLE, "83.33", "0.00"],
        [acc.RECEIVABLE, "0.00", "1750.00"],
        [acc.INVENTORY_LOSS, "1000.00", "0.00"],
        [acc.COGS, "0.00", "1000.00"],
      ]),
    );
    expect(lines).toHaveLength(5);
    expect(entry.lines.find((l) => l.accountId === acc.RECEIVABLE)?.partyId).toBe(env.buyer.id);
    expect(await accountNet(acc.SALES)).toBe(
      new Prisma.Decimal(before.sales).plus("1666.67").toFixed(2),
    );
    expect(await accountNet(acc.VAT_PAYABLE)).toBe(
      new Prisma.Decimal(before.vat).plus("83.33").toFixed(2),
    );
    expect(await accountNet(acc.COGS)).toBe(new Prisma.Decimal(before.cogs).minus(1000).toFixed(2));
    expect(await accountNet(acc.INVENTORY_LOSS)).toBe(
      new Prisma.Decimal(before.loss).plus(1000).toFixed(2),
    );
    expect(await accountNet(acc.INVENTORY)).toBe(before.inventory);
    await expectBooksBalanced(env.company.id);
    const journal = await getJournalEntryScreen(env.ctx, entry.id);
    expect(journal.source).toEqual({
      title: `Sales return ${ret.number}`,
      href: `/sales/returns/${ret.id}`,
    });

    // The value is the buyer's credit; the invoice itself still shows its due.
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("8950.00");
    expect(await creditOf(env)).toBe("1750.00");
    const current = await orders.getOrder(env.ctx, order.id);
    expect(current.status).toBe("PARTIALLY_RETURNED");
    expect(current.invoice?.dueAmount.toFixed(2)).toBe("10700.00");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "SalesReturn", entityId: ret.id, action: "CREATE" },
    });
    expect(audit.summary).toBe(
      `Sales return ${ret.number} on ${invoice.number}: 2 pcs to Damage & QC Rejects, 1750.00 credited to Rahim Traders — Size problem`,
    );

    // While it stands, the invoice cannot be voided nor the order cancelled.
    const voidRefused = await expectAppError(
      orders.voidOrCancelInvoice(env.ctx, invoice.id, {
        reason: "Wrong buyer",
        cancelOrder: false,
      }),
      "CONFLICT",
    );
    expect(voidRefused.message).toBe(
      "Goods on this invoice came back on a sales return. Void the return first to void the invoice.",
    );
    await expectAppError(
      orders.voidOrCancelInvoice(env.ctx, invoice.id, { reason: "Wrong buyer", cancelOrder: true }),
      "CONFLICT",
    );
    expect((await orders.getOrder(env.ctx, order.id)).status).toBe("PARTIALLY_RETURNED");

    // The credit note prints the lines, the shares and the credit.
    const { model, record } = await buildDocument(
      env.ctx,
      printRequestSchema.parse({ type: "SALES_RETURN", id: ret.id }),
      new Date(),
    );
    expect(record).toMatchObject({
      title: `Credit note ${ret.number}`,
      referenceType: "SalesReturn",
      referenceId: ret.id,
      partyId: env.buyer.id,
    });
    expect(model.title).toBe("Credit Note");
    expect(model.meta.map((m) => m.label)).toEqual([
      "Credit note no.",
      "Date",
      "Invoice no.",
      "Invoice date",
      "Order no.",
    ]);
    expect(tables(model.blocks)[0]!.rows.map((r) => r.cells)).toEqual([
      ["1", "Classic Polo – Navy – M", "2", "900.00", "1,800.00"],
    ]);
    expect(totalsOf(model.blocks).rows.map((r) => [r.label, r.value])).toEqual([
      ["Goods returned", "1,800.00"],
      ["Less their discount", "-133.33"],
      ["VAT / tax", "83.33"],
      ["Credited (BDT)", "1,750.00"],
    ]);
    const printed = await printing.printDocument(env.salesCtx, {
      type: "SALES_RETURN",
      id: ret.id,
    });
    const text = pdfLines((await printing.downloadDocument(env.salesCtx, printed.id)).bytes).join(
      "\n",
    );
    expect(text).toContain("CREDIT NOTE");
    expect(text).toContain("INVOICE NO.\n" + invoice.number);
    expect(text).toContain(ret.number);
    expect(text).toContain("Size problem");
    expect(printing.SHORT_KEPT_TYPES).toContain("SALES_RETURN");

    // Accounts uses the credit on the invoice; once used, the return can no longer be voided.
    await applyCredit(env.accountsCtx, order.id, { amount: 1750 });
    expect(await creditOf(env)).toBe("0.00");
    expect((await orders.getOrder(env.ctx, order.id)).invoice?.dueAmount.toFixed(2)).toBe(
      "8950.00",
    );
    const used = await expectAppError(
      returns.voidSalesReturn(env.accountsCtx, ret.id, { reason: "Entered by mistake" }),
      "CONFLICT",
    );
    expect(used.message).toBe(
      `The buyer has used the credit from ${ret.number}: only 0.00 of its 1750.00 is still unused on their account, so it can no longer be voided.`,
    );
    const screen = await returnScreens.getSalesReturnScreen(env.accountsCtx, ret.id);
    expect(screen.can.void).toBe(false);
    expect(screen.notes.void).toBe(
      "The buyer has used this credit (0.00 of 1750.00 is unused), so it can no longer be voided.",
    );
  });

  it("brings everything back over two returns that add up to the invoice, and voids one", async () => {
    const env = await setup();
    // 10,800 less 1,000 discount plus 333.33 VAT: 10,133.33.
    const order = await navyOrder(env, { discount: 1000, tax: 333.33 });
    const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
    await documents.createDeliveryChallan(env.ctx, order.id);
    const line = async (size: string) => (await lineOf(order.id, env.sku("Navy", size))).id;

    const first = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [
        { orderItemId: await line("S"), quantity: 1 },
        { orderItemId: await line("M"), quantity: 2 },
        { orderItemId: await line("M"), quantity: 1 }, // the same line twice adds up
      ],
      reason: "Quality fault",
      returnDate: dayFrom(0),
    });
    // 900 + 2,700 = 3,600; discount 1,000 × 3,600 / 10,800 = 333.33;
    // VAT 333.33 × 3,266.67 / 9,800 = 111.11; credit 3,377.78.
    expect(first.items.map((i) => [i.variant.sku, i.quantity, i.amount.toFixed(2)])).toEqual([
      ["EX-PL-001-NAVY-S", 1, "900.00"],
      ["EX-PL-001-NAVY-M", 3, "2700.00"],
    ]);
    expect([first.discount, first.tax, first.amount].map((d) => d.toFixed(2))).toEqual([
      "333.33",
      "111.11",
      "3377.78",
    ]);

    // The rest: the last return takes what is left of the discount and the VAT.
    const second = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [
        { orderItemId: await line("S"), quantity: 1 },
        { orderItemId: await line("M"), quantity: 1 },
        { orderItemId: await line("L"), quantity: 4 },
        { orderItemId: await line("XL"), quantity: 2 },
      ],
      reason: "Buyer closed the shop",
    });
    expect(
      [second.goodsValue, second.discount, second.tax, second.amount].map((d) => d.toFixed(2)),
    ).toEqual(["7200.00", "666.67", "222.22", "6755.55"]);
    expect(first.amount.plus(second.amount).toFixed(2)).toBe(invoice.total.toFixed(2));
    expect((await orders.getOrder(env.ctx, order.id)).status).toBe("RETURNED");
    expect(await creditOf(env)).toBe("10133.33");
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("0.00");

    const none = await expectAppError(
      returns.createSalesReturn(env.accountsCtx, {
        invoiceId: invoice.id,
        items: [{ orderItemId: await line("S"), quantity: 1 }],
        reason: "Again",
      }),
      "CONFLICT",
    );
    expect(none.message).toBe(`Every piece delivered on ${invoice.number} has already come back.`);

    // Voiding the second puts everything back as it was before it.
    const rejectsBefore = (await stock.listBadStock(env.ctx)).items.length;
    expect(rejectsBefore).toBe(6);
    const voided = await returns.voidSalesReturn(env.accountsCtx, second.id, {
      reason: "Recorded on the wrong invoice",
    });
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidReason).toBe("Recorded on the wrong invoice");
    expect((await stock.listBadStock(env.ctx)).items).toHaveLength(2);
    // Nothing is deleted: its movements stay next to their opposites, netting to nothing,
    // and its rejects lines stay marked void.
    const secondMoves = await prisma.stockMovement.findMany({
      where: { referenceType: "SalesReturn", referenceId: second.id },
    });
    expect(secondMoves).toHaveLength(8);
    expect(secondMoves.reduce((sum, m) => sum + m.quantity, 0)).toBe(0);
    expect(
      await prisma.badStockEntry.count({
        where: { salesReturnItem: { returnId: second.id }, voidedAt: { not: null } },
      }),
    ).toBe(4);
    expect(await creditOf(env)).toBe("3377.78");
    expect((await orders.getOrder(env.ctx, order.id)).status).toBe("PARTIALLY_RETURNED");
    for (const size of ["S", "M", "L", "XL"]) {
      const delivered = { S: 2, M: 4, L: 4, XL: 2 }[size]!;
      expect(await cell(env, env.sku("Navy", size)), size).toMatchObject({
        aGrade: 10 - delivered,
      });
    }
    await expectBooksBalanced(env.company.id);
    const again = await expectAppError(
      returns.voidSalesReturn(env.accountsCtx, second.id, { reason: "Twice by mistake" }),
      "CONFLICT",
    );
    expect(again.message).toBe(`${second.number} is already void.`);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "SalesReturn", entityId: second.id, action: "STATUS_CHANGE" },
    });
    expect(audit.summary).toBe(
      `Voided sales return ${second.number} (6755.55 credit, 4 rejects line(s) marked void): Recorded on the wrong invoice`,
    );

    // The voided pieces can come back again, priced from what is left.
    const third = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: await line("XL"), quantity: 2 }],
      reason: "Stitching fault",
    });
    expect(third.number).toMatch(/-00003$/);
    // 1,800 less 166.67 discount plus 55.55 VAT (333.33 × 1,633.33 / 9,800).
    expect(third.amount.toFixed(2)).toBe("1688.88");

    // With every return void, the order is delivered again and its invoice can be voided.
    await returns.voidSalesReturn(env.accountsCtx, first.id, { reason: "Entered by mistake" });
    await returns.voidSalesReturn(env.accountsCtx, third.id, { reason: "Entered by mistake" });
    expect((await orders.getOrder(env.ctx, order.id)).status).toBe("DELIVERED");
    expect(await creditOf(env)).toBe("0.00");
    expect((await stock.listBadStock(env.ctx)).items).toHaveLength(0);
    await orders.voidOrCancelInvoice(env.ctx, invoice.id, {
      reason: "Raised on the wrong buyer",
      cancelOrder: false,
    });
    const afterVoid = await expectAppError(
      returns.createSalesReturn(env.accountsCtx, {
        invoiceId: invoice.id,
        items: [{ orderItemId: await line("S"), quantity: 1 }],
        reason: "Late return",
      }),
      "CONFLICT",
    );
    expect(afterVoid.message).toBe(`Invoice ${invoice.number} is void.`);
    await expectBooksBalanced(env.company.id);
  });

  it("voids a return whose credit paid an earlier balance, but not one whose credit was spent", async () => {
    const env = await setup();
    await ledger.setOpeningBalance(env.ctx, env.buyer.id, { amount: 3000 });
    const order = await navyOrder(env);
    const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
    await documents.createDeliveryChallan(env.ctx, order.id);
    const navyL = (await lineOf(order.id, env.sku("Navy", "L"))).id;

    // 1,800 back goes against the 3,000 owed from before: no credit is left to use.
    const paidOff = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: navyL, quantity: 2 }],
      reason: "Wrong colour",
    });
    expect(paidOff.amount.toFixed(2)).toBe("1800.00");
    expect(await creditOf(env)).toBe("0.00");
    const screen = await returnScreens.getSalesReturnScreen(env.accountsCtx, paidOff.id);
    expect(screen.buyerCredit).toBe("0.00");
    expect(screen.earlierBalance).toBe("1200.00");
    expect(screen.can.void).toBe(true);
    expect(screen.notes).toEqual({
      void: null,
      credit:
        "Credit first pays what the buyer owed from before outside their invoices, such as an opening balance. Only what is left of it can be used on invoices.",
    });
    // Voiding it puts the earlier balance back.
    await returns.voidSalesReturn(env.accountsCtx, paidOff.id, { reason: "Counted twice" });
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("13800.00");

    // 3,600 back pays the 3,000 and leaves 600; once 500 of it is used, voiding is refused.
    const spent = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: navyL, quantity: 4 }],
      reason: "Wrong colour",
    });
    expect(await creditOf(env)).toBe("600.00");
    const before = await returnScreens.getSalesReturnScreen(env.accountsCtx, spent.id);
    expect(before.earlierBalance).toBeNull();
    expect(before.can.void).toBe(true);
    await applyCredit(env.accountsCtx, order.id, { amount: 500 });
    const refused = await expectAppError(
      returns.voidSalesReturn(env.accountsCtx, spent.id, { reason: "Entered by mistake" }),
      "CONFLICT",
    );
    expect(refused.message).toBe(
      `The buyer has used the credit from ${spent.number}: only 100.00 of its 3600.00 is still unused on their account, so it can no longer be voided.`,
    );
    const after = await returnScreens.getSalesReturnScreen(env.accountsCtx, spent.id);
    expect(after.can.void).toBe(false);
    expect(after.notes.credit).toBeNull();
    await expectBooksBalanced(env.company.id);
  });

  it("refuses pieces that were not delivered, walk-in sales and days out of range", async () => {
    const env = await setup();
    const order = await navyOrder(env);
    const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
    const navyM = (await lineOf(order.id, env.sku("Navy", "M"))).id;
    const navyS = (await lineOf(order.id, env.sku("Navy", "S"))).id;
    const input = (items: Array<{ orderItemId: string; quantity: number }>, more = {}) => ({
      invoiceId: invoice.id,
      items,
      reason: "Size problem",
      ...more,
    });

    const nothing = await expectAppError(
      returns.createSalesReturn(env.accountsCtx, input([{ orderItemId: navyM, quantity: 1 }])),
      "CONFLICT",
    );
    expect(nothing.message).toBe(
      `Nothing on ${invoice.number} has been delivered yet, so nothing can come back.`,
    );
    expect(await returnScreens.findReturnableInvoices(env.accountsCtx, "")).toEqual([]);

    await documents.createDeliveryChallan(env.ctx, order.id, {
      items: [{ variantId: env.sku("Navy", "M"), quantity: 3 }],
    });
    const tooMany = await expectAppError(
      returns.createSalesReturn(env.accountsCtx, input([{ orderItemId: navyM, quantity: 4 }])),
      "VALIDATION",
    );
    expect(tooMany.message).toBe("Only 3 delivered pcs of EX-PL-001-NAVY-M can come back.");
    expect(tooMany.details).toEqual({ "items.0.quantity": ["At most 3"] });
    const notSent = await expectAppError(
      returns.createSalesReturn(
        env.accountsCtx,
        input([
          { orderItemId: navyM, quantity: 1 },
          { orderItemId: navyS, quantity: 1 },
        ]),
      ),
      "VALIDATION",
    );
    expect(notSent.message).toBe("No delivered pieces of EX-PL-001-NAVY-S are left to come back.");
    expect(notSent.details).toEqual({ "items.1.quantity": ["At most 0"] });

    const other = await navyOrder(env, { documents: { invoice: false } });
    const stranger = await expectAppError(
      returns.createSalesReturn(
        env.accountsCtx,
        input([{ orderItemId: (await lineOf(other.id, env.sku("Navy", "M"))).id, quantity: 1 }]),
      ),
      "VALIDATION",
    );
    expect(stranger.message).toBe(`Line 1 is not on ${invoice.number}.`);

    const tomorrow = await expectAppError(
      returns.createSalesReturn(
        env.accountsCtx,
        input([{ orderItemId: navyM, quantity: 1 }], { returnDate: dayFrom(1) }),
      ),
      "VALIDATION",
    );
    expect(tomorrow.message).toBe("The goods cannot come back on a later day than today.");
    const early = await expectAppError(
      returns.createSalesReturn(
        env.accountsCtx,
        input([{ orderItemId: navyM, quantity: 1 }], { returnDate: dayFrom(-2) }),
      ),
      "VALIDATION",
    );
    expect(early.message).toBe(
      `The goods cannot come back before invoice ${invoice.number} was issued.`,
    );
    expect(await prisma.salesReturn.count()).toBe(0);

    // Part delivered, part returned: the rest still goes out, and the order stays "Part returned".
    await returns.createSalesReturn(env.accountsCtx, input([{ orderItemId: navyM, quantity: 2 }]));
    expect((await orders.getOrder(env.ctx, order.id)).status).toBe("PARTIALLY_RETURNED");
    await documents.createDeliveryChallan(env.ctx, order.id);
    const delivered = await orders.getOrder(env.ctx, order.id);
    expect(delivered.status).toBe("PARTIALLY_RETURNED");
    const form = await returnScreens.getSalesReturnForm(env.accountsCtx, invoice.id);
    expect(form.blocked).toBeNull();
    expect(form.lines.map((l) => [l.sku, l.delivered, l.returned, l.returnable])).toEqual([
      ["EX-PL-001-NAVY-S", 2, 0, 2],
      ["EX-PL-001-NAVY-M", 4, 2, 2],
      ["EX-PL-001-NAVY-L", 4, 0, 4],
      ["EX-PL-001-NAVY-XL", 2, 0, 2],
    ]);

    // A walk-in sale has no account to keep the credit on.
    const counter = await orders.createOrder(env.ctx, {
      channel: "POS",
      customerName: "Walk-in Karim",
      lines: [{ variantId: env.sku("White", "L"), quantity: 1, unitPrice: 1450 }],
      documents: { invoice: true, deliveryChallan: true },
    });
    const counterInvoice = (await orders.getOrder(env.ctx, counter.id)).invoice!;
    const walkIn = await expectAppError(
      returns.createSalesReturn(env.accountsCtx, {
        invoiceId: counterInvoice.id,
        items: [{ orderItemId: (await lineOf(counter.id, env.sku("White", "L"))).id, quantity: 1 }],
        reason: "Changed mind",
      }),
      "CONFLICT",
    );
    expect(walkIn.message).toBe(
      "A walk-in sale has no buyer account to keep the credit on, so it takes no sales return.",
    );
    const walkInForm = await returnScreens.getSalesReturnForm(env.accountsCtx, counterInvoice.id);
    expect(walkInForm.blocked).toBe(walkIn.message);
    expect(
      (await returnScreens.findReturnableInvoices(env.accountsCtx, "")).map((i) => i.number),
    ).toEqual([invoice.number]);
    await expectAppError(returnScreens.getSalesReturnForm(env.salesCtx, invoice.id), "FORBIDDEN");
    await expectAppError(returnScreens.findReturnableInvoices(env.salesCtx, ""), "FORBIDDEN");
  });

  it("shows returns on the invoice, the order and the Returns list to the right people", async () => {
    const env = await setup();
    const order = await navyOrder(env, { discount: 800 });
    const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
    await documents.createDeliveryChallan(env.ctx, order.id);

    // Before any return: Accounts may make one; Sales may not.
    expect((await screens.getInvoiceScreen(env.accountsCtx, invoice.id)).can.makeReturn).toBe(true);
    expect((await screens.getInvoiceScreen(env.salesCtx, invoice.id)).can.makeReturn).toBe(false);
    expect((await screens.getOrderScreen(env.accountsCtx, order.id)).can.makeReturn).toBe(true);
    expect((await screens.getInvoiceScreen(env.ctx, invoice.id)).can.void).toBe(true);

    const ret = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: (await lineOf(order.id, env.sku("Navy", "L"))).id, quantity: 1 }],
      reason: "Stained",
    });
    // 900 less its discount share 66.67: 833.33.
    expect(ret.amount.toFixed(2)).toBe("833.33");

    const owner = await screens.getInvoiceScreen(env.ctx, invoice.id);
    expect(owner.invoice.returns).toEqual([
      {
        id: ret.id,
        number: ret.number,
        returnedOn: expect.any(String),
        pieces: 1,
        amount: "833.33",
        voided: false,
      },
    ]);
    expect(owner.can.void).toBe(false);
    expect(owner.notes.void).toBe(
      "Goods on this invoice came back on a sales return. Void the return first to void the invoice.",
    );
    expect(owner.can.makeReturn).toBe(true);
    const orderScreen = await screens.getOrderScreen(env.ctx, order.id);
    expect(orderScreen.order.returns.map((r) => r.number)).toEqual([ret.number]);
    expect(orderScreen.can.voidInvoice).toBe(false);
    expect(orderScreen.can.cancel).toBe(false);
    // 10,000 sold after discount, 833.33 back, cost 6,000 (12 pcs at 500) stays in.
    expect(orderScreen.costs).toMatchObject({
      netSales: "10000.00",
      returned: "833.33",
      cost: "6000.00",
      margin: "3166.67",
    });
    expect((await screens.getOrderScreen(env.salesCtx, order.id)).costs).toBeNull();

    // The credit note's screen: costs and voiding only for the right people.
    const accounts = await returnScreens.getSalesReturnScreen(env.accountsCtx, ret.id);
    expect(accounts.salesReturn).toMatchObject({
      number: ret.number,
      pieces: 1,
      goods: "900.00",
      discount: "66.67",
      tax: "0.00",
      total: "833.33",
      reason: "Stained",
      voided: null,
      invoice: { id: invoice.id, number: invoice.number, due: "10000.00" },
      order: { id: order.id, number: order.number, status: "PARTIALLY_RETURNED" },
    });
    expect(accounts.salesReturn.lines).toEqual([
      {
        key: expect.any(String),
        sku: "EX-PL-001-NAVY-L",
        style: "Classic Polo",
        color: "Navy",
        size: "L",
        quantity: 1,
        unitPrice: "900.00",
        amount: "900.00",
      },
    ]);
    expect(accounts.buyerCredit).toBe("833.33");
    expect(accounts.can).toEqual({ void: true, openBuyer: true, useCredit: true });
    expect(accounts.salesReturn.cost).toBe("500.00");
    const seller = await returnScreens.getSalesReturnScreen(env.salesCtx, ret.id);
    expect(seller.can.void).toBe(false);
    expect(seller.can.useCredit).toBe(false);
    expect(seller.salesReturn.cost).toBeNull();

    // The Returns list: search by credit note, invoice or buyer, and by day.
    const list = await returnScreens.getSalesReturnList(env.salesCtx);
    expect(list.canRecord).toBe(false);
    expect((await returnScreens.getSalesReturnList(env.accountsCtx)).canRecord).toBe(true);
    expect(list.items).toEqual([
      {
        id: ret.id,
        number: ret.number,
        returnedOn: expect.any(String),
        amount: "833.33",
        pieces: 1,
        reason: "Stained",
        voided: false,
        buyer: { id: env.buyer.id, code: env.buyer.code, name: "Rahim Traders" },
        invoice: { id: invoice.id, number: invoice.number },
        order: { id: order.id, number: order.number },
      },
    ]);
    for (const search of [ret.number, invoice.number, "rahim", env.buyer.code]) {
      expect(
        (await returnScreens.listSalesReturnRows(env.ctx, { search })).items,
        search,
      ).toHaveLength(1);
    }
    expect((await returnScreens.listSalesReturnRows(env.ctx, { search: "nobody" })).items).toEqual(
      [],
    );
    expect((await returnScreens.listSalesReturnRows(env.ctx, { from: dayFrom(1) })).items).toEqual(
      [],
    );
    expect(
      (await returnScreens.listSalesReturnRows(env.ctx, { from: dayFrom(0), to: dayFrom(0) }))
        .items,
    ).toHaveLength(1);

    // Voided, it shows as void everywhere and the invoice can be voided again.
    await returns.voidSalesReturn(env.accountsCtx, ret.id, { reason: "Entered by mistake" });
    const after = await returnScreens.getSalesReturnScreen(env.accountsCtx, ret.id);
    expect(after.salesReturn.voided).toEqual({
      on: expect.any(String),
      reason: "Entered by mistake",
    });
    expect(after.can.void).toBe(false);
    expect((await screens.getInvoiceScreen(env.ctx, invoice.id)).invoice.returns[0]!.voided).toBe(
      true,
    );
    expect((await screens.getInvoiceScreen(env.ctx, invoice.id)).can.void).toBe(true);
    expect((await screens.getOrderScreen(env.ctx, order.id)).costs?.returned).toBeNull();
    const { model } = await buildDocument(
      env.ctx,
      printRequestSchema.parse({ type: "SALES_RETURN", id: ret.id }),
      new Date(),
    );
    expect(model.stamp).toEqual({ text: "Void", tone: "danger" });
  });
});
