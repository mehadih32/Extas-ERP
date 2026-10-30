import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT as deliveryRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/delivery/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as returnListsRoute } from "@/app/api/v1/ecommerce/return-lists/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import * as parties from "@/modules/parties/party.service";
import { checkParcel, returnsPage } from "@/modules/retail/returns.service";
import * as shopStock from "@/modules/retail/shop-stock.service";
import * as stores from "@/modules/retail/stores.service";
import * as orders from "@/modules/sales/order.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";

async function appError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

/*
 * The shops' reserve and "Buy ready stock" (plan v6 sec 3 and 3a). The polo
 * has 10 pieces of each colour and size (Navy and White, S/M/L) at cost 500;
 * the store buys at cost + 25%.
 */
run("Shop stock: the shops' reserve and ready stock bought for them (plan v6 sec 3)", () => {
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

  const variant = (color: string, size: string) =>
    shop.variants.find(
      (v) => v.styleId === shop.polo.id && v.color.name === color && v.size.name === size,
    )!;
  const colourId = (name: string) => shop.variants.find((v) => v.color.name === name)!.colorId;
  const reserveOf = async (color: string | null) =>
    (
      await prisma.retailReserve.findFirst({
        where: { colorId: color ? colourId(color) : null },
      })
    )?.quantity;
  const wholesale = async (quantity: number, forceOverride?: { reason: string }) => {
    const { party } = await parties.createParty(shop.owner, {
      kind: "BUYER",
      name: `Buyer ${Math.random()}`,
    });
    return orders.createOrder(shop.owner, {
      channel: "WHOLESALE",
      partyId: party.id,
      lines: [{ variantId: variant("Navy", "S").id, quantity, unitPrice: 900 }],
      ...(forceOverride ? { forceOverride } : {}),
    });
  };

  it("keeps wholesale out of the reserve, lets the shops take it, and puts approved pieces back", async () => {
    await shopStock.setReserve(shop.owner, {
      styleId: shop.polo.id,
      colorId: colourId("Navy"),
      quantity: 25,
    });
    // A whole-style reserve cannot sit beside one per colour.
    expect(
      (await appError(shopStock.setReserve(shop.owner, { styleId: shop.polo.id, quantity: 5 })))
        .code,
    ).toBe("VALIDATION");

    // 30 Navy pieces, 25 held: wholesale may take 5, not 6, not even with Force Allow.
    const refused = await appError(wholesale(6, { reason: "big buyer" }));
    expect(refused.code).toBe("INSUFFICIENT_STOCK");
    expect(refused.message).toContain("held for the retail shops");
    await wholesale(5);
    expect((await appError(wholesale(1))).code).toBe("INSUFFICIENT_STOCK");

    // The shop takes 3 Navy S: the reserve goes down to 22.
    const sku = shop.sku("EX-PL-001", "Navy", "S");
    const placed = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        externalOrderId: "WEB-1",
        customer: { name: "Rahim", phone: "01711000000" },
        shippingAddress: "Dhanmondi, Dhaka",
        paymentMethod: "cod",
        items: [{ sku, quantity: 3, unitPrice: 850, lineId: "WEB-1-1" }],
      },
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    await callShop(shop, shipmentsRoute, {
      path: "/shipments",
      body: { externalOrderId: "WEB-1", courier: "Pathao", consignmentId: "PTH-1", charge: 70 },
    });
    expect(await reserveOf("Navy")).toBe(22);

    // The parcel comes back and the owner approves the pieces: back on the reserve.
    await callShop(shop, deliveryRoute, {
      method: "PUT",
      path: "/orders/WEB-1/delivery",
      params: { externalOrderId: "WEB-1" },
      body: {
        status: "RETURNED",
        courier: "Pathao",
        consignmentId: "PTH-1",
        at: "2026-11-02T10:00:00+06:00",
      },
    });
    await callShop(shop, returnListsRoute, {
      path: "/return-lists",
      body: {
        returnListId: "RL-1",
        courier: "Pathao",
        handedBackAt: "2026-11-03",
        parcels: [{ consignmentId: "PTH-1", externalOrderId: "WEB-1" }],
      },
    });
    const parcel = (await returnsPage(shop.owner)).waiting[0]!;
    await checkParcel(shop.owner, parcel.id, {
      decisions: parcel.pieces.map((p) => ({ pieceId: p.id, decision: "APPROVE" })),
    });
    expect(await reserveOf("Navy")).toBe(25);

    // 60 days untouched: one reminder, then quiet for the next 60 days.
    await prisma.retailReserve.updateMany({
      data: { activeAt: new Date(Date.now() - 61 * 24 * 3600 * 1000) },
    });
    expect(await shopStock.remindIdleReserves()).toBe(1);
    expect(await shopStock.remindIdleReserves()).toBe(0);
    expect(
      await prisma.notificationLog.count({ where: { entityType: "RetailReserve" } }),
    ).toBeGreaterThan(0);
    const page = await shopStock.shopStockPage(shop.owner);
    expect(page.reserves[0]).toMatchObject({ colour: "Navy", quantity: 25, idle: true });

    // 0 takes it off: wholesale may sell the rest of Navy S (10 less the 5 sold).
    await shopStock.setReserve(shop.owner, {
      styleId: shop.polo.id,
      colorId: colourId("Navy"),
      quantity: 0,
    });
    await wholesale(5);
  });

  it("buys ready stock on the supplier's bill, at cost with the transport shared, and holds it for the shops", async () => {
    const { party: supplier } = await parties.createParty(shop.owner, {
      kind: "SUPPLIER",
      name: "Narayanganj Garments",
    });
    const input = {
      supplierId: supplier.id,
      styleId: shop.polo.id,
      warehouseId: shop.warehouse.id,
      supplierRef: "NG-77",
      lines: [
        { variantId: variant("White", "S").id, quantity: 20, unitPrice: "400" },
        { variantId: variant("White", "M").id, quantity: 10, unitPrice: "400" },
      ],
      extraCost: "600",
      retailOnly: true,
      priceMode: "AT_COST",
    };
    expect((await appError(shopStock.buyReadyStock(shop.owner, input))).code).toBe("VALIDATION");
    const bought = await shopStock.buyReadyStock(shop.owner, { ...input, pin: PIN });
    expect(bought.number).toMatch(/^RSP-\d{4}-00001$/);

    // 12,000 for the goods + 600 transport, due to the supplier.
    const bill = await prisma.supplierBill.findUniqueOrThrow({
      where: { id: bought.billId },
      include: { journalEntry: { include: { lines: true } } },
    });
    expect(bill).toMatchObject({ paymentType: "DUE", status: "UNPAID" });
    expect(Number(bill.dueAmount)).toBe(12600);
    const debit = bill.journalEntry!.lines.reduce((t, l) => t + Number(l.debit), 0);
    expect(debit).toBe(12600);

    // Each piece costs 400 + 20: the SKU's average re-weights (10 at 500, 20 at 420).
    const whiteS = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant("White", "S").id },
    });
    expect(Number(whiteS.avgCost)).toBeCloseTo(446.67, 2);
    const lot = await prisma.stockLot.findFirstOrThrow({ where: { source: "PURCHASE" } });
    expect(lot.styleId).toBe(shop.polo.id);

    // Retail only: all 30 held for the shops; at cost: the shops buy them at 420.
    expect(await reserveOf(null)).toBe(30);
    const prices = await prisma.retailPrice.findMany({
      where: { storeId: store.id, removedAt: null },
    });
    expect(prices.map((p) => Number(p.price))).toEqual([420, 420]);

    const page = await shopStock.shopStockPage(shop.owner);
    expect(page.purchases[0]).toMatchObject({
      pieces: 30,
      toShops: 0,
      total: "12600.00",
      due: "12600.00",
      retailOnly: true,
    });
  });
});
