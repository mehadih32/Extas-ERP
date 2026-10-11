import { beforeEach, describe, expect, it } from "vitest";

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { buildDocument } from "@/modules/documents/builders";
import { printRequestSchema } from "@/modules/documents/schemas";
import * as employees from "@/modules/hr/employee.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as overview from "@/modules/sales/overview.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as screens from "@/modules/sales/screens.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Sales checkout overhaul (PR 1): the order's cartons and packer, the credit
 * check before placing, the Overview figures and the order quick view.
 *
 * A company with a polo style (Navy / White x S M L XL, wholesale 900), 10 pcs
 * of each SKU, a buyer, two staff who pack, a Sales Executive and Accounts.
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
  const hire = (name: string) =>
    employees.createEmployee(ctx, { name, joinDate: "2025-01-01", salary: 15000 });
  const karim = await hire("Karim Packer");
  const rina = await hire("Rina Packer");
  return { ctx, salesCtx, accountsCtx, company, style, tops, sku, buyer, karim, rina };
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

/** Navy S/M/L/XL = 2/4/4/2 at 900: 12 pcs, 10,800. */
const navyRatio = (env: Env) => ({
  styleId: env.style.id,
  quantities: {
    [env.sku("Navy", "S")]: 2,
    [env.sku("Navy", "M")]: 4,
    [env.sku("Navy", "L")]: 4,
    [env.sku("Navy", "XL")]: 2,
  },
});

const wholesaleOrder = (env: Env, extra: Record<string, unknown> = {}, ctx = env.salesCtx) =>
  orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    matrix: [navyRatio(env)],
    ...extra,
  });

const build = (ctx: CompanyContext, request: unknown) =>
  buildDocument(ctx, printRequestSchema.parse(request), new Date());

const metaOf = async (ctx: CompanyContext, request: unknown) =>
  Object.fromEntries((await build(ctx, request)).model.meta.map((m) => [m.label, m.value]));

