import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as refunds from "@/modules/sales/refund.service";
import * as summary from "@/modules/sales/summary.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company with a polo style (Navy / White x S M L XL, wholesale 900, retail
 * 1450), 10 pcs of each SKU at cost 500, a wholesale buyer, a Sales Executive and an
 * Accounts user.
 */
async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
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
  return { ctx, salesCtx, accountsCtx, company, style, tops, sku, buyer };
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

const balanceOf = async (env: Env, partyId: string) =>
  (await ledger.getPartyBalance(env.ctx, partyId)).toFixed(2);

/** Debit less credit on a ledger account. */
async function accountNet(accountId: string) {
  const agg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });
  return new Prisma.Decimal(agg._sum.debit ?? 0).minus(agg._sum.credit ?? 0).toFixed(2);
}

/** Navy S/M/L/XL = 2/4/4/2 at 900: 10,800 taka. */
const wholesaleOrder = (env: Env, extra: Record<string, unknown> = {}) =>
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

/** A proforma for 12 polos at 1,000 (12,000 taka) with a 30% advance of 3,600. */
async function proformaFor(env: Env) {
  const quotation = await quotations.createQuotation(env.ctx, {
    partyId: env.buyer.id,
    items: [
      {
        categoryId: env.tops.id,
        styleId: env.style.id,
        description: "Polo pre-order",
        sizeBreakdown: { S: 2, M: 4, L: 4, XL: 2 },
        unitPrice: 1000,
      },
    ],
  });
  const proforma = await proformas.convertQuotationToProforma(env.ctx, quotation.id);
  return { quotation, proforma };
}

