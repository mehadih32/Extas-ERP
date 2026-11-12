import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { setPin } from "@/modules/ai/settings.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import { creditPosition } from "@/modules/sales/credit.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as returns from "@/modules/sales/return.service";
import * as wr from "@/modules/sales/wholesale-return.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company with a polo style (Navy / White x S M L XL, wholesale 900; White M
 * at 1,100 and White S at 700), 10 pcs of each SKU at cost 500, a wholesale
 * buyer, the owner, a Sales Executive, Accounts and the warehouse (QC).
 */
async function setup(name = "Extras") {
  const { company, roles } = await makeCompany(name);
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await member("SUPER_ADMIN", "owner");
  const salesCtx = await member("SALES_EXECUTIVE", "sales");
  const accountsCtx = await member("ACCOUNTS", "accounts");
  const warehouseCtx = await member("WAREHOUSE_TEAM", "store");

  const sizes = [];
  for (const size of ["S", "M", "L", "XL"])
    sizes.push(await catalog.createSize(ctx, { name: size }));
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
  await prisma.productVariant.update({
    where: { id: sku("White", "M") },
    data: { wholesalePrice: 1100 },
  });
  await prisma.productVariant.update({
    where: { id: sku("White", "S") },
    data: { wholesalePrice: 700 },
  });
  const buyer = (
    await parties.createParty(ctx, {
      kind: "BUYER",
      name: "Mamun Traders",
      phone: "01711223344",
      paymentTermsDays: 30,
    })
  ).party;
  // Navy S/M/L/XL = 2/4/4/2 at 900 (10,800), invoiced and delivered.
  const order = await orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: buyer.id,
    matrix: [
      {
        styleId: style.id,
        quantities: {
          [sku("Navy", "S")]: 2,
          [sku("Navy", "M")]: 4,
          [sku("Navy", "L")]: 4,
          [sku("Navy", "XL")]: 2,
        },
      },
    ],
  });
  await documents.createDeliveryChallan(ctx, order.id);
  const invoice = (await orders.getOrder(ctx, order.id)).invoice!;
  const line = async (color: string, size: string) =>
    (
      await prisma.salesOrderItem.findFirstOrThrow({
        where: { orderId: order.id, variantId: sku(color, size) },
        select: { id: true },
      })
    ).id;
  return {
    company,
    ctx,
    salesCtx,
    accountsCtx,
    warehouseCtx,
    sku,
    buyer,
    order,
    invoice,
    line,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function appError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const cell = async (env: Env, color: string, size: string) =>
  (await stock.stockByVariant(env.ctx, [env.sku(color, size)])).get(env.sku(color, size))!;

const creditOf = async (env: Env) =>
  (await creditPosition(prisma, env.company.id, env.buyer.id)).credit.toFixed(2);

async function expectBooksBalanced(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT je.number FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${companyId}
    GROUP BY je.id HAVING SUM(jl.debit) <> SUM(jl.credit)`;
  expect(rows).toEqual([]);
}

async function accountNet(accountId: string) {
  const agg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });
  return new Prisma.Decimal(agg._sum.debit ?? 0).minus(agg._sum.credit ?? 0).toFixed(2);
}

run("wholesale returns: receive, approve, QC and exchange (2026-11-12)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("receives, approves and checks a return with a refund line and an exchange line", async () => {
    const env = await setup();
    const acc = await ensureControlAccounts(env.company.id);
    // An old return, recorded at once as a credit note: it must stay exactly as it is.
    const old = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: env.invoice.id,
      items: [{ orderItemId: await env.line("Navy", "XL"), quantity: 1 }],
      reason: "Old way",
    });
    const oldBefore = await prisma.salesReturn.findUniqueOrThrow({
      where: { id: old.id },
      include: { items: true },
    });

    // Refused: a SKU not sold on the invoice, more than delivered less returned, a "Size only"
    // exchange to another colour, and someone without the right.
    const whiteLine = await prisma.salesOrderItem.findFirst({
      where: { orderId: env.order.id, variantId: env.sku("White", "M") },
    });
    expect(whiteLine).toBeNull();
    await appError(
      wr.receiveWholesaleReturn(env.salesCtx, {
        invoiceId: env.invoice.id,
        reason: "Unsold",
        lines: [{ orderItemId: "not-a-line", quantity: 1, mode: "REFUND" }],
      }),
      "VALIDATION",
    );
    const tooMany = await appError(
      wr.receiveWholesaleReturn(env.salesCtx, {
        invoiceId: env.invoice.id,
        reason: "Unsold",
        lines: [{ orderItemId: await env.line("Navy", "XL"), quantity: 2, mode: "REFUND" }],
      }),
      "VALIDATION",
    );
    expect(tooMany.message).toContain("Only 1 pcs");
    await appError(
      wr.receiveWholesaleReturn(env.salesCtx, {
        invoiceId: env.invoice.id,
        reason: "Wrong size",
        lines: [
          {
            orderItemId: await env.line("Navy", "L"),
            quantity: 2,
            mode: "EXCHANGE",
            exchange: { kind: "SIZE", variantId: env.sku("White", "L"), quantity: 2 },
          },
        ],
      }),
      "VALIDATION",
    );
    await appError(
      wr.receiveWholesaleReturn(env.warehouseCtx, {
        invoiceId: env.invoice.id,
        reason: "Unsold",
        lines: [{ orderItemId: await env.line("Navy", "M"), quantity: 1, mode: "REFUND" }],
      }),
      "FORBIDDEN",
    );

    // The live price difference: 2 White M at 1,100 for 2 Navy L at 900 = +400.
    const quote = await wr.exchangeQuote(env.salesCtx, {
      invoiceId: env.invoice.id,
      orderItemId: await env.line("Navy", "L"),
      quantity: 2,
      variantId: env.sku("White", "M"),
      newQuantity: 2,
    });
    expect(quote).toMatchObject({
      unitPrice: "1100.00",
      newTotal: "2200.00",
      credit: "1800.00",
      difference: "400.00",
    });

    const navyMBefore = await cell(env, "Navy", "M");
    const received = await wr.receiveWholesaleReturn(env.salesCtx, {
      invoiceId: env.invoice.id,
      reason: "Did not sell",
      lines: [
        { orderItemId: await env.line("Navy", "M"), quantity: 4, mode: "REFUND" },
        {
          orderItemId: await env.line("Navy", "L"),
          quantity: 2,
          mode: "EXCHANGE",
          exchange: { kind: "OTHER", variantId: env.sku("White", "M"), quantity: 2 },
        },
      ],
    });
    expect(received.number).toMatch(/^WR-/);
    expect(received.status).toBe("RECEIVED");
    expect(received.figures).toMatchObject({ received: 6, refunded: 0, exchanged: 2, a: null });
    expect(received.lines[1]).toMatchObject({ priceDifference: "400.00", newQuantity: 2 });
    expect(received.daysSinceSale).toBe(0);
    // Returns to check: not sellable yet, so the stock does not change.
    expect(await cell(env, "Navy", "M")).toEqual(navyMBefore);
    // The exchange's new pieces left at once on their own invoice and challan.
    expect(received.exchange?.challans.length).toBe(1);
    expect(received.exchange?.total).toBe("2200.00");
    expect((await cell(env, "White", "M")).aGrade).toBe(8);
    // The same pieces cannot come back twice.
    await appError(
      wr.receiveWholesaleReturn(env.salesCtx, {
        invoiceId: env.invoice.id,
        reason: "Again",
        lines: [{ orderItemId: await env.line("Navy", "M"), quantity: 1, mode: "REFUND" }],
      }),
      "VALIDATION",
    );
    // Nor by the old way.
    await appError(
      returns.createSalesReturn(env.accountsCtx, {
        invoiceId: env.invoice.id,
        items: [{ orderItemId: await env.line("Navy", "M"), quantity: 1 }],
        reason: "Again",
      }),
      "VALIDATION",
    );
    expect(
      (await prisma.salesOrder.findUniqueOrThrow({ where: { id: env.order.id } })).status,
    ).toBe("PARTIALLY_RETURNED");

    // Approve: Sales cannot; Accounts approves all 6 pieces: 5,400 credit (under 10,000, no PIN).
    await appError(wr.approveWholesaleReturn(env.salesCtx, received.id, {}), "FORBIDDEN");
    const approved = await wr.approveWholesaleReturn(env.accountsCtx, received.id, {});
    expect(approved.status).toBe("APPROVED");
    expect(approved.creditNote?.amount).toBe("5400.00");
    expect(approved.figures.refunded).toBe(6);
    // The exchange's invoice is paid from the credit; the buyer keeps 5,400 - 2,200 + 0.
    const exchange = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: approved.exchange!.orderId },
    });
    expect(exchange.dueAmount.toFixed(2)).toBe("0.00");
    // Unused credit: the old credit note (900) plus 5,400 less 2,200 used on the exchange.
    expect(await creditOf(env)).toBe("4100.00");
    const position = await creditPosition(prisma, env.company.id, env.buyer.id);
    // 10,800 billed + 2,200 exchange - 900 old credit - 5,400 credit = 6,700 owed.
    expect(position.balance.toFixed(2)).toBe("6700.00");
    await appError(wr.approveWholesaleReturn(env.accountsCtx, received.id, {}), "CONFLICT");

    // QC: Accounts cannot; the warehouse must split every piece; the split must add up.
    const lines = approved.lines;
    await appError(
      wr.checkWholesaleReturn(env.accountsCtx, received.id, {
        lines: lines.map((l) => ({ lineId: l.id, a: l.quantity, b: 0, reject: 0 })),
      }),
      "FORBIDDEN",
    );
    const wrong = await appError(
      wr.checkWholesaleReturn(env.warehouseCtx, received.id, {
        lines: [
          { lineId: lines[0]!.id, a: 1, b: 1, reject: 1 },
          { lineId: lines[1]!.id, a: 2, b: 0, reject: 0 },
        ],
      }),
      "VALIDATION",
    );
    expect(wrong.message).toContain("must add up to the 4 pcs received");
    const cogsBefore = await accountNet(acc.COGS);
    const checked = await wr.checkWholesaleReturn(env.warehouseCtx, received.id, {
      lines: [
        { lineId: lines[0]!.id, a: 1, b: 1, reject: 2 },
        { lineId: lines[1]!.id, a: 2, b: 0, reject: 0 },
      ],
    });
    expect(checked.status).toBe("DONE");
    expect(checked.figures).toMatchObject({ received: 6, refunded: 6, a: 3, b: 1, reject: 2 });
    expect(await cell(env, "Navy", "M")).toMatchObject({
      aGrade: navyMBefore.aGrade + 1,
      bGrade: navyMBefore.bGrade + 1,
    });
    const rejects = await prisma.badStockEntry.findMany({
      where: { companyId: env.company.id, reason: { contains: received.number } },
    });
    expect(rejects.map((r) => r.quantity)).toEqual([2]);
    // 6 pcs at cost 500 back from Cost of Goods Sold.
    expect(new Prisma.Decimal(cogsBefore).minus(await accountNet(acc.COGS)).toFixed(2)).toBe(
      "3000.00",
    );
    await expectBooksBalanced(env.company.id);

    // The old return is untouched.
    expect(
      await prisma.salesReturn.findUniqueOrThrow({
        where: { id: old.id },
        include: { items: true },
      }),
    ).toEqual(oldBefore);

    // The list: status, figures and the month's report by buyer.
    const list = await wr.listWholesaleReturns(env.ctx, { status: "DONE" });
    expect(list.items.map((i) => i.number)).toEqual([received.number]);
    expect(list.month).toMatchObject({ returns: 1, received: 6, refunded: 6, exchanged: 2 });
    expect(list.month.buyers[0]).toMatchObject({ name: "Mamun Traders", pieces: 6 });
    expect((await wr.listWholesaleReturns(env.ctx, { status: "RECEIVED" })).items).toEqual([]);
    // Every step is in the audit log.
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "WholesaleReturn", entityId: received.id },
      select: { action: true },
    });
    expect(audit.map((a) => a.action).sort()).toEqual(["CREATE", "STATUS_CHANGE", "UPDATE"]);
  });

  it("asks the PIN above the set amount, needs a reason for fewer pieces, and credits a cheaper exchange", async () => {
    const env = await setup();
    await setPin(env.ctx, { pin: "2468" });
    // Only the owner changes the amount, with the PIN.
    await appError(
      wr.setWholesaleReturnSettings(env.accountsCtx, { pinAbove: 1000, pin: "2468" }),
      "FORBIDDEN",
    );
    await expect(wr.setWholesaleReturnSettings(env.ctx, { pinAbove: 1000 })).rejects.toThrow();
    await wr.setWholesaleReturnSettings(env.ctx, { pinAbove: 1000, pin: "2468" });

    const ret = await wr.receiveWholesaleReturn(env.salesCtx, {
      invoiceId: env.invoice.id,
      reason: "Wrong size",
      lines: [
        { orderItemId: await env.line("Navy", "M"), quantity: 4, mode: "REFUND" },
        {
          orderItemId: await env.line("Navy", "L"),
          quantity: 2,
          mode: "EXCHANGE",
          exchange: { kind: "OTHER", variantId: env.sku("White", "S"), quantity: 2 },
        },
      ],
    });
    // 2 White S at 700 for 2 Navy L at 900: the buyer gets 400 back as credit.
    expect(ret.lines[1]!.priceDifference).toBe("-400.00");
    const [m, l] = ret.lines;
    // Fewer pieces than came back needs a reason.
    await appError(
      wr.approveWholesaleReturn(env.accountsCtx, ret.id, {
        lines: [{ lineId: m!.id, refunded: 3 }],
      }),
      "VALIDATION",
    );
    // 3 + 2 pieces = 4,500, over 1,000: the PIN is needed.
    await expect(
      wr.approveWholesaleReturn(env.accountsCtx, ret.id, {
        lines: [{ lineId: m!.id, refunded: 3 }],
        reason: "One was worn",
      }),
    ).rejects.toThrow(/PIN/);
    await expect(
      wr.approveWholesaleReturn(env.accountsCtx, ret.id, {
        lines: [{ lineId: m!.id, refunded: 3 }],
        reason: "One was worn",
        pin: "1111",
      }),
    ).rejects.toThrow();
    expect((await wr.getWholesaleReturn(env.ctx, ret.id)).status).toBe("RECEIVED");
    const approved = await wr.approveWholesaleReturn(env.accountsCtx, ret.id, {
      lines: [
        { lineId: m!.id, refunded: 3 },
        { lineId: l!.id, refunded: 2 },
      ],
      reason: "One was worn",
      pin: "2468",
    });
    expect(approved.creditNote?.amount).toBe("4500.00");
    expect(approved.approveNote).toBe("One was worn");
    expect(approved.figures).toMatchObject({ received: 6, refunded: 5 });
    // The exchange invoice (1,400) is paid from the credit; 3,100 stays as credit on the account
    // against the original invoice.
    const exchange = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: approved.exchange!.orderId },
    });
    expect(exchange.total.toFixed(2)).toBe("1400.00");
    expect(exchange.dueAmount.toFixed(2)).toBe("0.00");
    const position = await creditPosition(prisma, env.company.id, env.buyer.id);
    // 10,800 + 1,400 - 4,500 = 7,700 owed.
    expect(position.balance.toFixed(2)).toBe("7700.00");
    // The unrefunded piece still came back: it cannot come back again.
    await appError(
      returns.createSalesReturn(env.accountsCtx, {
        invoiceId: env.invoice.id,
        items: [{ orderItemId: await env.line("Navy", "M"), quantity: 1 }],
        reason: "Again",
      }),
      "VALIDATION",
    );

    // A mistake is put right by voiding the credit note: the approval is undone, nothing deleted.
    await returns.voidSalesReturn(env.accountsCtx, approved.creditNote!.id, {
      reason: "Approved the wrong count",
    });
    const undone = await wr.getWholesaleReturn(env.ctx, ret.id);
    expect(undone.status).toBe("RECEIVED");
    expect(undone.creditNote).toBeNull();
    expect(
      (await prisma.salesOrder.findUniqueOrThrow({ where: { id: exchange.id } })).dueAmount.toFixed(
        2,
      ),
    ).toBe("1400.00");
    expect(await prisma.salesReturn.count({ where: { id: approved.creditNote!.id } })).toBe(1);
    // Approved again, all six: 5,400.
    const again = await wr.approveWholesaleReturn(env.accountsCtx, ret.id, { pin: "2468" });
    expect(again.creditNote?.amount).toBe("5400.00");
    await expectBooksBalanced(env.company.id);
  });

  it("holds the invoice while a return waits, and takes no approval or QC on a void sale", async () => {
    const env = await setup();
    const ret = await wr.receiveWholesaleReturn(env.salesCtx, {
      invoiceId: env.invoice.id,
      reason: "Did not sell",
      lines: [{ orderItemId: await env.line("Navy", "M"), quantity: 2, mode: "REFUND" }],
    });
    // The invoice cannot be voided while the return waits for approval.
    const held = await appError(
      documents.voidInvoice(env.ctx, env.invoice.id, { reason: "Wrong buyer" }),
      "CONFLICT",
    );
    expect(held.message).toMatch(/wholesale return/);
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: env.invoice.id } })).status,
    ).not.toBe("VOID");

    // Should the sale be undone anyway, the return takes no approval and no QC: no second credit.
    await prisma.invoice.update({ where: { id: env.invoice.id }, data: { status: "VOID" } });
    await appError(wr.approveWholesaleReturn(env.accountsCtx, ret.id, {}), "CONFLICT");
    const qc = { lines: [{ lineId: ret.lines[0]!.id, a: 2, b: 0, reject: 0 }] };
    await appError(wr.checkWholesaleReturn(env.warehouseCtx, ret.id, qc), "CONFLICT");
    await prisma.invoice.update({ where: { id: env.invoice.id }, data: { status: "UNPAID" } });
    await prisma.salesOrder.update({ where: { id: env.order.id }, data: { status: "CANCELLED" } });
    await appError(wr.approveWholesaleReturn(env.accountsCtx, ret.id, {}), "CONFLICT");
    await appError(wr.checkWholesaleReturn(env.warehouseCtx, ret.id, qc), "CONFLICT");
    expect(await prisma.salesReturn.count({ where: { invoiceId: env.invoice.id } })).toBe(0);
  });

  it("counts the invoice's earlier credit notes toward the PIN amount", async () => {
    const env = await setup();
    await setPin(env.ctx, { pin: "2468" });
    await wr.setWholesaleReturnSettings(env.ctx, { pinAbove: 1500, pin: "2468" });
    const receive = async () =>
      wr.receiveWholesaleReturn(env.salesCtx, {
        invoiceId: env.invoice.id,
        reason: "Did not sell",
        lines: [{ orderItemId: await env.line("Navy", "M"), quantity: 1, mode: "REFUND" }],
      });
    // 900 alone is under 1,500: no PIN.
    const first = await wr.approveWholesaleReturn(env.accountsCtx, (await receive()).id, {});
    expect(first.creditNote?.amount).toBe("900.00");
    // The second 900 brings the invoice to 1,800: the PIN is needed, though this part is small.
    const second = await receive();
    await expect(wr.approveWholesaleReturn(env.accountsCtx, second.id, {})).rejects.toThrow(/PIN/);
    const approved = await wr.approveWholesaleReturn(env.accountsCtx, second.id, { pin: "2468" });
    expect(approved.creditNote?.amount).toBe("900.00");
  });

  it("lets only those who also record money received approve (the money rule)", async () => {
    const env = await setup();
    const ret = await wr.receiveWholesaleReturn(env.salesCtx, {
      invoiceId: env.invoice.id,
      reason: "Did not sell",
      lines: [{ orderItemId: await env.line("Navy", "M"), quantity: 1, mode: "REFUND" }],
    });
    // The store is given the approval permission, but not "Record money received".
    const store = await prisma.companyMembership.findFirstOrThrow({
      where: { companyId: env.company.id, userId: env.warehouseCtx.user.id },
      select: { roleId: true },
    });
    const approve = await prisma.permission.findUniqueOrThrow({
      where: { key: "sales.returns.approve" },
    });
    await prisma.rolePermission.create({
      data: { roleId: store.roleId, permissionId: approve.id },
    });
    const storeCtx = await contextFor(env.warehouseCtx.user.id, env.company.id);
    expect(storeCtx.can("sales.returns.approve")).toBe(true);
    expect(wr.wholesaleReturnAccess(storeCtx).approve).toBe(false);
    await appError(wr.approveWholesaleReturn(storeCtx, ret.id, {}), "FORBIDDEN");
    expect(wr.wholesaleReturnAccess(env.accountsCtx).approve).toBe(true);
  });

  it("keeps a company's returns to itself", async () => {
    const env = await setup("Extras");
    const other = await setup("Other Co");
    const ret = await wr.receiveWholesaleReturn(env.salesCtx, {
      invoiceId: env.invoice.id,
      reason: "Did not sell",
      lines: [{ orderItemId: await env.line("Navy", "M"), quantity: 1, mode: "REFUND" }],
    });
    await appError(wr.getWholesaleReturn(other.ctx, ret.id), "NOT_FOUND");
    await appError(wr.approveWholesaleReturn(other.accountsCtx, ret.id, {}), "NOT_FOUND");
    await appError(
      wr.checkWholesaleReturn(other.warehouseCtx, ret.id, {
        lines: [{ lineId: ret.lines[0]!.id, a: 1, b: 0, reject: 0 }],
      }),
      "NOT_FOUND",
    );
    await appError(
      wr.receiveWholesaleReturn(other.salesCtx, {
        invoiceId: env.invoice.id,
        reason: "Not theirs",
        lines: [{ orderItemId: await env.line("Navy", "S"), quantity: 1, mode: "REFUND" }],
      }),
      "NOT_FOUND",
    );
    expect((await wr.listWholesaleReturns(other.ctx)).items).toEqual([]);
  });
});