run("cartons and packer on an order", () => {
  beforeEach(resetDb);

  it("keeps the cartons and the packer from checkout, and prints them on the papers", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env, {
      totalCartons: 3,
      packedById: env.karim.id,
      documents: { invoice: true, packingList: true, deliveryChallan: true },
    });
    expect(order).toMatchObject({ totalCartons: 3, packedById: env.karim.id });
    expect(order.packedBy).toMatchObject({ id: env.karim.id, name: "Karim Packer" });

    // The packing list takes the order's cartons when it is given none.
    const list = await prisma.packingList.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(list.cartons).toBe(3);
    const challan = await prisma.deliveryChallan.findFirstOrThrow({ where: { orderId: order.id } });

    const packing = await metaOf(env.ctx, { type: "PACKING_LIST", id: list.id });
    expect(packing).toMatchObject({ "Total cartons": "3", "Packed by": "Karim Packer" });
    const delivery = await metaOf(env.ctx, { type: "DELIVERY_CHALLAN", id: challan.id });
    expect(delivery).toMatchObject({ "Total cartons": "3", "Packed by": "Karim Packer" });
  });

  it("prints a dash for each on the papers when neither is given", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env, {
      documents: { invoice: false, packingList: true, deliveryChallan: true },
    });
    expect(order).toMatchObject({ totalCartons: null, packedById: null, packedBy: null });
    const list = await prisma.packingList.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(list.cartons).toBeNull();
    const challan = await prisma.deliveryChallan.findFirstOrThrow({ where: { orderId: order.id } });
    const packing = await metaOf(env.ctx, { type: "PACKING_LIST", id: list.id });
    const delivery = await metaOf(env.ctx, { type: "DELIVERY_CHALLAN", id: challan.id });
    for (const meta of [packing, delivery]) {
      expect(meta).toMatchObject({ "Total cartons": "–", "Packed by": "–" });
    }
  });

  it("takes only staff of this company who are still working", async () => {
    const env = await setup();
    const other = await setup("Other Co");
    const fromElsewhere = await expectAppError(
      wholesaleOrder(env, { packedById: other.karim.id }),
      "VALIDATION",
    );
    expect(fromElsewhere.details).toEqual({ packedById: ["Choose someone from the list"] });

    await employees.exitEmployee(env.ctx, env.rina.id, {
      exitDate: localDay(new Date(), env.company.timezone),
      status: "RESIGNED",
    });
    await expectAppError(wholesaleOrder(env, { packedById: env.rina.id }), "VALIDATION");
    const working = await orders.listPackers(env.ctx);
    expect(working.map((p) => p.name)).toEqual(["Karim Packer"]);
    expect(await prisma.salesOrder.count()).toBe(0);
  });

  it("changes them on edit and later, keeping a packer who has since left", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env, {
      packedById: env.rina.id,
      documents: { invoice: false, packingList: false, deliveryChallan: false },
    });

    // An edit that leaves them out keeps them.
    const edited = await orders.updateOrder(env.salesCtx, order.id, {
      matrix: [navyRatio(env)],
      notes: "Fold with tissue",
    });
    expect(edited).toMatchObject({ totalCartons: null, packedById: env.rina.id });
    const counted = await orders.updateOrder(env.salesCtx, order.id, {
      matrix: [navyRatio(env)],
      totalCartons: 4,
    });
    expect(counted).toMatchObject({ totalCartons: 4, packedById: env.rina.id });

    // Rina leaves: the order still names her, and saving it as it is still works.
    await employees.exitEmployee(env.ctx, env.rina.id, {
      exitDate: localDay(new Date(), env.company.timezone),
      status: "RESIGNED",
    });
    const kept = await orders.setOrderLogistics(env.salesCtx, order.id, {
      totalCartons: 5,
      packedById: env.rina.id,
    });
    expect(kept).toMatchObject({ totalCartons: 5, packedById: env.rina.id });
    // Her name stays in the order's list of packers so the screen can show it.
    const form = await screens.getOrderForm(env.salesCtx, { orderId: order.id });
    expect(form.packers.map((p) => p.name)).toEqual(["Karim Packer", "Rina Packer"]);
    // Naming her again on another order is refused.
    const other = await wholesaleOrder(env, {
      matrix: [{ styleId: env.style.id, quantities: { [env.sku("White", "S")]: 1 } }],
      documents: { invoice: false, packingList: false, deliveryChallan: false },
    });
    await expectAppError(
      orders.setOrderLogistics(env.salesCtx, other.id, { packedById: env.rina.id }),
      "VALIDATION",
    );

    // Cartons changed after packing update the packing list too.
    await documents.createPackingList(env.salesCtx, order.id, {});
    expect(
      (await prisma.packingList.findUniqueOrThrow({ where: { orderId: order.id } })).cartons,
    ).toBe(5);
    const swapped = await orders.setOrderLogistics(env.salesCtx, order.id, {
      totalCartons: 7,
      packedById: env.karim.id,
    });
    expect(swapped).toMatchObject({ totalCartons: 7, packedById: env.karim.id });
    expect(
      (await prisma.packingList.findUniqueOrThrow({ where: { orderId: order.id } })).cartons,
    ).toBe(7);
    // Only what is named changes; null clears.
    const cleared = await orders.setOrderLogistics(env.salesCtx, order.id, { packedById: null });
    expect(cleared).toMatchObject({ totalCartons: 7, packedById: null });

    const log = await prisma.auditLog.findMany({
      where: { entityType: "SalesOrder", entityId: order.id, summary: { startsWith: "Logistics" } },
      orderBy: { createdAt: "asc" },
      select: { summary: true },
    });
    expect(log.map((l) => l.summary)).toEqual([
      `Logistics of ${order.number}: cartons 4 -> 5`,
      `Logistics of ${order.number}: cartons 5 -> 7, packer changed`,
      `Logistics of ${order.number}: cartons 7 -> 7, packer changed`,
    ]);
  });

  it("refuses a cancelled order, another company's order and bad numbers", async () => {
    const env = await setup();
    const other = await setup("Other Co");
    const order = await wholesaleOrder(env, {
      documents: { invoice: false, packingList: false, deliveryChallan: false },
    });
    await expectAppError(
      orders.setOrderLogistics(other.salesCtx, order.id, { totalCartons: 2 }),
      "NOT_FOUND",
    );
    await expect(
      orders.setOrderLogistics(env.salesCtx, order.id, { totalCartons: -1 }),
    ).rejects.toThrow();
    await expect(
      orders.setOrderLogistics(env.salesCtx, order.id, { totalCartons: 1.5 }),
    ).rejects.toThrow();
    await orders.cancelOrder(env.salesCtx, order.id, { reason: "Buyer changed mind" });
    const refused = await expectAppError(
      orders.setOrderLogistics(env.salesCtx, order.id, { totalCartons: 2 }),
      "CONFLICT",
    );
    expect(refused.message).toBe("This order is cancelled.");
    const screen = await screens.getOrderScreen(env.salesCtx, order.id);
    expect(screen.can.logistics).toBe(false);
    expect(screen.packers).toEqual([]);
  });

  it("carries them when a proforma becomes the order", async () => {
    const env = await setup();
    const q = await quotations.createQuotation(env.ctx, {
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
    const pi = await proformas.convertQuotationToProforma(env.ctx, q.id);
    await payments.receivePayment(env.accountsCtx, {
      proformaId: pi.id,
      amount: Number(pi.advanceAmount),
      method: "CASH",
    });
    const order = await proformas.convertProformaToOrder(env.ctx, pi.id, {
      matrix: [{ ...navyRatio(env), unitPrice: 1000 }],
      totalCartons: 2,
      packedById: env.karim.id,
    });
    expect(order).toMatchObject({ totalCartons: 2, packedById: env.karim.id });
  });
});

