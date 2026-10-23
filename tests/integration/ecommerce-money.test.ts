import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST as postAdSpend } from "@/app/api/v1/ecommerce/ad-spend/route";
import { PATCH as patchOrder } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/route";
import { POST as postPayment } from "@/app/api/v1/ecommerce/payments/route";
import { POST as postReturn } from "@/app/api/v1/ecommerce/returns/route";
import { localDay, startOfDayInZone } from "@/lib/dates";
import { readOnly } from "@/lib/read-only";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as reports from "@/modules/accounts/reports.service";
import { DATA_CHECKS } from "@/modules/bug-guard/checks/data";
import { buildDocument } from "@/modules/documents/builders";
import type { Block } from "@/modules/documents/model";
import { printRequestSchema } from "@/modules/documents/schemas";
import { createIntegration } from "@/modules/ecommerce/integration.service";
import { SHOP_PERMISSIONS } from "@/modules/ecommerce/shop-account";
import * as stock from "@/modules/inventory/stock.service";
import { ensureWalkInParty } from "@/modules/parties/walk-in";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as receipts from "@/modules/sales/payment.service";
import * as refunds from "@/modules/sales/refund.service";
import * as returnScreens from "@/modules/sales/return-screens.service";
import * as returns from "@/modules/sales/return.service";

import { callShop, giveKey, type Shop, setupShop, shopUserOf } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const today = () => localDay(new Date(), TZ);
const daysAgo = (n: number) => localDay(new Date(Date.now() - n * 86_400_000), TZ);

const variantId = (shop: Shop, sku: string) => shop.variants.find((v) => v.sku === sku)!.id;

/**
 * A website order as the orders endpoint makes it (built in parallel): channel
 * WEBSITE, no buyer, this shop's externalOrderId. `deliver` invoices it and
 * sends every piece.
 */
async function websiteOrder(
  shop: Shop,
  externalOrderId: string,
  lines: Array<[sku: string, quantity: number]>,
  opts: { invoice?: boolean; deliver?: boolean; integrationId?: string } = {},
) {
  const order = await orders.createOrder(shop.owner, {
    channel: "WEBSITE",
    customerName: "Nusrat Jahan",
    customerPhone: "01811000000",
    shippingAddress: "House 12, Road 5, Dhanmondi, Dhaka",
    lines: lines.map(([sku, quantity]) => ({ variantId: variantId(shop, sku), quantity })),
    documents: { invoice: Boolean(opts.invoice || opts.deliver) },
  });
  await prisma.salesOrder.update({
    where: { id: order.id },
    data: { integrationId: opts.integrationId ?? shop.integration.id, externalOrderId },
  });
  if (opts.deliver) await documents.createDeliveryChallan(shop.owner, order.id);
  return order;
}

/** An entry's lines as account key -> net debit (debit - credit), with each line's party. */
async function entryLines(companyId: string, entryId: string) {
  const acc = await ensureControlAccounts(companyId);
  const keyOf = new Map(Object.entries(acc).map(([key, id]) => [id, key]));
  const lines = await prisma.journalLine.findMany({ where: { entryId } });
  const net: Record<string, string> = {};
  const parties: Record<string, string | null> = {};
  for (const l of lines) {
    const key = keyOf.get(l.accountId) ?? l.accountId;
    const value = new Prisma.Decimal(net[key] ?? 0).plus(l.debit).minus(l.credit);
    net[key] = value.toFixed(2);
    parties[key] = l.partyId;
  }
  for (const [key, value] of Object.entries(net)) if (value === "0.00") delete net[key];
  const debit = lines.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0));
  const credit = lines.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0));
  expect(debit.toFixed(2)).toBe(credit.toFixed(2));
  return { net, parties };
}

/** The books check passes and Bug Guard's data and accounts checks find nothing. */
async function expectBooksOk(shop: Shop) {
  const check = await reports.getBooksCheck(shop.owner);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
  expect(check.ok).toBe(true);
  const found = await readOnly("Bug Guard only reads", async () => {
    const ctx = {
      companyId: shop.company.id,
      now: new Date(),
      since: new Date(Date.now() - 7 * 86_400_000),
      platform: false,
      db: prisma,
    };
    const out = [];
    for (const c of DATA_CHECKS) out.push(...(await c.run(ctx)));
    return out;
  });
  expect(found.map((f) => `${f.key}: ${f.title}`)).toEqual([]);
}

const cell = async (shop: Shop, sku: string) =>
  (await stock.stockByVariant(shop.owner, [variantId(shop, sku)])).get(variantId(shop, sku))!;

const costs = (shop: Shop, sku: string) =>
  prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId(shop, sku) },
    select: { avgCost: true, bGradeAvgCost: true },
  });

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

