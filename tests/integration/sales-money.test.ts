import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { getFileForDownload } from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as cheques from "@/modules/sales/cheque.service";
import * as credit from "@/modules/sales/credit.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proofs from "@/modules/sales/proof.service";
import * as screens from "@/modules/sales/screens.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Sales overhaul 2: a buyer's dues and credit (advance balance), payments that
 * pay invoices oldest first or as chosen, the previous due on an invoice,
 * cheques (pending, cleared, bounced) and proof photos.
 *
 * A company with one polo (Navy M, wholesale 900, 50 pcs), a buyer, a Super
 * Admin (who places orders and takes money at checkout), a Sales Executive and
 * Accounts.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const admin = await makeUser("admin@extras.test");
  await addToCompany(admin.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(admin.id, company.id);
  const seller = await makeUser("sales@extras.test");
  await addToCompany(seller.id, company.id, roles.SALES_EXECUTIVE);
  const salesCtx = await contextFor(seller.id, company.id);
  const accountant = await makeUser("accounts@extras.test");
  await addToCompany(accountant.id, company.id, roles.ACCOUNTS);
  const accountsCtx = await contextFor(accountant.id, company.id);

  const size = await catalog.createSize(ctx, { name: "M" });
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, { colorIds: [navy.id], sizeIds: [size.id] });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { styleId: style.id } });
  await stock.adjustStock(ctx, {
    variantId: variant.id,
    quantity: 50,
    type: "OPENING",
    unitCost: 500,
  });
  const newBuyer = async (name: string) =>
    (await parties.createParty(ctx, { kind: "BUYER", name, phone: "01711223344" })).party;
  const buyer = await newBuyer("Rahim Traders");
  return { ctx, salesCtx, accountsCtx, company, style, variant, buyer, newBuyer };
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

/** An invoiced wholesale order of `pieces` x 900, placed by the Sales Executive. */
const sell = (env: Env, pieces: number, extra: Record<string, unknown> = {}, ctx = env.salesCtx) =>
  orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: (extra.partyId as string | undefined) ?? env.buyer.id,
    lines: [{ variantId: env.variant.id, quantity: pieces }],
    ...extra,
  });

const position = async (env: Env, partyId = env.buyer.id) => {
  const p = await credit.creditPosition(prisma, env.company.id, partyId);
  return {
    balance: p.balance.toFixed(2),
    openDues: p.openDues.toFixed(2),
    credit: p.credit.toFixed(2),
    previousDue: p.previousDue.toFixed(2),
  };
};

const invoiceOf = (orderId: string) =>
  prisma.invoice.findFirstOrThrow({
    where: { orderId, status: { not: "VOID" } },
    select: {
      id: true,
      status: true,
      paidAmount: true,
      dueAmount: true,
      previousDue: true,
      previousCredit: true,
    },
  });

const due = async (orderId: string) => (await invoiceOf(orderId)).dueAmount.toFixed(2);

const onAccount = (env: Env, amount: number, extra: Record<string, unknown> = {}) =>
  payments.receivePayment(env.accountsCtx, {
    partyId: env.buyer.id,
    amount,
    method: "CASH",
    ...extra,
  });

/** What the buyer's receivable says (debits less credits), straight from the books. */
async function receivable(env: Env, partyId = env.buyer.id) {
  const acc = await ensureControlAccounts(env.company.id);
  const sum = await prisma.journalLine.aggregate({
    where: { accountId: acc.RECEIVABLE, partyId },
    _sum: { debit: true, credit: true },
  });
  return (Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0)).toFixed(2);
}

/** Sales income booked, all buyers (only orders are revenue, never a previous due). */
async function salesIncome(env: Env) {
  const acc = await ensureControlAccounts(env.company.id);
  const sum = await prisma.journalLine.aggregate({
    where: { accountId: acc.SALES },
    _sum: { debit: true, credit: true },
  });
  return (Number(sum._sum.credit ?? 0) - Number(sum._sum.debit ?? 0)).toFixed(2);
}

