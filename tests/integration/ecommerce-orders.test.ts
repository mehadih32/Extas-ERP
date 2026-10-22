import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

/** Lets a test win the stock check before the transaction and lose the race inside it. */
const race = vi.hoisted(() => ({ plenty: 0 }));
vi.mock("@/modules/inventory/stock.service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/inventory/stock.service")>();
  return {
    ...real,
    availableByVariant: async (...args: Parameters<typeof real.availableByVariant>) => {
      if (race.plenty > 0) {
        race.plenty--;
        return new Map(args[1].map((id) => [id, 1000]));
      }
      return real.availableByVariant(...args);
    },
  };
});

import { PATCH as patchRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { GET as stockOneRoute } from "@/app/api/v1/ecommerce/stock/[sku]/route";
import { prisma } from "@/lib/prisma";
import { createIntegration } from "@/modules/ecommerce/integration.service";
import { receivePayment } from "@/modules/sales/payment.service";

import { callShop, giveKey, type Shop, setupShop, shopUserOf } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

type Keys = Pick<Shop, "apiKey" | "webhookSecret">;

const order = (externalOrderId: string, items: Array<Record<string, unknown>>, extra = {}) => ({
  externalOrderId,
  customer: { name: "Rahim Uddin", phone: "01711000000" },
  shippingAddress: "House 5, Road 2, Dhanmondi, Dhaka",
  items,
  shippingFee: 80,
  codAmount: 0,
  paymentMethod: "bkash",
  ...extra,
});

const post = (shop: Keys, body: unknown, options: { idempotencyKey?: string } = {}) =>
  callShop(shop, ordersRoute, { path: "/orders", body, ...options });

const patch = (shop: Keys, externalOrderId: string, body: unknown) =>
  callShop<{ externalOrderId: string }>(shop, patchRoute, {
    method: "PATCH",
    path: `/orders/${externalOrderId}`,
    body,
    params: { externalOrderId },
  });

const stockOf = async (shop: Shop, sku: string) =>
  (await callShop<{ sku: string }>(shop, stockOneRoute, { path: `/stock/${sku}`, params: { sku } }))
    .body.warehouses[0] as { onHand: number; reserved: number; available: number };

run("E-commerce API: orders (CN-005)", () => {
  let shop: Shop;
  let navyS: string;
  let navyM: string;
  let whiteL: string;
  let tee: string;
  beforeEach(async () => {
    await resetDb();
    race.plenty = 0;
    shop = await setupShop();
    navyS = shop.sku("EX-PL-001", "Navy", "S");
    navyM = shop.sku("EX-PL-001", "Navy", "M");
    whiteL = shop.sku("EX-PL-001", "White", "L");
    tee = shop.sku("EX-TS-002", "White", "S");
  });

  const placeOrder = async (
    id = "WEB-1001",
    items = [{ sku: navyS, quantity: 2, unitPrice: 1450 }],
  ) => {
    const res = await post(shop, order(id, items, { paymentMethod: "COD", codAmount: 2980 }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };

  it("makes a confirmed WEBSITE order at the shop's prices, reserves its stock and logs it as the shop", async () => {
    const res = await post(
      shop,
      order(
        "WEB-1001",
        [
          { sku: navyS, quantity: 2, unitPrice: 1200, discount: 100 },
          { sku: whiteL, quantity: 1, unitPrice: 1450 },
        ],
        {
          note: "Call before coming",
          companyId: "another-company",
          codAmount: 3730,
          paymentMethod: "cod",
        },
      ),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      erpOrderId: expect.any(String),
      erpOrderNumber: expect.any(String),
      externalOrderId: "WEB-1001",
      status: "CONFIRMED",
      total: 3830,
      paid: 0,
      due: 3830,
      codAmount: 3730,
      items: expect.arrayContaining([
        { sku: navyS, quantity: 2, unitPrice: 1200, discount: 100 },
        { sku: whiteL, quantity: 1, unitPrice: 1450, discount: 0 },
      ]),
    });
    const saved = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: res.body.erpOrderId },
      include: { items: true, invoice: true },
    });
    expect(saved).toMatchObject({
      companyId: shop.company.id,
      channel: "WEBSITE",
      status: "CONFIRMED",
      partyId: null,
      integrationId: shop.integration.id,
      externalOrderId: "WEB-1001",
      warehouseId: shop.warehouse.id,
      customerName: "Rahim Uddin",
      customerPhone: "01711000000",
      shippingAddress: "House 5, Road 2, Dhanmondi, Dhaka",
      notes: "Call before coming",
      paymentMethod: "COURIER_COD",
      invoice: null,
      hasForceOverride: false,
    });
    expect(saved.shippingCharge.toFixed(2)).toBe("80.00");
    expect(saved.subtotal.toFixed(2)).toBe("3750.00");
    expect(saved.items.every((i) => !i.forceOverride)).toBe(true);

    expect(await stockOf(shop, navyS)).toMatchObject({ onHand: 10, reserved: 2, available: 8 });
    expect(await stockOf(shop, whiteL)).toMatchObject({ reserved: 1, available: 9 });

    const shopUser = await shopUserOf(shop.integration.id);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "SalesOrder", entityId: saved.id, action: "CREATE" },
    });
    expect(audit.userId).toBe(shopUser);
    expect(audit.companyId).toBe(shop.company.id);
  });

  it("answers a repeat with the same Idempotency-Key once: one order, one reservation", async () => {
    const body = order("WEB-2001", [{ sku: navyS, quantity: 3, unitPrice: 1450 }]);
    const first = await post(shop, body, { idempotencyKey: "order-WEB-2001" });
    const again = await post(shop, body, { idempotencyKey: "order-WEB-2001" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await prisma.salesOrder.count({ where: { companyId: shop.company.id } })).toBe(1);
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 3, available: 7 });

    // The same order under another key: 409 with the ERP order it already is.
    const twice = await post(shop, body, { idempotencyKey: "order-WEB-2001-b" });
    expect(twice.status).toBe(409);
    expect(twice.body.error).toMatchObject({
      code: "ORDER_EXISTS",
      details: { erpOrderId: first.body.erpOrderId, erpOrderNumber: first.body.erpOrderNumber },
    });
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 3 });
  });

  it("refuses short stock with 409 naming every short SKU, and reserves nothing", async () => {
    const res = await post(
      shop,
      order("WEB-3001", [
        { sku: navyS, quantity: 11, unitPrice: 1450 },
        { sku: navyM, quantity: 2, unitPrice: 1450 },
        { sku: whiteL, quantity: 12, unitPrice: 1450 },
        { sku: tee, quantity: 1, unitPrice: 600 },
      ]),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(res.body.error.details.shortSkus).toEqual([
      { sku: navyS, requested: 11, available: 10 },
      { sku: whiteL, requested: 12, available: 10 },
      { sku: tee, requested: 1, available: 0 },
    ]);
    expect(await prisma.salesOrder.count()).toBe(0);
    expect(await stockOf(shop, navyM)).toMatchObject({ reserved: 0 });

    // A SKU sent twice counts as one line: 6 + 6 of 10 is short.
    const twice = await post(
      shop,
      order("WEB-3002", [
        { sku: navyS, quantity: 6, unitPrice: 1450 },
        { sku: navyS, quantity: 6, unitPrice: 1450 },
      ]),
    );
    expect(twice.status).toBe(409);
    expect(twice.body.error.details.shortSkus).toEqual([
      { sku: navyS, requested: 12, available: 10 },
    ]);
  });

  it("gives the same 409 when the last pieces go to another order inside the transaction", async () => {
    race.plenty = 1; // the check before the transaction sees plenty
    const res = await post(
      shop,
      order("WEB-3101", [
        { sku: navyM, quantity: 2, unitPrice: 1450 },
        { sku: navyS, quantity: 11, unitPrice: 1450 },
      ]),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(res.body.error.details.shortSkus).toEqual([
      { sku: navyS, requested: 11, available: 10 },
    ]);
    expect(await prisma.salesOrder.count()).toBe(0);
    expect(await stockOf(shop, navyM)).toMatchObject({ reserved: 0 });
  });

  it("refuses unknown and inactive SKUs (422), a bad body, a shop without a warehouse, and bad auth", async () => {
    const unknown = await post(
      shop,
      order("WEB-4001", [
        { sku: "NOPE-1", quantity: 1, unitPrice: 10 },
        { sku: navyS, quantity: 1, unitPrice: 10 },
        { sku: "NOPE-2", quantity: 1, unitPrice: 10 },
      ]),
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toMatchObject({
      code: "VALIDATION",
      details: { unknownSkus: ["NOPE-1", "NOPE-2"] },
    });

    await prisma.style.update({ where: { id: shop.tee.id }, data: { isActive: false } });
    await prisma.productVariant.updateMany({
      where: { companyId: shop.company.id, sku: navyM },
      data: { removedAt: new Date() },
    });
    const inactive = await post(
      shop,
      order("WEB-4002", [
        { sku: tee, quantity: 1, unitPrice: 600 },
        { sku: navyM, quantity: 1, unitPrice: 1450 },
        { sku: navyS, quantity: 1, unitPrice: 1450 },
      ]),
    );
    expect(inactive.status).toBe(422);
    expect(inactive.body.error.details).toEqual({ inactiveSkus: [tee, navyM] });

    const bad = await post(shop, { externalOrderId: "WEB-4003", items: [] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("VALIDATION");
    expect(bad.body.error.details).toHaveProperty("customer");

    const unsigned = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: order("WEB-4004", [{ sku: navyS, quantity: 1, unitPrice: 1 }]),
      sign: false,
    });
    expect(unsigned.status).toBe(401);
    const noKey = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: order("WEB-4004", [{ sku: navyS, quantity: 1, unitPrice: 1 }]),
      key: null,
    });
    expect(noKey.status).toBe(401);
    const noIdempotency = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: order("WEB-4004", [{ sku: navyS, quantity: 1, unitPrice: 1 }]),
      idempotencyKey: null,
    });
    expect(noIdempotency.status).toBe(400);
    expect(noIdempotency.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { warehouseId: null },
    });
    const noWarehouse = await post(
      shop,
      order("WEB-4005", [{ sku: navyS, quantity: 1, unitPrice: 1 }]),
    );
    expect(noWarehouse.status).toBe(409);
    expect(noWarehouse.body.error.code).toBe("NO_WAREHOUSE");
    expect(await prisma.salesOrder.count()).toBe(0);
  });

  it("edits items, charges and the buyer before packing, redoing the reservation", async () => {
    const placed = await placeOrder("WEB-5001", [{ sku: navyS, quantity: 8, unitPrice: 1450 }]);
    // The order's own 8 count as available to it: 10 of 10 is fine.
    const res = await patch(shop, "WEB-5001", {
      items: [
        { sku: navyS, quantity: 10, unitPrice: 1400, discount: 50 },
        { sku: whiteL, quantity: 1, unitPrice: 1450 },
      ],
      shippingFee: 120,
      codAmount: 15520,
      customer: { name: "Rahim U.", phone: "01811000000" },
      shippingAddress: "Flat 3B, Road 7, Banani, Dhaka",
      note: "Leave at the gate",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      erpOrderId: placed.erpOrderId,
      status: "CONFIRMED",
      total: 15520,
      codAmount: 15520,
      due: 15520,
    });
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        { sku: navyS, quantity: 10, unitPrice: 1400, discount: 50 },
        { sku: whiteL, quantity: 1, unitPrice: 1450, discount: 0 },
      ]),
    );
    const saved = await prisma.salesOrder.findUniqueOrThrow({ where: { id: placed.erpOrderId } });
    expect(saved).toMatchObject({
      customerName: "Rahim U.",
      customerPhone: "01811000000",
      shippingAddress: "Flat 3B, Road 7, Banani, Dhaka",
      notes: "Leave at the gate",
    });
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 10, available: 0 });
    expect(await stockOf(shop, whiteL)).toMatchObject({ reserved: 1 });

    // Too many now: 409 with the short SKUs, and the order keeps what it had.
    const short = await patch(shop, "WEB-5001", {
      items: [
        { sku: navyS, quantity: 11, unitPrice: 1400 },
        { sku: whiteL, quantity: 11, unitPrice: 1450 },
      ],
    });
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(short.body.error.details.shortSkus).toEqual([
      { sku: navyS, requested: 11, available: 10 },
      { sku: whiteL, requested: 11, available: 10 },
    ]);
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 10 });

    // While processing it can still change; once packed it is locked.
    expect((await patch(shop, "WEB-5001", { status: "PROCESSING" })).body.status).toBe(
      "PROCESSING",
    );
    const processing = await patch(shop, "WEB-5001", { codAmount: 0 });
    expect(processing.status).toBe(200);
    expect(processing.body.codAmount).toBe(0);
    const packed = await patch(shop, "WEB-5001", { status: "PACKED" });
    expect(packed.body.status).toBe("PACKED");
    const locked = await patch(shop, "WEB-5001", { note: "Too late" });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("ORDER_LOCKED");
  });

  it("finds only this shop's own orders", async () => {
    await placeOrder("WEB-6001");
    const second = await createIntegration(shop.owner, {
      name: "Second shop",
      warehouseId: shop.warehouse.id,
    });
    const keys = await giveKey(second.id);
    const theirs = await patch(keys, "WEB-6001", { status: "PROCESSING" });
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe("NOT_FOUND");
    const other = await setupShop("Other Co");
    expect((await patch(other, "WEB-6001", { status: "PROCESSING" })).status).toBe(404);
    expect((await patch(shop, "WEB-0000", { status: "PROCESSING" })).status).toBe(404);
    const wrongKey = await callShop<{ externalOrderId: string }>(shop, patchRoute, {
      method: "PATCH",
      path: "/orders/WEB-6001",
      body: { status: "PROCESSING" },
      params: { externalOrderId: "WEB-6001" },
      key: "not-a-key",
    });
    expect(wrongKey.status).toBe(401);
    expect((await patch(shop, "WEB-6001", { reason: "Why not" })).status).toBe(422);
    expect((await patch(shop, "WEB-6001", {})).status).toBe(422);
    expect((await patch(shop, "WEB-6001", { status: "SHIPPED" })).status).toBe(422);
  });

  it("moves through processing and packed, the same status again doing nothing", async () => {
    const placed = await placeOrder("WEB-7001");
    expect((await patch(shop, "WEB-7001", { status: "PROCESSING" })).body.status).toBe(
      "PROCESSING",
    );
    expect((await patch(shop, "WEB-7001", { status: "processing" })).status).toBe(200);
    const packed = await patch(shop, "WEB-7001", { status: "PACKED" });
    expect(packed.body.status).toBe("PACKED");
    const list = await prisma.packingList.findUniqueOrThrow({
      where: { orderId: placed.erpOrderId },
      include: { items: true },
    });
    expect(list.items.map((i) => i.quantity)).toEqual([2]);
    expect((await patch(shop, "WEB-7001", { status: "PACKED" })).status).toBe(200);
    expect(await prisma.packingList.count()).toBe(1);
    const back = await patch(shop, "WEB-7001", { status: "PROCESSING" });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe("CONFLICT");
    const shopUser = await shopUserOf(shop.integration.id);
    const audits = await prisma.auditLog.findMany({
      where: { entityId: { in: [placed.erpOrderId, list.id] } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(audits.every((a) => a.userId === shopUser)).toBe(true);
  });

  it("delivers: the invoice and the challan, stock out and the journals posted, once", async () => {
    const placed = await placeOrder("WEB-8001");
    const res = await patch(shop, "WEB-8001", { status: "DELIVERED" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: "DELIVERED", total: 2980, due: 2980 });
    expect(await stockOf(shop, navyS)).toMatchObject({ onHand: 8, reserved: 0, available: 8 });

    const saved = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: placed.erpOrderId },
      include: { invoice: true, deliveryChallans: { include: { items: true } } },
    });
    expect(saved.invoice?.status).toBe("UNPAID");
    expect(saved.invoice?.total.toFixed(2)).toBe("2980.00");
    expect(saved.deliveryChallans).toHaveLength(1);
    expect(saved.deliveryChallans[0]!.items[0]!.quantity).toBe(2);
    const sale = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "SALE", sourceId: saved.invoice!.id },
      include: { lines: true },
    });
    const debit = sale.lines.reduce((s, l) => s + Number(l.debit), 0);
    expect(debit).toBe(2980);
    const cost = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "SALE", sourceId: saved.deliveryChallans[0]!.id },
      include: { lines: true },
    });
    expect(cost.lines.reduce((s, l) => s + Number(l.debit), 0)).toBe(1000);
    const out = await prisma.stockMovement.findFirstOrThrow({
      where: { referenceId: placed.erpOrderId, type: "SALE_OUT" },
    });
    expect(out.quantity).toBe(-2);
    const shopUser = await shopUserOf(shop.integration.id);
    expect(sale.postedById).toBe(shopUser);
    expect(out.createdById).toBe(shopUser);

    // Again: nothing more.
    expect((await patch(shop, "WEB-8001", { status: "DELIVERED" })).status).toBe(200);
    expect(await prisma.deliveryChallan.count()).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "SALE" } })).toBe(2);

    // After delivery: no cancel, no undelivered return, no edit.
    const cancel = await patch(shop, "WEB-8001", { status: "CANCELLED", reason: "Changed mind" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe("USE_RETURNS");
    const returned = await patch(shop, "WEB-8001", { status: "RETURNED" });
    expect(returned.status).toBe(409);
    expect(returned.body.error.code).toBe("USE_RETURNS");
    expect(
      (await patch(shop, "WEB-8001", { items: [{ sku: navyS, quantity: 1, unitPrice: 1 }] })).body
        .error.code,
    ).toBe("ORDER_LOCKED");
  });

  it("cancels before delivery, freeing the reservation and keeping the reason", async () => {
    const placed = await placeOrder("WEB-9001");
    const res = await patch(shop, "WEB-9001", {
      status: "CANCELLED",
      reason: "Buyer changed mind",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: "CANCELLED", due: 0 });
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 0, available: 10 });
    const saved = await prisma.salesOrder.findUniqueOrThrow({ where: { id: placed.erpOrderId } });
    expect(saved.notes).toContain("Buyer changed mind");
    expect((await patch(shop, "WEB-9001", { status: "CANCELLED" })).status).toBe(200);
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 0 });
    const deliver = await patch(shop, "WEB-9001", { status: "DELIVERED" });
    expect(deliver.status).toBe(409);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: placed.erpOrderId, action: "STATUS_CHANGE" },
    });
    expect(audit.userId).toBe(await shopUserOf(shop.integration.id));
  });

  it("takes an undelivered parcel back: the reservation freed, status RETURNED", async () => {
    const placed = await placeOrder("WEB-9101");
    const res = await patch(shop, "WEB-9101", { status: "RETURNED", reason: "Buyer not at home" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: "RETURNED", due: 0 });
    expect(await stockOf(shop, navyS)).toMatchObject({ onHand: 10, reserved: 0 });
    const saved = await prisma.salesOrder.findUniqueOrThrow({ where: { id: placed.erpOrderId } });
    expect(saved.notes).toContain("Buyer not at home");
    expect((await patch(shop, "WEB-9101", { status: "RETURNED" })).status).toBe(200);
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 0 });
    // A returned order cannot be cancelled (its stock would be freed twice).
    const placedOther = await placeOrder("WEB-9102");
    expect(placedOther.status).toBe("CONFIRMED");
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 2 });
    const cancel = await patch(shop, "WEB-9101", { status: "CANCELLED" });
    expect(cancel.status).toBe(409);
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 2 });
  });

  it("never pays money back: cancel or return with money paid answers PAYMENT_HELD", async () => {
    const placed = await placeOrder("WEB-9201");
    await receivePayment(shop.accounts, {
      orderId: placed.erpOrderId,
      amount: 500,
      method: "CASH",
    });
    const cancel = await patch(shop, "WEB-9201", { status: "CANCELLED", reason: "No stock" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toMatchObject({ code: "PAYMENT_HELD", details: { held: 500 } });
    expect(cancel.body.error.message).toContain("Accounts");
    const returned = await patch(shop, "WEB-9201", { status: "RETURNED" });
    expect(returned.status).toBe(409);
    expect(returned.body.error.code).toBe("PAYMENT_HELD");
    expect(await stockOf(shop, navyS)).toMatchObject({ reserved: 2 });
    const saved = await prisma.salesOrder.findUniqueOrThrow({ where: { id: placed.erpOrderId } });
    expect(saved.status).toBe("CONFIRMED");
    expect(await prisma.refund.count()).toBe(0);

    // Delivered later, the money paid before is applied to the invoice.
    const delivered = await patch(shop, "WEB-9201", { status: "DELIVERED" });
    expect(delivered.body).toMatchObject({ status: "DELIVERED", paid: 500, due: 2480 });
  });
});