run("the credit check before placing an order", () => {
  beforeEach(resetDb);

  it("answers the way saving the order does", async () => {
    const env = await setup();
    const limited = (
      await parties.createParty(env.ctx, { kind: "BUYER", name: "Small Shop", creditLimit: 15000 })
    ).party;
    expect(
      await orders.checkBuyerCredit(env.salesCtx, { partyId: limited.id, amount: 10800 }),
    ).toEqual({ ok: true });
    // No limit: anything goes on credit.
    expect(
      await orders.checkBuyerCredit(env.salesCtx, { partyId: env.buyer.id, amount: 9_000_000 }),
    ).toEqual({ ok: true });

    await wholesaleOrder(env, {
      partyId: limited.id,
      documents: { invoice: true, packingList: false, deliveryChallan: false },
    });
    const over = await expectAppError(
      orders.checkBuyerCredit(env.salesCtx, { partyId: limited.id, amount: 10800 }),
      "CONFLICT",
    );
    expect(over.message).toBe("Credit limit exceeded: due 10800.00 + 10800.00 > limit 15000.00.");
    // Saving the same order is refused with the same words.
    const saving = await expectAppError(wholesaleOrder(env, { partyId: limited.id }), "CONFLICT");
    expect(saving.message).toBe(over.message);
    // What fits is still fine.
    expect(
      await orders.checkBuyerCredit(env.salesCtx, { partyId: limited.id, amount: 4200 }),
    ).toEqual({ ok: true });

    // A closed account and a supplier are refused; a stranger's buyer is not found.
    const supplier = (
      await parties.createParty(env.ctx, { kind: "SUPPLIER", name: "Fabric House" })
    ).party;
    await expectAppError(
      orders.checkBuyerCredit(env.salesCtx, { partyId: supplier.id, amount: 1 }),
      "VALIDATION",
    );
    const other = await setup("Other Co");
    await expectAppError(
      orders.checkBuyerCredit(env.salesCtx, { partyId: other.buyer.id, amount: 1 }),
      "NOT_FOUND",
    );
  });
});