run("money on a buyer's account", () => {
  beforeEach(resetDb);

  it("pays the oldest dues first and keeps the rest as advance balance", async () => {
    const env = await setup();
    const first = await sell(env, 2); // 1,800
    const second = await sell(env, 1); // 900
    expect(await position(env)).toEqual({
      balance: "2700.00",
      openDues: "2700.00",
      credit: "0.00",
      previousDue: "2700.00",
    });

    const paid = await onAccount(env, 2000, { oldestFirst: true });
    expect(paid.allocated).toEqual([
      { orderId: first.id, number: first.number, amount: "1800.00" },
      { orderId: second.id, number: second.number, amount: "200.00" },
    ]);
    expect(paid.advanceKept).toBe("0.00");
    expect((await invoiceOf(first.id)).status).toBe("PAID");
    expect(await due(second.id)).toBe("700.00");

    const more = await onAccount(env, 1000, { oldestFirst: true });
    expect(more.allocated.map((a) => a.amount)).toEqual(["700.00"]);
    expect(more.advanceKept).toBe("300.00");
    expect(await position(env)).toEqual({
      balance: "-300.00",
      openDues: "0.00",
      credit: "300.00",
      previousDue: "0.00",
    });
    // Allocations post nothing: the books hold the two invoices and the two payments only.
    expect(await receivable(env)).toBe("-300.00");
    const receipt = await payments.getPaymentReceipt(env.salesCtx, more.payment.id);
    expect(receipt.allocations.map((a) => [a.order.number, a.amount.toFixed(2)])).toEqual([
      [second.number, "700.00"],
    ]);
  });

  it("settles an earlier balance owed beyond the invoices before keeping any advance", async () => {
    const env = await setup();
    await ledger.setOpeningBalance(env.ctx, env.buyer.id, { amount: 1000 });
    const order = await sell(env, 1); // 900
    expect(await position(env)).toMatchObject({
      balance: "1900.00",
      openDues: "900.00",
      credit: "0.00",
    });

    const paid = await onAccount(env, 2500, { oldestFirst: true });
    expect(paid.allocated.map((a) => a.amount)).toEqual(["900.00"]);
    // 900 pays the invoice, 1,000 the opening balance, and only 600 is advance balance.
    expect(paid.advanceKept).toBe("600.00");
    expect(paid.payment.advanceKept?.toFixed(2)).toBe("600.00");
    expect(await position(env)).toMatchObject({ balance: "-600.00", credit: "600.00" });
    const receipt = await payments.getPaymentReceipt(env.accountsCtx, paid.payment.id);
    expect(receipt.onAccount).toEqual({
      towardEarlier: expect.anything(),
      kept: expect.anything(),
    });
    expect(receipt.onAccount!.towardEarlier.toFixed(2)).toBe("1000.00");
    const screen = await screens.getPaymentScreen(env.accountsCtx, paid.payment.id);
    expect(screen.payment).toMatchObject({ towardEarlier: "1000.00", advanceKept: "600.00" });

    // Voiding the invoice gives its 900 back as credit, and the receipt says so.
    const invoice = await invoiceOf(order.id);
    await documents.voidInvoice(env.ctx, invoice.id, { reason: "Billed twice" });
    const after = await screens.getPaymentScreen(env.accountsCtx, paid.payment.id);
    expect(after.payment).toMatchObject({ towardEarlier: "1000.00", advanceKept: "1500.00" });
    expect(await position(env)).toMatchObject({ credit: "1500.00" });
  });

  it("pays the invoices chosen, refusing amounts that do not fit", async () => {
    const env = await setup();
    const first = await sell(env, 2);
    const second = await sell(env, 1);

    const paid = await onAccount(env, 1000, {
      allocations: [{ orderId: second.id, amount: 600 }],
    });
    expect(paid.allocated.map((a) => [a.number, a.amount])).toEqual([[second.number, "600.00"]]);
    expect(paid.advanceKept).toBe("400.00");
    expect(await due(first.id)).toBe("1800.00");
    expect(await due(second.id)).toBe("300.00");
    expect((await position(env)).credit).toBe("400.00");

    // More than the money received, more than the invoice owes, or another buyer's order.
    const over = await expectAppError(
      onAccount(env, 500, { allocations: [{ orderId: first.id, amount: 600 }] }),
      "VALIDATION",
    );
    expect(over.details).toMatchObject({ allocations: ["At most 500.00 in all"] });
    const tooMuch = await expectAppError(
      onAccount(env, 1000, { allocations: [{ orderId: second.id, amount: 400 }] }),
      "VALIDATION",
    );
    expect(tooMuch.details).toMatchObject({
      [`allocations.${second.id}`]: ["At most 300.00 is due"],
    });
    const other = await env.newBuyer("Karim Fashion");
    const theirs = await sell(env, 1, { partyId: other.id });
    const notTheirs = await expectAppError(
      onAccount(env, 500, { allocations: [{ orderId: theirs.id, amount: 500 }] }),
      "VALIDATION",
    );
    expect(notTheirs.details).toMatchObject({
      [`allocations.${theirs.id}`]: ["Not an order of this buyer"],
    });
    // Nothing was recorded by the refused tries.
    expect(await prisma.payment.count()).toBe(1);
    // Sales never records money.
    await expectAppError(
      payments.receivePayment(env.salesCtx, {
        partyId: env.buyer.id,
        amount: 100,
        method: "CASH",
        oldestFirst: true,
      }),
      "FORBIDDEN",
    );
  });

  it("keeps money above an invoiced order's due only when asked", async () => {
    const env = await setup();
    const order = await sell(env, 1); // 900
    const refused = await expectAppError(
      payments.receivePayment(env.accountsCtx, { orderId: order.id, amount: 1500, method: "CASH" }),
      "VALIDATION",
    );
    expect(refused.message).toContain("Only 900.00 is due");

    const paid = await payments.receivePayment(env.accountsCtx, {
      orderId: order.id,
      amount: 1500,
      method: "CASH",
      extra: "ADVANCE",
    });
    expect(paid.allocated.map((a) => a.amount)).toEqual(["900.00"]);
    expect(paid.advanceKept).toBe("600.00");
    expect((await invoiceOf(order.id)).status).toBe("PAID");
    expect(paid.payment).toMatchObject({ orderId: null, partyId: env.buyer.id });
    expect((await position(env)).credit).toBe("600.00");

    // Before the invoice the money is an advance on the order: never more than it.
    const notInvoiced = await sell(env, 1, { documents: { invoice: false } });
    await expectAppError(
      payments.receivePayment(env.accountsCtx, {
        orderId: notInvoiced.id,
        amount: 1000,
        method: "CASH",
        extra: "ADVANCE",
      }),
      "VALIDATION",
    );
  });

  it("puts credit against an order, and gives it back when the invoice is voided", async () => {
    const env = await setup();
    await onAccount(env, 500); // nothing due yet: all of it is credit
    const order = await sell(env, 1); // 900
    expect(await position(env)).toMatchObject({ credit: "500.00", balance: "400.00" });

    await expectAppError(credit.applyCredit(env.salesCtx, order.id, { amount: 100 }), "FORBIDDEN");
    const tooMuch = await expectAppError(
      credit.applyCredit(env.accountsCtx, order.id, { amount: 600 }),
      "VALIDATION",
    );
    expect(tooMuch.message).toContain("500.00");

    const used = await credit.applyCredit(env.accountsCtx, order.id, { amount: 300 });
    expect(used).toMatchObject({ orderId: order.id, number: order.number });
    expect(used.creditLeft.toFixed(2)).toBe("200.00");
    expect(await due(order.id)).toBe("600.00");
    expect((await invoiceOf(order.id)).status).toBe("PARTIALLY_PAID");
    // Using credit posts nothing.
    expect(await receivable(env)).toBe("400.00");

    const screen = await screens.getOrderScreen(env.accountsCtx, order.id);
    expect(screen.order.credits.map((c) => c.amount)).toEqual(["300.00"]);
    expect(screen.buyerMoney).toEqual({ previousDue: "400.00", credit: "200.00" });

    const invoice = await invoiceOf(order.id);
    await documents.voidInvoice(env.ctx, invoice.id, { reason: "Wrong price agreed" });
    const allocation = await prisma.creditAllocation.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(allocation.releasedAt).not.toBeNull();
    expect(await position(env)).toMatchObject({ credit: "500.00", openDues: "0.00" });
    const order2 = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(order2.paidAmount.toFixed(2)).toBe("0.00");
  });

  it("refuses credit for a walk-in customer and answers the buyer's dues", async () => {
    const env = await setup();
    const counter = await orders.createOrder(env.salesCtx, {
      channel: "POS",
      lines: [{ variantId: env.variant.id, quantity: 1 }],
    });
    await expectAppError(
      credit.applyCredit(env.accountsCtx, counter.id, { amount: 100 }),
      "VALIDATION",
    );

    const first = await sell(env, 2);
    await sell(env, 1);
    const dues = await credit.getBuyerOpenDues(env.accountsCtx, env.buyer.id);
    expect(dues).toMatchObject({ previousDue: "2700.00", credit: "0.00", openDues: "2700.00" });
    expect(dues.dues.map((d) => [d.orderNumber, d.due])).toEqual([
      [first.number, "1800.00"],
      [expect.any(String), "900.00"],
    ]);
    const walkIn = await prisma.party.findFirstOrThrow({ where: { systemRole: "WALK_IN" } });
    await expectAppError(credit.getBuyerMoney(env.accountsCtx, walkIn.id), "NOT_FOUND");
  });
});