run("E-commerce API: payments (CN-005)", () => {
  let shop: Shop;
  let navyS: string;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    navyS = shop.sku("EX-PL-001", "Navy", "S");
  });

  it("records an advance before the invoice, applies it when the invoice is issued, then takes the COD", async () => {
    const order = await websiteOrder(shop, "WEB-1001", [[navyS, 1]]);
    const acc = await ensureControlAccounts(shop.company.id);
    const walkIn = await ensureWalkInParty(shop.company.id);

    const day = daysAgo(1);
    const res = await callShop(shop, postPayment, {
      path: "/payments",
      body: {
        externalOrderId: "WEB-1001",
        amount: 500,
        method: "bkash",
        reference: "TRX-9F2K",
        date: day,
        note: "Paid at checkout",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      erpPaymentId: expect.any(String),
      erpPaymentNumber: expect.any(String),
      externalOrderId: "WEB-1001",
      amount: 500,
      method: "BKASH",
      orderPaid: 500,
      orderDue: 950,
    });
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: res.body.erpPaymentId },
    });
    expect(payment).toMatchObject({
      number: res.body.erpPaymentNumber,
      method: "BKASH",
      orderId: order.id,
      isAdvance: true,
      reference: "TRX-9F2K",
      notes: "Paid at checkout",
      accountId: acc.MOBILE_WALLET,
      partyId: null,
    });
    expect(payment.paymentDate.toISOString()).toBe(startOfDayInZone(day, TZ).toISOString());
    // Dr the wallet, Cr Customer Advance on the Walk-in customers account.
    const advance = await entryLines(shop.company.id, payment.journalEntryId!);
    expect(advance.net).toEqual({ MOBILE_WALLET: "500.00", CUSTOMER_ADVANCE: "-500.00" });
    expect(advance.parties.CUSTOMER_ADVANCE).toBe(walkIn);
    // In the shop account's name.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Payment", entityId: payment.id },
    });
    expect(audit.userId).toBe(await shopUserOf(shop.integration.id));

    // The invoice issued later uses the advance, exactly as for the ERP's own walk-in orders.
    const invoice = await documents.issueInvoice(shop.owner, order.id);
    const sale = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "SALE", sourceId: invoice.id },
    });
    const invoiceLines = await entryLines(shop.company.id, sale.id);
    expect(invoiceLines.net).toMatchObject({
      CUSTOMER_ADVANCE: "500.00",
      RECEIVABLE: "950.00",
      SALES: "-1450.00",
    });
    expect(invoiceLines.parties.RECEIVABLE).toBe(walkIn);
    await documents.createDeliveryChallan(shop.owner, order.id);

    // The courier's cash after delivery reduces the receivable.
    const cod = await callShop(shop, postPayment, {
      path: "/payments",
      body: {
        externalOrderId: "WEB-1001",
        amount: 950,
        method: "COD",
        reference: "STEADFAST-INV-77",
        date: new Date().toISOString(),
      },
    });
    expect(cod.status).toBe(201);
    expect(cod.body).toMatchObject({ method: "COD", amount: 950, orderPaid: 1450, orderDue: 0 });
    const codPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: cod.body.erpPaymentId },
    });
    expect(codPayment).toMatchObject({
      method: "COURIER_COD",
      isAdvance: false,
      accountId: acc.CASH,
    });
    const received = await entryLines(shop.company.id, codPayment.journalEntryId!);
    expect(received.net).toEqual({ CASH: "950.00", RECEIVABLE: "-950.00" });
    expect(received.parties.RECEIVABLE).toBe(walkIn);
    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paidAmount.toFixed(2)).toBe("1450.00");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      "PAID",
    );

    // Nothing is due any more: more money is refused.
    const extra = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1001", amount: 10, method: "COD" },
    });
    expect(extra.status).toBe(422);
    expect(extra.body.error.code).toBe("VALIDATION");
    await expectBooksOk(shop);
  });

  it("takes card and Nagad money to the bank and the wallet by default", async () => {
    await websiteOrder(shop, "WEB-1002", [[navyS, 2]], { invoice: true });
    const acc = await ensureControlAccounts(shop.company.id);
    const card = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1002", amount: 1000, method: "Card", reference: "SSL-1" },
    });
    expect(card.status).toBe(201);
    const nagad = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1002", amount: 1900, method: "NAGAD", reference: "NG-1" },
    });
    expect(nagad.status).toBe(201);
    expect(nagad.body).toMatchObject({ orderPaid: 2900, orderDue: 0 });
    const rows = await prisma.payment.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((p) => [p.method, p.accountId, p.isAdvance])).toEqual([
      ["CARD", acc.BANK, false],
      ["NAGAD", acc.MOBILE_WALLET, false],
    ]);
  });

  it("answers a repeat with the first result and refuses the same payment under a new key", async () => {
    await websiteOrder(shop, "WEB-1003", [[navyS, 1]]);
    const body = {
      externalOrderId: "WEB-1003",
      amount: 300,
      method: "BKASH",
      reference: "TRX-AAA",
    };
    const first = await callShop(shop, postPayment, {
      path: "/payments",
      body,
      idempotencyKey: "pay-1",
    });
    expect(first.status).toBe(201);
    const again = await callShop(shop, postPayment, {
      path: "/payments",
      body,
      idempotencyKey: "pay-1",
    });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    expect(await prisma.payment.count()).toBe(1);

    // The same order, method and reference is the same money, whatever the key.
    const twice = await callShop(shop, postPayment, {
      path: "/payments",
      body: { ...body, reference: " TRX-AAA " },
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error).toMatchObject({
      code: "PAYMENT_EXISTS",
      details: { erpPaymentId: first.body.erpPaymentId },
    });
    // Another method with that reference is other money.
    const other = await callShop(shop, postPayment, {
      path: "/payments",
      body: { ...body, method: "NAGAD" },
    });
    expect(other.status).toBe(201);
    expect(await prisma.payment.count()).toBe(2);
  });

  it("refuses an unknown or another shop's order, more than is due, a cancelled order and bad input", async () => {
    const order = await websiteOrder(shop, "WEB-1004", [[navyS, 1]]);
    const none = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-404", amount: 100, method: "COD" },
    });
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe("NOT_FOUND");

    // The same number from another integration of the company is not this shop's order.
    const second = await createIntegration(shop.owner, {
      name: "Second shop",
      warehouseId: shop.warehouse.id,
    });
    await giveKey(second.id);
    await websiteOrder(shop, "WEB-2ND", [[navyS, 1]], { integrationId: second.id });
    const theirs = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-2ND", amount: 100, method: "COD" },
    });
    expect(theirs.status).toBe(404);

    const tooMuch = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1004", amount: 1450.01, method: "COD" },
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("1450.00"),
      details: { amount: [expect.stringContaining("1450.00")] },
    });

    for (const body of [
      { externalOrderId: "WEB-1004", amount: 0, method: "COD" },
      { externalOrderId: "WEB-1004", amount: 10.005, method: "COD" },
      { externalOrderId: "WEB-1004", amount: 10, method: "PAYPAL" },
      { externalOrderId: "WEB-1004", amount: 10, method: "COD", date: "yesterday" },
      { externalOrderId: "WEB-1004", amount: 10, method: "COD", date: "2999-01-01" },
      { amount: 10, method: "COD" },
    ]) {
      const bad = await callShop(shop, postPayment, { path: "/payments", body });
      expect(bad.status, JSON.stringify(body)).toBe(422);
      expect(bad.body.error.code).toBe("VALIDATION");
    }

    await orders.cancelOrder(shop.owner, order.id, { reason: "Customer cancelled" });
    const cancelled = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1004", amount: 100, method: "COD" },
    });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.code).toBe("CONFLICT");

    const noKey = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1004", amount: 100, method: "COD" },
      key: null,
    });
    expect(noKey.status).toBe(401);
    expect(await prisma.payment.count()).toBe(0);
  });
});