run("the Sales overview and quick view", () => {
  beforeEach(resetDb);

  it("counts today's work, what waits to leave, what is overdue and lists the orders", async () => {
    const env = await setup();
    const tz = env.company.timezone;
    const today = localDay(new Date(), tz);
    const empty = await overview.getSalesOverview(env.salesCtx);
    expect(empty.figures).toMatchObject({
      ordersToday: { count: 0 },
      toDeliver: { count: 0, value: "0.00", late: 0 },
      overdue: { count: 0, value: "0.00" },
      openQuotations: 0,
      awaitingAdvance: 0,
    });
    expect(empty).toMatchObject({ today, canCreate: true, recent: [], shipping: [] });

    // An order taken last week, due to ship two days ago, invoiced with a due day that passed.
    const late = await wholesaleOrder(env, {
      orderDate: addDays(today, -7),
      shipmentDate: addDays(today, -2),
      documents: { invoice: false, packingList: false, deliveryChallan: false },
    });
    await documents.issueInvoice(env.salesCtx, late.id, {
      issueDate: addDays(today, -7),
      dueDate: addDays(today, -1),
    });
    // Today's order, shipping next week, handed over at once.
    const soon = await wholesaleOrder(env, {
      matrix: [{ styleId: env.style.id, quantities: { [env.sku("White", "M")]: 3 } }],
      shipmentDate: addDays(today, 7),
    });
    await documents.createDeliveryChallan(env.salesCtx, soon.id, {});
    // Today's order still to deliver, shipping tomorrow.
    const next = await wholesaleOrder(env, {
      matrix: [{ styleId: env.style.id, quantities: { [env.sku("White", "L")]: 2 } }],
      shipmentDate: addDays(today, 1),
      documents: { invoice: false, packingList: false, deliveryChallan: false },
    });

    const o = await overview.getSalesOverview(env.salesCtx);
    expect(o.figures.ordersToday).toEqual({ count: 2, value: "4500.00" });
    expect(o.figures.toDeliver).toEqual({ count: 2, value: "12600.00", late: 1 });
    expect(o.figures.overdue).toEqual({ count: 1, value: "10800.00" });
    expect(o.recent.map((r) => r.number)).toEqual([next.number, soon.number, late.number]);
    expect(o.recent[0]).toMatchObject({
      buyer: "Rahim Traders",
      total: "1800.00",
      orderedOn: today,
      shipmentOn: addDays(today, 1),
    });
    // Delivered orders are not waiting to ship; the late one comes first.
    expect(o.shipping.map((r) => r.number)).toEqual([late.number, next.number]);
    expect(o.updatedAt).toMatch(/^\d{2}:\d{2}$/);

    // Another company sees none of it.
    const other = await setup("Other Co");
    const theirs = await overview.getSalesOverview(other.salesCtx);
    expect(theirs.recent).toEqual([]);
    expect(theirs.figures.toDeliver.count).toBe(0);
  });

  it("shows one order in the quick view, by style, without costs", async () => {
    const env = await setup();
    const order = await wholesaleOrder(env, {
      matrix: [
        navyRatio(env),
        { styleId: env.style.id, quantities: { [env.sku("White", "S")]: 1 } },
      ],
      discount: 300,
      totalCartons: 2,
      packedById: env.karim.id,
      documents: { invoice: true, packingList: true, deliveryChallan: false },
    });
    await documents.createDeliveryChallan(env.salesCtx, order.id, {
      items: [{ variantId: env.sku("Navy", "M"), quantity: 4 }],
    });
    const peek = await overview.getOrderPeek(env.salesCtx, order.id);
    expect(peek).toMatchObject({
      number: order.number,
      buyer: "Rahim Traders",
      buyerId: env.buyer.id,
      phone: "01711223344",
      pieces: 13,
      delivered: 4,
      subtotal: "11700.00",
      discount: "300.00",
      total: "11400.00",
      totalCartons: 2,
      packedBy: "Karim Packer",
      challans: 1,
      hasForceOverride: false,
    });
    // One style, however many colours.
    expect(peek.styles).toEqual([
      { code: "EX-PL-001", name: "Classic Polo", pieces: 13, amount: "11700.00" },
    ]);
    expect(peek.invoice?.number).toMatch(/^INV-/);
    expect(peek.packingList).toMatch(/^PL-/);
    expect(JSON.stringify(peek)).not.toMatch(/cost|margin/i);

    const other = await setup("Other Co");
    await expectAppError(overview.getOrderPeek(other.salesCtx, order.id), "NOT_FOUND");
  });
});