run("checkout with the previous due and credit", () => {
  beforeEach(resetDb);

  it("prints the previous due without counting it as a sale or counting credit twice", async () => {
    const env = await setup();
    const old = await sell(env, 2); // 1,800 due
    await onAccount(env, 500); // kept on account: 500 credit
    expect(await position(env)).toEqual({
      balance: "1300.00",
      openDues: "1800.00",
      credit: "500.00",
      previousDue: "1300.00",
    });

    // 1,800 more; 500 of credit; 3,000 cash: this bill, then the older due, oldest first.
    const order = await sell(
      env,
      2,
      { includePreviousDue: true, useCredit: 500, payment: { amount: 3000, method: "CASH" } },
      env.ctx,
    );
    const invoice = await invoiceOf(order.id);
    expect(invoice.previousDue?.toFixed(2)).toBe("1300.00");
    expect(invoice.previousCredit?.toFixed(2)).toBe("500.00");
    expect(invoice.status).toBe("PAID");
    expect(await due(old.id)).toBe("100.00");
    expect(await receivable(env)).toBe("100.00");
    // Revenue is the two orders, never the previous due.
    expect(await salesIncome(env)).toBe("3600.00");

    // The printed figures: the credit used was taken off the previous due, so it goes back.
    const doc = await documents.getInvoiceDocument(env.salesCtx, invoice.id);
    expect(doc.previous).not.toBeNull();
    const p = doc.previous!;
    expect(p.previousDue.toFixed(2)).toBe("1800.00");
    expect(p.totalPayable.toFixed(2)).toBe("3600.00");
    expect(p.paidTowardPrevious.toFixed(2)).toBe("1700.00");
    expect(p.balanceDue.toFixed(2)).toBe("100.00");
    expect(doc.credits.map((c) => c.amount.toFixed(2))).toEqual(["500.00", "1300.00"]);
  });

  it("issues the invoice later with the previous due, for people who see balances", async () => {
    const env = await setup();
    await sell(env, 1); // 900 due
    const order = await sell(env, 2, { documents: { invoice: false } });
    const issued = await documents.issueInvoice(env.salesCtx, order.id, {
      includePreviousDue: true,
    });
    expect(issued.previousDue?.toFixed(2)).toBe("900.00");
    expect(issued.previousCredit).toBeNull();
    const doc = await documents.getInvoiceDocument(env.salesCtx, issued.id);
    expect(doc.previous!.totalPayable.toFixed(2)).toBe("2700.00");
    expect(doc.previous!.balanceDue.toFixed(2)).toBe("2700.00");

    // Nothing owed before: nothing is printed.
    const fresh = await env.newBuyer("New Buyer");
    const first = await sell(env, 1, { partyId: fresh.id, includePreviousDue: true });
    expect((await invoiceOf(first.id)).previousDue).toBeNull();
  });

  it("refuses the previous due and credit without the invoice, a buyer or the permission", async () => {
    const env = await setup();
    await onAccount(env, 500);
    const noInvoice = await expectAppError(
      sell(env, 1, { includePreviousDue: true, documents: { invoice: false } }),
      "VALIDATION",
    );
    expect(noInvoice.details).toMatchObject({ includePreviousDue: ["Tick Issue the invoice"] });
    await expectAppError(sell(env, 1, { useCredit: 100 }), "FORBIDDEN");
    const tooMuch = await expectAppError(sell(env, 1, { useCredit: 1000 }, env.ctx), "VALIDATION");
    expect(tooMuch.details).toMatchObject({ useCredit: ["At most 900.00"] });
    // A walk-in sale (retail, 1,450) takes no more than its total.
    const walkIn = await expectAppError(
      orders.createOrder(env.ctx, {
        channel: "POS",
        lines: [{ variantId: env.variant.id, quantity: 1 }],
        payment: { amount: 1500, method: "CASH" },
      }),
      "VALIDATION",
    );
    expect(walkIn.message).toContain("more than the order total");
    // Nothing was saved by the refused tries.
    expect(await prisma.salesOrder.count()).toBe(0);
  });

  it("keeps extra money at checkout as advance balance", async () => {
    const env = await setup();
    const order = await sell(env, 1, { payment: { amount: 1000, method: "CASH" } }, env.ctx);
    expect((await invoiceOf(order.id)).status).toBe("PAID");
    expect(await position(env)).toMatchObject({ credit: "100.00", balance: "-100.00" });
    const receipt = await prisma.payment.findFirstOrThrow({});
    expect(receipt).toMatchObject({ orderId: null, invoiceId: (await invoiceOf(order.id)).id });
  });
});

