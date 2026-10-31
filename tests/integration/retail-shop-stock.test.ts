import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT as deliveryRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/delivery/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as returnListsRoute } from "@/app/api/v1/ecommerce/return-lists/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { runTransaction } from "@/lib/transaction";
import { billStoreOrderTx } from "@/modules/ecommerce/orders.service";
import { setPin } from "@/modules/ai/settings.service";
import * as parties from "@/modules/parties/party.service";
import { checkParcel, returnsPage } from "@/modules/retail/returns.service";
import * as shopStock from "@/modules/retail/shop-stock.service";
import * as stores from "@/modules/retail/stores.service";
import { resolvePeriod } from "@/modules/accounts/periods";
import { findProductionParties } from "@/modules/production/screens.service";
import { productionVsReadyStock } from "@/modules/reports/source-compare.service";
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

    // Billed twice at the same moment (a retry with the shipment): the reserve is taken once.
    const second = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        externalOrderId: "WEB-2",
        customer: { name: "Karim", phone: "01711000001" },
        shippingAddress: "Mirpur, Dhaka",
        paymentMethod: "cod",
        items: [{ sku, quantity: 2, unitPrice: 850, lineId: "WEB-2-1" }],
      },
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const so = await prisma.salesOrder.findFirstOrThrow({ where: { externalOrderId: "WEB-2" } });
    const billed = await Promise.all(
      [1, 2].map(() => runTransaction((tx) => billStoreOrderTx(tx, shop.owner, so.id))),
    );
    expect(billed.sort()).toEqual([false, true]);
    expect(await reserveOf("Navy")).toBe(23);

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
    expect(page.reserves[0]).toMatchObject({ colour: "Navy", quantity: 23, idle: true });

    // 0 takes it off: wholesale may sell the rest of Navy S (10 less the 5 sold and 2 to WEB-2).
    await shopStock.setReserve(shop.owner, {
      styleId: shop.polo.id,
      colorId: colourId("Navy"),
      quantity: 0,
    });
    await wholesale(3);
  });

  it("buys ready stock on the supplier's bill, at cost with the transport shared, and holds it for the shops", async () => {
    const { party: supplier } = await parties.createParty(shop.owner, {
      kind: "SUPPLIER",
      name: "Narayanganj Garments",
    });
    const cell = (colour: string, size: string, quantity: number) => ({
      colorId: variant(colour, size).colorId,
      sizeId: variant(colour, size).sizeId,
      quantity,
    });
    const input = {
      supplier: { mode: "PICK", supplierId: supplier.id },
      style: { mode: "PICK", styleId: shop.polo.id },
      warehouseId: shop.warehouse.id,
      supplierRef: "NG-77",
      lines: [cell("White", "S", 20), cell("White", "M", 10)],
      priceBasis: "TOTAL",
      price: "12000",
      extraCosts: [
        { label: "Transport", amount: "450" },
        { label: "Loading", amount: "150" },
      ],
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

  it("buys from a one-time supplier with a new style and its size chart, paid in full from one account", async () => {
    const acc = await prisma.ledgerAccount.findFirstOrThrow({
      where: { companyId: shop.owner.company.id, subType: "CASH" },
    });
    const category = await prisma.category.findFirstOrThrow({
      where: { companyId: shop.owner.company.id },
    });
    const navy = colourId("Navy");
    const sizeOf = (name: string) => shop.variants.find((v) => v.size.name === name)!.sizeId;
    const input = {
      supplier: { mode: "RANDOM", name: "Gulistan wholesaler", phone: "01700000000" },
      style: {
        mode: "NEW",
        code: "ex-pn-001",
        name: "Cotton chino pant",
        categoryId: category.id,
        sizeChart: {
          garment: "BOTTOM",
          unit: "INCH",
          points: [{ name: "Waist", values: { [sizeOf("S")]: "30", [sizeOf("M")]: 32 } }],
        },
      },
      warehouseId: shop.warehouse.id,
      lines: [
        { colorId: navy, sizeId: sizeOf("S"), quantity: 200 },
        { colorId: navy, sizeId: sizeOf("M"), quantity: 100 },
      ],
      priceBasis: "TOTAL",
      price: "9000",
      extraCosts: [{ label: "Transport", amount: "2000" }],
      payment: { mode: "FULL", accountId: acc.id, method: "CASH" },
      pin: PIN,
    };

    // Paying now is for those who record payments.
    const noPay = { ...shop.owner, can: (key: string) => key !== "accounts.payments.record" };
    expect((await appError(shopStock.buyReadyStock(noPay as typeof shop.owner, input))).code).toBe(
      "FORBIDDEN",
    );

    const bought = await shopStock.buyReadyStock(shop.owner, input);
    // 9,000 + 2,000 transport = 11,000, all paid: 300 pieces cost 36.6667 each.
    const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: bought.billId } });
    expect(Number(bill.totalAmount)).toBe(11000);
    expect(Number(bill.dueAmount)).toBe(0);
    expect(bill.status).toBe("PAID");
    const supplier = await prisma.party.findUniqueOrThrow({ where: { id: bought.supplierId } });
    expect(supplier).toMatchObject({
      name: "Gulistan wholesaler",
      kind: "SUPPLIER",
      oneTime: true,
    });
    const payment = await prisma.payment.findFirstOrThrow({ where: { supplierBillId: bill.id } });
    expect(Number(payment.amount)).toBe(11000);
    expect(payment.accountId).toBe(acc.id);

    const style = await prisma.style.findUniqueOrThrow({
      where: { id: bought.styleId },
      include: { variants: true, sizeChart: true },
    });
    expect(style.code).toBe("EX-PN-001");
    expect(style.variants).toHaveLength(2);
    expect(style.variants.map((v) => Number(v.avgCost))).toEqual([36.6667, 36.6667]);
    expect(style.sizeChart?.garment).toBe("BOTTOM");
    expect(style.sizeChart?.points).toEqual([
      { name: "Waist", values: { [sizeOf("S")]: 30, [sizeOf("M")]: 32 } },
    ]);
    const purchase = await prisma.readyStockPurchase.findUniqueOrThrow({
      where: { id: bought.id },
    });
    expect(purchase.extraCosts).toEqual([{ label: "Transport", amount: "2000" }]);
    expect(Number(purchase.extraCost)).toBe(2000);

    // Listed under Other suppliers, not in the regular suppliers list.
    const picker = await findProductionParties(shop.owner, { kind: "SUPPLIER" });
    expect(picker.map((p) => p.name)).not.toContain("Gulistan wholesaler");
    const other = await parties.listParties(shop.owner, { kind: "SUPPLIER", oneTime: true });
    expect(other.items.map((p) => p.name)).toEqual(["Gulistan wholesaler"]);
    const regular = await parties.listParties(shop.owner, { kind: "SUPPLIER", oneTime: false });
    expect(regular.items.map((p) => p.name)).not.toContain("Gulistan wholesaler");

    // Part paid: what is left stays due on that supplier's own account.
    const again = await shopStock.buyReadyStock(shop.owner, {
      ...input,
      supplier: { mode: "PICK", supplierId: supplier.id },
      style: { mode: "PICK", styleId: style.id },
      extraCosts: [],
      payment: { mode: "PART", amount: "4000", accountId: acc.id, method: "CASH" },
    });
    const second = await prisma.supplierBill.findUniqueOrThrow({ where: { id: again.billId } });
    expect(Number(second.dueAmount)).toBe(5000);
    expect(
      (
        await appError(
          shopStock.buyReadyStock(shop.owner, {
            ...input,
            payment: { mode: "PART", amount: "99999", accountId: acc.id, method: "CASH" },
            style: { mode: "PICK", styleId: style.id },
          }),
        )
      ).code,
    ).toBe("VALIDATION");
  });

  it("compares production with ready stock: pieces in, sales and profit, a style that came both ways shared", async () => {
    // The polo: 60 pieces of opening stock (setup), 60 made by a factory at 400, 40 bought ready at 300.
    const owner = shop.owner;
    const lot = await prisma.stockLot.create({
      data: {
        companyId: owner.company.id,
        number: "LOT-TEST-PROD",
        styleId: shop.polo.id,
        warehouseId: shop.warehouse.id,
        source: "PRODUCTION",
      },
    });
    const navyM = variant("Navy", "M");
    await prisma.stockMovement.create({
      data: {
        companyId: owner.company.id,
        variantId: navyM.id,
        warehouseId: shop.warehouse.id,
        type: "PRODUCTION_IN",
        quantity: 60,
        unitCost: 400,
        lotId: lot.id,
      },
    });
    const { party: supplier } = await parties.createParty(owner, {
      kind: "SUPPLIER",
      name: "Ready Co",
    });
    await shopStock.buyReadyStock(owner, {
      supplier: { mode: "PICK", supplierId: supplier.id },
      style: { mode: "PICK", styleId: shop.polo.id },
      warehouseId: shop.warehouse.id,
      lines: [{ colorId: navyM.colorId, sizeId: navyM.sizeId, quantity: 40 }],
      priceBasis: "PIECE",
      price: "300",
      pin: PIN,
    });
    // Bought earlier but written down today: it counts on its purchase date.
    const old = await shopStock.buyReadyStock(owner, {
      supplier: { mode: "PICK", supplierId: supplier.id },
      style: { mode: "PICK", styleId: shop.polo.id },
      warehouseId: shop.warehouse.id,
      purchaseDate: "2020-01-15",
      lines: [{ colorId: navyM.colorId, sizeId: navyM.sizeId, quantity: 5 }],
      priceBasis: "PIECE",
      price: "300",
      pin: PIN,
    });
    expect(old.billId).toBeTruthy();
    // 10 pieces sold at 900.
    await wholesale(10);

    const period = resolvePeriod({ period: "ONE_MONTH" }, owner.company);
    const report = await productionVsReadyStock(owner, period);
    expect(report.totals.PRODUCTION).toMatchObject({ piecesIn: 60, costIn: "24000.00" });
    expect(report.totals.READY_STOCK).toMatchObject({ piecesIn: 40, costIn: "12000.00" });
    // Shares by the pieces that came in each way: 60 opening, 60 made, 40 bought.
    const polo = report.styles.find((r) => r.styleId === shop.polo.id)!;
    expect(polo.shared).toBe(true);
    // The earlier purchase is not in this month's pieces, but counts in the shares (45 bought).
    expect(polo.shareNote).toBe("36% production, 27% ready stock, 36% opening and other stock");
    const sold = Object.values(polo.sources).reduce((a, f) => a + f.piecesSold, 0);
    const sales = Object.values(polo.sources).reduce((a, f) => a + Number(f.sales), 0);
    expect(sold).toBe(10);
    expect(sales).toBe(9000);
    expect(polo.sources.READY_STOCK).toMatchObject({ piecesSold: 3 });
    expect(polo.sources.PRODUCTION).toMatchObject({ piecesSold: 4 });
    expect(report.totals.READY_STOCK.profitPct).not.toBeNull();

    // Costs and profit are for those who see the financials.
    const noMoney = {
      ...owner,
      can: (k: string) => k !== "dashboard.financials" && k !== "accounts.view",
    };
    expect((await appError(productionVsReadyStock(noMoney as typeof owner, period))).code).toBe(
      "FORBIDDEN",
    );
  });
});
