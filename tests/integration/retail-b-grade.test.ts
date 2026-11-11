import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET as variantsRoute } from "@/app/api/v1/ecommerce/catalog/variants/route";
import { PUT as deliveryRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/delivery/route";
import { PATCH as lineRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/lines/[lineId]/route";
import { PATCH as patchRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as returnListsRoute } from "@/app/api/v1/ecommerce/return-lists/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { GET as skuStockRoute } from "@/app/api/v1/ecommerce/stock/[sku]/route";
import { GET as stockRoute } from "@/app/api/v1/ecommerce/stock/route";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import { returnUndeliveredTx } from "@/modules/ecommerce/orders.service";
import { scanShopChanges } from "@/modules/ecommerce/webhooks";
import * as stock from "@/modules/inventory/stock.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { createParty } from "@/modules/parties/party.service";
import { checkParcel, returnsPage } from "@/modules/retail/returns.service";
import * as stores from "@/modules/retail/stores.service";
import { createOrder, updateOrder } from "@/modules/sales/order.service";
import { createSalesReturn } from "@/modules/sales/return.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";

/*
 * B-grade lines for a retail store's shop (the owner, 2026-11-11). The store
 * buys the Classic Polo's A-grade pieces at 625 (cost 500 + 25%) and its
 * B-grade pieces at the style's B-grade price (400), else at the A price. A B
 * line takes the factory's B-grade stock (Navy S: 3 pieces at cost 200) at
 * the B-grade cost; one SKU is on one order in one grade only.
 */
run("Retail store's B-grade lines", () => {
  let shop: Shop;
  let store: Awaited<ReturnType<typeof stores.createStore>>;
  const sku = (color: string, size: string) => shop.sku("EX-PL-001", color, size);
  const variantOf = (s: string) => shop.variants.find((v) => v.sku === s)!;

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
    await prisma.style.update({ where: { id: shop.polo.id }, data: { bGradePrice: 400 } });
    await stock.adjustStock(shop.owner, {
      variantId: variantOf(sku("Navy", "S")).id,
      quantity: 3,
      grade: "B_GRADE",
      type: "OPENING",
      unitCost: 200,
    });
  });

  const order = (id: string, items: Array<Record<string, unknown>>) =>
    callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        externalOrderId: id,
        customer: { name: "Rahim", phone: "01711000000" },
        shippingAddress: "Dhanmondi, Dhaka",
        paymentMethod: "cod",
        items: items.map((item, i) => ({ unitPrice: 900, lineId: `${id}-${i + 1}`, ...item })),
      },
    });
  const ship = (id: string) =>
    callShop(shop, shipmentsRoute, {
      path: "/shipments",
      body: { externalOrderId: id, courier: "Pathao", consignmentId: `PTH-${id}`, charge: 70 },
    });
  const comeBack = async (id: string) => {
    const back = await callShop(shop, deliveryRoute, {
      method: "PUT",
      path: `/orders/${id}/delivery`,
      params: { externalOrderId: id },
      body: {
        status: "RETURNED",
        courier: "Pathao",
        consignmentId: `PTH-${id}`,
        at: "2026-11-02T10:00:00+06:00",
      },
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const list = await callShop(shop, returnListsRoute, {
      path: "/return-lists",
      body: {
        returnListId: `RL-${id}`,
        courier: "Pathao",
        handedBackAt: "2026-11-03",
        parcels: [{ consignmentId: `PTH-${id}`, externalOrderId: id }],
      },
    });
    expect(list.status, JSON.stringify(list.body)).toBe(201);
  };
  const balanceOf = (s: string, grade: "A_GRADE" | "B_GRADE") =>
    prisma.stockBalance.findUniqueOrThrow({
      where: {
        variantId_warehouseId_grade: {
          variantId: variantOf(s).id,
          warehouseId: shop.warehouse.id,
          grade,
        },
      },
    });
  const storeOwes = async () => Number(await getPartyBalance(shop.owner, store.partyId));

  it("prices a B line at the style's B-grade price (else the A price) and reserves B-grade stock", async () => {
    const navyS = sku("Navy", "S");
    const placed = await order("WEB-1", [{ sku: navyS, quantity: 2, grade: "B" }]);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body).toMatchObject({ erpTotal: 800, total: 800 });
    expect(placed.body.lines).toEqual([
      expect.objectContaining({ sku: navyS, grade: "B", quantity: 2, shopPrice: 400 }),
    ]);
    const item = await prisma.salesOrderItem.findFirstOrThrow({
      where: { orderId: placed.body.erpOrderId },
    });
    expect(item).toMatchObject({ grade: "B_GRADE", quantity: 2, forceOverride: false });
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3, reserved: 2 });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 10, reserved: 0 });

    // B-grade stock is short (1 left), however much A-grade stock there is: nothing is reserved.
    const short = await order("WEB-2", [{ sku: navyS, quantity: 2, grade: "B" }]);
    expect(short.status).toBe(409);
    expect(short.body.error).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details: { shortSkus: [{ sku: navyS, requested: 2, available: 1 }] },
    });
    const navyM = sku("Navy", "M");
    const none = await order("WEB-3", [{ sku: navyM, quantity: 1, grade: "B" }]);
    expect(none.status).toBe(409);
    expect(none.body.error.details.shortSkus).toEqual([{ sku: navyM, requested: 1, available: 0 }]);
    expect(await balanceOf(navyM, "A_GRADE")).toMatchObject({ quantity: 10, reserved: 0 });

    // Without a B-grade price on the style, a B-grade piece costs the store its A price.
    await prisma.style.update({ where: { id: shop.polo.id }, data: { bGradePrice: null } });
    const atA = await order("WEB-4", [{ sku: navyS, quantity: 1, grade: "B" }]);
    expect(atA.status, JSON.stringify(atA.body)).toBe(201);
    expect(atA.body.lines[0]).toMatchObject({ grade: "B", shopPrice: 625 });
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3, reserved: 3 });
  });

  it("refuses one SKU in both grades on one order, also through a replaced line", async () => {
    const navyS = sku("Navy", "S");
    const both = await order("WEB-1", [
      { sku: navyS, quantity: 1 },
      { sku: navyS, quantity: 1, grade: "B" },
    ]);
    expect(both.status).toBe(422);
    expect(both.body.error).toMatchObject({
      code: "VALIDATION",
      message: `${navyS} is on this order as both A-grade and B-grade: send them as separate orders.`,
      details: { bothGrades: [navyS] },
    });
    expect(await prisma.salesOrder.count()).toBe(0);
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ reserved: 0 });

    // Two lines of one SKU in the same grade are fine.
    const twice = await order("WEB-2", [
      { sku: navyS, quantity: 1, grade: "B" },
      { sku: navyS, quantity: 1, grade: "B" },
    ]);
    expect(twice.status, JSON.stringify(twice.body)).toBe(201);
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ reserved: 2 });

    // A line waiting for stock (its Return stock piece failed the check) is replaced.
    const navyM = sku("Navy", "M");
    const placed = await order("WEB-3", [
      { sku: navyS, quantity: 1 },
      { sku: navyM, quantity: 1 },
    ]);
    expect(placed.status).toBe(201);
    await prisma.retailOrderLine.updateMany({
      where: { lineId: "WEB-3-2" },
      data: { waitingStock: true },
    });
    const patchLine = (body: Record<string, unknown>) =>
      callShop(shop, lineRoute, {
        method: "PATCH",
        path: "/orders/WEB-3/lines/WEB-3-2",
        params: { externalOrderId: "WEB-3", lineId: "WEB-3-2" },
        body,
      });
    const clash = await patchLine({ action: "REPLACE", sku: navyS, grade: "B" });
    expect(clash.status).toBe(422);
    expect(clash.body.error.details).toEqual({ bothGrades: [navyS] });

    // Another SKU's B-grade piece: it takes B-grade stock and frees the A-grade reservation.
    await stock.adjustStock(shop.owner, {
      variantId: variantOf(sku("White", "S")).id,
      quantity: 2,
      grade: "B_GRADE",
      type: "OPENING",
      unitCost: 150,
    });
    const whiteS = sku("White", "S");
    const replaced = await patchLine({ action: "REPLACE", sku: whiteS, grade: "B" });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body.lines[1]).toMatchObject({ sku: whiteS, grade: "B", shopPrice: 400 });
    expect(replaced.body.erpTotal).toBe(1025);
    const items = await prisma.salesOrderItem.findMany({
      where: { orderId: placed.body.erpOrderId },
      include: { variant: { select: { sku: true } } },
    });
    expect(items.map((i) => [i.variant.sku, i.grade]).sort()).toEqual(
      [
        [navyS, "A_GRADE"],
        [whiteS, "B_GRADE"],
      ].sort(),
    );
    expect(await balanceOf(whiteS, "B_GRADE")).toMatchObject({ quantity: 2, reserved: 1 });
    expect(await balanceOf(navyM, "A_GRADE")).toMatchObject({ quantity: 10, reserved: 0 });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ reserved: 1 });
  });

  it("bills a B line out of B-grade stock at the B-grade cost, never from the shops' reserve", async () => {
    const navyS = sku("Navy", "S");
    const navyM = sku("Navy", "M");
    const reserve = await prisma.retailReserve.create({
      data: { companyId: shop.company.id, styleId: shop.polo.id, quantity: 5 },
    });
    const placed = await order("WEB-1", [
      { sku: navyS, quantity: 2, grade: "B" },
      { sku: navyM, quantity: 1 },
    ]);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.erpTotal).toBe(1425);
    const shipped = await ship("WEB-1");
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
    expect(await storeOwes()).toBe(1425);

    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 1, reserved: 0 });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 10, reserved: 0 });
    expect(await balanceOf(navyM, "A_GRADE")).toMatchObject({ quantity: 9, reserved: 0 });
    const out = await prisma.stockMovement.findMany({
      where: { referenceId: placed.body.erpOrderId, type: "SALE_OUT" },
      include: { variant: { select: { sku: true } } },
    });
    expect(out.map((m) => [m.variant.sku, m.grade, m.quantity, Number(m.unitCost)]).sort()).toEqual(
      [
        [navyS, "B_GRADE", -2, 200],
        [navyM, "A_GRADE", -1, 500],
      ].sort(),
    );
    const items = await prisma.salesOrderItem.findMany({
      where: { orderId: placed.body.erpOrderId },
      include: { variant: { select: { sku: true } } },
    });
    expect(Object.fromEntries(items.map((i) => [i.variant.sku, Number(i.unitCost)]))).toEqual({
      [navyS]: 200,
      [navyM]: 500,
    });
    // Cost of goods: 2 x 200 + 1 x 500.
    const challan = await prisma.deliveryChallan.findFirstOrThrow({
      where: { orderId: placed.body.erpOrderId },
    });
    const cogs = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "SALE", sourceId: challan.id },
      include: { lines: true },
    });
    expect(Math.max(...cogs.lines.map((l) => Number(l.debit)))).toBe(900);
    // The B-grade average cost is unchanged by the sale, and the A-grade one too.
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantOf(navyS).id } });
    expect([Number(v.avgCost), Number(v.bGradeAvgCost)]).toEqual([500, 200]);
    // The shops' reserve gave only the A-grade piece.
    expect(
      (await prisma.retailReserve.findUniqueOrThrow({ where: { id: reserve.id } })).quantity,
    ).toBe(4);
    const lines = await prisma.retailOrderLine.findMany({ orderBy: { lineId: "asc" } });
    expect(lines.map((l) => [l.grade, l.fromReserve])).toEqual([
      ["B", 0],
      ["A", 1],
    ]);
  });

  it("never takes a piece sold as B-grade back as A-grade on a hand-entered return", async () => {
    const navyS = sku("Navy", "S");
    const placed = await order("WEB-1", [{ sku: navyS, quantity: 1, grade: "B" }]);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect((await ship("WEB-1")).status).toBe(201);
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { orderId: placed.body.erpOrderId },
    });
    const item = await prisma.salesOrderItem.findFirstOrThrow({
      where: { orderId: placed.body.erpOrderId },
    });
    expect(item.grade).toBe("B_GRADE");
    const back = (qc: "GOOD" | "B_GRADE") =>
      createSalesReturn(shop.owner, {
        invoiceId: invoice.id,
        items: [{ orderItemId: item.id, quantity: 1, qc }],
        reason: "Came back to the store",
      });
    await expect(back("GOOD")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 10 });
    await back("B_GRADE");
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3 });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 10 });
  });

  it("takes an approved B piece back into B-grade stock at its cost, and credits the price paid", async () => {
    const navyS = sku("Navy", "S");
    const navyM = sku("Navy", "M");
    await order("WEB-1", [
      { sku: navyS, quantity: 2, grade: "B" },
      { sku: navyM, quantity: 1 },
    ]);
    await ship("WEB-1");
    expect(await storeOwes()).toBe(1425);
    await comeBack("WEB-1");
    const parcel = (await returnsPage(shop.owner)).waiting[0]!;
    expect(parcel.pieces).toHaveLength(3);
    await checkParcel(shop.owner, parcel.id, {
      decisions: parcel.pieces.map((p) => ({ pieceId: p.id, decision: "APPROVE" as const })),
    });
    expect(await storeOwes()).toBe(0);
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3, reserved: 0 });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 10 });
    expect(await balanceOf(navyM, "A_GRADE")).toMatchObject({ quantity: 10 });
    const back = await prisma.stockMovement.findMany({
      where: { type: "RETURN_RESTOCK" },
      include: { variant: { select: { sku: true } } },
    });
    expect(
      back.map((m) => [m.variant.sku, m.grade, m.quantity, Number(m.unitCost)]).sort(),
    ).toEqual(
      [
        [navyS, "B_GRADE", 2, 200],
        [navyM, "A_GRADE", 1, 500],
      ].sort(),
    );
    const returned = await prisma.salesReturnItem.findMany({
      include: { variant: { select: { sku: true } } },
    });
    expect(
      Object.fromEntries(returned.map((r) => [r.variant.sku, [r.qcStatus, Number(r.amount)]])),
    ).toEqual({ [navyS]: ["MOVED_TO_B_GRADE", 800], [navyM]: ["MOVED_TO_MAIN_STOCK", 625] });
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantOf(navyS).id } });
    expect([Number(v.avgCost), Number(v.bGradeAvgCost)]).toEqual([500, 200]);
  });

  it("gives a B line only pieces sold as B-grade from Return stock, an A line only A-grade ones", async () => {
    const navyS = sku("Navy", "S");
    await order("WEB-1", [{ sku: navyS, quantity: 1, grade: "B" }]);
    await ship("WEB-1");
    await comeBack("WEB-1");
    // Main A-grade stock is 10: the 11th piece cannot be the B-grade piece in Return stock.
    const a = await order("WEB-2", [{ sku: navyS, quantity: 11 }]);
    expect(a.status).toBe(409);
    expect(a.body.error.details.shortSkus).toEqual([{ sku: navyS, requested: 11, available: 10 }]);
    // 2 B-grade pieces are left in stock: the third is the one in Return stock.
    const b = await order("WEB-3", [{ sku: navyS, quantity: 3, grade: "B" }]);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.lines[0]).toMatchObject({ grade: "B", fromReturnStock: true, shopPrice: 400 });
  });

  it("frees the B-grade reservation when the order is cancelled or comes back before it left", async () => {
    const navyS = sku("Navy", "S");
    const navyM = sku("Navy", "M");
    await order("WEB-1", [
      { sku: navyS, quantity: 2, grade: "B" },
      { sku: navyM, quantity: 1 },
    ]);
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ reserved: 2 });
    const cancelled = await callShop<{ externalOrderId: string }>(shop, patchRoute, {
      method: "PATCH",
      path: "/orders/WEB-1",
      params: { externalOrderId: "WEB-1" },
      body: { status: "CANCELLED", reason: "customer cancelled" },
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3, reserved: 0 });
    expect(await balanceOf(navyM, "A_GRADE")).toMatchObject({ quantity: 10, reserved: 0 });

    const placed = await order("WEB-2", [{ sku: navyS, quantity: 3, grade: "B" }]);
    expect(placed.status).toBe(201);
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ reserved: 3 });
    await prisma.$transaction((tx) =>
      returnUndeliveredTx(tx, shop.owner, placed.body.erpOrderId, "courier never took it"),
    );
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3, reserved: 0 });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 10, reserved: 0 });
  });

  it("lists a SKU's B-grade row (its own price and stock) for the store's site only", async () => {
    const navyS = sku("Navy", "S");
    const catalog = await callShop(shop, variantsRoute, { path: "/catalog/variants" });
    expect(catalog.status).toBe(200);
    const rows = catalog.body.data as Array<Record<string, unknown>>;
    // 6 A-grade rows, and Navy S's B-grade row right after its A row.
    expect(rows).toHaveLength(7);
    const at = rows.findIndex((r) => r.sku === navyS);
    expect(rows.slice(at, at + 2)).toEqual([
      expect.objectContaining({ sku: navyS, grade: "A", shopPrice: 625 }),
      expect.objectContaining({ sku: navyS, grade: "B", shopPrice: 400 }),
    ]);
    expect(rows.filter((r) => r.grade === "B")).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/avgCost|retailPrice/);

    const all = await callShop(shop, stockRoute, { path: "/stock" });
    expect(all.body.data).toHaveLength(7);
    expect(all.body.data.filter((r: { grade: string }) => r.grade === "B")).toEqual([
      expect.objectContaining({ sku: navyS, grade: "B", onHand: 3, reserved: 0, available: 3 }),
    ]);
    expect(all.body.data.filter((r: { grade: string }) => r.grade === "A")).toHaveLength(6);
    await order("WEB-1", [{ sku: navyS, quantity: 1, grade: "B" }]);
    const one = await callShop<{ sku: string }>(shop, skuStockRoute, {
      path: `/stock/${navyS}`,
      params: { sku: navyS },
    });
    expect(one.body).toMatchObject({ sku: navyS, available: 10 });
    expect(one.body.warehouses).toEqual([
      expect.objectContaining({ grade: "A", onHand: 10, reserved: 0, available: 10 }),
      expect.objectContaining({ grade: "B", onHand: 3, reserved: 1, available: 2 }),
    ]);

    // A shop that is not a retail store's (it cannot order B-grade lines) sees only A-grade rows.
    await prisma.retailStore.update({ where: { id: store.id }, data: { integrationId: null } });
    const plain = await callShop(shop, stockRoute, { path: "/stock" });
    expect(plain.body.data).toHaveLength(6);
    expect(plain.body.data.every((r: { grade: string }) => r.grade === "A")).toBe(true);
  });

  it("sends a B-grade row's webhooks under their own key, so they never replace the A-grade ones", async () => {
    const navyS = sku("Navy", "S");
    const navyM = sku("Navy", "M");
    const later = () => new Promise((resolve) => setTimeout(resolve, 5));
    let from = new Date(0);
    /** What was sent since the first pass (which told the site of the opening stock). */
    const outgoing = (where: Record<string, unknown>) =>
      prisma.webhookEvent.findMany({
        where: {
          integrationId: shop.integration.id,
          direction: "OUTGOING",
          receivedAt: { gt: from },
          ...where,
        },
        orderBy: { receivedAt: "asc" },
      });
    await scanShopChanges();
    await later();
    from = new Date();
    await later();

    // Navy M's first B-grade pieces: its B-grade listing and its B-grade stock row.
    await stock.adjustStock(shop.owner, {
      variantId: variantOf(navyM).id,
      quantity: 2,
      grade: "B_GRADE",
      type: "OPENING",
      unitCost: 180,
    });
    await scanShopChanges();
    const [bStock] = await outgoing({ eventType: "stock.changed", externalId: `${navyM}:B` });
    expect((bStock!.payload as { data: unknown }).data).toMatchObject({
      sku: navyM,
      grade: "B",
      onHand: 2,
      available: 2,
    });
    const [bListing] = await outgoing({ eventType: "variant.changed", externalId: `${navyM}:B` });
    expect((bListing!.payload as { data: unknown }).data).toMatchObject({
      sku: navyM,
      grade: "B",
      shopPrice: 400,
      isNew: true,
    });
    expect(await outgoing({ eventType: "stock.changed", externalId: navyM })).toHaveLength(0);

    // A B-grade sale moves only the B-grade row; the listing is not sent again.
    await later();
    const placed = await order("WEB-1", [{ sku: navyM, quantity: 1, grade: "B" }]);
    expect(placed.status).toBe(201);
    await scanShopChanges();
    const bRows = await outgoing({ eventType: "stock.changed", externalId: `${navyM}:B` });
    expect(bRows.map((e) => (e.payload as { data: { reserved: number } }).data.reserved)).toEqual([
      0, 1,
    ]);
    expect(await outgoing({ eventType: "variant.changed", externalId: `${navyM}:B` })).toHaveLength(
      1,
    );
    expect(await outgoing({ eventType: "stock.changed", externalId: navyM })).toHaveLength(0);

    // An A-grade change of Navy S goes under the plain SKU, as always.
    await later();
    await order("WEB-2", [{ sku: navyS, quantity: 1 }]);
    await scanShopChanges();
    const [aRow] = await outgoing({ eventType: "stock.changed", externalId: navyS });
    expect((aRow!.payload as { data: unknown }).data).toMatchObject({
      sku: navyS,
      grade: "A",
      reserved: 1,
    });
    expect(await outgoing({ eventType: "stock.changed", externalId: `${navyS}:B` })).toHaveLength(
      0,
    );
    expect((await scanShopChanges()).events).toBe(0);
  });

  it("keeps a B line B-grade when the order's lines are edited in the ERP", async () => {
    const navyS = sku("Navy", "S");
    const placed = await order("WEB-1", [{ sku: navyS, quantity: 2, grade: "B" }]);
    expect(placed.status).toBe(201);
    await updateOrder(shop.owner, placed.body.erpOrderId, {
      lines: [{ variantId: variantOf(navyS).id, quantity: 1, unitPrice: 400 }],
    });
    const item = await prisma.salesOrderItem.findFirstOrThrow({
      where: { orderId: placed.body.erpOrderId },
    });
    expect(item).toMatchObject({ grade: "B_GRADE", quantity: 1, forceOverride: false });
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3, reserved: 1 });
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 10, reserved: 0 });
  });

  it("keeps wholesale orders on A-grade stock only", async () => {
    const navyS = sku("Navy", "S");
    const buyer = (await createParty(shop.owner, { kind: "BUYER", name: "Rahim Traders" })).party;
    const wholesale = await createOrder(shop.owner, {
      channel: "WHOLESALE",
      partyId: buyer.id,
      warehouseId: shop.warehouse.id,
      lines: [{ variantId: variantOf(navyS).id, quantity: 2 }],
      documents: { invoice: true, packingList: true, deliveryChallan: true },
    });
    const item = await prisma.salesOrderItem.findFirstOrThrow({
      where: { orderId: wholesale.id },
    });
    expect(item).toMatchObject({ grade: "A_GRADE" });
    expect(Number(item.unitCost)).toBe(500);
    expect(await balanceOf(navyS, "A_GRADE")).toMatchObject({ quantity: 8, reserved: 0 });
    expect(await balanceOf(navyS, "B_GRADE")).toMatchObject({ quantity: 3, reserved: 0 });
  });
});