run("E-commerce API: payments sent again (CN-005 review)", () => {
  let shop: Shop;
  let navyS: string;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    navyS = shop.sku("EX-PL-001", "Navy", "S");
  });

  it("needs the transaction id for bKash, Nagad and card money", async () => {
    await websiteOrder(shop, "WEB-1101", [[navyS, 1]]);
    for (const method of ["BKASH", "nagad", "Card"]) {
      for (const reference of [undefined, "", "   "]) {
        const res = await callShop(shop, postPayment, {
          path: "/payments",
          body: { externalOrderId: "WEB-1101", amount: 100, method, reference },
        });
        expect(res.status, `${method} ${JSON.stringify(reference)}`).toBe(422);
        expect(res.body.error).toMatchObject({
          code: "VALIDATION",
          details: { reference: [expect.stringContaining("transaction id")] },
        });
      }
    }
    expect(await prisma.payment.count()).toBe(0);
    const ok = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1101", amount: 100, method: "BKASH", reference: "TRX-1" },
    });
    expect(ok.status).toBe(201);
  });

  it("takes a COD of one amount once without a reference; another reference is other money", async () => {
    await websiteOrder(shop, "WEB-1102", [[navyS, 2]], { deliver: true });
    const first = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1102", amount: 1000, method: "COD" },
    });
    expect(first.status).toBe(201);
    // The same COD sent again under a new Idempotency-Key is the same money.
    const again = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1102", amount: 1000, method: "COD" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: "PAYMENT_EXISTS",
      details: { erpPaymentId: first.body.erpPaymentId },
    });
    // A COD of another amount, or of the same amount with its own reference, is new money.
    const other = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1102", amount: 900, method: "COD" },
    });
    expect(other.status).toBe(201);
    const second = await callShop(shop, postPayment, {
      path: "/payments",
      body: {
        externalOrderId: "WEB-1102",
        amount: 1000,
        method: "COD",
        reference: "STEADFAST-INV-2",
      },
    });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ orderPaid: 2900, orderDue: 0 });
    // The same reference again is the same money, whatever the amount (checked before the due).
    const sameRef = await callShop(shop, postPayment, {
      path: "/payments",
      body: {
        externalOrderId: "WEB-1102",
        amount: 400,
        method: "COD",
        reference: "STEADFAST-INV-2",
      },
    });
    expect(sameRef.status).toBe(409);
    expect(sameRef.body.error).toMatchObject({
      code: "PAYMENT_EXISTS",
      details: { erpPaymentId: second.body.erpPaymentId },
    });
    expect(await prisma.payment.count()).toBe(3);
    await expectBooksOk(shop);
  });

  it("matches a COD without a reference only with earlier ones without a reference", async () => {
    await websiteOrder(shop, "WEB-1104", [[navyS, 2]], { deliver: true });
    const withRef = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1104", amount: 1000, method: "COD", reference: "SF-1" },
    });
    expect(withRef.status).toBe(201);
    const without = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1104", amount: 1000, method: "COD" },
    });
    expect(without.status).toBe(201);
    const again = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1104", amount: 1000, method: "COD" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ erpPaymentId: without.body.erpPaymentId });
  });

  it("takes no money on an order whose parcel came back undelivered (409 ORDER_LOCKED)", async () => {
    await websiteOrder(shop, "WEB-1103", [[navyS, 1]]);
    const back = await callShop<{ externalOrderId: string }>(shop, patchOrder, {
      method: "PATCH",
      path: "/orders/WEB-1103",
      body: { status: "RETURNED", reason: "Customer not at home" },
      params: { externalOrderId: "WEB-1103" },
    });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("RETURNED");
    const res = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-1103", amount: 100, method: "COD" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_LOCKED");
    expect(res.body.error.message).toContain("undelivered");
    expect(await prisma.payment.count()).toBe(0);
  });
});