run("cheques", () => {
  beforeEach(resetDb);

  it("posts nothing while pending, records the receipt when cleared", async () => {
    const env = await setup();
    const order = await sell(env, 2); // 1,800
    const entriesBefore = await prisma.journalEntry.count();

    await expectAppError(
      cheques.recordCheque(env.salesCtx, { orderId: order.id, amount: 1800, chequeNo: "100234" }),
      "FORBIDDEN",
    );
    const cheque = await cheques.recordCheque(env.accountsCtx, {
      orderId: order.id,
      amount: 1800,
      chequeNo: "100234",
      bankName: "City Bank",
    });
    expect(cheque.status).toBe("PENDING");
    expect(await due(order.id)).toBe("1800.00");
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.journalEntry.count()).toBe(entriesBefore);

    // Sales sees the cheque; only Accounts may act on it.
    const listed = await screens.listChequeRows(env.salesCtx, { status: "PENDING" });
    expect(listed.canManage).toBe(false);
    expect(listed.items.map((c) => [c.chequeNo, c.amount, c.order?.number])).toEqual([
      ["100234", "1800.00", order.number],
    ]);
    await expectAppError(cheques.clearCheque(env.salesCtx, cheque.id, {}), "FORBIDDEN");

    const today = localDay(new Date(), env.company.timezone);
    await expectAppError(
      cheques.clearCheque(env.accountsCtx, cheque.id, { clearedOn: addDays(today, 1) }),
      "VALIDATION",
    );
    const cleared = await cheques.clearCheque(env.accountsCtx, cheque.id, {});
    expect(cleared.payment).toMatchObject({ method: "CHEQUE", orderId: order.id });
    expect(cleared.payment.reference).toBe("Cheque 100234, City Bank");
    expect((await invoiceOf(order.id)).status).toBe("PAID");
    const after = await prisma.cheque.findUniqueOrThrow({ where: { id: cheque.id } });
    expect(after).toMatchObject({ status: "CLEARED", paymentId: cleared.payment.id });
    // It goes into the bank, not the cash box.
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { id: cleared.payment.accountId },
    });
    expect(bank.subType).toBe("BANK");
    // Once only.
    await expectAppError(cheques.clearCheque(env.accountsCtx, cheque.id, {}), "CONFLICT");
    await expectAppError(
      cheques.bounceCheque(env.accountsCtx, cheque.id, { reason: "Too late" }),
      "CONFLICT",
    );
  });

  it("records nothing for a bounced cheque, and counts it on the dashboard", async () => {
    const env = await setup();
    const order = await sell(env, 1);
    const cheque = await cheques.recordCheque(env.accountsCtx, {
      orderId: order.id,
      amount: 900,
      chequeNo: "55",
    });
    const pending = await screens.getPaymentDashboard(env.salesCtx);
    expect(pending.pendingCheques).toEqual({ count: 1, value: "900.00" });
    expect(pending.pendingDues).toEqual({ count: 1, value: "900.00" });

    const bounced = await cheques.bounceCheque(env.accountsCtx, cheque.id, {
      reason: "Insufficient funds",
    });
    expect(bounced).toMatchObject({ status: "BOUNCED", bounceReason: "Insufficient funds" });
    expect(await prisma.payment.count()).toBe(0);
    expect(await due(order.id)).toBe("900.00");
    const dashboard = await screens.getPaymentDashboard(env.salesCtx);
    expect(dashboard.pendingCheques.count).toBe(0);
    expect(dashboard.bouncedCheques).toEqual({ count: 1, value: "900.00" });
    expect(dashboard.collectedToday.value).toBe("0.00");
  });

  it("clears onto the buyer's account when the order was paid meanwhile", async () => {
    const env = await setup();
    const order = await sell(env, 1); // 900
    const other = await sell(env, 1); // 900
    const cheque = await cheques.recordCheque(env.accountsCtx, {
      orderId: order.id,
      amount: 900,
      chequeNo: "77",
    });
    await payments.receivePayment(env.accountsCtx, {
      orderId: order.id,
      amount: 900,
      method: "CASH",
    });
    const cleared = await cheques.clearCheque(env.accountsCtx, cheque.id, {});
    expect(cleared.payment.orderId).toBeNull();
    expect(cleared.allocated.map((a) => [a.number, a.amount])).toEqual([[other.number, "900.00"]]);
    expect((await position(env)).balance).toBe("0.00");
  });

  it("takes a cheque at checkout as pending", async () => {
    const env = await setup();
    const order = await sell(
      env,
      1,
      { payment: { amount: 900, method: "CHEQUE", cheque: { chequeNo: "9001" } } },
      env.ctx,
    );
    expect(await due(order.id)).toBe("900.00");
    expect(await prisma.payment.count()).toBe(0);
    const cheque = await prisma.cheque.findFirstOrThrow({ where: { orderId: order.id } });
    expect(cheque).toMatchObject({ status: "PENDING", chequeNo: "9001", partyId: env.buyer.id });
    const screen = await screens.getOrderScreen(env.salesCtx, order.id);
    expect(screen.order.cheques.map((c) => [c.chequeNo, c.status])).toEqual([["9001", "PENDING"]]);
    // A cheque never goes above the bill.
    await expectAppError(
      sell(
        env,
        1,
        { payment: { amount: 1000, method: "CHEQUE", cheque: { chequeNo: "9002" } } },
        env.ctx,
      ),
      "VALIDATION",
    );
  });

  it("clears a cheque on account by the split saved with it, cut to what is still due", async () => {
    const env = await setup();
    const first = await sell(env, 1);
    const second = await sell(env, 1);
    const cheque = await cheques.recordCheque(env.accountsCtx, {
      partyId: env.buyer.id,
      amount: 1000,
      chequeNo: "31",
      allocations: [
        { orderId: second.id, amount: 900 },
        { orderId: first.id, amount: 100 },
      ],
    });
    // Meanwhile the second invoice gets 400 in cash.
    await payments.receivePayment(env.accountsCtx, {
      orderId: second.id,
      amount: 400,
      method: "CASH",
    });
    const cleared = await cheques.clearCheque(env.accountsCtx, cheque.id, {});
    expect(cleared.allocated.map((a) => [a.number, a.amount]).sort()).toEqual(
      [
        [first.number, "100.00"],
        [second.number, "500.00"],
      ].sort(),
    );
    expect(cleared.advanceKept).toBe("400.00");
  });
});