/** Every journal entry of the company balances. */
async function expectBooksBalanced(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT je.number FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${companyId}
    GROUP BY je.id HAVING SUM(jl.debit) <> SUM(jl.credit)`;
  expect(rows).toEqual([]);
}

run("buyer refunds", () => {
  beforeEach(resetDb);

  it("pays an advance back off an order, so Sales can cancel it", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env, { documents: { invoice: false } });
    const { payment } = await payments.receivePayment(env.accountsCtx, {
      orderId: order.id,
      amount: 4000,
      method: "BKASH",
    });
    expect(await balanceOf(env, env.buyer.id)).toBe("-4000.00");

    // While the order holds money, Sales can neither cancel it nor settle the money.
    const blocked = await expectAppError(
      orders.cancelOrder(env.salesCtx, order.id, { reason: "Buyer backed out" }),
      "CONFLICT",
    );
    expect(blocked.message).toBe(
      `4000.00 paid on ${order.number} has to be settled first: Accounts can pay it back, keep it as credit on the buyer's account or keep it as a cancellation charge.`,
    );
    await expectAppError(
      orders.cancelOrder(env.salesCtx, order.id, {
        reason: "Buyer backed out",
        settle: { kind: "CASH", method: "BKASH" },
      }),
      "FORBIDDEN",
    );
    const denied = await expectAppError(
      refunds.refundBuyer(env.salesCtx, {
        orderId: order.id,
        kind: "CASH",
        method: "BKASH",
        amount: 4000,
        reason: "Buyer backed out",
      }),
      "FORBIDDEN",
    );
    expect(denied.message).toBe("Only Accounts can pay money back to a buyer.");

    // Accounts pays 3,000 back by bKash...
    await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        orderId: order.id,
        kind: "CASH",
        method: "BKASH",
        amount: 4000.01,
        reason: "Buyer backed out",
      }),
      "VALIDATION",
    );
    const paidBack = await refunds.refundBuyer(env.accountsCtx, {
      orderId: order.id,
      kind: "CASH",
      method: "BKASH",
      amount: 3000,
      reason: "Buyer backed out",
      reference: "TRX-RF-1",
    });
    expect(paidBack.number).toMatch(/^RF-\d{4}-00001$/);
    expect(paidBack).toMatchObject({
      kind: "CASH",
      method: "BKASH",
      reference: "TRX-RF-1",
      partyId: env.buyer.id,
      orderId: order.id,
      proformaId: null,
      voidedAt: null,
    });
    expect(paidBack.accountId).toBe(payment.accountId); // the same bKash wallet
    expect(paidBack.heldBefore?.toFixed(2)).toBe("4000.00");
    expect(paidBack.heldAfter?.toFixed(2)).toBe("1000.00");
    const current = await orders.getOrder(env.ctx, order.id);
    expect(current.paidAmount.toFixed(2)).toBe("1000.00");
    expect(current.dueAmount.toFixed(2)).toBe("9800.00");
    expect(await balanceOf(env, env.buyer.id)).toBe("-1000.00");

    // ...and keeps the last 1,000 as a cancellation charge.
    const kept = await refunds.refundBuyer(env.accountsCtx, {
      orderId: order.id,
      kind: "FORFEIT",
      amount: 1000,
      reason: "Cancellation charge agreed",
    });
    expect(kept).toMatchObject({ kind: "FORFEIT", method: null, accountId: null });
    await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        orderId: order.id,
        kind: "CASH",
        method: "CASH",
        amount: 1,
        reason: "Anything left?",
      }),
      "CONFLICT",
    );
    expect(await balanceOf(env, env.buyer.id)).toBe("0.00");
    const acc = await ensureControlAccounts(env.company.id);
    expect(await accountNet(payment.accountId)).toBe("1000.00"); // 4,000 in, 3,000 out
    expect(await accountNet(acc.OTHER_INCOME)).toBe("-1000.00");

    // Nothing is held any more: Sales cancels the order and its stock is free again.
    const cancelled = await orders.cancelOrder(env.salesCtx, order.id, {
      reason: "Buyer backed out",
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.paidAmount.toFixed(2)).toBe("0.00");
    expect(cancelled.refunds.map((r) => [r.number, r.kind, r.amount.toFixed(2)])).toEqual([
      [paidBack.number, "CASH", "3000.00"],
      [kept.number, "FORFEIT", "1000.00"],
    ]);
    const navyM = await stock.stockByVariant(env.ctx, [env.sku("Navy", "M")]);
    expect(navyM.get(env.sku("Navy", "M"))!.reserved).toBe(0);
    // The refunds of a cancelled order stay as they are.
    await expectAppError(
      refunds.voidRefund(env.accountsCtx, paidBack.id, { reason: "Recorded twice" }),
      "CONFLICT",
    );

    const listed = await refunds.listRefunds(env.ctx, { orderId: order.id });
    expect(listed.items.map((r) => r.number)).toEqual([kept.number, paidBack.number]); // newest first
    expect((await refunds.listRefunds(env.ctx, { kind: "FORFEIT" })).items).toHaveLength(1);
    expect(
      (await refunds.listRefunds(env.ctx, { partyId: env.buyer.id, take: 1 })).nextCursor,
    ).toBeDefined();

    // The day's takings count the money paid back, not the charge kept.
    const today = await summary.getSalesSummary(env.ctx);
    expect(today).toMatchObject({
      collected: "4000.00",
      refunded: "3000.00",
      netCollected: "1000.00",
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Refund", entityId: paidBack.id },
    });
    expect(audit.summary).toBe(
      `Refund ${paidBack.number}: 3000.00 paid back from order ${order.number} — Buyer backed out`,
    );
    await expectBooksBalanced(env.company.id);
  });

  it("cancels an invoiced, paid order in one go and keeps the money as credit", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env);
    await payments.receivePayment(env.accountsCtx, {
      orderId: order.id,
      amount: 2000,
      method: "CASH",
    });

    // Money paid against a live invoice is not refunded on its own...
    const blocked = await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        orderId: order.id,
        kind: "CASH",
        method: "CASH",
        amount: 2000,
        reason: "Buyer wants it back",
      }),
      "CONFLICT",
    );
    expect(blocked.message).toContain(`Void the invoice first`);
    // ...and Accounts may not void the invoice that cancelling voids.
    await expectAppError(
      orders.cancelOrder(env.accountsCtx, order.id, {
        reason: "Buyer cancelled",
        settle: { kind: "CREDIT" },
      }),
      "FORBIDDEN",
    );

    const cancelled = await orders.cancelOrder(env.ctx, order.id, {
      reason: "Buyer cancelled",
      settle: { kind: "CREDIT" },
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.invoice!.status).toBe("VOID");
    expect(cancelled.paidAmount.toFixed(2)).toBe("0.00");
    expect(cancelled.dueAmount.toFixed(2)).toBe("0.00");
    expect(cancelled.refunds.map((r) => [r.kind, r.amount.toFixed(2), r.reason])).toEqual([
      ["CREDIT", "2000.00", "Order cancelled: Buyer cancelled"],
    ]);
    const credit = cancelled.refunds[0]!;
    expect(await balanceOf(env, env.buyer.id)).toBe("-2000.00"); // now credit on account
    expect((await refunds.accountCredit(prisma, env.company.id, env.buyer.id)).toFixed(2)).toBe(
      "2000.00",
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "SalesOrder", entityId: order.id, action: "STATUS_CHANGE" },
    });
    expect(audit.summary).toBe(
      `Cancelled order ${order.number}: Buyer cancelled (2000.00 paid kept as credit on account, ${credit.number})`,
    );

    // The credit can be paid out later, never more than is left.
    await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        partyId: env.buyer.id,
        kind: "CREDIT",
        amount: 100,
        reason: "Keep it",
      }),
      "VALIDATION",
    );
    const tooMuch = await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        partyId: env.buyer.id,
        kind: "CASH",
        method: "CASH",
        amount: 2000.01,
        reason: "Pay it all back",
      }),
      "VALIDATION",
    );
    expect(tooMuch.message).toBe("Rahim Traders has only 2000.00 of credit on account.");
    const payout = await refunds.refundBuyer(env.accountsCtx, {
      partyId: env.buyer.id,
      kind: "CASH",
      method: "CASH",
      amount: 1500,
      reason: "Credit paid back",
    });
    expect(payout).toMatchObject({ orderId: null, proformaId: null, heldBefore: null });
    expect(await balanceOf(env, env.buyer.id)).toBe("-500.00");

    // The credit note stays (its order is cancelled); the payout can be voided, once.
    await expectAppError(
      refunds.voidRefund(env.ctx, credit.id, { reason: "Recorded by mistake" }),
      "CONFLICT",
    );
    await expectAppError(
      refunds.voidRefund(env.salesCtx, payout.id, { reason: "Paid twice by mistake" }),
      "FORBIDDEN",
    );
    const voided = await refunds.voidRefund(env.accountsCtx, payout.id, {
      reason: "Paid twice by mistake",
    });
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidReason).toBe("Paid twice by mistake");
    expect(await balanceOf(env, env.buyer.id)).toBe("-2000.00");
    await expectAppError(
      refunds.voidRefund(env.accountsCtx, payout.id, { reason: "Again please" }),
      "CONFLICT",
    );

    // Suppliers are not refunded here.
    const supplier = (
      await parties.createParty(env.ctx, { kind: "SUPPLIER", name: "Thread House" })
    ).party;
    await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        partyId: supplier.id,
        kind: "CASH",
        method: "CASH",
        amount: 1,
        reason: "Not a buyer",
      }),
      "VALIDATION",
    );
    await expectBooksBalanced(env.company.id);
  });

  it("settles a proforma's advance when it is cancelled, and its production keeps running", async () => {
    const env = await setup();
    const { quotation, proforma: pi } = await proformaFor(env);
    const { productionProject } = await payments.receivePayment(env.accountsCtx, {
      proformaId: pi.id,
      amount: 3600,
      method: "BANK_TRANSFER",
    });
    expect(productionProject).not.toBeNull();

    // Part of the advance paid back: the proforma stays in production.
    const part = await refunds.refundBuyer(env.accountsCtx, {
      proformaId: pi.id,
      kind: "CASH",
      method: "BANK_TRANSFER",
      amount: 600,
      reason: "Fewer pieces agreed",
    });
    expect(part).toMatchObject({ proformaId: pi.id, orderId: null });
    expect(part.heldBefore?.toFixed(2)).toBe("3600.00");
    expect(part.heldAfter?.toFixed(2)).toBe("3000.00");
    let current = await proformas.getProforma(env.ctx, pi.id);
    expect(current.status).toBe("IN_PRODUCTION");
    expect(current.advancePaid.toFixed(2)).toBe("3000.00");
    expect(current.advanceDue.toFixed(2)).toBe("600.00");
    expect(await balanceOf(env, env.buyer.id)).toBe("-3000.00");

    // Cancelling settles the rest, which is Accounts' (or the Super Admin's) call.
    await expectAppError(
      proformas.cancelProforma(env.ctx, pi.id, { reason: "Buyer cancelled" }),
      "CONFLICT",
    );
    await expectAppError(
      proformas.cancelProforma(env.salesCtx, pi.id, {
        reason: "Buyer cancelled",
        settle: { kind: "FORFEIT" },
      }),
      "FORBIDDEN",
    );
    current = await proformas.cancelProforma(env.ctx, pi.id, {
      reason: "Buyer cancelled",
      settle: { kind: "FORFEIT" },
    });
    expect(current.status).toBe("CANCELLED");
    expect(current.advancePaid.toFixed(2)).toBe("0.00");
    expect(current.refunds.map((r) => [r.kind, r.amount.toFixed(2)])).toEqual([
      ["CASH", "600.00"],
      ["FORFEIT", "3000.00"],
    ]);
    expect(current.productionProjects.map((p) => p.status)).toEqual(["ACTIVE"]);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).status).toBe(
      "ACCEPTED",
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ProformaInvoice", entityId: pi.id, action: "STATUS_CHANGE" },
    });
    expect(audit.summary).toBe(
      `Cancelled ${pi.number}: Buyer cancelled (3000.00 advance kept as a cancellation charge, ${current.refunds[1]!.number}); production ${productionProject!.code} keeps running`,
    );
    expect(await balanceOf(env, env.buyer.id)).toBe("0.00");
    const acc = await ensureControlAccounts(env.company.id);
    expect(await accountNet(acc.OTHER_INCOME)).toBe("-3000.00");

    // A cancelled proforma's refunds stay as they are; nothing more can be refunded or paid.
    await expectAppError(
      refunds.voidRefund(env.accountsCtx, part.id, { reason: "Recorded twice" }),
      "CONFLICT",
    );
    await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        proformaId: pi.id,
        kind: "CASH",
        method: "CASH",
        amount: 1,
        reason: "More please",
      }),
      "CONFLICT",
    );
    await expectAppError(
      proformas.cancelProforma(env.ctx, pi.id, { reason: "Again please" }),
      "CONFLICT",
    );
    await expectBooksBalanced(env.company.id);
  });

  it("holds the advance again when a refund is voided, and moves refunds to the order", async () => {
    const env = await setup();
    const { proforma: pi } = await proformaFor(env);
    await payments.receivePayment(env.accountsCtx, {
      proformaId: pi.id,
      amount: 2000,
      method: "CASH",
    });
    const mistake = await refunds.refundBuyer(env.accountsCtx, {
      proformaId: pi.id,
      kind: "CASH",
      method: "CASH",
      amount: 1000,
      reason: "Paid back by mistake",
    });
    // The advance is short again, so the proforma cannot become an order.
    await expectAppError(
      proformas.convertProformaToOrder(env.ctx, pi.id, {
        lines: [{ variantId: env.sku("White", "S"), quantity: 1 }],
      }),
      "CONFLICT",
    );
    const more = await payments.receivePayment(env.accountsCtx, {
      proformaId: pi.id,
      amount: 2000,
      method: "CASH",
    });
    expect(more.productionProject).toBeNull(); // 3,000 of 3,600 held

    // Voiding the refund puts its 1,000 back: the advance is paid and production starts.
    const voided = await refunds.voidRefund(env.accountsCtx, mistake.id, {
      reason: "The buyer never took it",
    });
    expect(voided.voidedAt).not.toBeNull();
    let current = await proformas.getProforma(env.ctx, pi.id);
    expect(current.advancePaid.toFixed(2)).toBe("4000.00");
    expect(current.status).toBe("IN_PRODUCTION");
    expect(current.advancePaidAt).not.toBeNull();
    expect(current.productionProjects).toHaveLength(1);

    // A real refund later: it stays below the 3,600 needed, and production carries on.
    const real = await refunds.refundBuyer(env.accountsCtx, {
      proformaId: pi.id,
      kind: "CASH",
      method: "CASH",
      amount: 400,
      reason: "Overpaid",
    });
    expect(real.heldBefore?.toFixed(2)).toBe("4000.00"); // the voided one does not count
    current = await proformas.getProforma(env.ctx, pi.id);
    expect(current.advancePaid.toFixed(2)).toBe("3600.00");
    expect(current.status).toBe("IN_PRODUCTION");

    // The order takes the payments and the refunds with it.
    const order = await proformas.convertProformaToOrder(env.ctx, pi.id, {
      matrix: [
        {
          styleId: env.style.id,
          unitPrice: 1000,
          quantities: {
            [env.sku("White", "S")]: 2,
            [env.sku("White", "M")]: 4,
            [env.sku("White", "L")]: 4,
            [env.sku("White", "XL")]: 2,
          },
        },
      ],
    });
    expect(order.paidAmount.toFixed(2)).toBe("3600.00");
    expect(order.dueAmount.toFixed(2)).toBe("8400.00");
    expect(order.refunds.map((r) => [r.number, Boolean(r.voidedAt)])).toEqual([
      [mistake.number, true],
      [real.number, false],
    ]);
    await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        proformaId: pi.id,
        kind: "CASH",
        method: "CASH",
        amount: 100,
        reason: "On the proforma",
      }),
      "CONFLICT",
    );
    const onOrder = await refunds.refundBuyer(env.accountsCtx, {
      orderId: order.id,
      kind: "CASH",
      method: "CASH",
      amount: 600,
      reason: "Discount agreed",
    });
    expect(onOrder.heldBefore?.toFixed(2)).toBe("3600.00");
    // The voucher of the moved refund still shows the proforma it was written for.
    expect((await refunds.getRefund(env.ctx, real.id)).proforma?.number).toBe(pi.number);

    // Invoicing applies only what is still held.
    const invoice = await documents.issueInvoice(env.ctx, order.id);
    expect(invoice.paidAmount.toFixed(2)).toBe("3000.00");
    expect(invoice.dueAmount.toFixed(2)).toBe("9000.00");
    expect(await balanceOf(env, env.buyer.id)).toBe("9000.00");
    const printed = await documents.getInvoiceDocument(env.ctx, invoice.id);
    expect(printed.refunds.map((r) => r.number)).toEqual([real.number, onOrder.number]);
    // Once invoiced again, a refund on the order is not voided behind the invoice's back.
    await expectAppError(
      refunds.voidRefund(env.accountsCtx, onOrder.id, { reason: "Changed our mind" }),
      "CONFLICT",
    );
    await expectBooksBalanced(env.company.id);
  });

  it("voids a refund only while the money can go back", async () => {
    const env = await setup();
    // Credit kept on account that the buyer has since used.
    const first = await wholesaleOrder(env, { documents: { invoice: false } });
    await payments.receivePayment(env.accountsCtx, {
      orderId: first.id,
      amount: 2000,
      method: "CASH",
    });
    const credit = await refunds.refundBuyer(env.accountsCtx, {
      orderId: first.id,
      kind: "CREDIT",
      amount: 2000,
      reason: "Move it to the account",
    });
    expect(await balanceOf(env, env.buyer.id)).toBe("-2000.00");
    await wholesaleOrder(env); // invoiced for 10,800: the credit counts against it
    expect(await balanceOf(env, env.buyer.id)).toBe("8800.00");
    const used = await expectAppError(
      refunds.voidRefund(env.accountsCtx, credit.id, { reason: "Keep it on the order" }),
      "CONFLICT",
    );
    expect(used.message).toBe(
      "Only 0.00 of this 2000.00 credit is still on the buyer's account; the rest has been used.",
    );

    // An order paid in full again since its refund.
    const second = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [{ variantId: env.sku("White", "S"), quantity: 5 }],
      documents: { invoice: false },
    });
    await payments.receivePayment(env.accountsCtx, {
      orderId: second.id,
      amount: 4500,
      method: "CASH",
    });
    const back = await refunds.refundBuyer(env.accountsCtx, {
      orderId: second.id,
      kind: "CASH",
      method: "CASH",
      amount: 2000,
      reason: "Wrong amount taken",
    });
    await payments.receivePayment(env.accountsCtx, {
      orderId: second.id,
      amount: 2000,
      method: "CASH",
    });
    await expectAppError(
      refunds.voidRefund(env.accountsCtx, back.id, { reason: "Recorded by mistake" }),
      "CONFLICT",
    );
    expect((await orders.getOrder(env.ctx, second.id)).paidAmount.toFixed(2)).toBe("4500.00");
    await expectBooksBalanced(env.company.id);
  });

  it("does not refund the same money twice at once", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env, { documents: { invoice: false } });
    await payments.receivePayment(env.accountsCtx, {
      orderId: order.id,
      amount: 4000,
      method: "CASH",
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        refunds.refundBuyer(env.accountsCtx, {
          orderId: order.id,
          kind: "CASH",
          method: "CASH",
          amount: 4000,
          reason: "Buyer backed out",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await orders.getOrder(env.ctx, order.id)).paidAmount.toFixed(2)).toBe("0.00");
    expect(await balanceOf(env, env.buyer.id)).toBe("0.00");
  });

  it("pays walk-in customers back but keeps no credit for them", async () => {
    const env = await setup();
    const walkIn = await orders.createOrder(env.ctx, {
      channel: "POS",
      customerName: "Karim Uddin",
      customerPhone: "01900000000",
      lines: [{ variantId: env.sku("White", "M"), quantity: 2 }],
    });
    const { payment } = await payments.receivePayment(env.accountsCtx, {
      orderId: walkIn.id,
      amount: 2900,
      method: "NAGAD",
    });
    const noAccount = await expectAppError(
      orders.cancelOrder(env.ctx, walkIn.id, {
        reason: "Wrong size",
        settle: { kind: "CREDIT" },
      }),
      "VALIDATION",
    );
    expect(noAccount.message).toContain("A walk-in customer has no account");
    // Nothing changed: the invoice is still live and paid.
    expect((await orders.getOrder(env.ctx, walkIn.id)).invoice!.status).toBe("PAID");

    const cancelled = await orders.cancelOrder(env.ctx, walkIn.id, {
      reason: "Wrong size",
      settle: { kind: "CASH", method: "NAGAD", reference: "NGD-RF-9" },
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.refunds.map((r) => [r.kind, r.method, r.amount.toFixed(2)])).toEqual([
      ["CASH", "NAGAD", "2900.00"],
    ]);
    const refund = await refunds.getRefund(env.ctx, cancelled.refunds[0]!.id);
    expect(refund).toMatchObject({ partyId: null, accountId: payment.accountId });
    expect(refund.order?.customerName).toBe("Karim Uddin");
    expect(await accountNet(payment.accountId)).toBe("0.00");
    await expectBooksBalanced(env.company.id);
  });

  it("keeps each company's refunds to itself", async () => {
    const extras = await setup();
    const order = await wholesaleOrder(extras, { documents: { invoice: false } });
    await payments.receivePayment(extras.accountsCtx, {
      orderId: order.id,
      amount: 1000,
      method: "CASH",
    });
    const refund = await refunds.refundBuyer(extras.accountsCtx, {
      orderId: order.id,
      kind: "CASH",
      method: "CASH",
      amount: 500,
      reason: "Half back",
    });
    const other = await setup("Fabric Apparel");
    await expectAppError(
      refunds.refundBuyer(other.ctx, {
        orderId: order.id,
        kind: "CASH",
        method: "CASH",
        amount: 100,
        reason: "Not ours",
      }),
      "NOT_FOUND",
    );
    await expectAppError(
      refunds.refundBuyer(other.ctx, {
        partyId: extras.buyer.id,
        kind: "CASH",
        method: "CASH",
        amount: 100,
        reason: "Not ours",
      }),
      "NOT_FOUND",
    );
    await expectAppError(refunds.getRefund(other.ctx, refund.id), "NOT_FOUND");
    await expectAppError(
      refunds.voidRefund(other.ctx, refund.id, { reason: "Not ours either" }),
      "NOT_FOUND",
    );
    expect((await refunds.listRefunds(other.ctx)).items).toEqual([]);
    expect((await refunds.listRefunds(extras.ctx)).items).toHaveLength(1);
  });
});