run("E-commerce API: returns with QC per item (CN-005)", () => {
  let shop: Shop;
  let navyM: string;
  let navyL: string;
  let whiteS: string;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    navyM = shop.sku("EX-PL-001", "Navy", "M");
    navyL = shop.sku("EX-PL-001", "Navy", "L");
    whiteS = shop.sku("EX-PL-001", "White", "S");
  });

  it("puts good pieces back in stock, B-grade ones in B-grade stock and damaged ones in the rejects, and voids it", async () => {
    const order = await websiteOrder(
      shop,
      "WEB-2001",
      [
        [navyM, 3],
        [whiteS, 2],
      ],
      { deliver: true },
    );
    // Newer stock at another cost: a good piece back re-weights the average at the cost it left at.
    await stock.adjustStock(shop.owner, {
      variantId: variantId(shop, navyM),
      quantity: 10,
      type: "ADJUSTMENT",
      unitCost: 800,
    });
    expect((await costs(shop, navyM)).avgCost.toFixed(4)).toBe("676.4706");
    expect(await cell(shop, navyM)).toMatchObject({ aGrade: 17, bGrade: 0 });
    const acc = await ensureControlAccounts(shop.company.id);
    const walkIn = await ensureWalkInParty(shop.company.id);

    const res = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2001",
        reason: "Customer returned",
        returnDate: today(),
        items: [
          { sku: navyM, quantity: 1, qc: "good" },
          { sku: navyM, quantity: 1, qc: "b-grade" },
          { sku: navyM, quantity: 1, qc: "DAMAGED", note: "Torn seam" },
          { sku: whiteS, quantity: 1, qc: "Good" },
        ],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      erpReturnId: expect.any(String),
      erpReturnNumber: expect.stringMatching(/^CN/),
      externalOrderId: "WEB-2001",
      externalReturnId: null,
      credited: 5800,
      // Nothing was paid yet: the credit pays the invoice's due, which drops to the piece kept.
      usedOnOrder: 5800,
      toPayBack: 0,
      orderDue: 1450,
      orderStatus: "PARTIALLY_RETURNED",
      items: [
        { sku: navyM, quantity: 1, qc: "GOOD" },
        { sku: navyM, quantity: 1, qc: "B_GRADE" },
        { sku: navyM, quantity: 1, qc: "DAMAGED" },
        { sku: whiteS, quantity: 1, qc: "GOOD" },
      ],
    });

    // Stock after each QC kind.
    expect(await cell(shop, navyM)).toMatchObject({ aGrade: 18, bGrade: 1 });
    expect(await cell(shop, whiteS)).toMatchObject({ aGrade: 9, bGrade: 0 });
    const navyCosts = await costs(shop, navyM);
    expect(navyCosts.avgCost.toFixed(4)).toBe("666.6667"); // (17 x 676.47 + 500) / 18
    expect(navyCosts.bGradeAvgCost.toFixed(4)).toBe("500.0000");
    expect((await costs(shop, whiteS)).avgCost.toFixed(4)).toBe("500.0000");
    const rejects = await prisma.badStockEntry.findMany({ where: { voidedAt: null } });
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatchObject({
      variantId: variantId(shop, navyM),
      quantity: 1,
      source: "RETURN_QC",
    });
    expect(rejects[0]!.lossValue.toFixed(2)).toBe("500.00");

    const ret = await prisma.salesReturn.findUniqueOrThrow({
      where: { id: res.body.erpReturnId },
      include: { items: { orderBy: { id: "asc" } } },
    });
    expect(ret).toMatchObject({
      orderId: order.id,
      partyId: null,
      createdById: await shopUserOf(shop.integration.id),
    });
    expect(ret.costValue.toFixed(2)).toBe("2000.00");
    const kinds = ret.items
      .map((i) => [i.variantId === variantId(shop, navyM) ? "navyM" : "whiteS", i.qcStatus])
      .sort();
    expect(kinds).toEqual([
      ["navyM", "MOVED_TO_BAD_STOCK"],
      ["navyM", "MOVED_TO_B_GRADE"],
      ["navyM", "MOVED_TO_MAIN_STOCK"],
      ["whiteS", "MOVED_TO_MAIN_STOCK"],
    ]);
    expect(ret.items.find((i) => i.qcStatus === "MOVED_TO_BAD_STOCK")!.qcNote).toBe("Torn seam");
    expect(ret.items.filter((i) => i.qtyRestocked === 1)).toHaveLength(3);

    // The money side as today, on the Walk-in customers account; the cost side by QC kind.
    const books = await entryLines(shop.company.id, ret.journalEntryId!);
    expect(books.net).toEqual({
      SALES: "5800.00",
      RECEIVABLE: "-5800.00",
      INVENTORY: "1500.00",
      INVENTORY_LOSS: "500.00",
      COGS: "-2000.00",
    });
    expect(books.parties.RECEIVABLE).toBe(walkIn);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "SalesReturn", entityId: ret.id, action: "CREATE" },
    });
    expect(audit.userId).toBe(await shopUserOf(shop.integration.id));
    expect(audit.summary).toContain(
      "2 pcs back in stock, 1 pcs to B-grade stock, 1 pcs to Damage & QC Rejects",
    );
    await expectBooksOk(shop);

    // The credit note screen says where the pieces went.
    const screen = await returnScreens.getSalesReturnScreen(shop.owner, ret.id);
    expect(screen.salesReturn.customerName).toBe("Nusrat Jahan");
    expect(screen.salesReturn.wentTo).toEqual({ stock: 2, bGrade: 1, rejects: 1 });
    expect(screen.salesReturn.lines.map((l) => l.qc).sort()).toEqual([
      "B_GRADE",
      "DAMAGED",
      "GOOD",
      "GOOD",
    ]);
    expect(screen.can.void).toBe(true);
    const list = await returnScreens.getSalesReturnList(shop.owner);
    expect(list.items[0]).toMatchObject({ buyer: null, customerName: "Nusrat Jahan" });
    // The credit note names the customer and where each piece went.
    const { model } = await buildDocument(
      shop.owner,
      printRequestSchema.parse({ type: "SALES_RETURN", id: ret.id }),
      new Date(),
    );
    expect(model.parties[0]!.lines[0]).toBe("Nusrat Jahan");
    const table = model.blocks.find(
      (b): b is Extract<Block, { kind: "table" }> => b.kind === "table",
    )!;
    expect(table.rows.map((row) => row.details?.[0]).sort()).toEqual([
      `${navyM} · B-grade stock`,
      `${navyM} · Back in stock`,
      `${navyM} · Damage & QC Rejects`,
      `${whiteS} · Back in stock`,
    ]);

    // Voiding takes the pieces back out of A and B stock and reverses the entry.
    await returns.voidSalesReturn(shop.owner, ret.id, { reason: "Recorded by mistake" });
    expect(await cell(shop, navyM)).toMatchObject({ aGrade: 17, bGrade: 0 });
    expect(await cell(shop, whiteS)).toMatchObject({ aGrade: 8, bGrade: 0 });
    expect((await costs(shop, navyM)).avgCost.toFixed(4)).toBe("676.4706");
    expect(await prisma.badStockEntry.count({ where: { voidedAt: null } })).toBe(0);
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: ret.journalEntryId! },
    });
    expect(entry.isReversed).toBe(true);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "DELIVERED",
    );
    await expectBooksOk(shop);
    // The same pieces can come back again.
    const again = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2001",
        reason: "Customer returned",
        items: [
          { sku: navyM, quantity: 3, qc: "GOOD" },
          { sku: whiteS, quantity: 2, qc: "GOOD" },
        ],
      },
    });
    expect(again.status).toBe(201);
    expect(again.body.orderStatus).toBe("RETURNED");
    expect(acc.INVENTORY).toBeDefined();
    await expectBooksOk(shop);
  });

  it("refuses to void while restocked pieces are no longer there, then voids once they are", async () => {
    await websiteOrder(shop, "WEB-2002", [[navyL, 10]], { deliver: true });
    expect(await cell(shop, navyL)).toMatchObject({ aGrade: 0 });
    const res = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2002",
        reason: "Wrong size",
        items: [
          { sku: navyL, quantity: 2, qc: "GOOD" },
          { sku: navyL, quantity: 1, qc: "B_GRADE" },
        ],
      },
    });
    expect(res.status).toBe(201);
    expect(await cell(shop, navyL)).toMatchObject({ aGrade: 2, bGrade: 1, available: 2 });

    // The two good pieces are promised to a new order.
    const promised = await orders.createOrder(shop.owner, {
      channel: "WEBSITE",
      customerName: "Arif",
      lines: [{ variantId: variantId(shop, navyL), quantity: 2 }],
      documents: { invoice: false },
    });
    const refused = await expectAppError(
      returns.voidSalesReturn(shop.owner, res.body.erpReturnId, { reason: "Recorded by mistake" }),
      "CONFLICT",
    );
    expect(refused.message).toContain(navyL);
    expect(refused.message).toContain("2 pcs");
    await orders.cancelOrder(shop.owner, promised.id, { reason: "Customer cancelled" });

    // The B-grade piece was written off meanwhile.
    await stock.adjustStock(shop.owner, {
      variantId: variantId(shop, navyL),
      grade: "B_GRADE",
      quantity: -1,
      type: "ADJUSTMENT",
    });
    const bGone = await expectAppError(
      returns.voidSalesReturn(shop.owner, res.body.erpReturnId, { reason: "Recorded by mistake" }),
      "CONFLICT",
    );
    expect(bGone.message).toContain("B-grade");
    // The screen does not offer the void and says why.
    const screen = await returnScreens.getSalesReturnScreen(shop.owner, res.body.erpReturnId);
    expect(screen.can.void).toBe(false);
    expect(screen.notes.void).toContain("B-grade");
    await stock.adjustStock(shop.owner, {
      variantId: variantId(shop, navyL),
      grade: "B_GRADE",
      quantity: 1,
      type: "ADJUSTMENT",
    });

    await returns.voidSalesReturn(shop.owner, res.body.erpReturnId, {
      reason: "Recorded by mistake",
    });
    expect(await cell(shop, navyL)).toMatchObject({ aGrade: 0, bGrade: 0 });
    const voided = await prisma.salesReturn.findUniqueOrThrow({
      where: { id: res.body.erpReturnId },
    });
    expect(voided.voidedAt).not.toBeNull();
    await expectBooksOk(shop);
  });

  it("answers a repeat with the first result: one return, one entry", async () => {
    await websiteOrder(shop, "WEB-2003", [[navyM, 2]], { deliver: true });
    const body = {
      externalOrderId: "WEB-2003",
      reason: "Size problem",
      items: [{ sku: navyM, quantity: 1, qc: "GOOD" }],
    };
    const first = await callShop(shop, postReturn, {
      path: "/returns",
      body,
      idempotencyKey: "ret-1",
    });
    expect(first.status).toBe(201);
    const again = await callShop(shop, postReturn, {
      path: "/returns",
      body,
      idempotencyKey: "ret-1",
    });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    expect(await prisma.salesReturn.count()).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "RETURN" } })).toBe(1);
    expect(await cell(shop, navyM)).toMatchObject({ aGrade: 9 });
  });

  it("refuses an unknown order, nothing delivered, a SKU not on the order, too many pieces and bad input", async () => {
    const wrongKey = await callShop(shop, postReturn, {
      path: "/returns",
      body: { externalOrderId: "WEB-2004", reason: "x", items: [] },
      key: "not-a-key",
    });
    expect(wrongKey.status).toBe(401);

    const unknown = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-404",
        reason: "Size problem",
        items: [{ sku: navyM, quantity: 1, qc: "GOOD" }],
      },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");

    await websiteOrder(shop, "WEB-2004", [[navyM, 2]]);
    const notInvoiced = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2004",
        reason: "Size problem",
        items: [{ sku: navyM, quantity: 1, qc: "GOOD" }],
      },
    });
    expect(notInvoiced.status).toBe(409);
    expect(notInvoiced.body.error.message).toContain("no invoice");

    await websiteOrder(shop, "WEB-2005", [[navyM, 2]], { invoice: true });
    const notDelivered = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2005",
        reason: "Size problem",
        items: [{ sku: navyM, quantity: 1, qc: "GOOD" }],
      },
    });
    expect(notDelivered.status).toBe(409);
    expect(notDelivered.body.error.message).toContain("delivered yet");

    await websiteOrder(shop, "WEB-2006", [[navyM, 2]], { deliver: true });
    const offOrder = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2006",
        reason: "Size problem",
        items: [
          { sku: navyM, quantity: 1, qc: "GOOD" },
          { sku: whiteS, quantity: 1, qc: "GOOD" },
        ],
      },
    });
    expect(offOrder.status).toBe(422);
    expect(offOrder.body.error.details).toHaveProperty(["items.1.sku"]);

    const tooMany = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2006",
        reason: "Size problem",
        items: [
          { sku: navyM, quantity: 2, qc: "GOOD" },
          { sku: navyM, quantity: 1, qc: "DAMAGED" },
        ],
      },
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.message).toContain("Only 2");

    for (const body of [
      { externalOrderId: "WEB-2006", reason: "Size", items: [{ sku: navyM, quantity: 1 }] },
      {
        externalOrderId: "WEB-2006",
        reason: "Size",
        items: [{ sku: navyM, quantity: 1, qc: "MAYBE" }],
      },
      {
        externalOrderId: "WEB-2006",
        reason: "Size",
        items: [{ sku: navyM, quantity: 0, qc: "GOOD" }],
      },
      { externalOrderId: "WEB-2006", reason: "Size", items: [] },
      {
        externalOrderId: "WEB-2006",
        reason: "Size",
        returnDate: "2999-01-01",
        items: [{ sku: navyM, quantity: 1, qc: "GOOD" }],
      },
    ]) {
      const bad = await callShop(shop, postReturn, { path: "/returns", body });
      expect(bad.status, JSON.stringify(body)).toBe(422);
      expect(bad.body.error.code).toBe("VALIDATION");
    }
    expect(await prisma.salesReturn.count()).toBe(0);
  });

  it("keeps the ERP's own return as it was: no QC choice without the QC permission, no walk-in returns", async () => {
    const order = await websiteOrder(shop, "WEB-2007", [[navyM, 2]], { deliver: true });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    const line = await prisma.salesOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
    // The return screen takes no walk-in sale.
    const walkIn = await expectAppError(
      returns.createSalesReturn(shop.accounts, {
        invoiceId: invoice.id,
        items: [{ orderItemId: line.id, quantity: 1 }],
        reason: "Size problem",
      }),
      "CONFLICT",
    );
    expect(walkIn.message).toContain("walk-in");
    // Putting pieces back into sellable stock is QC work (sales.returns.qc).
    await expectAppError(
      returns.createSalesReturn(
        shop.accounts,
        {
          invoiceId: invoice.id,
          items: [{ orderItemId: line.id, quantity: 1, qc: "GOOD" }],
          reason: "Size problem",
        },
        undefined,
        { walkInCredit: true },
      ),
      "FORBIDDEN",
    );
    expect(await prisma.salesReturn.count()).toBe(0);
  });
});