run("proof photos", () => {
  let uploads: string;
  // The first bytes of a PNG, then filler: enough for the type check.
  const png = (size = 2048) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(size - 8, 7),
    ]);

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-proofs-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("keeps small photos only, from the people who record money", async () => {
    const env = await setup();
    await expectAppError(
      proofs.storePaymentProof(env.salesCtx, { fileName: "a.png", bytes: png() }),
      "FORBIDDEN",
    );
    await expectAppError(
      proofs.storePaymentProof(env.accountsCtx, {
        fileName: "a.pdf",
        bytes: Buffer.from("%PDF-1.4 not a photo"),
      }),
      "VALIDATION",
    );
    await expectAppError(
      proofs.storePaymentProof(env.accountsCtx, {
        fileName: "big.png",
        bytes: png(proofs.MAX_PROOF_BYTES + 1),
      }),
      "VALIDATION",
    );
    const stored = await proofs.storePaymentProof(env.accountsCtx, {
      fileName: "bkash.png",
      bytes: png(),
    });
    expect(stored).toMatchObject({ mimeType: "image/png", sizeBytes: 2048 });

    // Attached when the payment is recorded; Sales may then open it.
    const order = await sell(env, 1);
    const paid = await payments.receivePayment(env.accountsCtx, {
      orderId: order.id,
      amount: 900,
      method: "BKASH",
      proofFileId: stored.id,
    });
    expect(paid.payment.proofFileId).toBe(stored.id);
    const opened = await getFileForDownload(env.salesCtx, stored.id);
    expect(opened.asset.id).toBe(stored.id);

    // Someone else's upload is not attachable.
    const theirs = await proofs.storePaymentProof(env.ctx, { fileName: "x.png", bytes: png() });
    await expectAppError(
      payments.receivePayment(env.accountsCtx, {
        partyId: env.buyer.id,
        amount: 100,
        method: "CASH",
        proofFileId: theirs.id,
      }),
      "NOT_FOUND",
    );
  });

  it("replaces a proof, drops the old one, and clears unused uploads after a day", async () => {
    const env = await setup();
    await onAccount(env, 300);
    const payment = await prisma.payment.findFirstOrThrow({});
    const first = await proofs.storePaymentProof(env.accountsCtx, {
      fileName: "one.png",
      bytes: png(),
    });
    await proofs.attachPaymentProof(env.accountsCtx, payment.id, { fileId: first.id });
    const second = await proofs.storePaymentProof(env.accountsCtx, {
      fileName: "two.png",
      bytes: png(),
    });
    await proofs.attachPaymentProof(env.accountsCtx, payment.id, { fileId: second.id });
    expect(await prisma.fileAsset.findUnique({ where: { id: first.id } })).toBeNull();

    // A cheque's photo goes on its receipt when it clears.
    const order = await sell(env, 1);
    const chequePhoto = await proofs.storePaymentProof(env.accountsCtx, {
      fileName: "cheque.png",
      bytes: png(),
    });
    const cheque = await cheques.recordCheque(env.accountsCtx, {
      orderId: order.id,
      amount: 900,
      chequeNo: "12",
      proofFileId: chequePhoto.id,
    });
    const cleared = await cheques.clearCheque(env.accountsCtx, cheque.id, {});
    const receipt = await prisma.payment.findUniqueOrThrow({ where: { id: cleared.payment.id } });
    expect(receipt.proofFileId).toBe(chequePhoto.id);

    // Uploaded but never used: gone the next night, not before.
    const stray = await proofs.storePaymentProof(env.accountsCtx, {
      fileName: "stray.png",
      bytes: png(),
    });
    expect(await proofs.purgeUnusedProofs()).toBe(0);
    await prisma.fileAsset.updateMany({
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect(await proofs.purgeUnusedProofs()).toBe(1);
    expect(await prisma.fileAsset.findUnique({ where: { id: stray.id } })).toBeNull();
    expect(await prisma.fileAsset.count()).toBe(2);
  });
});
