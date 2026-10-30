import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET as accountRoute } from "@/app/api/v1/ecommerce/account/route";
import { GET as variantsRoute } from "@/app/api/v1/ecommerce/catalog/variants/route";
import { PATCH as patchRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as paymentsRoute } from "@/app/api/v1/ecommerce/payments/route";
import { POST as returnsRoute } from "@/app/api/v1/ecommerce/returns/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { releaseHold } from "@/modules/retail/account.service";
import * as stores from "@/modules/retail/stores.service";
import { receivePayment } from "@/modules/sales/payment.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";
const DAY = 24 * 60 * 60 * 1000;

const order = (externalOrderId: string, items: Array<Record<string, unknown>>, extra = {}) => ({
  externalOrderId,
  customer: { name: "Rahim Uddin", phone: "01711000000" },
  shippingAddress: "House 5, Road 2, Dhanmondi, Dhaka",
  items,
  shippingFee: 80,
  codAmount: 1450,
  paymentMethod: "cod",
  deliveryCharge: 80,
  ...extra,
});

/*
 * A shop linked to a retail store works the retail way (plan v6 sec 9): its
 * orders are sales to the store at the store's prices, billed when the parcel
 * leaves; customer payments and the old returns path are closed; it reads its
 * own prices and its account; it is refused orders while on hold.
 */