/** What the Walk-in customers account owes on the books (Receivable debits less credits). */
async function walkInBalance(shop: Shop) {
  const acc = await ensureControlAccounts(shop.company.id);
  const agg = await prisma.journalLine.aggregate({
    where: { accountId: acc.RECEIVABLE, partyId: await ensureWalkInParty(shop.company.id) },
    _sum: { debit: true, credit: true },
  });
  return new Prisma.Decimal(agg._sum.debit ?? 0).minus(agg._sum.credit ?? 0).toFixed(2);
}

const orderMoney = async (orderId: string) => {
  const o = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { invoice: true },
  });
  return {
    paid: o.paidAmount.toFixed(2),
    due: o.dueAmount.toFixed(2),
    invoiceDue: o.invoice!.dueAmount.toFixed(2),
    invoiceStatus: o.invoice!.status,
  };
};

run("E-commerce API: a website return's credit (CN-005 review)", () => {
  let shop: Shop;
  let navyM: string;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    navyM = shop.sku("EX-PL-001", "Navy", "M");
  });

  const returnOne = (externalOrderId: string, extra: Record<string, unknown> = {}) =>
    callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId,
        reason: "Size problem",
        items: [{ sku: navyM, quantity: 1, qc: "GOOD" }],
        ...extra,
      },
    });

  it("pays an unpaid COD order's due with the credit: the courier collects only for what was kept", async () => {
    const order = await websiteOrder(shop, "WEB-3001", [[navyM, 2]], { deliver: true });
    const walkIn = await ensureWalkInParty(shop.company.id);
    expect(await orderMoney(order.id)).toMatchObject({ due: "2900.00", invoiceStatus: "UNPAID" });

    const res = await returnOne("WEB-3001");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      credited: 1450,
      usedOnOrder: 1450,
      toPayBack: 0,
      orderDue: 1450,
    });
    expect(await orderMoney(order.id)).toEqual({
      paid: "1450.00",
      due: "1450.00",
      invoiceDue: "1450.00",
      invoiceStatus: "PARTIALLY_PAID",
    });
    const allocations = await prisma.creditAllocation.findMany();
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      salesReturnId: res.body.erpReturnId,
      orderId: order.id,
      partyId: walkIn,
      paymentId: null,
      releasedAt: null,
    });
    expect(allocations[0]!.amount.toFixed(2)).toBe("1450.00");
    expect(await walkInBalance(shop)).toBe("1450.00");
    const screen = await returnScreens.getSalesReturnScreen(shop.accounts, res.body.erpReturnId);
    expect(screen.walkInCredit).toEqual({
      usedOnInvoice: "1450.00",
      paidBack: "0.00",
      left: "0.00",
    });
    expect(screen.can.payBackKinds).toEqual([]);
    expect(screen.salesReturn.invoice.due).toBe("1450.00");
    await expectBooksOk(shop);

    // The courier collects the rest. More than due plus the return's credit is refused.
    const tooMuch = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3001", amount: 2900.01, method: "COD" },
    });
    expect(tooMuch.status).toBe(422);
    const cod = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3001", amount: 1450, method: "COD" },
    });
    expect(cod.status).toBe(201);
    expect(cod.body).toMatchObject({ orderPaid: 2900, orderDue: 0 });
    expect((await orderMoney(order.id)).invoiceStatus).toBe("PAID");
    expect(await walkInBalance(shop)).toBe("0.00");
    await expectBooksOk(shop);

    // Voiding the return releases the allocation: the piece is owed for again.
    await returns.voidSalesReturn(shop.accounts, res.body.erpReturnId, {
      reason: "Recorded by mistake",
    });
    const released = await prisma.creditAllocation.findFirstOrThrow();
    expect(released.releasedAt).not.toBeNull();
    expect(released.releaseReason).toContain("voided");
    expect(await orderMoney(order.id)).toEqual({
      paid: "1450.00",
      due: "1450.00",
      invoiceDue: "1450.00",
      invoiceStatus: "PARTIALLY_PAID",
    });
    expect(await walkInBalance(shop)).toBe("1450.00");
    await expectBooksOk(shop);
  });

  it("uses part of the credit on a part-paid order and leaves the rest to pay back", async () => {
    const order = await websiteOrder(shop, "WEB-3002", [[navyM, 2]]);
    const paid = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3002", amount: 2000, method: "BKASH", reference: "TRX-P1" },
    });
    expect(paid.status).toBe(201);
    await documents.issueInvoice(shop.owner, order.id);
    await documents.createDeliveryChallan(shop.owner, order.id);
    const res = await returnOne("WEB-3002");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      credited: 1450,
      usedOnOrder: 900,
      toPayBack: 550,
      orderDue: 0,
    });
    expect(await orderMoney(order.id)).toMatchObject({ due: "0.00", invoiceStatus: "PAID" });
    const screen = await returnScreens.getSalesReturnScreen(shop.accounts, res.body.erpReturnId);
    expect(screen.walkInCredit).toEqual({
      usedOnInvoice: "900.00",
      paidBack: "0.00",
      left: "550.00",
    });
    expect(screen.can.payBackKinds).toContain("CASH");
    expect(screen.can.payBackKinds).not.toContain("CREDIT");
    // What the company owes the customer sits on the Walk-in customers account.
    expect(await walkInBalance(shop)).toBe("-550.00");
    await expectBooksOk(shop);
  });

  it("leaves a prepaid order's credit for Accounts to pay back; voiding waits for that refund", async () => {
    const order = await websiteOrder(shop, "WEB-3003", [[navyM, 2]]);
    const walkIn = await ensureWalkInParty(shop.company.id);
    await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3003", amount: 2900, method: "BKASH", reference: "TRX-P2" },
    });
    await documents.issueInvoice(shop.owner, order.id);
    await documents.createDeliveryChallan(shop.owner, order.id);
    const res = await returnOne("WEB-3003");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      credited: 1450,
      usedOnOrder: 0,
      toPayBack: 1450,
      orderDue: 0,
    });
    expect(await prisma.creditAllocation.count()).toBe(0);
    expect(await walkInBalance(shop)).toBe("-1450.00");
    const returnId = res.body.erpReturnId as string;

    // The shop's account can never pay money out: the API only reports what is left.
    expect(SHOP_PERMISSIONS).not.toContain("accounts.payments.record");
    expect(SHOP_PERMISSIONS).not.toContain("accounts.manage");

    // Accounts pays it back from the credit note: no more than is left, never as credit.
    const more = await expectAppError(
      refunds.refundBuyer(shop.accounts, {
        salesReturnId: returnId,
        kind: "CASH",
        method: "BKASH",
        amount: 1450.01,
        reason: "Customer returned one shirt",
      }),
      "VALIDATION",
    );
    expect(more.message).toContain("1450.00");
    await expectAppError(
      refunds.refundBuyer(shop.accounts, {
        salesReturnId: returnId,
        kind: "CREDIT",
        amount: 100,
        reason: "Customer returned one shirt",
      }),
      "VALIDATION",
    );
    // Only Accounts' money key pays money back.
    const sales = await expectAppError(
      refunds.refundBuyer(
        { ...shop.accounts, can: (key: string) => key !== "accounts.payments.record" },
        {
          salesReturnId: returnId,
          kind: "CASH",
          method: "BKASH",
          amount: 100,
          reason: "Customer returned one shirt",
        },
      ),
      "FORBIDDEN",
    );
    expect(sales.message).toContain("Accounts");

    const first = await refunds.refundBuyer(shop.accounts, {
      salesReturnId: returnId,
      kind: "CASH",
      method: "BKASH",
      reference: "TRX-BACK-1",
      amount: 1000,
      reason: "Customer returned one shirt",
    });
    expect(first).toMatchObject({ salesReturnId: returnId, partyId: null, orderId: null });
    const acc = await ensureControlAccounts(shop.company.id);
    const lines = await entryLines(shop.company.id, first.journalEntryId!);
    expect(lines.net).toEqual({ RECEIVABLE: "1000.00", MOBILE_WALLET: "-1000.00" });
    expect(lines.parties.RECEIVABLE).toBe(walkIn);
    expect(acc.MOBILE_WALLET).toBeDefined();
    // The order keeps what it was paid: this is the return's credit, not its money.
    expect(await orderMoney(order.id)).toMatchObject({ paid: "2900.00", due: "0.00" });
    expect(await walkInBalance(shop)).toBe("-450.00");

    let screen = await returnScreens.getSalesReturnScreen(shop.accounts, returnId);
    expect(screen.walkInCredit).toEqual({
      usedOnInvoice: "0.00",
      paidBack: "1000.00",
      left: "450.00",
    });
    expect(screen.can.void).toBe(false);
    expect(screen.notes.void).toContain("paid back");
    const blocked = await expectAppError(
      returns.voidSalesReturn(shop.accounts, returnId, { reason: "Recorded by mistake" }),
      "CONFLICT",
    );
    expect(blocked.message).toContain(first.number);

    // The voucher names the customer, the credit note and the order.
    const { model } = await buildDocument(
      shop.accounts,
      printRequestSchema.parse({ type: "REFUND_VOUCHER", id: first.id }),
      new Date(),
    );
    expect(model.parties[0]!.lines[0]).toBe("Nusrat Jahan");
    expect(model.meta).toEqual(
      expect.arrayContaining([
        { label: "Credit note no.", value: res.body.erpReturnNumber },
        { label: "Order no.", value: order.number },
      ]),
    );
    // The refunds list links it to the credit note.
    const { listRefundRows } = await import("@/modules/sales/screens.service");
    const rows = await listRefundRows(shop.accounts);
    expect(rows.items[0]!.salesReturn).toEqual({ id: returnId, number: res.body.erpReturnNumber });

    const rest = await refunds.refundBuyer(shop.accounts, {
      salesReturnId: returnId,
      kind: "CASH",
      method: "CASH",
      amount: 450,
      reason: "Customer returned one shirt",
    });
    await expectAppError(
      refunds.refundBuyer(shop.accounts, {
        salesReturnId: returnId,
        kind: "CASH",
        method: "CASH",
        amount: 1,
        reason: "Customer returned one shirt",
      }),
      "CONFLICT",
    );
    screen = await returnScreens.getSalesReturnScreen(shop.accounts, returnId);
    expect(screen.walkInCredit!.left).toBe("0.00");
    expect(screen.can.payBackKinds).toEqual([]);
    expect(await walkInBalance(shop)).toBe("0.00");
    await expectBooksOk(shop);

    // Voiding both refunds puts the credit back; then the return can be voided.
    await refunds.voidRefund(shop.accounts, rest.id, { reason: "Recorded by mistake" });
    await refunds.voidRefund(shop.accounts, first.id, { reason: "Recorded by mistake" });
    expect((await returnScreens.getSalesReturnScreen(shop.accounts, returnId)).can.void).toBe(true);
    await returns.voidSalesReturn(shop.accounts, returnId, { reason: "Recorded by mistake" });
    expect(await orderMoney(order.id)).toMatchObject({ paid: "2900.00", due: "0.00" });
    expect(await walkInBalance(shop)).toBe("0.00");
    await expectAppError(
      refunds.refundBuyer(shop.accounts, {
        salesReturnId: returnId,
        kind: "CASH",
        method: "CASH",
        amount: 1,
        reason: "Customer returned one shirt",
      }),
      "CONFLICT",
    );
    await expectBooksOk(shop);
  });

  it("takes the full COD collected before a return: the credit becomes the customer's to pay back", async () => {
    const order = await websiteOrder(shop, "WEB-3005", [[navyM, 2]], { deliver: true });
    const ret = await returnOne("WEB-3005");
    expect(ret.body).toMatchObject({ usedOnOrder: 1450, orderDue: 1450 });
    // The courier had collected 2900 at the door; its remittance comes after the return.
    const cod = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3005", amount: 2900, method: "COD", reference: "SF-77" },
    });
    expect(cod.status).toBe(201);
    expect(cod.body).toMatchObject({ amount: 2900, orderPaid: 2900, orderDue: 0 });
    const rows = await prisma.creditAllocation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.releasedAt).not.toBeNull();
    expect(rows[0]!.releaseReason).toContain("left to pay back");
    expect(await orderMoney(order.id)).toEqual({
      paid: "2900.00",
      due: "0.00",
      invoiceDue: "0.00",
      invoiceStatus: "PAID",
    });
    const screen = await returnScreens.getSalesReturnScreen(shop.accounts, ret.body.erpReturnId);
    expect(screen.walkInCredit).toEqual({
      usedOnInvoice: "0.00",
      paidBack: "0.00",
      left: "1450.00",
    });
    expect(screen.can.payBackKinds).toContain("CASH");
    expect(await walkInBalance(shop)).toBe("-1450.00");
    await expectBooksOk(shop);

    // Accounts pays the customer back from the credit note.
    await refunds.refundBuyer(shop.accounts, {
      salesReturnId: ret.body.erpReturnId,
      kind: "CASH",
      method: "BKASH",
      reference: "TRX-BACK-77",
      amount: 1450,
      reason: "Customer returned one shirt",
    });
    expect(await walkInBalance(shop)).toBe("0.00");
    expect(await orderMoney(order.id)).toMatchObject({ paid: "2900.00", due: "0.00" });
    await expectBooksOk(shop);
  });

  it("takes a prepaid bKash synced after every piece came back", async () => {
    const order = await websiteOrder(shop, "WEB-3006", [[navyM, 2]], { deliver: true });
    const ret = await callShop(shop, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-3006",
        reason: "Size problem",
        items: [{ sku: navyM, quantity: 2, qc: "GOOD" }],
      },
    });
    expect(ret.body).toMatchObject({ usedOnOrder: 2900, orderDue: 0, orderStatus: "RETURNED" });
    // The credit paid it in full, yet the bKash paid at checkout is still to be recorded.
    const bkash = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3006", amount: 2900, method: "BKASH", reference: "TRX-LATE" },
    });
    expect(bkash.status).toBe(201);
    expect(bkash.body).toMatchObject({ orderPaid: 2900, orderDue: 0 });
    expect(await prisma.creditAllocation.count({ where: { releasedAt: null } })).toBe(0);
    const screen = await returnScreens.getSalesReturnScreen(shop.accounts, ret.body.erpReturnId);
    expect(screen.walkInCredit!.left).toBe("2900.00");
    expect(await walkInBalance(shop)).toBe("-2900.00");
    expect((await orderMoney(order.id)).paid).toBe("2900.00");
    await expectBooksOk(shop);
  });

  it("takes part of the credit's place, in the ERP too, and never more than due plus the credit", async () => {
    const order = await websiteOrder(shop, "WEB-3007", [[navyM, 2]], { deliver: true });
    const ret = await returnOne("WEB-3007");
    const tooMuch = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3007", amount: 2900.01, method: "COD", reference: "SF-1" },
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.message).toContain("2900.00");
    await expectAppError(
      receipts.receivePayment(shop.accounts, {
        orderId: order.id,
        amount: 2900.01,
        method: "CASH",
      }),
      "VALIDATION",
    );

    // 2000 comes in: 1450 was due, so 550 of the credit steps aside (the allocation is
    // released and a smaller one takes its place).
    const part = await callShop(shop, postPayment, {
      path: "/payments",
      body: { externalOrderId: "WEB-3007", amount: 2000, method: "COD", reference: "SF-2" },
    });
    expect(part.status).toBe(201);
    const rows = await prisma.creditAllocation.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.amount.toFixed(2), r.releasedAt === null])).toEqual([
      ["1450.00", false],
      ["900.00", true],
    ]);
    expect(rows[1]!.salesReturnId).toBe(ret.body.erpReturnId);
    let screen = await returnScreens.getSalesReturnScreen(shop.accounts, ret.body.erpReturnId);
    expect(screen.walkInCredit).toMatchObject({ usedOnInvoice: "900.00", left: "550.00" });
    await expectBooksOk(shop);

    // In the ERP: the order offers to receive up to what the credit still pays.
    const { getOrderScreen } = await import("@/modules/sales/screens.service");
    const view = await getOrderScreen(shop.accounts, order.id);
    expect(view.can.receive).toBe(true);
    expect(view.can.receiveUpTo).toBe("900.00");
    await receipts.receivePayment(shop.accounts, {
      orderId: order.id,
      amount: 900,
      method: "CASH",
    });
    screen = await returnScreens.getSalesReturnScreen(shop.accounts, ret.body.erpReturnId);
    expect(screen.walkInCredit).toMatchObject({ usedOnInvoice: "0.00", left: "1450.00" });
    expect(await orderMoney(order.id)).toMatchObject({ paid: "2900.00", due: "0.00" });
    const after = await getOrderScreen(shop.accounts, order.id);
    expect(after.can.receive).toBe(false);
    expect(after.can.receiveUpTo).toBeNull();
    await expectBooksOk(shop);

    // Voiding the return now leaves the cash as paid: nothing was allocated any more.
    await returns.voidSalesReturn(shop.accounts, ret.body.erpReturnId, {
      reason: "Recorded by mistake",
    });
    expect(await orderMoney(order.id)).toMatchObject({ paid: "2900.00", due: "0.00" });
    await expectBooksOk(shop);
  });

  it("takes the shop's own return id once: 409 RETURN_EXISTS, also when two come at once", async () => {
    await websiteOrder(shop, "WEB-3004", [[navyM, 4]], { deliver: true });
    const first = await returnOne("WEB-3004", { externalReturnId: "RMA-1" });
    expect(first.status).toBe(201);
    expect(first.body.externalReturnId).toBe("RMA-1");
    const stored = await prisma.salesReturn.findUniqueOrThrow({
      where: { id: first.body.erpReturnId },
    });
    expect(stored).toMatchObject({
      integrationId: shop.integration.id,
      externalReturnId: "RMA-1",
    });

    // Sent again under a new Idempotency-Key: the same return, not recorded twice.
    const again = await returnOne("WEB-3004", { externalReturnId: " RMA-1 " });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: "RETURN_EXISTS",
      details: { erpReturnId: first.body.erpReturnId },
    });
    expect(await prisma.salesReturn.count()).toBe(1);

    // Another id is another return; two at once with one id make one return.
    expect((await returnOne("WEB-3004", { externalReturnId: "RMA-2" })).status).toBe(201);
    const both = await Promise.all([
      returnOne("WEB-3004", { externalReturnId: "RMA-3" }),
      returnOne("WEB-3004", { externalReturnId: "RMA-3" }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(both.find((r) => r.status === 409)!.body.error.code).toBe("RETURN_EXISTS");
    expect(await prisma.salesReturn.count()).toBe(3);

    // Another shop of the company may use the same id for its own return.
    const second = await createIntegration(shop.owner, {
      name: "Second shop",
      warehouseId: shop.warehouse.id,
    });
    const keys = await giveKey(second.id);
    await websiteOrder(shop, "WEB-2ND-1", [[navyM, 1]], {
      deliver: true,
      integrationId: second.id,
    });
    const theirs = await callShop(keys, postReturn, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-2ND-1",
        externalReturnId: "RMA-1",
        reason: "Size problem",
        items: [{ sku: navyM, quantity: 1, qc: "GOOD" }],
      },
    });
    expect(theirs.status).toBe(201);

    const long = await returnOne("WEB-3004", { externalReturnId: "R".repeat(101) });
    expect(long.status).toBe(422);
    expect(long.body.error.details).toHaveProperty("externalReturnId");
    await expectBooksOk(shop);
  });
});

