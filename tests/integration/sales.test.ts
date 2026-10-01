import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as customFields from "@/modules/sales/custom-fields.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as summary from "@/modules/sales/summary.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company with a polo style (Navy / White x S M L XL, wholesale 900, retail
 * 1450), 10 pcs of each SKU at cost 500, a wholesale buyer and a Sales Executive.
 */
async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
  const admin = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(admin.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(admin.id, company.id);
  const seller = await makeUser(`sales@${company.slug}.test`);
  await addToCompany(seller.id, company.id, roles.SALES_EXECUTIVE);
  const salesCtx = await contextFor(seller.id, company.id);

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
  const warehouse = await stock.getDefaultWarehouse(ctx);
  return { ctx, salesCtx, company, style, tops, sku, buyer, warehouse };
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

const cell = async (env: Env, variantId: string) =>
  (await stock.stockByVariant(env.ctx, [variantId])).get(variantId)!;
const balanceOf = async (env: Env, partyId: string) =>
  (await ledger.getPartyBalance(env.ctx, partyId)).toFixed(2);

/** Wholesale matrix order: Navy S/M/L/XL = 2/4/4/2 at the wholesale price. */
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
          [env.sku("White", "S")]: 0,
        },
      },
    ],
    ...extra,
  });

/** Every journal entry of the company balances. */
async function expectBooksBalanced(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT je.number FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${companyId}
    GROUP BY je.id HAVING SUM(jl.debit) <> SUM(jl.credit)`;
  expect(rows).toEqual([]);
}

run("quotations", () => {
  beforeEach(resetDb);

  it("builds a quotation with sizes, styling rules and custom fields", async () => {
    const env = await setup();
    const { ctx } = env;
    await customFields.createCustomField(ctx, {
      entity: "QUOTATION",
      key: "gsm",
      label: "Fabric GSM",
      fieldType: "NUMBER",
      isRequired: true,
    });
    await customFields.createCustomField(ctx, {
      entity: "QUOTATION",
      key: "washType",
      label: "Wash type",
      fieldType: "SELECT",
      options: ["Enzyme", "Silicon"],
    });

    const q = await quotations.createQuotation(ctx, {
      partyId: env.buyer.id,
      validUntil: "2099-12-31",
      items: [
        {
          categoryId: env.tops.id,
          styleId: env.style.id,
          description: "Pique polo with tipping",
          fabric: "100% cotton pique",
          sizeBreakdown: { S: 100, M: 200, L: 200, XL: 100 },
          unitPrice: 650,
        },
        { description: "Custom woven labels", quantity: 600, unitPrice: 2.5 },
      ],
      stylingRules: [
        { area: "Placket", instruction: "The placket should not have a black border" },
        { area: "Collar & Cuff", instruction: "Golden color should be a little brighter" },
      ],
      discount: 1500,
      tax: 0,
      customFields: { gsm: "220", washType: "Enzyme" },
    });
    expect(q.number).toMatch(/^QT-\d{4}-00001$/);
    expect(q.items.map((i) => [i.quantity, i.lineTotal.toFixed(2)])).toEqual([
      [600, "390000.00"],
      [600, "1500.00"],
    ]);
    expect(q.subtotal.toFixed(2)).toBe("391500.00");
    expect(q.total.toFixed(2)).toBe("390000.00");
    expect(q.stylingRules.map((r) => r.area)).toEqual(["Placket", "Collar & Cuff"]);
    expect(q.customFieldValues).toEqual([
      { key: "gsm", label: "Fabric GSM", value: 220 },
      { key: "washType", label: "Wash type", value: "Enzyme" },
    ]);
    expect(q.letterhead.name).toBe("Extras");
    expect(q.isExpired).toBe(false);

    // Custom field rules.
    const base = {
      partyId: env.buyer.id,
      items: [{ description: "Tee", quantity: 1, unitPrice: 1 }],
    };
    await expectAppError(quotations.createQuotation(ctx, base), "VALIDATION"); // gsm required
    await expectAppError(
      quotations.createQuotation(ctx, { ...base, customFields: { gsm: 180, washType: "Stone" } }),
      "VALIDATION",
    );
    await expectAppError(
      quotations.createQuotation(ctx, { ...base, customFields: { gsm: 180, colour: "red" } }),
      "VALIDATION",
    );
    await expect(
      quotations.createQuotation(ctx, {
        ...base,
        customFields: { gsm: 180 },
        items: [{ description: "Tee", quantity: 5, sizeBreakdown: { S: 2, M: 2 }, unitPrice: 1 }],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("edits drafts, moves through statuses and refuses suppliers", async () => {
    const env = await setup();
    const { ctx } = env;
    const q = await quotations.createQuotation(ctx, {
      partyId: env.buyer.id,
      items: [{ description: "Hoodie", quantity: 100, unitPrice: 1200 }],
    });
    const edited = await quotations.updateQuotation(ctx, q.id, {
      items: [
        { description: "Hoodie", quantity: 150, unitPrice: 1150 },
        { description: "Joggers", quantity: 50, unitPrice: 800 },
      ],
      discount: 2500,
    });
    expect(edited.total.toFixed(2)).toBe("210000.00");
    expect(edited.items).toHaveLength(2);
    const discounted = await quotations.updateQuotation(ctx, q.id, { tax: 1000 });
    expect(discounted.total.toFixed(2)).toBe("211000.00");

    await quotations.setQuotationStatus(ctx, q.id, { status: "SENT" });
    await expectAppError(quotations.setQuotationStatus(ctx, q.id, { status: "SENT" }), "CONFLICT");
    await quotations.setQuotationStatus(ctx, q.id, { status: "ACCEPTED" });
    await expectAppError(quotations.updateQuotation(ctx, q.id, { tax: 0 }), "CONFLICT");
    await expectAppError(quotations.deleteQuotation(ctx, q.id), "CONFLICT");

    const supplier = (await parties.createParty(ctx, { kind: "SUPPLIER", name: "Knit Mill" }))
      .party;
    await expectAppError(
      quotations.createQuotation(ctx, {
        partyId: supplier.id,
        items: [{ description: "x", quantity: 1, unitPrice: 1 }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      quotations.createQuotation(ctx, {
        partyId: env.buyer.id,
        items: [{ description: "x", quantity: 10, unitPrice: 1 }],
        discount: 11,
      }),
      "VALIDATION",
    );

    const draft = await quotations.createQuotation(ctx, {
      partyId: env.buyer.id,
      items: [{ description: "Draft", quantity: 1, unitPrice: 1 }],
    });
    await quotations.deleteQuotation(ctx, draft.id);
    const list = await quotations.listQuotations(ctx, { status: "ACCEPTED" });
    expect(list.items.map((i) => i.number)).toEqual([q.number]);
  });
});

run("proforma, advance and production", () => {
  beforeEach(resetDb);

  it("converts a quotation, takes the 30% advance, starts production, then becomes an order", async () => {
    const env = await setup();
    const { ctx } = env;
    const q = await quotations.createQuotation(ctx, {
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
    const pi = await proformas.convertQuotationToProforma(ctx, q.id);
    expect(pi.number).toMatch(/^PI-\d{4}-00001$/);
    expect(pi.total.toFixed(2)).toBe("12000.00");
    expect(pi.advanceAmount.toFixed(2)).toBe("3600.00");
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe(
      "CONVERTED",
    );
    await expectAppError(proformas.convertQuotationToProforma(ctx, q.id), "CONFLICT");

    // Part of the advance: nothing starts yet.
    const first = await payments.receivePayment(ctx, {
      proformaId: pi.id,
      amount: 2000,
      method: "BKASH",
    });
    expect(first.productionProject).toBeNull();
    expect(await balanceOf(env, env.buyer.id)).toBe("-2000.00"); // advance held for the buyer
    await expectAppError(
      proformas.cancelProforma(ctx, pi.id, { reason: "Buyer changed mind" }),
      "CONFLICT",
    );
    await expectAppError(
      proformas.convertProformaToOrder(ctx, pi.id, {
        lines: [{ variantId: env.sku("Navy", "S"), quantity: 1 }],
      }),
      "CONFLICT",
    );

    // Rest of the advance: production starts.
    const second = await payments.receivePayment(ctx, {
      proformaId: pi.id,
      amount: 1600,
      method: "BANK_TRANSFER",
    });
    expect(second.productionProject?.code).toMatch(/^PRD-\d{4}-00001$/);
    const project = await prisma.productionProject.findUniqueOrThrow({
      where: { id: second.productionProject!.id },
      include: { stageLogs: true },
    });
    expect(project).toMatchObject({
      buyerId: env.buyer.id,
      proformaId: pi.id,
      targetQuantity: 12,
      styleId: env.style.id,
    });
    expect(project.stageLogs.map((s) => s.stage)).toEqual(["FABRIC_SOURCING"]);
    const afterAdvance = await proformas.getProforma(ctx, pi.id);
    expect(afterAdvance.status).toBe("IN_PRODUCTION");
    expect(afterAdvance.advanceDue.toFixed(2)).toBe("0.00");
    await expectAppError(
      payments.receivePayment(ctx, { proformaId: pi.id, amount: 8400.01, method: "CASH" }),
      "VALIDATION",
    );

    // Goods ready: the proforma becomes an order and the advance moves with it.
    const order = await proformas.convertProformaToOrder(ctx, pi.id, {
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
    expect(order).toMatchObject({ channel: "B2B_PREORDER", proformaId: pi.id });
    expect(order.paidAmount.toFixed(2)).toBe("3600.00");
    expect(order.dueAmount.toFixed(2)).toBe("8400.00");
    expect(order.payments).toHaveLength(2);
    expect((await proformas.getProforma(ctx, pi.id)).status).toBe("CONVERTED");

    // Invoicing applies the advance: the buyer owes the rest.
    const invoice = await documents.issueInvoice(ctx, order.id);
    expect(invoice).toMatchObject({ status: "PARTIALLY_PAID" });
    expect(invoice.dueAmount.toFixed(2)).toBe("8400.00");
    expect(await balanceOf(env, env.buyer.id)).toBe("8400.00");
    await expectBooksBalanced(env.company.id);
  });

  it("cancels an unpaid proforma and frees its quotation", async () => {
    const env = await setup();
    const q = await quotations.createQuotation(env.ctx, {
      partyId: env.buyer.id,
      items: [{ description: "Caps", quantity: 100, unitPrice: 150 }],
    });
    const pi = await proformas.convertQuotationToProforma(env.ctx, q.id, { advancePercent: 50 });
    expect(pi.advanceAmount.toFixed(2)).toBe("7500.00");
    const cancelled = await proformas.cancelProforma(env.ctx, pi.id, { reason: "Buyer delayed" });
    expect(cancelled.status).toBe("CANCELLED");
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe(
      "ACCEPTED",
    );
    const again = await proformas.convertQuotationToProforma(env.ctx, q.id);
    expect(again.number).toMatch(/-00002$/);
  });
});

run("orders, stock and Force Override", () => {
  beforeEach(resetDb);

  it("reserves stock on checkout and posts the invoice to the buyer's ledger", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env);
    expect(order.number).toMatch(/^SO-\d{4}-00001$/);
    expect(order.status).toBe("CONFIRMED");
    expect(order.items).toHaveLength(4);
    expect(order.total.toFixed(2)).toBe("10800.00"); // 12 pcs x 900
    expect(await cell(env, env.sku("Navy", "M"))).toEqual({
      aGrade: 10,
      bGrade: 0,
      reserved: 4,
      available: 6,
    });

    expect(order.invoice).toMatchObject({ status: "UNPAID" });
    expect(order.invoice!.number).toMatch(/^INV-\d{4}-00001$/);
    expect(order.invoice!.dueDate).toBeInstanceOf(Date); // 30-day terms
    expect(await balanceOf(env, env.buyer.id)).toBe("10800.00");
    const statement = await ledger.getStatement(env.ctx, env.buyer.id);
    expect(statement.lines.map((l) => [l.sourceType, l.debit])).toEqual([["SALE", "10800.00"]]);
    const buyer = await prisma.party.findUniqueOrThrow({ where: { id: env.buyer.id } });
    expect(buyer.lastTransactionAt).toBeInstanceOf(Date);
    await expectBooksBalanced(env.company.id);
  });

  it("blocks selling beyond stock unless Force Override is allowed and ticked", async () => {
    const env = await setup();
    const line = { variantId: env.sku("White", "L"), quantity: 14 };
    const err = await expectAppError(
      orders.createOrder(env.ctx, { channel: "WHOLESALE", partyId: env.buyer.id, lines: [line] }),
      "INSUFFICIENT_STOCK",
    );
    expect(err.details).toEqual({ "stock.EX-PL-001-WHITE-L": ["Requested 14, available 10"] });

    // A Sales Executive may not override by default.
    await expectAppError(
      orders.createOrder(env.salesCtx, {
        channel: "WHOLESALE",
        partyId: env.buyer.id,
        lines: [line],
        forceOverride: { reason: "Factory delivers tomorrow" },
      }),
      "FORBIDDEN",
    );

    const order = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [line, { variantId: env.sku("White", "M"), quantity: 1 }],
      forceOverride: { reason: "Factory delivers tomorrow" },
    });
    expect(order.hasForceOverride).toBe(true);
    const overridden = order.items.find((i) => i.variantId === line.variantId)!;
    expect(overridden).toMatchObject({
      forceOverride: true,
      availableAtSale: 10,
      overrideReason: "Factory delivers tomorrow",
    });
    expect(order.items.find((i) => i.variantId !== line.variantId)!.forceOverride).toBe(false);
    expect((await cell(env, line.variantId)).available).toBe(-4);

    // Delivering it all takes the SKU below zero, which only override lines may do.
    await documents.createDeliveryChallan(env.ctx, order.id);
    expect(await cell(env, line.variantId)).toMatchObject({ aGrade: -4, reserved: 0 });
    const audit = await prisma.auditLog.findFirst({
      where: { action: "FORCE_OVERRIDE", entityId: order.id },
    });
    expect(audit?.summary).toContain("EX-PL-001-WHITE-L 14 (available 10)");
  });

  it("delivers in parts with challans: stock out, cost of sales and status", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env);
    const navyM = env.sku("Navy", "M");

    const first = await documents.createDeliveryChallan(env.ctx, order.id, {
      items: [{ variantId: navyM, quantity: 3 }],
      vehicleNo: "DHA-GA-11-2233",
      driverName: "Karim",
    });
    expect(first.number).toMatch(/^DC-\d{4}-00001$/);
    expect(await cell(env, navyM)).toEqual({ aGrade: 7, bGrade: 0, reserved: 1, available: 6 });
    let current = await orders.getOrder(env.ctx, order.id);
    expect(current.status).toBe("PROCESSING");
    expect(current.items.find((i) => i.variantId === navyM)).toMatchObject({
      delivered: 3,
      remaining: 1,
    });

    await expectAppError(
      documents.createDeliveryChallan(env.ctx, order.id, {
        items: [{ variantId: navyM, quantity: 2 }],
      }),
      "VALIDATION",
    );
    await documents.createDeliveryChallan(env.ctx, order.id); // everything left
    current = await orders.getOrder(env.ctx, order.id);
    expect(current.status).toBe("DELIVERED");
    expect(current.deliveryChallans).toHaveLength(2);
    expect(await cell(env, navyM)).toEqual({ aGrade: 6, bGrade: 0, reserved: 0, available: 6 });
    await expectAppError(documents.createDeliveryChallan(env.ctx, order.id), "CONFLICT");

    const movements = await prisma.stockMovement.findMany({
      where: { type: "SALE_OUT", referenceId: order.id },
    });
    expect(movements.reduce((s, m) => s + m.quantity, 0)).toBe(-12);
    const cogs = await prisma.journalLine.findMany({
      where: { account: { subType: "COGS", companyId: env.company.id } },
    });
    expect(cogs.reduce((s, l) => s + Number(l.debit), 0)).toBe(6000); // 12 pcs x 500 cost

    const challan = await documents.getChallanDocument(env.ctx, first.id);
    expect(challan.totalPieces).toBe(3);
    expect(JSON.stringify(challan.items)).not.toMatch(/price/i);
    expect((await documents.listChallans(env.ctx, { partyId: env.buyer.id })).length).toBe(2);
    await expectBooksBalanced(env.company.id);
  });

  it("only one of two buyers gets the last pieces", async () => {
    const env = await setup();
    const variantId = env.sku("White", "XL");
    const other = (await parties.createParty(env.ctx, { kind: "BUYER", name: "Second Buyer" }))
      .party;
    const results = await Promise.allSettled(
      [env.buyer.id, other.id].map((partyId) =>
        orders.createOrder(env.ctx, {
          channel: "WHOLESALE",
          partyId,
          lines: [{ variantId, quantity: 10 }],
          documents: { invoice: false },
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await cell(env, variantId)).toMatchObject({ reserved: 10, available: 0 });
  });

  it("respects the buyer's credit limit and account status", async () => {
    const env = await setup();
    const limited = (
      await parties.createParty(env.ctx, { kind: "BUYER", name: "Small Shop", creditLimit: 5000 })
    ).party;
    const order = (partyId: string, extra: Record<string, unknown> = {}) =>
      orders.createOrder(env.ctx, {
        channel: "WHOLESALE",
        partyId,
        lines: [{ variantId: env.sku("Navy", "S"), quantity: 6 }], // 5400
        ...extra,
      });
    const err = await expectAppError(order(limited.id), "CONFLICT");
    expect(err.message).toContain("Credit limit exceeded");
    // Paying part at the counter keeps the new due within the limit.
    const paid = await order(limited.id, { payment: { amount: 1000, method: "CASH" } });
    expect(paid.invoice!.status).toBe("PARTIALLY_PAID");

    await parties.changePartyStatus(env.ctx, limited.id, { status: "CLOSED" }); // settling: dues open
    await expectAppError(order(limited.id), "CONFLICT");
  });

  it("edits and cancels orders, keeping reservations right", async () => {
    const env = await setup();
    const navyS = env.sku("Navy", "S");
    const whiteS = env.sku("White", "S");
    const order = await wholesaleOrder(env, { documents: { invoice: false } });

    const edited = await orders.updateOrder(env.ctx, order.id, {
      lines: [
        { variantId: navyS, quantity: 10 },
        { variantId: whiteS, quantity: 3, unitPrice: 850 },
      ],
      shippingCharge: 300,
    });
    expect(edited.total.toFixed(2)).toBe("11850.00"); // 9000 + 2550 + 300
    expect((await cell(env, navyS)).reserved).toBe(10); // own reservation counted as free
    expect((await cell(env, env.sku("Navy", "M"))).reserved).toBe(0);
    expect((await cell(env, whiteS)).reserved).toBe(3);

    await documents.issueInvoice(env.ctx, order.id);
    await expectAppError(orders.updateOrder(env.ctx, order.id, { discount: 100 }), "CONFLICT");

    // A Sales Executive cannot cancel an invoiced order (it voids the invoice).
    await expectAppError(
      orders.cancelOrder(env.salesCtx, order.id, { reason: "Duplicate" }),
      "FORBIDDEN",
    );
    const cancelled = await orders.cancelOrder(env.ctx, order.id, { reason: "Duplicate order" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.invoice!.status).toBe("VOID");
    expect(cancelled.dueAmount.toFixed(2)).toBe("0.00");
    expect((await cell(env, navyS)).reserved).toBe(0);
    expect(await balanceOf(env, env.buyer.id)).toBe("0.00");
    await expectAppError(
      payments.receivePayment(env.ctx, { orderId: order.id, amount: 1, method: "CASH" }),
      "CONFLICT",
    );

    const delivered = await wholesaleOrder(env, { documents: { deliveryChallan: true } });
    expect(delivered.status).toBe("DELIVERED");
    await expectAppError(
      orders.cancelOrder(env.ctx, delivered.id, { reason: "Too late" }),
      "CONFLICT",
    );
    const paid = await wholesaleOrder(env, { payment: { amount: 500, method: "CASH" } });
    await expectAppError(
      orders.cancelOrder(env.ctx, paid.id, { reason: "Paid already" }),
      "CONFLICT",
    );
    await expectBooksBalanced(env.company.id);
  });

  it("packs orders with a pick-list", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env);
    const list = await documents.createPackingList(env.ctx, order.id, {
      cartons: 2,
      grossWeightKg: 8.5,
    });
    expect(list.number).toMatch(/^PL-\d{4}-00001$/);
    expect((await orders.getOrder(env.ctx, order.id)).status).toBe("PACKED");
    await expectAppError(documents.createPackingList(env.ctx, order.id), "CONFLICT");

    const doc = await documents.getPackingListDocument(env.ctx, list.id);
    expect(doc.totalPieces).toBe(12);
    const firstTwo = doc.items.slice(0, 2);
    const picked = await documents.setPickedItems(env.ctx, list.id, {
      itemIds: firstTwo.map((i) => i.id),
      isPicked: true,
    });
    expect(picked.pickedPieces).toBe(firstTwo.reduce((s, i) => s + i.quantity, 0));
    await expectAppError(
      documents.setPickedItems(env.ctx, list.id, { itemIds: ["nope"], isPicked: true }),
      "VALIDATION",
    );

    const other = await wholesaleOrder(env, { documents: { invoice: false } });
    await expectAppError(
      documents.createPackingList(env.ctx, other.id, {
        items: [{ variantId: env.sku("White", "XL"), quantity: 1 }],
      }),
      "VALIDATION",
    );
  });
});

run("payments, invoices and walk-in sales", () => {
  beforeEach(resetDb);

  it("tracks paid / due on the invoice and clears the buyer's balance", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env);
    const first = await payments.receivePayment(env.ctx, {
      orderId: order.id,
      amount: 4000,
      method: "BKASH",
      reference: "TRX123",
    });
    expect(first.payment.number).toMatch(/^RCPT-\d{4}-00001$/);
    expect(first.payment.isAdvance).toBe(false);
    const wallet = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { id: first.payment.accountId },
    });
    expect(wallet.subType).toBe("MOBILE_WALLET");

    let invoice = await documents.getInvoiceDocument(env.ctx, order.invoice!.id);
    expect(invoice).toMatchObject({ status: "PARTIALLY_PAID" });
    expect(invoice.dueAmount.toFixed(2)).toBe("6800.00");
    await expectAppError(
      payments.receivePayment(env.ctx, { orderId: order.id, amount: 6800.01, method: "CASH" }),
      "VALIDATION",
    );
    await payments.receivePayment(env.ctx, { orderId: order.id, amount: 6800, method: "CASH" });
    invoice = await documents.getInvoiceDocument(env.ctx, order.invoice!.id);
    expect(invoice.status).toBe("PAID");
    expect(invoice.payments.map((p) => p.amount.toFixed(2))).toEqual(["4000.00", "6800.00"]);
    expect(await balanceOf(env, env.buyer.id)).toBe("0.00");

    const statement = await ledger.getStatement(env.ctx, env.buyer.id);
    expect(statement.lines.map((l) => l.balance)).toEqual(["10800.00", "6800.00", "0.00"]);
    const overview = await ledger.getReceivablesPayables(env.ctx);
    expect(overview.totalReceivable).toBe("0.00");
    await expectBooksBalanced(env.company.id);
  });

  it("does not take two payments for the same due at once", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        payments.receivePayment(env.ctx, { orderId: order.id, amount: 10800, method: "CASH" }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await orders.getOrder(env.ctx, order.id)).paidAmount.toFixed(2)).toBe("10800.00");
  });

  it("voids and re-issues an invoice, keeping payments", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env);
    await payments.receivePayment(env.ctx, { orderId: order.id, amount: 5000, method: "CASH" });
    const voided = await documents.voidInvoice(env.ctx, order.invoice!.id, {
      reason: "Wrong price agreed",
    });
    expect(voided.status).toBe("VOID");
    expect(await balanceOf(env, env.buyer.id)).toBe("-5000.00"); // payment is now their advance
    await expectAppError(
      documents.voidInvoice(env.ctx, order.invoice!.id, { reason: "Again please" }),
      "CONFLICT",
    );

    await orders.updateOrder(env.ctx, order.id, {
      matrix: [
        { styleId: env.style.id, unitPrice: 850, quantities: { [env.sku("Navy", "M")]: 10 } },
      ],
    });
    const reissued = await documents.issueInvoice(env.ctx, order.id);
    expect(reissued.number).not.toBe(order.invoice!.number);
    expect(reissued.total.toFixed(2)).toBe("8500.00");
    expect(reissued.paidAmount.toFixed(2)).toBe("5000.00");
    expect(reissued.status).toBe("PARTIALLY_PAID");
    expect(await balanceOf(env, env.buyer.id)).toBe("3500.00");
    const audit = await prisma.auditLog.findMany({
      where: { action: "INVOICE_EDIT" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audit.map((a) => a.summary)).toEqual([
      expect.stringContaining("Voided invoice"),
      expect.stringContaining("Re-issued voided invoice"),
    ]);
    await expectAppError(
      orders.updateOrder(env.ctx, order.id, {
        lines: [{ variantId: env.sku("Navy", "S"), quantity: 1 }],
      }),
      "CONFLICT",
    );
    await expectBooksBalanced(env.company.id);
  });

  it("checks out a walk-in POS sale with every document in one step", async () => {
    const env = await setup();
    const order = await orders.createOrder(env.ctx, {
      channel: "POS",
      customerName: "Walk-in",
      customerPhone: "01900000000",
      lines: [{ variantId: env.sku("White", "M"), quantity: 2, discount: 100 }],
      payment: { amount: 2800, method: "CASH" },
      documents: { invoice: true, packingList: true, deliveryChallan: true },
    });
    expect(order.total.toFixed(2)).toBe("2800.00"); // 2 x 1450 retail - 100
    expect(order.status).toBe("DELIVERED");
    expect(order.invoice!.status).toBe("PAID");
    expect(order.packingList).not.toBeNull();
    expect(order.deliveryChallans).toHaveLength(1);
    expect(await cell(env, env.sku("White", "M"))).toEqual({
      aGrade: 8,
      bGrade: 0,
      reserved: 0,
      available: 8,
    });
    const doc = await documents.getInvoiceDocument(env.ctx, order.invoice!.id);
    expect(doc.buyer).toMatchObject({ name: "Walk-in", phone: "01900000000" });
    await expectAppError(
      orders.createOrder(env.ctx, {
        channel: "POS",
        lines: [{ variantId: env.sku("White", "M"), quantity: 1 }],
        payment: { amount: 2000, method: "CASH" },
      }),
      "VALIDATION",
    );
    await expectBooksBalanced(env.company.id);

    const today = await summary.getSalesSummary(env.ctx);
    expect(today).toMatchObject({
      invoicedSales: "2800.00",
      invoiceCount: 1,
      orderCount: 1,
      collected: "2800.00",
      outstandingDue: "0.00",
    });
    expect(today.byChannel).toEqual([{ channel: "POS", orders: 1, value: "2800.00" }]);
  });

  it("takes on-account payments from buyers only", async () => {
    const env = await setup();
    await wholesaleOrder(env);
    await payments.receivePayment(env.ctx, {
      partyId: env.buyer.id,
      amount: 3000,
      method: "CHEQUE",
    });
    expect(await balanceOf(env, env.buyer.id)).toBe("7800.00");
    const supplier = (await parties.createParty(env.ctx, { kind: "SUPPLIER", name: "Mill" })).party;
    await expectAppError(
      payments.receivePayment(env.ctx, { partyId: supplier.id, amount: 1, method: "CASH" }),
      "VALIDATION",
    );
    const list = await payments.listPayments(env.ctx, { partyId: env.buyer.id });
    expect(list.items).toHaveLength(1);
    const receipt = await payments.getPaymentReceipt(env.ctx, list.items[0]!.id);
    expect(receipt.account.name).toBe("Bank");
  });
});

run("sales company isolation", () => {
  beforeEach(resetDb);

  it("keeps each company's quotations, orders and SKUs apart", async () => {
    const extras = await setup("Extras");
    const other = await setup("Fabric Apparel");
    const order = await wholesaleOrder(extras);
    const q = await quotations.createQuotation(extras.ctx, {
      partyId: extras.buyer.id,
      items: [{ description: "Tee", quantity: 1, unitPrice: 1 }],
    });

    await expectAppError(orders.getOrder(other.ctx, order.id), "NOT_FOUND");
    await expectAppError(quotations.getQuotation(other.ctx, q.id), "NOT_FOUND");
    await expectAppError(proformas.convertQuotationToProforma(other.ctx, q.id), "NOT_FOUND");
    await expectAppError(documents.issueInvoice(other.ctx, order.id), "NOT_FOUND");
    await expectAppError(documents.createDeliveryChallan(other.ctx, order.id), "NOT_FOUND");
    await expectAppError(documents.getInvoiceDocument(other.ctx, order.invoice!.id), "NOT_FOUND");
    await expectAppError(
      payments.receivePayment(other.ctx, { orderId: order.id, amount: 1, method: "CASH" }),
      "NOT_FOUND",
    );
    await expectAppError(
      orders.createOrder(other.ctx, {
        channel: "WHOLESALE",
        partyId: other.buyer.id,
        lines: [{ variantId: extras.sku("Navy", "S"), quantity: 1 }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      quotations.createQuotation(other.ctx, {
        partyId: extras.buyer.id,
        items: [{ description: "Tee", quantity: 1, unitPrice: 1 }],
      }),
      "NOT_FOUND",
    );
    expect((await orders.listOrders(other.ctx)).items).toHaveLength(0);
    expect((await summary.getSalesSummary(other.ctx)).invoicedSales).toBe("0.00");
  });
});
