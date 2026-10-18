import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { lockRow } from "@/lib/row-lock";
import * as chart from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { boxBalance } from "@/modules/accounts/petty-cash-balance";
import * as petty from "@/modules/accounts/petty-cash.service";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import { lockSupplierAccount } from "@/modules/accounts/supplier-settlement";
import * as voucher from "@/modules/accounts/voucher.service";
import { applyPlan } from "@/modules/bug-guard/corrections";
import * as expenses from "@/modules/expenses/expense.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import { applyCredit, creditPosition } from "@/modules/sales/credit.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as refunds from "@/modules/sales/refund.service";
import * as returns from "@/modules/sales/return.service";
import { canVoidRefundAs } from "@/modules/sales/rules";
import { receivePaymentSchema } from "@/modules/sales/schemas";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/*
 * Money and stock guards found in the v6.4.1 review: costs hidden in the API,
 * opening balances reversed (never deleted) and a buyer's opening advance usable,
 * order edits re-checked under the lock, petty cash boxes never below zero, a void
 * sales return keeping its history, refunds voided only by those who may take money
 * in, supplier locks before journal numbers, and Bug Guard stock corrections that
 * survive a sale.
 */

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const person = async (role: keyof typeof roles, email: string) => {
    const user = await makeUser(`${email}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const admin = await person("SUPER_ADMIN", "admin");
  const ctx = admin.ctx;
  const salesCtx = (await person("SALES_EXECUTIVE", "sales")).ctx;
  const storeCtx = (await person("WAREHOUSE_TEAM", "store")).ctx;
  const accountsCtx = (await person("ACCOUNTS", "accounts")).ctx;
  const staff = await person("EMPLOYEE", "staff");

  const sizes = [];
  for (const name of ["S", "M"]) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [navy.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(ctx, { variantId: v.id, quantity: 50, type: "OPENING", unitCost: 500 });
  }
  const buyer = (
    await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders", phone: "01711223344" })
  ).party;
  const supplier = (await parties.createParty(ctx, { kind: "SUPPLIER", name: "Gazipur Knit" }))
    .party;
  return {
    company,
    ctx,
    salesCtx,
    storeCtx,
    accountsCtx,
    staff,
    tops,
    style,
    sku,
    buyer,
    supplier,
  };
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

/** Waits until `n` sessions of this database wait on a lock (row or advisory). */
async function waitForLockWaiters(n: number) {
  for (let i = 0; i < 300; i++) {
    const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row!.n) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Expected ${n} session(s) waiting on a lock.`);
}

/**
 * Holds what `lock` locks (and whatever it changes) in an open transaction until
 * `release()`; `held` resolves once the lock is taken.
 */
function hold(lock: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const held = new Promise<void>((resolve) => (ready = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await lock(tx);
      ready();
      await gate;
    },
    { timeout: 60_000 },
  );
  return { held, release, done };
}

const reservedOf = async (variantId: string) =>
  (
    await prisma.stockBalance.findFirstOrThrow({
      where: { variantId, grade: "A_GRADE" },
    })
  ).reserved;

/** A wholesale order of `quantity` Navy M (900 each), without an invoice. */
const orderOf = (env: Env, quantity: number) =>
  orders.createOrder(env.ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    lines: [{ variantId: env.sku("M"), quantity }],
    documents: { invoice: false },
  });