run("Retail store's web orders (plan v6, part 2)", () => {
  let shop: Shop;
  let store: Awaited<ReturnType<typeof stores.createStore>>;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    await setPin(shop.owner, { pin: PIN });
    store = await stores.createStore(shop.owner, {
      name: "Extas Retail",
      kind: "ONLINE",
      warehouseId: shop.warehouse.id,
      integrationId: shop.integration.id,
    });
    await stores.setPriceRules(shop.owner, store.id, { aRule: "PERCENT", aValue: "25", pin: PIN });
  });

  const post = (body: unknown) => callShop(shop, ordersRoute, { path: "/orders", body });
  const ship = (externalOrderId: string, consignmentId: string) =>
    callShop(shop, shipmentsRoute, {
      path: "/shipments",
      body: { externalOrderId, courier: "Pathao", consignmentId, charge: 70 },
    });
  const patch = (externalOrderId: string, body: unknown) =>
    callShop<{ externalOrderId: string }>(shop, patchRoute, {
      method: "PATCH",
      path: `/orders/${externalOrderId}`,
      body,
      params: { externalOrderId },
    });
  const navyS = () => shop.sku("EX-PL-001", "Navy", "S");
  const navyM = () => shop.sku("EX-PL-001", "Navy", "M");

  it("sells to the store at its own price, keeps the customer's price, and bills when the parcel leaves", async () => {
    const res = await post(
      order("WEB-1043", [
        { sku: navyS(), quantity: 1, unitPrice: 1450, lineId: "WEB-1043-1", customerPrice: 1400 },
        { sku: navyM(), quantity: 2, unitPrice: 1450, discount: 100 },
      ]),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ erpTotal: 1875, billedAt: null, total: 1875 });
    expect(res.body.lines).toEqual([
      expect.objectContaining({ lineId: "WEB-1043-1", shopPrice: 625, customerPrice: 1400 }),
      expect.objectContaining({ lineId: "WEB-1043-2", shopPrice: 625, customerPrice: 1400 }),
    ]);
    const saved = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: res.body.erpOrderId },
      include: { invoice: true, retailOrder: true },
    });
    expect(saved).toMatchObject({ partyId: store.partyId, shippingCharge: expect.anything() });
    expect(Number(saved.shippingCharge)).toBe(0);
    expect(saved.invoice).toBeNull();
    expect(Number(saved.retailOrder!.customerTotal)).toBe(4200);
    expect(Number(await getPartyBalance(shop.owner, store.partyId))).toBe(0);

    const shipped = await ship("WEB-1043", "PTH-1");
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
    expect(shipped.body.orderStatus).toBe("DELIVERED");
    const billed = await prisma.retailOrder.findUniqueOrThrow({ where: { orderId: saved.id } });
    expect(billed.billedAt).not.toBeNull();
    expect(Number(await getPartyBalance(shop.owner, store.partyId))).toBe(1875);
    // Another shipment (or a delivered result) never bills it twice.
    expect((await patch("WEB-1043", { status: "DELIVERED" })).status).toBe(200);
    expect(Number(await getPartyBalance(shop.owner, store.partyId))).toBe(1875);
    // Goods that left come back only through the return lists.
    const cancel = await patch("WEB-1043", { status: "CANCELLED", reason: "changed mind" });
    expect(cancel.status).toBe(410);
  });

  it("never bills an order cancelled before it leaves, and refuses edits of its lines", async () => {
    expect(
      (await post(order("WEB-1", [{ sku: navyS(), quantity: 1, unitPrice: 1450 }]))).status,
    ).toBe(201);
    const edit = await patch("WEB-1", { items: [{ sku: navyS(), quantity: 2, unitPrice: 1450 }] });
    expect(edit.status).toBe(409);
    const cancel = await patch("WEB-1", { status: "CANCELLED", reason: "customer cancelled" });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.status).toBe("CANCELLED");
    expect(Number(await getPartyBalance(shop.owner, store.partyId))).toBe(0);
  });

  it("refuses a SKU with no shop price, a B-grade line, and a closed store", async () => {
    const tee = shop.sku("EX-TS-002", "White", "S");
    const noPrice = await post(order("WEB-2", [{ sku: tee, quantity: 1, unitPrice: 600 }]));
    expect(noPrice.status).toBe(409);
    expect(noPrice.body.error).toMatchObject({ code: "NO_SHOP_PRICE", details: { skus: [tee] } });
    const bGrade = await post(
      order("WEB-3", [{ sku: navyS(), quantity: 1, unitPrice: 900, grade: "B" }]),
    );
    expect(bGrade.status).toBe(422);
    await stores.setStoreClosed(shop.owner, store.id, true);
    const closed = await post(order("WEB-4", [{ sku: navyS(), quantity: 1, unitPrice: 1450 }]));
    expect(closed.body.error.code).toBe("STORE_CLOSED");
    expect(await prisma.salesOrder.count({ where: { integrationId: shop.integration.id } })).toBe(
      0,
    );
  });

  it("closes customer payments and the old returns for a store", async () => {
    await post(order("WEB-5", [{ sku: navyS(), quantity: 1, unitPrice: 1450 }]));
    const pay = await callShop(shop, paymentsRoute, {
      path: "/payments",
      body: { externalOrderId: "WEB-5", amount: 1450, method: "COD" },
    });
    expect(pay.status).toBe(410);
    const ret = await callShop(shop, returnsRoute, {
      path: "/returns",
      body: {
        externalOrderId: "WEB-5",
        reason: "size",
        items: [{ sku: navyS(), quantity: 1, qc: "GOOD" }],
      },
    });
    expect(ret.status).toBe(410);
  });

  it("shows the store only its own price, never the ERP's cost or price list", async () => {
    const res = await callShop(shop, variantsRoute, { path: "/catalog/variants" });
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ grade: "A", shopPrice: 625 });
    expect(rows[0]).not.toHaveProperty("avgCost");
    expect(rows[0]).not.toHaveProperty("retailPrice");
    const one = await callShop(shop, variantsRoute, {
      path: "/catalog/variants?styleCode=EX-TS-002",
    });
    expect(one.body.data).toEqual([]);
  });

  it("holds new orders 30 days after the last payment while it owes, until it pays or the owner lifts it", async () => {
    await post(order("WEB-6", [{ sku: navyS(), quantity: 1, unitPrice: 1450 }]));
    await ship("WEB-6", "PTH-6");
    // The bill was 31 days ago and nothing was paid since.
    await prisma.journalEntry.updateMany({
      where: { companyId: shop.company.id, sourceType: "SALE" },
      data: { date: new Date(Date.now() - 31 * DAY) },
    });
    let account = await callShop(shop, accountRoute, { path: "/account" });
    expect(account.body).toMatchObject({ balance: 625, waitingCheck: 0, hold: { onHold: true } });
    const held = await post(order("WEB-7", [{ sku: navyM(), quantity: 1, unitPrice: 1450 }]));
    expect(held.status).toBe(409);
    expect(held.body.error.code).toBe("ACCOUNT_ON_HOLD");

    await expect(releaseHold(shop.owner, store.id, { reason: "paying Friday" })).rejects.toThrow();
    await releaseHold(shop.owner, store.id, { reason: "paying Friday", days: 3, pin: PIN });
    expect(
      (await post(order("WEB-7", [{ sku: navyM(), quantity: 1, unitPrice: 1450 }]))).status,
    ).toBe(201);
    await prisma.retailStore.update({ where: { id: store.id }, data: { holdReleasedUntil: null } });

    // Any payment starts the 30 days again.
    await receivePayment(shop.accounts, { partyId: store.partyId, amount: 100, method: "CASH" });
    account = await callShop(shop, accountRoute, { path: "/account" });
    expect(account.body.hold).toMatchObject({ onHold: false, daysSinceLastPayment: 0 });
    expect(account.body.balance).toBe(525);
    expect(
      (await post(order("WEB-8", [{ sku: navyM(), quantity: 1, unitPrice: 1450 }]))).status,
    ).toBe(201);
  });

  it("gives the store's bills and payments for a period", async () => {
    await post(order("WEB-9", [{ sku: navyS(), quantity: 2, unitPrice: 1450 }]));
    await ship("WEB-9", "PTH-9");
    await receivePayment(shop.accounts, { partyId: store.partyId, amount: 1000, method: "CASH" });
    const today = new Date().toISOString().slice(0, 10);
    const res = await callShop(shop, accountRoute, {
      path: `/account?from=2026-01-01&to=${today}`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.period).toMatchObject({
      openingBalance: 0,
      ordersTotal: 1250,
      paymentsTotal: 1000,
      closingBalance: 250,
    });
    expect(res.body.statement.map((r: { kind: string }) => r.kind)).toEqual(
      expect.arrayContaining(["BILL", "PAYMENT"]),
    );
  });
});