run("E-commerce API: ad spend (CN-005)", () => {
  let shop: Shop;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
  });

  it("keeps one figure per day, platform and campaign: a repeat replaces it", async () => {
    const day = daysAgo(1);
    const first = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body: { date: day, platform: "facebook", amount: 1200.5, campaign: "Puja sale" },
    });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      erpAdSpendId: expect.any(String),
      date: day,
      platform: "FACEBOOK",
      campaign: "Puja sale",
      amount: 1200.5,
      replaced: false,
    });
    const later = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body: { date: day, platform: "FACEBOOK", amount: 1850, campaign: "Puja sale" },
    });
    expect(later.status).toBe(200);
    expect(later.body).toEqual({ ...first.body, amount: 1850, replaced: true });
    // No campaign is its own figure, and so is another platform or day.
    const none = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body: { date: day, platform: "FACEBOOK", amount: 300 },
    });
    expect(none.status).toBe(201);
    expect(none.body.campaign).toBeNull();
    const blank = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body: { date: day, platform: "FACEBOOK", amount: 350, campaign: "" },
    });
    expect(blank.status).toBe(200);
    expect(blank.body).toMatchObject({ erpAdSpendId: none.body.erpAdSpendId, replaced: true });
    expect(
      (
        await callShop(shop, postAdSpend, {
          path: "/ad-spend",
          body: { date: day, platform: "GOOGLE", amount: 90, campaign: "Puja sale" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await callShop(shop, postAdSpend, {
          path: "/ad-spend",
          body: { date: today(), platform: "FACEBOOK", amount: 0, campaign: "Puja sale" },
        })
      ).status,
    ).toBe(201);

    const rows = await prisma.adSpend.findMany({ orderBy: [{ date: "asc" }, { amount: "asc" }] });
    expect(
      rows.map((r) => [
        localDay(r.date, "UTC"),
        r.platform,
        r.campaign,
        r.amount.toFixed(2),
        r.companyId,
      ]),
    ).toEqual([
      [day, "GOOGLE", "Puja sale", "90.00", shop.company.id],
      [day, "FACEBOOK", null, "350.00", shop.company.id],
      [day, "FACEBOOK", "Puja sale", "1850.00", shop.company.id],
      [today(), "FACEBOOK", "Puja sale", "0.00", shop.company.id],
    ]);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "AdSpend", entityId: first.body.erpAdSpendId },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual(["CREATE", "UPDATE"]);
    expect(audit[1]!.userId).toBe(await shopUserOf(shop.integration.id));
    expect(audit[1]!.before).toMatchObject({ amount: "1200.50" });
  });

  it("answers a repeat with the first result and keeps one row when two come at once", async () => {
    const body = { date: today(), platform: "TIKTOK", amount: 500 };
    const first = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body,
      idempotencyKey: "ads-1",
    });
    const again = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body,
      idempotencyKey: "ads-1",
    });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);

    const both = await Promise.all(
      [700, 800].map((amount) =>
        callShop(shop, postAdSpend, {
          path: "/ad-spend",
          body: { date: today(), platform: "INSTAGRAM", amount, campaign: "Eid" },
        }),
      ),
    );
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await prisma.adSpend.count({ where: { platform: "INSTAGRAM" } })).toBe(1);
    expect(await prisma.adSpend.count()).toBe(2);
  });

  it("keeps each shop's figures apart, and never replaces ad spend entered in the ERP", async () => {
    const day = daysAgo(2);
    const erpRow = await prisma.adSpend.create({
      data: {
        companyId: shop.company.id,
        date: new Date(`${day}T00:00:00Z`),
        platform: "FACEBOOK",
        amount: 300,
      },
    });
    const second = await createIntegration(shop.owner, {
      name: "Second shop",
      warehouseId: shop.warehouse.id,
    });
    const keys = await giveKey(second.id);
    const body = { date: day, platform: "FACEBOOK", amount: 1000 };
    const ours = await callShop(shop, postAdSpend, { path: "/ad-spend", body });
    const theirs = await callShop(keys, postAdSpend, {
      path: "/ad-spend",
      body: { ...body, amount: 2000 },
    });
    expect([ours.status, theirs.status]).toEqual([201, 201]);
    // Each shop's repeat replaces only its own figure.
    const oursAgain = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body: { ...body, amount: 1100 },
    });
    expect(oursAgain.status).toBe(200);
    expect(oursAgain.body).toMatchObject({ erpAdSpendId: ours.body.erpAdSpendId, replaced: true });
    const rows = await prisma.adSpend.findMany({ orderBy: { amount: "asc" } });
    expect(rows.map((r) => [r.integrationId, r.amount.toFixed(2)])).toEqual([
      [null, "300.00"],
      [shop.integration.id, "1100.00"],
      [second.id, "2000.00"],
    ]);
    expect(rows[0]!.id).toBe(erpRow.id);
  });

  it("refuses a bad key, a bad day, platform or amount, and a day still to come", async () => {
    const noKey = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body: { date: today(), platform: "FACEBOOK", amount: 1 },
      key: null,
    });
    expect(noKey.status).toBe(401);
    const unsigned = await callShop(shop, postAdSpend, {
      path: "/ad-spend",
      body: { date: today(), platform: "FACEBOOK", amount: 1 },
      sign: false,
    });
    expect(unsigned.status).toBe(401);
    for (const body of [
      { date: "22-10-2026", platform: "FACEBOOK", amount: 1 },
      { date: "2026-02-30", platform: "FACEBOOK", amount: 1 },
      { date: today(), platform: "SNAPCHAT", amount: 1 },
      { date: today(), platform: "FACEBOOK", amount: -1 },
      { date: today(), platform: "FACEBOOK" },
      { date: localDay(new Date(Date.now() + 3 * 86_400_000), TZ), platform: "GOOGLE", amount: 1 },
    ]) {
      const bad = await callShop(shop, postAdSpend, { path: "/ad-spend", body });
      expect(bad.status, JSON.stringify(body)).toBe(422);
      expect(bad.body.error.code).toBe("VALIDATION");
    }
    expect(await prisma.adSpend.count()).toBe(0);
  });
});