run("money and stock guards (v6.4.1 review)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("hides what returned pieces cost from people who do not see the financials", async () => {
    const env = await setup();
    const order = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [{ variantId: env.sku("M"), quantity: 4 }],
    });
    const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
    await documents.createDeliveryChallan(env.ctx, order.id);
    const line = await prisma.salesOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const made = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: line.id, quantity: 2 }],
      reason: "Stitching fault",
    });

    // Accounts sees the cost (as on the screen).
    const seen = await returns.getSalesReturn(env.accountsCtx, made.id);
    expect(seen.costValue?.toFixed(2)).toBe("1000.00");
    expect(seen.items[0]!.unitCost?.toFixed(2)).toBe("500.00");
    expect(seen.items[0]!.badStockEntry?.lossValue?.toFixed(2)).toBe("1000.00");

    // Sales and the store see the credit note without what the pieces cost.
    for (const viewer of [env.salesCtx, env.storeCtx]) {
      const hidden = await returns.getSalesReturn(viewer, made.id);
      expect(hidden.amount.toFixed(2)).toBe("1800.00");
      expect(hidden.costValue).toBeNull();
      expect(hidden.items[0]!.unitCost).toBeNull();
      expect(hidden.items[0]!.badStockEntry?.lossValue ?? null).toBeNull();
      expect(JSON.stringify(hidden)).not.toContain("1000");
    }
  });

  it("reverses an earlier opening balance instead of deleting it, for Accounts only", async () => {
    const env = await setup();
    const entries = () =>
      prisma.journalEntry.findMany({
        where: { sourceType: "OPENING_BALANCE", sourceId: env.buyer.id },
        orderBy: { createdAt: "asc" },
        include: { lines: true },
      });
    await ledger.setOpeningBalance(env.accountsCtx, env.buyer.id, { amount: 1500 });
    const [first] = await entries();
    await ledger.setOpeningBalance(env.accountsCtx, env.buyer.id, { amount: 1200 });
    const after = await entries();
    expect(after).toHaveLength(3);
    expect(after[0]!.id).toBe(first!.id);
    expect(after[0]!.isReversed).toBe(true);
    expect(after[1]!.reversalOfId).toBe(first!.id);
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("1200.00");

    // Saving the same amount again posts nothing new.
    await ledger.setOpeningBalance(env.accountsCtx, env.buyer.id, { amount: 1200 });
    expect(await entries()).toHaveLength(3);
    // 0 takes it away with one more reversal.
    await ledger.setOpeningBalance(env.accountsCtx, env.buyer.id, { amount: 0 });
    expect(await entries()).toHaveLength(4);
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("0.00");

    // The service checks the permission too, not only the screen and the route.
    await expectAppError(
      ledger.setOpeningBalance(env.salesCtx, env.buyer.id, { amount: 900 }),
      "FORBIDDEN",
    );
  });

  it("makes a buyer's opening advance credit that can be used and paid back", async () => {
    const env = await setup();
    await ledger.setOpeningBalance(env.accountsCtx, env.buyer.id, { amount: -2000 });
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("-2000.00");
    expect((await creditPosition(prisma, env.company.id, env.buyer.id)).credit.toFixed(2)).toBe(
      "2000.00",
    );
    expect((await refunds.accountCredit(prisma, env.company.id, env.buyer.id)).toFixed(2)).toBe(
      "2000.00",
    );

    // 500 paid back, 1,500 used on an invoice.
    await refunds.refundBuyer(env.accountsCtx, {
      partyId: env.buyer.id,
      amount: 500,
      kind: "CASH",
      method: "CASH",
      reason: "Advance given back",
    });
    const order = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [{ variantId: env.sku("M"), quantity: 2 }],
    });
    await applyCredit(env.accountsCtx, order.id, { amount: 1500 });
    const after = await orders.getOrder(env.ctx, order.id);
    expect(after.invoice!.dueAmount.toFixed(2)).toBe("300.00");
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("300.00");
  });

  it("moves an opening advance posted the old way when it is saved again", async () => {
    const env = await setup();
    // As opening advances were posted before v6.4.1: on Customer Advance.
    const acc = await ensureControlAccounts(env.company.id);
    await prisma.journalEntry.create({
      data: {
        companyId: env.company.id,
        number: "JV-OLD-1",
        description: `Opening balance — ${env.buyer.name}`,
        sourceType: "OPENING_BALANCE",
        sourceId: env.buyer.id,
        lines: {
          create: [
            { accountId: acc.OPENING_EQUITY, debit: 2000 },
            { accountId: acc.CUSTOMER_ADVANCE, partyId: env.buyer.id, credit: 2000 },
          ],
        },
      },
    });
    await prisma.party.update({ where: { id: env.buyer.id }, data: { openingBalance: -2000 } });
    expect((await creditPosition(prisma, env.company.id, env.buyer.id)).credit.toFixed(2)).toBe(
      "0.00",
    );
    await ledger.setOpeningBalance(env.accountsCtx, env.buyer.id, { amount: -2000 });
    expect((await creditPosition(prisma, env.company.id, env.buyer.id)).credit.toFixed(2)).toBe(
      "2000.00",
    );
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("-2000.00");
    const old = await prisma.journalEntry.findFirstOrThrow({ where: { number: "JV-OLD-1" } });
    expect(old.isReversed).toBe(true);
  });

  it("re-checks an order edit under the lock: two edits at once keep the reservation right", async () => {
    const env = await setup();
    await orderOf(env, 10);
    const order = await orderOf(env, 5);
    expect(await reservedOf(env.sku("M"))).toBe(15);
    const holder = hold((tx) => lockRow(tx, "SalesOrder", order.id));
    await holder.held;
    const edits = [3, 4].map((quantity) =>
      orders.updateOrder(env.ctx, order.id, {
        lines: [{ variantId: env.sku("M"), quantity }],
      }),
    );
    await waitForLockWaiters(2);
    holder.release();
    await holder.done;
    const results = await Promise.allSettled(edits);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const items = await prisma.salesOrderItem.findMany({ where: { orderId: order.id } });
    const held = items.reduce((s, i) => s + i.quantity, 0);
    expect(await reservedOf(env.sku("M"))).toBe(10 + held);
  });

  it("refuses an order edit whose new total is below money paid while it waited", async () => {
    const env = await setup();
    const order = await orderOf(env, 5);
    const holder = hold(async (tx) => {
      await lockRow(tx, "SalesOrder", order.id);
      await payments.receivePaymentTx(
        tx,
        env.ctx,
        receivePaymentSchema.parse({ orderId: order.id, amount: 4000, method: "CASH" }),
      );
    });
    await holder.held;
    const edit = orders.updateOrder(env.ctx, order.id, {
      lines: [{ variantId: env.sku("M"), quantity: 2 }],
    });
    await waitForLockWaiters(1);
    holder.release();
    await holder.done;
    const error = await expectAppError(edit, "VALIDATION");
    expect(error.message).toBe("The new total is less than the 4000.00 already paid.");
    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.total.toFixed(2)).toBe("4500.00");
  });

  it("cancels an order edited at the same moment with the reservation it holds then", async () => {
    const env = await setup();
    await orderOf(env, 10);
    const order = await orderOf(env, 5);
    const holder = hold((tx) => lockRow(tx, "SalesOrder", order.id));
    await holder.held;
    const edit = orders.updateOrder(env.ctx, order.id, {
      lines: [{ variantId: env.sku("M"), quantity: 3 }],
    });
    const cancel = orders.cancelOrder(env.ctx, order.id, { reason: "Buyer changed mind" });
    await waitForLockWaiters(2);
    holder.release();
    await holder.done;
    await Promise.allSettled([edit, cancel]);
    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CANCELLED");
    expect(await reservedOf(env.sku("M"))).toBe(10);
  });

  it("refuses to make a proforma an order below an advance paid while it waited", async () => {
    const env = await setup();
    const q = await quotations.createQuotation(env.salesCtx, {
      partyId: env.buyer.id,
      items: [{ categoryId: env.tops.id, description: "Polo", quantity: 10, unitPrice: 1000 }],
    });
    const pi = await proformas.convertQuotationToProforma(env.salesCtx, q.id, {
      advancePercent: 30,
    });
    await payments.receivePayment(env.ctx, { proformaId: pi.id, amount: 3000, method: "CASH" });
    const holder = hold(async (tx) => {
      await lockRow(tx, "ProformaInvoice", pi.id);
      await payments.receivePaymentTx(
        tx,
        env.ctx,
        receivePaymentSchema.parse({ proformaId: pi.id, amount: 5000, method: "CASH" }),
      );
    });
    await holder.held;
    const convert = proformas.convertProformaToOrder(env.ctx, pi.id, {
      lines: [{ variantId: env.sku("M"), quantity: 4, unitPrice: 1000 }],
    });
    await waitForLockWaiters(1);
    holder.release();
    await holder.done;
    const error = await expectAppError(convert, "VALIDATION");
    expect(error.message).toBe(
      "The order total 4000.00 is less than the advance already paid (8000.00).",
    );
    expect(await prisma.salesOrder.count({ where: { proformaId: pi.id } })).toBe(0);
  });

  it("never takes more out of a petty cash box than it holds", async () => {
    const env = await setup();
    const cash = (await chart.listCashAccounts(env.ctx)).find((a) => a.subType === "CASH")!;
    await petty.createPettyCashBox(env.ctx, { name: "Factory", holderId: env.staff.user.id });
    const box = await prisma.pettyCashBox.findFirstOrThrow({
      where: { companyId: env.company.id },
    });
    const top = await voucher.createTransfer(env.accountsCtx, {
      fromAccountId: cash.id,
      toAccountId: box.ledgerAccountId,
      amount: 5000,
    });
    await expenses.ensureGeneralExpenseHeads(env.company.id);
    const head = await prisma.expenseHead.findFirstOrThrow({
      where: { companyId: env.company.id, requiresEmployee: false, isActive: true },
    });
    // The holder records a cost from their own box, as before.
    await expenses.createExpense(env.staff.ctx, {
      headId: head.id,
      amount: 4000,
      paymentType: "CASH_BANK",
      method: "CASH",
      pettyCashBoxId: box.id,
      description: "Thread and needles",
    });
    const inBox = async () => (await boxBalance(env.company.id, box)).toFixed(2);
    expect(await inBox()).toBe("1000.00");

    // Reversing the 5,000 top-up would leave the box at -4,000.
    const reversal = await expectAppError(
      voucher.reverseJournalVoucher(env.accountsCtx, top.id, { reason: "Wrong box" }),
      "VALIDATION",
    );
    expect(reversal.message).toBe("Factory has 1000.00 in it. Ask Accounts to top it up first.");
    // Paying a supplier from the box: only what it holds.
    await expectAppError(
      supplierPayments.paySupplier(env.accountsCtx, {
        supplierId: env.supplier.id,
        amount: 2000,
        method: "CASH",
        accountId: box.ledgerAccountId,
      }),
      "VALIDATION",
    );
    await supplierPayments.paySupplier(env.accountsCtx, {
      supplierId: env.supplier.id,
      amount: 600,
      method: "CASH",
      accountId: box.ledgerAccountId,
    });
    expect(await inBox()).toBe("400.00");
  });

  it("voids a sales return with opposite stock movements, keeping its rejects lines marked void", async () => {
    const env = await setup();
    const order = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [{ variantId: env.sku("M"), quantity: 4 }],
    });
    const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
    await documents.createDeliveryChallan(env.ctx, order.id);
    const line = await prisma.salesOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const made = await returns.createSalesReturn(env.accountsCtx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: line.id, quantity: 2 }],
      reason: "Stitching fault",
    });
    const before = await prisma.stockBalance.findMany({ orderBy: { id: "asc" } });
    const entry = await prisma.badStockEntry.findFirstOrThrow({
      where: { salesReturnItem: { returnId: made.id } },
    });
    await returns.voidSalesReturn(env.accountsCtx, made.id, { reason: "Entered by mistake" });

    // History stays: the first movements and their opposites, netting to nothing.
    const moves = await prisma.stockMovement.findMany({
      where: {
        OR: [
          { referenceType: "SalesReturn", referenceId: made.id },
          { referenceType: "BadStockEntry", referenceId: entry.id },
        ],
      },
    });
    const row = (m: (typeof moves)[number]) =>
      `${m.type} ${m.quantity}${m.note?.startsWith(`Void of ${made.number}`) ? " (void)" : ""}`;
    expect(moves.map(row).sort()).toEqual([
      "BAD_STOCK_OUT -2",
      "BAD_STOCK_OUT 2 (void)",
      "RETURN_RESTOCK -2 (void)",
      "RETURN_RESTOCK 2",
    ]);
    expect(await prisma.stockBalance.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    // The rejects line is kept, marked void, and leaves the rejects list.
    const kept = await prisma.badStockEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(kept.voidedAt).not.toBeNull();
    const list = await stock.listBadStock(env.ctx);
    expect(list.items).toHaveLength(0);
    expect(list.totals).toMatchObject({ entries: 0, pieces: 0, lossValue: "0.00" });
  });

  it("voids a refund paid in cash only for people who may record money received", async () => {
    const env = await setup();
    await payments.receivePayment(env.accountsCtx, {
      partyId: env.buyer.id,
      amount: 1000,
      method: "CASH",
    });
    const refund = await refunds.refundBuyer(env.accountsCtx, {
      partyId: env.buyer.id,
      amount: 400,
      kind: "CASH",
      method: "CASH",
      reason: "Paid back",
    });
    const payOnly = {
      ...env.accountsCtx,
      can: (key: Parameters<typeof env.accountsCtx.can>[0]) =>
        key !== "accounts.receipts.record" && env.accountsCtx.can(key),
    };
    const refused = await expectAppError(
      refunds.voidRefund(payOnly, refund.id, { reason: "Entered twice" }),
      "FORBIDDEN",
    );
    expect(refused.message).toBe(
      "Only Accounts can record money received: voiding this refund puts the money back into the account.",
    );
    expect(canVoidRefundAs(payOnly, "CASH").ok).toBe(false);
    expect(canVoidRefundAs(env.accountsCtx, "CASH").ok).toBe(true);
    await refunds.voidRefund(env.accountsCtx, refund.id, { reason: "Entered twice" });
    expect((await refunds.accountCredit(prisma, env.company.id, env.buyer.id)).toFixed(2)).toBe(
      "1000.00",
    );
  });

  it("locks the supplier before taking any journal number", async () => {
    const env = await setup();
    const companyId = env.company.id;
    await expenses.ensureGeneralExpenseHeads(companyId);
    const head = await prisma.expenseHead.findFirstOrThrow({
      where: { companyId, requiresEmployee: false, isActive: true },
    });
    // Every counter these steps use exists already (a new one would not be seen locked).
    const first = await supplierPayments.paySupplier(env.accountsCtx, {
      supplierId: env.supplier.id,
      amount: 100,
      method: "CASH",
    });
    const due = await expenses.createExpense(env.accountsCtx, {
      headId: head.id,
      amount: 300,
      paymentType: "DUE",
      supplierId: env.supplier.id,
      description: "Courier",
    });

    /** Runs `action` while the supplier is locked elsewhere: no counter may be held meanwhile. */
    const lockedFirst = async (action: () => Promise<unknown>) => {
      const holder = hold((tx) => lockSupplierAccount(tx, companyId, env.supplier.id));
      await holder.held;
      const running = action();
      await waitForLockWaiters(1);
      const probe = await prisma
        .$transaction(
          (tx) =>
            tx.$queryRaw`SELECT id FROM "DocumentSequence" WHERE "companyId" = ${companyId} FOR UPDATE NOWAIT`,
        )
        .then(
          () => "free",
          () => "held",
        );
      holder.release();
      await holder.done;
      await running;
      expect(probe).toBe("free");
    };

    await lockedFirst(() =>
      supplierPayments.paySupplier(env.accountsCtx, {
        supplierId: env.supplier.id,
        amount: 200,
        method: "CASH",
      }),
    );
    await lockedFirst(() =>
      supplierPayments.voidSupplierPayment(env.accountsCtx, first.id, { reason: "Paid twice" }),
    );
    await lockedFirst(() =>
      expenses.createExpense(env.accountsCtx, {
        headId: head.id,
        amount: 250,
        paymentType: "DUE",
        supplierId: env.supplier.id,
        description: "Loading",
      }),
    );
    const claim = await expenses.createExpense(env.salesCtx, {
      headId: head.id,
      amount: 150,
      paymentType: "DUE",
      supplierId: env.supplier.id,
      description: "Courier",
    });
    await lockedFirst(() => expenses.approveExpense(env.accountsCtx, claim.id, {}));
    await lockedFirst(() =>
      expenses.voidExpense(env.accountsCtx, due.id, { reason: "Booked twice" }),
    );
    await lockedFirst(() =>
      ledger.setOpeningBalance(env.accountsCtx, env.supplier.id, { amount: -5000 }),
    );
    expect((await ledger.getPartyBalance(env.ctx, env.supplier.id)).toFixed(2)).toBe("-5200.00");
  });

  it("makes a Bug Guard stock correction after a sale, from the difference only", async () => {
    const env = await setup();
    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { variantId: env.sku("S"), grade: "A_GRADE" },
    });
    // The stock line says 3 more than its movements.
    await prisma.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: balance.quantity + 3 },
    });
    const plan = {
      kind: "STOCK" as const,
      balanceId: balance.id,
      variantId: balance.variantId,
      warehouseId: balance.warehouseId,
      grade: "A_GRADE" as const,
      stored: balance.quantity + 3,
      moved: balance.quantity,
      label: "EX-PL-001-NAVY-S",
    };
    // A sale since the check: both the stock and its movements went down by 2.
    const order = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [{ variantId: env.sku("S"), quantity: 2 }],
      documents: { invoice: true, deliveryChallan: true },
    });
    expect(order.id).toBeTruthy();
    await prisma.$transaction((tx) =>
      applyPlan(tx, env.company.id, plan, { userId: env.ctx.user.id, correctionId: "corr-1" }),
    );
    const own = await prisma.stockMovement.findMany({
      where: { referenceType: "BugGuardCorrection", referenceId: "corr-1" },
    });
    expect(own.map((m) => m.quantity)).toEqual([3]);
    const moved = await prisma.stockMovement.aggregate({
      where: { variantId: env.sku("S"), warehouseId: balance.warehouseId, grade: "A_GRADE" },
      _sum: { quantity: true },
    });
    const now = await prisma.stockBalance.findUniqueOrThrow({ where: { id: balance.id } });
    expect(moved._sum.quantity).toBe(now.quantity);
    // Made once: a second go finds nothing left to put right.
    await expect(
      prisma.$transaction((tx) =>
        applyPlan(tx, env.company.id, plan, { userId: env.ctx.user.id, correctionId: "corr-2" }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
