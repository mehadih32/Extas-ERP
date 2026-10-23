import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PATCH as patchRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as eventsRoute } from "@/app/api/v1/ecommerce/shipments/[consignmentId]/events/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { prisma } from "@/lib/prisma";
import { createIntegration } from "@/modules/ecommerce/integration.service";
import { receivePayment } from "@/modules/sales/payment.service";

import { callShop, giveKey, type Shop, setupShop, shopUserOf } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

type Keys = Pick<Shop, "apiKey" | "webhookSecret">;

const ship = (shop: Keys, body: Record<string, unknown>, idempotencyKey?: string) =>
  callShop(shop, shipmentsRoute, { path: "/shipments", body, idempotencyKey });

const event = (
  shop: Keys,
  consignmentId: string,
  status: string,
  occurredAt: string,
  extra: Record<string, unknown> = {},
) =>
  callShop<{ consignmentId: string }>(shop, eventsRoute, {
    path: `/shipments/${consignmentId}/events`,
    body: { status, occurredAt, ...extra },
    params: { consignmentId },
  });

run("E-commerce API: shipments and courier events (CN-005)", () => {
  let shop: Shop;
  let navyS: string;
  let orderId: string;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    navyS = shop.sku("EX-PL-001", "Navy", "S");
    const res = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        externalOrderId: "WEB-1",
        customer: { name: "Karim", phone: "01911000000" },
        shippingAddress: "Mirpur 10, Dhaka",
        items: [{ sku: navyS, quantity: 2, unitPrice: 1450 }],
        shippingFee: 60,
        codAmount: 2960,
        paymentMethod: "COD",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    orderId = res.body.erpOrderId;
  });

  const stockRow = () =>
    prisma.stockBalance.findFirstOrThrow({
      where: { variant: { sku: navyS, companyId: shop.company.id }, grade: "A_GRADE" },
    });

  it("books a shipment: the courier made by name, the order shipped, a repeat refused", async () => {
    const res = await ship(shop, {
      externalOrderId: "WEB-1",
      courier: "Pathao",
      consignmentId: "PTH-778899",
      trackingCode: "TRK-1",
      charge: 70,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      erpShipmentId: expect.any(String),
      externalOrderId: "WEB-1",
      courier: "Pathao",
      consignmentId: "PTH-778899",
      status: "CREATED",
      orderStatus: "SHIPPED",
    });
    const shipment = await prisma.shipment.findUniqueOrThrow({
      where: { id: res.body.erpShipmentId },
      include: { courierAccount: true },
    });
    expect(shipment).toMatchObject({
      companyId: shop.company.id,
      orderId,
      trackingCode: "TRK-1",
      status: "CREATED",
    });
    expect(shipment.codAmount.toFixed(2)).toBe("2960.00");
    expect(shipment.deliveryCharge.toFixed(2)).toBe("70.00");
    expect(shipment.courierAccount).toMatchObject({
      provider: "PATHAO",
      name: "Pathao",
      credentialsRef: null,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Shipment", entityId: shipment.id },
    });
    expect(audit.userId).toBe(await shopUserOf(shop.integration.id));

    const again = await ship(shop, {
      externalOrderId: "WEB-1",
      courier: "pathao",
      consignmentId: "PTH-778899",
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: "SHIPMENT_EXISTS",
      details: { erpShipmentId: shipment.id },
    });

    // Another courier: Steadfast by name, any other as OTHER; the COD amount as sent.
    const steadfast = await ship(shop, {
      externalOrderId: "WEB-1",
      courier: "Steadfast",
      consignmentId: "SF-1",
      codAmount: 0,
    });
    expect(steadfast.status).toBe(201);
    const redx = await ship(shop, {
      externalOrderId: "WEB-1",
      courier: "RedX",
      consignmentId: "RX-1",
    });
    expect(redx.status).toBe(201);
    const couriers = await prisma.courierAccount.findMany({
      where: { companyId: shop.company.id },
      orderBy: { name: "asc" },
    });
    expect(couriers.map((c) => [c.name, c.provider])).toEqual([
      ["Pathao", "PATHAO"],
      ["RedX", "OTHER"],
      ["Steadfast", "STEADFAST"],
    ]);
    const sf = await prisma.shipment.findUniqueOrThrow({
      where: { id: steadfast.body.erpShipmentId },
    });
    expect(sf.codAmount.toFixed(2)).toBe("0.00");
  });

  it("refuses an unknown or another shop's order, a cancelled order, and bad auth", async () => {
    expect(
      (await ship(shop, { externalOrderId: "WEB-404", courier: "Pathao", consignmentId: "P-1" }))
        .status,
    ).toBe(404);
    const second = await createIntegration(shop.owner, {
      name: "Second shop",
      warehouseId: shop.warehouse.id,
    });
    const keys = await giveKey(second.id);
    expect(
      (await ship(keys, { externalOrderId: "WEB-1", courier: "Pathao", consignmentId: "P-1" }))
        .status,
    ).toBe(404);
    const noKey = await callShop(shop, shipmentsRoute, {
      path: "/shipments",
      body: { externalOrderId: "WEB-1", courier: "Pathao", consignmentId: "P-1" },
      key: null,
    });
    expect(noKey.status).toBe(401);
    const bad = await ship(shop, { externalOrderId: "WEB-1", courier: "", consignmentId: "P-1" });
    expect(bad.status).toBe(422);

    await callShop<{ externalOrderId: string }>(shop, patchRoute, {
      method: "PATCH",
      path: "/orders/WEB-1",
      body: { status: "CANCELLED", reason: "Out of area" },
      params: { externalOrderId: "WEB-1" },
    });
    const cancelled = await ship(shop, {
      externalOrderId: "WEB-1",
      courier: "Pathao",
      consignmentId: "P-1",
    });
    expect(cancelled.status).toBe(409);
    expect(await prisma.shipment.count()).toBe(0);
  });

  it("follows the courier's events: latest by time, delivered delivers the order once", async () => {
    await ship(shop, { externalOrderId: "WEB-1", courier: "Steadfast", consignmentId: "SF-9" });
    const transit = await event(shop, "SF-9", "in transit", "2026-10-20T10:00:00+06:00", {
      courierStatus: "In Transit",
    });
    expect(transit.status, JSON.stringify(transit.body)).toBe(201);
    expect(transit.body).toEqual({
      erpShipmentId: expect.any(String),
      consignmentId: "SF-9",
      status: "IN_TRANSIT",
      orderStatus: "SHIPPED",
    });
    // An older event arriving late does not move the shipment back.
    const picked = await event(shop, "SF-9", "picked", "2026-10-20T08:00:00+06:00");
    expect(picked.body.status).toBe("IN_TRANSIT");

    const delivered = await event(shop, "SF-9", "DELIVERED", "2026-10-21T15:30:00+06:00", {
      note: "Received by buyer",
    });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);
    expect(delivered.body).toMatchObject({ status: "DELIVERED", orderStatus: "DELIVERED" });
    expect(delivered.body.orderError).toBeUndefined();
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { consignmentId: "SF-9" },
      include: { events: true },
    });
    expect(shipment.deliveredAt?.toISOString()).toBe("2026-10-21T09:30:00.000Z");
    expect(shipment.events).toHaveLength(3);
    expect(shipment.events.find((e) => e.status === "IN_TRANSIT")?.rawStatus).toBe("In Transit");
    const row = await stockRow();
    expect(row).toMatchObject({ quantity: 8, reserved: 0 });
    expect(await prisma.invoice.count({ where: { orderId } })).toBe(1);
    expect(await prisma.deliveryChallan.count({ where: { orderId } })).toBe(1);

    // The courier sends it again (another key): saved once, delivered once.
    const repeat = await event(shop, "SF-9", "delivered", "2026-10-21T15:30:00+06:00");
    expect(repeat.status).toBe(201);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: shipment.id } })).toBe(3);
    expect(await prisma.deliveryChallan.count({ where: { orderId } })).toBe(1);

    // Returned after delivery: only saved, the order stays delivered (the shop sends POST /returns).
    const back = await event(shop, "SF-9", "RETURNED", "2026-10-22T10:00:00+06:00");
    expect(back.body).toMatchObject({ status: "RETURNED", orderStatus: "DELIVERED" });
    expect(back.body.orderError).toBeUndefined();
    expect(await stockRow()).toMatchObject({ quantity: 8, reserved: 0 });
  });

  it("a parcel back before delivery frees the stock; with money held the event is kept and says why", async () => {
    await ship(shop, { externalOrderId: "WEB-1", courier: "Pathao", consignmentId: "PT-5" });
    expect(await stockRow()).toMatchObject({ reserved: 2 });
    const back = await event(shop, "PT-5", "RETURNED", "2026-10-21T12:00:00Z", {
      note: "Buyer refused",
    });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(back.body).toMatchObject({ status: "RETURNED", orderStatus: "RETURNED" });
    expect(await stockRow()).toMatchObject({ quantity: 10, reserved: 0 });
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.notes).toContain("Buyer refused");
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { consignmentId: "PT-5" } });
    expect(shipment.returnedAt?.toISOString()).toBe("2026-10-21T12:00:00.000Z");

    // A second order, paid in part before it came back: the event is saved, the order waits for Accounts.
    const second = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        externalOrderId: "WEB-2",
        customer: { name: "Karim", phone: "01911000000" },
        shippingAddress: "Mirpur 10, Dhaka",
        items: [{ sku: navyS, quantity: 1, unitPrice: 1450 }],
        paymentMethod: "bKash",
      },
    });
    await receivePayment(shop.accounts, {
      orderId: second.body.erpOrderId,
      amount: 1450,
      method: "CASH",
    });
    await ship(shop, { externalOrderId: "WEB-2", courier: "Pathao", consignmentId: "PT-6" });
    const held = await event(shop, "PT-6", "RETURNED", "2026-10-21T12:00:00Z");
    expect(held.status).toBe(201);
    expect(held.body).toMatchObject({
      status: "RETURNED",
      orderStatus: "SHIPPED",
      orderError: { code: "PAYMENT_HELD", message: expect.stringContaining("Accounts") },
    });
    expect(
      await prisma.shipmentEvent.count({ where: { shipment: { consignmentId: "PT-6" } } }),
    ).toBe(1);
    expect(await stockRow()).toMatchObject({ reserved: 1 });
  });

  it("finds a consignment only among this shop's orders", async () => {
    await ship(shop, { externalOrderId: "WEB-1", courier: "Pathao", consignmentId: "PT-7" });
    expect((await event(shop, "PT-0", "PICKED_UP", "2026-10-21T12:00:00Z")).status).toBe(404);
    const second = await createIntegration(shop.owner, {
      name: "Second shop",
      warehouseId: shop.warehouse.id,
    });
    const keys = await giveKey(second.id);
    expect((await event(keys, "PT-7", "PICKED_UP", "2026-10-21T12:00:00Z")).status).toBe(404);
    const other = await setupShop("Other Co");
    expect((await event(other, "PT-7", "PICKED_UP", "2026-10-21T12:00:00Z")).status).toBe(404);
    expect((await event(shop, "PT-7", "LOST_IN_SPACE", "2026-10-21T12:00:00Z")).status).toBe(422);
    expect((await event(shop, "PT-7", "PICKED_UP", "yesterday")).status).toBe(422);
    const badSignature = await callShop<{ consignmentId: string }>(shop, eventsRoute, {
      path: "/shipments/PT-7/events",
      body: { status: "PICKED_UP", occurredAt: "2026-10-21T12:00:00Z" },
      params: { consignmentId: "PT-7" },
      headers: { "x-extas-signature": "sha256=00" },
    });
    expect(badSignature.status).toBe(401);
    expect(badSignature.body.error.code).toBe("BAD_SIGNATURE");
  });

  it("a repeat with the same Idempotency-Key gets the first answer and does nothing twice", async () => {
    // PATCH /orders/{id}: the key is honoured when sent.
    const change = (key: string, status: string) =>
      callShop<{ externalOrderId: string }>(shop, patchRoute, {
        method: "PATCH",
        path: "/orders/WEB-1",
        body: { status },
        params: { externalOrderId: "WEB-1" },
        idempotencyKey: key,
      });
    const processing = await change("patch-1", "PROCESSING");
    expect(processing.status, JSON.stringify(processing.body)).toBe(200);
    const auditsAfterFirst = await prisma.auditLog.count({ where: { companyId: shop.company.id } });
    const patchAgain = await change("patch-1", "PROCESSING");
    expect(patchAgain.status).toBe(200);
    expect(patchAgain.headers.get("Idempotent-Replayed")).toBe("true");
    expect(patchAgain.body).toEqual(processing.body);
    expect(await prisma.auditLog.count({ where: { companyId: shop.company.id } })).toBe(
      auditsAfterFirst,
    );
    expect((await change("patch-1", "PACKED")).body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    // POST /shipments.
    const booking = { externalOrderId: "WEB-1", courier: "Pathao", consignmentId: "PTH-42" };
    const booked = await ship(shop, booking, "ship-1");
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    const bookedAgain = await ship(shop, booking, "ship-1");
    expect(bookedAgain.status).toBe(201);
    expect(bookedAgain.headers.get("Idempotent-Replayed")).toBe("true");
    expect(bookedAgain.body).toEqual(booked.body);
    expect(await prisma.shipment.count({ where: { orderId } })).toBe(1);

    // POST /shipments/{consignmentId}/events.
    const delivered = () =>
      callShop<{ consignmentId: string }>(shop, eventsRoute, {
        path: "/shipments/PTH-42/events",
        body: { status: "DELIVERED", occurredAt: "2026-10-21T15:30:00+06:00" },
        params: { consignmentId: "PTH-42" },
        idempotencyKey: "event-1",
      });
    const first = await delivered();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const events = await prisma.shipmentEvent.count({ where: { shipment: { orderId } } });
    const again = await delivered();
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    expect(await prisma.shipmentEvent.count({ where: { shipment: { orderId } } })).toBe(events);
    expect(await prisma.invoice.count({ where: { orderId } })).toBe(1);
    expect((await stockRow()).quantity).toBe(8);
  });
});
