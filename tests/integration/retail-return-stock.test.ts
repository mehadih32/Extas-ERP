import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT as deliveryRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/delivery/route";
import { PATCH as lineRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/lines/[lineId]/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as returnListsRoute } from "@/app/api/v1/ecommerce/return-lists/route";
import { GET as returnsRoute } from "@/app/api/v1/ecommerce/returns/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { setPin } from "@/modules/ai/settings.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { checkParcel, returnsPage } from "@/modules/retail/returns.service";
import * as stores from "@/modules/retail/stores.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";

/*
 * Return stock (plan v6 sec 8.5): an unchecked returned piece goes on a new
 * store order only when main stock is out, and is checked at packing. The
 * store buys the polo at 625. Main stock holds 10 Navy S.
 */
run("Retail orders filled from Return stock (plan v6 sec 8.5)", () => {
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

  const sku = (color: string, size: string) => shop.sku("EX-PL-001", color, size);
  const order = (id: string, items: Array<[string, number]>) =>
    callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        externalOrderId: id,
        customer: { name: "Rahim", phone: "01711000000" },
        shippingAddress: "Dhanmondi, Dhaka",
        paymentMethod: "cod",
        items: items.map(([s, quantity], i) => ({
          sku: s,
          quantity,
          unitPrice: 850,
          lineId: `${id}-${i + 1}`,
        })),
      },
    });
  const ship = (id: string) =>
    callShop(shop, shipmentsRoute, {
      path: "/shipments",
      body: { externalOrderId: id, courier: "Pathao", consignmentId: `PTH-${id}`, charge: 70 },
    });
  const balance = async () => Number(await getPartyBalance(shop.owner, store.partyId));
  const patchLine = (id: string, lineId: string, body: Record<string, unknown>) =>
    callShop(shop, lineRoute, {
      method: "PATCH",
      path: `/orders/${id}/lines/${lineId}`,
      params: { externalOrderId: id, lineId },
      body,
    });

  /** One Navy S back in Return stock, and main stock of it all sold. */
  const pieceInReturnStock = async () => {
    expect((await order("WEB-1", [[sku("Navy", "S"), 1]])).status).toBe(201);
    await ship("WEB-1");
    await callShop(shop, deliveryRoute, {
      method: "PUT",
      path: "/orders/WEB-1/delivery",
      params: { externalOrderId: "WEB-1" },
      body: {
        status: "RETURNED",
        courier: "Pathao",
        consignmentId: "PTH-WEB-1",
        at: "2026-11-02T10:00:00+06:00",
      },
    });
    await callShop(shop, returnListsRoute, {
      path: "/return-lists",
      body: {
        returnListId: "RL-1",
        courier: "Pathao",
        handedBackAt: "2026-11-03",
        parcels: [{ consignmentId: "PTH-WEB-1", externalOrderId: "WEB-1" }],
      },
    });
    expect((await order("WEB-2", [[sku("Navy", "S"), 9]])).status).toBe(201);
  };
  const decide = async (decision: "APPROVE" | "DECLINE") => {
    const parcel = (await returnsPage(shop.owner)).waiting[0]!;
    expect(parcel.pieces[0]!.reservedFor).toMatch(/^SO-/);
    await checkParcel(shop.owner, parcel.id, {
      decisions: [
        {
          pieceId: parcel.pieces[0]!.id,
          decision,
          ...(decision === "DECLINE" ? { reason: "STAIN_OR_DAMAGE" } : {}),
        },
      ],
    });
  };

  it("sends the piece only after it passes the packing check, and credits the earlier return", async () => {
    await pieceInReturnStock();
    // Main stock and Return stock together are short of 2.
    const tooMany = await order("WEB-9", [[sku("Navy", "S"), 2]]);
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.details.shortSkus).toEqual([
      { sku: sku("Navy", "S"), requested: 2, available: 1 },
    ]);
    const filled = await order("WEB-3", [[sku("Navy", "S"), 1]]);
    expect(filled.status, JSON.stringify(filled.body)).toBe(201);
    expect(filled.body.lines[0]).toMatchObject({ fromReturnStock: true, shopPrice: 625 });
    const blocked = await ship("WEB-3");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("RETURN_PIECE_NOT_CHECKED");

    const before = await balance();
    await decide("APPROVE");
    expect(await balance()).toBe(before - 625);
    expect((await ship("WEB-3")).status).toBe(201);
    expect(await balance()).toBe(before);
    const pulled = await callShop(shop, returnsRoute, { path: "/returns" });
    expect(pulled.body.data[0].pieces[0]).toMatchObject({
      status: "APPROVED_AT_PACKING",
      credit: 625,
    });
  });

  it("holds a line whose piece fails the check until the site replaces or cancels it", async () => {
    await pieceInReturnStock();
    const placed = await order("WEB-3", [
      [sku("Navy", "S"), 1],
      [sku("White", "S"), 1],
    ]);
    expect(placed.body.erpTotal).toBe(1250);
    await decide("DECLINE");
    const short = await ship("WEB-3");
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe("LINE_SHORT");
    expect((await patchLine("WEB-3", "WEB-3-2", { action: "WAIT" })).status).toBe(409);
    expect((await patchLine("WEB-3", "WEB-3-1", { action: "WAIT" })).status).toBe(200);

    const replaced = await patchLine("WEB-3", "WEB-3-1", {
      action: "REPLACE",
      sku: sku("Navy", "M"),
    });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body.lines[0]).toMatchObject({ sku: sku("Navy", "M"), shopPrice: 625 });
    expect((await ship("WEB-3")).status).toBe(201);
  });

  it("cancels a waiting line: never billed, kept in the history", async () => {
    await pieceInReturnStock();
    await order("WEB-3", [
      [sku("Navy", "S"), 1],
      [sku("White", "S"), 1],
    ]);
    await decide("DECLINE");
    const cancelled = await patchLine("WEB-3", "WEB-3-1", {
      action: "CANCEL",
      reason: "customer agreed",
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body).toMatchObject({ erpTotal: 625 });
    expect(cancelled.body.lines.map((l: { cancelled: boolean }) => l.cancelled)).toEqual([
      true,
      false,
    ]);
    const before = await balance();
    expect((await ship("WEB-3")).status).toBe(201);
    expect(await balance()).toBe(before + 625);
  });
});
