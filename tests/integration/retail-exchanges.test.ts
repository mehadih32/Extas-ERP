import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET as accountRoute } from "@/app/api/v1/ecommerce/account/route";
import { GET as exchangesRoute } from "@/app/api/v1/ecommerce/exchanges/route";
import { PUT as deliveryRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/delivery/route";
import { PATCH as lineRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/lines/[lineId]/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as returnListsRoute } from "@/app/api/v1/ecommerce/return-lists/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { billOverdueExchanges } from "@/modules/retail/exchanges.service";
import { checkParcel, returnsPage } from "@/modules/retail/returns.service";
import * as stores from "@/modules/retail/stores.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";

/*
 * A retail store's exchanges (plan v6 sec 8.9): the new piece goes out unbilled
 * and only the difference is settled when the old piece is checked. The polo
 * costs 500; the store buys it at 625 (25%), later at 700 (40%) and 725 (45%).
 */
run("Retail store's exchanges (plan v6 sec 8.9)", () => {
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
    await priceAt("25");
  });

  const priceAt = (percent: string) =>
    stores.setPriceRules(shop.owner, store.id, { aRule: "PERCENT", aValue: percent, pin: PIN });
  const sku = (color: string, size: string) => shop.sku("EX-PL-001", color, size);
  const order = (body: Record<string, unknown>) =>
    callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        customer: { name: "Rahim", phone: "01711000000" },
        shippingAddress: "Dhanmondi, Dhaka",
        paymentMethod: "cod",
        ...body,
      },
    });
  const ship = (id: string) =>
    callShop(shop, shipmentsRoute, {
      path: "/shipments",
      body: { externalOrderId: id, courier: "Pathao", consignmentId: `PTH-${id}`, charge: 70 },
    });
  const deliver = (id: string, status = "DELIVERED", extra: Record<string, unknown> = {}) =>
    callShop(shop, deliveryRoute, {
      method: "PUT",
      path: `/orders/${id}/delivery`,
      params: { externalOrderId: id },
      body: {
        status,
        courier: "Pathao",
        consignmentId: `PTH-${id}`,
        at: "2026-11-03T12:00:00+06:00",
        ...extra,
      },
    });
  const handBack = (listId: string, id: string, handedBackAt = "2026-11-05") =>
    callShop(shop, returnListsRoute, {
      path: "/return-lists",
      body: {
        returnListId: listId,
        courier: "Pathao",
        handedBackAt,
        parcels: [{ consignmentId: `PICK-${id}`, externalOrderId: id }],
      },
    });
  const exchange = (id: string, of: string, replaces: string, newSku: string) =>
    order({
      externalOrderId: id,
      exchange: { ofExternalOrderId: of, note: "size M for size L" },
      items: [
        {
          lineId: `${id}-1`,
          replacesLineId: replaces,
          sku: newSku,
          quantity: 1,
          unitPrice: 0,
          customerPrice: 0,
        },
      ],
    });
  const balance = async () => Number(await getPartyBalance(shop.owner, store.partyId));
  const stockOf = async (s: string) =>
    (
      await prisma.stockBalance.findFirstOrThrow({
        where: { variant: { sku: s }, grade: "A_GRADE" },
      })
    ).quantity;
  /** Checks every waiting piece with the one decision. */
  const check = async (decision: "APPROVE" | "DECLINE") => {
    const parcel = (await returnsPage(shop.owner)).waiting[0]!;
    await checkParcel(shop.owner, parcel.id, {
      decisions: parcel.pieces.map((p) => ({
        pieceId: p.id,
        decision,
        ...(decision === "DECLINE" ? { reason: "STAIN_OR_DAMAGE" } : {}),
      })),
    });
  };
  const placeAndDeliver = async () => {
    const placed = await order({
      externalOrderId: "WEB-1043",
      items: [
        { sku: sku("Navy", "S"), quantity: 1, unitPrice: 850, lineId: "WEB-1043-1" },
        { sku: sku("Navy", "M"), quantity: 1, unitPrice: 1190, lineId: "WEB-1043-2" },
      ],
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect((await ship("WEB-1043")).status).toBe(201);
    expect((await deliver("WEB-1043")).status).toBe(200);
    expect(await balance()).toBe(1250);
  };

  it("settles only the difference, exchange after exchange, when the old pieces come back approved", async () => {
    await placeAndDeliver();
    await priceAt("40");
    const placed = await exchange("WEB-1043-X1", "WEB-1043", "WEB-1043-2", sku("Navy", "L"));
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body).toMatchObject({
      erpTotal: 0,
      exchangeId: expect.stringMatching(/^EXG-\d{4}-00001$/),
      atRisk: 700,
      lines: [{ replacesLineId: "WEB-1043-2", shopPrice: 700, replacedShopPrice: 625 }],
    });
    // The same line cannot be exchanged twice at once.
    const twice = await exchange("WEB-1043-X9", "WEB-1043", "WEB-1043-2", sku("White", "L"));
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("EXCHANGE_OPEN");

    const navyM = await stockOf(sku("Navy", "M"));
    await ship("WEB-1043-X1");
    await deliver("WEB-1043-X1");
    expect(await balance()).toBe(1250);
    const account = await callShop(shop, accountRoute, { path: "/account" });
    expect(account.body).toMatchObject({ balance: 1250, exchangesAtRisk: 700 });

    const list = await handBack("RL-140", "WEB-1043-X1");
    expect(list.body.parcels[0]).toMatchObject({
      result: "IN_RETURN_STOCK",
      pieces: [{ lineId: "WEB-1043-2", sku: sku("Navy", "M") }],
    });
    await check("APPROVE");
    expect(await balance()).toBe(1325); // 625 + 75 for the bigger size
    expect(await stockOf(sku("Navy", "M"))).toBe(navyM + 1);

    // The customer exchanges the new piece again: 700 -> 725 adds 25.
    await priceAt("45");
    const again = await exchange("WEB-1043-X2", "WEB-1043-X1", "WEB-1043-X1-1", sku("White", "L"));
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    await ship("WEB-1043-X2");
    await deliver("WEB-1043-X2");
    await handBack("RL-141", "WEB-1043-X2");
    await check("APPROVE");
    expect(await balance()).toBe(1350); // 625 + 625 + 75 + 25

    const pulled = await callShop(shop, exchangesRoute, {
      path: "/exchanges?status=all",
    });
    expect(pulled.body.totalAtRisk).toBe(0);
    expect(
      pulled.body.items.map(
        (x: { status: string; events: Array<{ type: string; kind?: string; amount: number }> }) => [
          x.status,
          x.events.map((e) => [e.type, e.kind, e.amount]),
        ],
      ),
    ).toEqual([
      ["SETTLED", [["exchange.settled", "EXTRA", 75]]],
      ["SETTLED", [["exchange.settled", "EXTRA", 25]]],
    ]);
    // The site was told the same events, under the same ids.
    const pushed = await prisma.webhookEvent.findMany({
      where: { direction: "OUTGOING", eventType: "exchange.settled" },
    });
    expect(pushed.map((e) => e.id).sort()).toEqual(
      pulled.body.items
        .flatMap((x: { events: Array<{ eventId: string }> }) => x.events.map((e) => e.eventId))
        .sort(),
    );
    expect((pushed[0]!.payload as { data: { amount: number } }).data.amount).toBeGreaterThan(0);
    const period = await callShop(shop, accountRoute, {
      path: "/account?from=2020-01-01&to=2099-12-31",
    });
    expect(period.body.period).toMatchObject({ exchangesTotal: 100, closingBalance: 1350 });
  });

  it("bills the new piece when the old one is late, and credits the old one when it comes back approved", async () => {
    await placeAndDeliver();
    await priceAt("40");
    await exchange("WEB-1043-X1", "WEB-1043", "WEB-1043-2", sku("Navy", "L"));
    await ship("WEB-1043-X1");
    await deliver("WEB-1043-X1"); // delivered 3 Nov: the deadline is the end of 7 Nov
    expect(await billOverdueExchanges(new Date("2026-11-07T17:00:00Z"))).toBe(0);
    expect(await billOverdueExchanges(new Date("2026-11-07T21:00:00Z"))).toBe(1); // 8 Nov in Dhaka
    expect(await billOverdueExchanges(new Date("2026-11-09T21:00:00Z"))).toBe(0);
    expect(await balance()).toBe(1950);

    await handBack("RL-150", "WEB-1043-X1", "2026-11-10");
    await check("APPROVE");
    expect(await balance()).toBe(1325); // the same as an exchange on time

    const pulled = await callShop(shop, exchangesRoute, {
      path: "/exchanges?status=all",
    });
    expect(pulled.body.items[0].status).toBe("CREDITED");
    expect(
      pulled.body.items[0].events.map((e: { type: string; amount: number }) => [e.type, e.amount]),
    ).toEqual([
      ["exchange.billed", 700],
      ["exchange.credited", -625],
    ]);
  });

  it("reverses a deadline bill when the list shows the piece was back in time, and bills a declined one", async () => {
    await placeAndDeliver();
    await priceAt("40");
    await exchange("WEB-1043-X1", "WEB-1043", "WEB-1043-2", sku("Navy", "L"));
    await ship("WEB-1043-X1");
    await deliver("WEB-1043-X1");
    await billOverdueExchanges(new Date("2026-11-08T21:00:00Z"));
    expect(await balance()).toBe(1950);
    await handBack("RL-160", "WEB-1043-X1", "2026-11-06");
    expect(await balance()).toBe(1250);
    await check("DECLINE");
    expect(await balance()).toBe(1950); // the new piece in full; the old one stays the store's
  });

  it("refuses a line not delivered, cancels a refused exchange parcel, and bills its piece only when declined", async () => {
    const placed = await order({
      externalOrderId: "WEB-7",
      items: [{ sku: sku("Navy", "S"), quantity: 1, unitPrice: 850, lineId: "WEB-7-1" }],
    });
    expect(placed.status).toBe(201);
    const early = await exchange("WEB-7-X1", "WEB-7", "WEB-7-1", sku("Navy", "L"));
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("LINE_NOT_DELIVERED");
    expect((await exchange("WEB-7-X1", "WEB-404", "WEB-7-1", sku("Navy", "L"))).status).toBe(404);

    await ship("WEB-7");
    await deliver("WEB-7");
    await exchange("WEB-7-X1", "WEB-7", "WEB-7-1", sku("Navy", "L"));
    await ship("WEB-7-X1");
    const navyL = await stockOf(sku("Navy", "L"));
    await deliver("WEB-7-X1", "RETURNED");
    await handBack("RL-170", "WEB-7-X1");
    await check("APPROVE");
    expect(await stockOf(sku("Navy", "L"))).toBe(navyL + 1);
    expect(await balance()).toBe(625);
    const pulled = await callShop(shop, exchangesRoute, {
      path: "/exchanges?status=all",
    });
    expect(pulled.body.items[0].status).toBe("CANCELLED");

    // Exchanged again and refused again, the piece damaged: the store's loss.
    await exchange("WEB-7-X2", "WEB-7", "WEB-7-1", sku("Navy", "L"));
    await ship("WEB-7-X2");
    await deliver("WEB-7-X2", "RETURNED");
    await handBack("RL-171", "WEB-7-X2");
    await check("DECLINE");
    expect(await balance()).toBe(1250);
  });

  it("bills a refused exchange piece the courier never hands back, and credits it if it comes back approved", async () => {
    const placed = await order({
      externalOrderId: "WEB-8",
      items: [{ sku: sku("Navy", "S"), quantity: 1, unitPrice: 850, lineId: "WEB-8-1" }],
    });
    expect(placed.status).toBe(201);
    await ship("WEB-8");
    await deliver("WEB-8");
    expect(await balance()).toBe(625);
    await exchange("WEB-8-X1", "WEB-8", "WEB-8-1", sku("Navy", "L"));
    await ship("WEB-8-X1");
    await deliver("WEB-8-X1", "RETURNED"); // refused on 3 Nov: the piece is due back by 7 Nov
    expect(await billOverdueExchanges(new Date("2026-11-07T17:00:00Z"))).toBe(0);
    expect(await balance()).toBe(625);
    expect(await billOverdueExchanges(new Date("2026-11-07T21:00:00Z"))).toBe(1); // lost on the way
    expect(await balance()).toBe(1250);
    expect(await billOverdueExchanges(new Date("2026-11-09T21:00:00Z"))).toBe(0);

    // The courier finds it later: back and approved, the bill comes off.
    const navyL = await stockOf(sku("Navy", "L"));
    await handBack("RL-180", "WEB-8-X1", "2026-11-10");
    await check("APPROVE");
    expect(await stockOf(sku("Navy", "L"))).toBe(navyL + 1);
    expect(await balance()).toBe(625);
    const pulled = await callShop(shop, exchangesRoute, { path: "/exchanges?status=all" });
    expect(pulled.body.items[0].status).toBe("CREDITED");
    expect(
      pulled.body.items[0].events.map((e: { type: string; amount: number }) => [e.type, e.amount]),
    ).toEqual([
      ["exchange.billed", 625],
      ["exchange.credited", -625],
    ]);

    // Again refused, billed when late, then back damaged: it stays billed, never twice.
    await exchange("WEB-8-X2", "WEB-8", "WEB-8-1", sku("Navy", "L"));
    await ship("WEB-8-X2");
    await deliver("WEB-8-X2", "RETURNED");
    await billOverdueExchanges(new Date("2026-11-07T21:00:00Z"));
    expect(await balance()).toBe(1250);
    await handBack("RL-181", "WEB-8-X2", "2026-11-10");
    await check("DECLINE");
    expect(await balance()).toBe(1250);
  });

  it("settles each new line when two pieces of one old line are swapped for two SKUs", async () => {
    const placed = await order({
      externalOrderId: "WEB-20",
      items: [{ sku: sku("Navy", "M"), quantity: 2, unitPrice: 1190, lineId: "WEB-20-1" }],
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    await ship("WEB-20");
    await deliver("WEB-20");
    expect(await balance()).toBe(1250);
    await priceAt("40");
    const swapped = await order({
      externalOrderId: "WEB-20-X1",
      exchange: { ofExternalOrderId: "WEB-20", note: "one L, one S" },
      items: [
        {
          lineId: "X1-1",
          replacesLineId: "WEB-20-1",
          sku: sku("Navy", "L"),
          quantity: 1,
          unitPrice: 0,
          customerPrice: 0,
        },
        {
          lineId: "X1-2",
          replacesLineId: "WEB-20-1",
          sku: sku("Navy", "S"),
          quantity: 1,
          unitPrice: 0,
          customerPrice: 0,
        },
      ],
    });
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(201);
    await ship("WEB-20-X1");
    await deliver("WEB-20-X1");
    await handBack("RL-200", "WEB-20-X1");
    // The two old pieces are checked one at a time.
    for (let i = 0; i < 2; i++) {
      const parcel = (await returnsPage(shop.owner)).waiting[0]!;
      await checkParcel(shop.owner, parcel.id, {
        decisions: [
          { pieceId: parcel.pieces.find((p) => p.status === "WAITING")!.id, decision: "APPROVE" },
        ],
      });
    }
    expect(await balance()).toBe(1400); // 1250 + 75 + 75
    const lines = await prisma.retailOrderLine.findMany({
      where: { lineId: { in: ["X1-1", "X1-2"] } },
      select: { exchangeState: true },
    });
    expect(lines.map((l) => l.exchangeState)).toEqual(["SETTLED", "SETTLED"]);
    const pulled = await callShop(shop, exchangesRoute, { path: "/exchanges?status=all" });
    expect(pulled.body.totalAtRisk).toBe(0);
  });

  it("never bills an exchange line the site cancelled before the parcel left", async () => {
    const placed = await order({
      externalOrderId: "WEB-30",
      items: [
        { sku: sku("Navy", "S"), quantity: 1, unitPrice: 850, lineId: "WEB-30-1" },
        { sku: sku("Navy", "M"), quantity: 1, unitPrice: 1190, lineId: "WEB-30-2" },
      ],
    });
    expect(placed.status).toBe(201);
    await ship("WEB-30");
    await deliver("WEB-30");
    const swapped = await order({
      externalOrderId: "WEB-30-X1",
      exchange: { ofExternalOrderId: "WEB-30", note: "two sizes" },
      items: [
        {
          lineId: "X3-1",
          replacesLineId: "WEB-30-1",
          sku: sku("Navy", "L"),
          quantity: 1,
          unitPrice: 0,
          customerPrice: 0,
        },
        {
          lineId: "X3-2",
          replacesLineId: "WEB-30-2",
          sku: sku("White", "L"),
          quantity: 1,
          unitPrice: 0,
          customerPrice: 0,
        },
      ],
    });
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(201);
    // The second new piece failed its packing check; the site cancels that line.
    await prisma.retailOrderLine.updateMany({
      where: { lineId: "X3-2" },
      data: { waitingStock: true },
    });
    const cancelled = await callShop(shop, lineRoute, {
      method: "PATCH",
      path: "/orders/WEB-30-X1/lines/X3-2",
      params: { externalOrderId: "WEB-30-X1", lineId: "X3-2" },
      body: { action: "CANCEL", reason: "Piece failed the packing check" },
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    await ship("WEB-30-X1");
    const result = await deliver("WEB-30-X1");
    expect(result.body.returningLines).toEqual([{ lineId: "WEB-30-1", quantity: 1 }]);
    // Past every deadline: only the kept line's old piece is billed.
    expect(await billOverdueExchanges(new Date("2026-11-20T21:00:00Z"))).toBe(1);
    expect(await balance()).toBe(1250 + 625);
    const states = await prisma.retailOrderLine.findMany({
      where: { lineId: { in: ["X3-1", "X3-2"] } },
      orderBy: { lineId: "asc" },
      select: { exchangeState: true },
    });
    expect(states.map((l) => l.exchangeState)).toEqual(["BILLED", "CANCELLED"]);
    // The old line of the cancelled piece can be exchanged again.
    const again = await exchange("WEB-30-X2", "WEB-30", "WEB-30-2", sku("White", "M"));
    expect(again.status, JSON.stringify(again.body)).toBe(201);
  });
});
