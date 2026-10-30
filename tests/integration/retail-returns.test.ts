import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET as accountRoute } from "@/app/api/v1/ecommerce/account/route";
import { PUT as deliveryRoute } from "@/app/api/v1/ecommerce/orders/[externalOrderId]/delivery/route";
import { POST as ordersRoute } from "@/app/api/v1/ecommerce/orders/route";
import { POST as returnListsRoute } from "@/app/api/v1/ecommerce/return-lists/route";
import { GET as returnsRoute } from "@/app/api/v1/ecommerce/returns/route";
import { POST as shipmentsRoute } from "@/app/api/v1/ecommerce/shipments/route";
import { prisma } from "@/lib/prisma";
import { storeDashboard } from "@/modules/retail/dashboards.service";
import { setPin } from "@/modules/ai/settings.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { checkParcel, resolveHold, returnsPage } from "@/modules/retail/returns.service";
import * as stores from "@/modules/retail/stores.service";
import { retailWatch } from "@/modules/retail/watch.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";

/*
 * A retail store's returns (plan v6 sec 8): the courier's result, the return
 * list, Hold, Return stock and the owner's check. Money moves only at the check.
 * The order: 3 polos the store buys at 625 each, sold to the customer at 850,
 * 1190 and 980 (the plan's example).
 */
run("Retail store's returns (plan v6, part 2)", () => {
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
  const place = async (id: string) => {
    const res = await callShop(shop, ordersRoute, {
      path: "/orders",
      body: {
        externalOrderId: id,
        customer: { name: "Rahim", phone: "01711000000" },
        shippingAddress: "Dhanmondi, Dhaka",
        paymentMethod: "cod",
        items: [
          { sku: sku("Navy", "S"), quantity: 1, unitPrice: 850, lineId: `${id}-1` },
          { sku: sku("Navy", "M"), quantity: 1, unitPrice: 1190, lineId: `${id}-2` },
          { sku: sku("White", "S"), quantity: 1, unitPrice: 980, lineId: `${id}-3` },
        ],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const shipped = await callShop(shop, shipmentsRoute, {
      path: "/shipments",
      body: { externalOrderId: id, courier: "Pathao", consignmentId: `PTH-${id}`, charge: 70 },
    });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  };
  const delivery = (id: string, body: Record<string, unknown>) =>
    callShop<{ externalOrderId: string }>(shop, deliveryRoute, {
      method: "PUT",
      path: `/orders/${id}/delivery`,
      params: { externalOrderId: id },
      body: {
        courier: "Pathao",
        consignmentId: `PTH-${id}`,
        at: "2026-11-02T15:40:00+06:00",
        ...body,
      },
    });
  const handBack = (returnListId: string, parcels: Array<Record<string, unknown>>) =>
    callShop(shop, returnListsRoute, {
      path: "/return-lists",
      body: { returnListId, courier: "Pathao", handedBackAt: "2026-11-05", parcels },
    });
  const balance = async () => Number(await getPartyBalance(shop.owner, store.partyId));
  const navyS = () =>
    prisma.stockBalance.findFirstOrThrow({
      where: { variant: { sku: sku("Navy", "S") }, grade: "A_GRADE" },
    });

  it("works out the kept piece, takes the others into Return stock, and credits only approved ones", async () => {
    await place("WEB-1043");
    expect(await balance()).toBe(1875);
    const result = await delivery("WEB-1043", { status: "PARTIAL", collected: 1310 });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({
      identification: "GREEN",
      returningLines: [
        { lineId: "WEB-1043-1", quantity: 1 },
        { lineId: "WEB-1043-3", quantity: 1 },
      ],
    });

    const list = await handBack("RL-123", [
      { consignmentId: "PTH-WEB-1043", externalOrderId: "WEB-1043", receivedCount: 2 },
    ]);
    expect(list.status, JSON.stringify(list.body)).toBe(201);
    expect(list.body.parcels[0]).toMatchObject({ result: "IN_RETURN_STOCK" });
    expect(list.body.parcels[0].pieces).toHaveLength(2);
    // Nothing changed money yet; the waiting pieces are left out of the hold.
    expect(await balance()).toBe(1875);
    const account = await callShop(shop, accountRoute, { path: "/account" });
    expect(account.body).toMatchObject({ balance: 1875, waitingCheck: 1250 });
    // The same list again gives the same answer; the courier's result can no longer change.
    const again = await handBack("RL-123", [
      { consignmentId: "PTH-WEB-1043", externalOrderId: "WEB-1043" },
    ]);
    expect(again.body.parcels[0]).toMatchObject({ result: "IN_RETURN_STOCK" });
    expect((await delivery("WEB-1043", { status: "RETURNED" })).status).toBe(409);

    const before = (await navyS()).quantity;
    const page = await returnsPage(shop.owner);
    expect(page.waiting).toHaveLength(1);
    const [first, second] = page.waiting[0]!.pieces;
    await expect(
      checkParcel(shop.accounts, page.waiting[0]!.id, {
        decisions: [{ pieceId: first!.id, decision: "APPROVE" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      checkParcel(shop.owner, page.waiting[0]!.id, {
        decisions: [{ pieceId: second!.id, decision: "DECLINE" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await checkParcel(shop.owner, page.waiting[0]!.id, {
      decisions: [
        { pieceId: first!.id, decision: "APPROVE" },
        { pieceId: second!.id, decision: "DECLINE", reason: "STAIN_OR_DAMAGE" },
      ],
    });
    expect(await balance()).toBe(1250);
    expect((await navyS()).quantity).toBe(before + 1);
    // The ERP's side: 3 pieces billed (1,875) at a cost of 500 each, one credited
    // back (625) with its cost back in stock. A store with no figures yet asks for
    // no fixed costs, even over its lifetime.
    const dash = await storeDashboard(shop.owner, store.id, { period: "all" });
    expect(dash.erp).toMatchObject({ taken: "1875.00", givenBack: "625.00", erpProfit: "250.00" });
    expect(dash.fixedMissing).toEqual([]);
    const parcel = await prisma.retailReturnParcel.findFirstOrThrow({});
    expect(parcel.state).toBe("CHECKED");
    // A piece is decided once.
    await expect(
      checkParcel(shop.owner, parcel.id, {
        decisions: [{ pieceId: first!.id, decision: "APPROVE" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const pulled = await callShop(shop, returnsRoute, { path: "/returns" });
    expect(pulled.body.data[0]).toMatchObject({ returnListId: "RL-123", stage: "CHECKED" });
    expect(
      pulled.body.data[0].pieces.map(
        (p: { status: string; credit: number; reason: string | null }) => [
          p.status,
          p.credit,
          p.reason,
        ],
      ),
    ).toEqual([
      ["APPROVED", 625, null],
      ["DECLINED", 0, "STAIN_OR_DAMAGE"],
    ]);
  });

  it("puts an unclear parcel on Hold until the owner ticks the pieces", async () => {
    await place("WEB-2");
    // 3000 fits no set of kept pieces (all but one piece back): unclear.
    const result = await delivery("WEB-2", { status: "PARTIAL", collected: 3000 });
    expect(result.body.identification).toBe("ORANGE");
    const list = await handBack("RL-2", [{ consignmentId: "PTH-WEB-2", externalOrderId: "WEB-2" }]);
    expect(list.body.parcels[0]).toMatchObject({ result: "HOLD" });
    const account = await callShop(shop, accountRoute, { path: "/account" });
    expect(account.body.waitingCheck).toBe(1875);

    const page = await returnsPage(shop.owner);
    const held = page.hold[0]!;
    await expect(resolveHold(shop.owner, held.id, { came: [] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await resolveHold(shop.owner, held.id, {
      came: [{ lineId: held.lines[1]!.id, quantity: 1 }],
    });
    const after = await returnsPage(shop.owner);
    expect(after.hold).toHaveLength(0);
    expect(after.waiting[0]!.pieces.map((p) => p.sku)).toEqual([sku("Navy", "M")]);
    expect(await balance()).toBe(1875);
  });

  it("marks a parcel that never came as the store's loss", async () => {
    await place("WEB-3");
    await delivery("WEB-3", { status: "PARTIAL", collected: 3000 });
    await handBack("RL-3", [{ consignmentId: "PTH-WEB-3", externalOrderId: "WEB-3" }]);
    const held = (await returnsPage(shop.owner)).hold[0]!;
    await resolveHold(shop.owner, held.id, { missing: true });
    const page = await returnsPage(shop.owner);
    expect(page.history[0]).toMatchObject({ state: "MISSING" });
    expect(await balance()).toBe(1875);
  });

  it("refuses parcels that are not the store's, not returned, or handed back already", async () => {
    await place("WEB-4");
    await place("WEB-5");
    await delivery("WEB-5", { status: "DELIVERED", collected: 3020 });
    await delivery("WEB-4", { status: "RETURNED" });
    expect(
      (await handBack("RL-4", [{ consignmentId: "PTH-WEB-4", externalOrderId: "WEB-4" }])).body
        .parcels[0],
    ).toMatchObject({ result: "IN_RETURN_STOCK" });
    const list = await handBack("RL-5", [
      { consignmentId: "OTHER-1", externalOrderId: "WEB-4" },
      { consignmentId: "PTH-WEB-5", externalOrderId: "WEB-5" },
      { consignmentId: "PTH-WEB-4", externalOrderId: "WEB-4" },
      { consignmentId: "PTH-X", externalOrderId: "WEB-404" },
    ]);
    expect(list.body.parcels.map((p: { result: string; reason?: string }) => p.reason)).toEqual([
      "NOT_OUR_ORDER",
      "NOT_RETURNED",
      "ALREADY_HANDED_BACK",
      "NOT_OUR_ORDER",
    ]);
  });

  it("reminds on days 5, 7 and 10 while a parcel waits for the check, and owes at the month's end", async () => {
    // The night watch speaks as the owner.
    await prisma.user.update({ where: { id: shop.owner.user.id }, data: { isSuperAdmin: true } });
    await place("WEB-6");
    await place("WEB-7");
    await delivery("WEB-6", { status: "RETURNED" });
    await delivery("WEB-7", { status: "RETURNED" });
    await handBack("RL-6", [
      { consignmentId: "PTH-WEB-6", externalOrderId: "WEB-6" },
      { consignmentId: "PTH-WEB-7", externalOrderId: "WEB-7" },
    ]);
    // 22:05 in Dhaka on the given day.
    const night = async (day: string) => {
      await retailWatch(new Date(`${day}T16:05:00Z`));
      const note = await prisma.retailAlert.findFirst({ where: { kind: "NIGHT", key: day } });
      return note?.text ?? "";
    };
    expect(await night("2026-11-09")).not.toContain("not checked");
    expect(await night("2026-11-10")).toContain(
      "Extas Retail: 2 returned parcels not checked 5 days after the courier handed them back",
    );
    expect(await night("2026-11-11")).not.toContain("not checked");
    // One parcel is checked: only the other is reminded.
    const page = await returnsPage(shop.owner);
    const one = page.waiting[0]!;
    await checkParcel(shop.owner, one.id, {
      decisions: one.pieces.map((x) => ({ pieceId: x.id, decision: "APPROVE" as const })),
    });
    expect(await night("2026-11-12")).toContain("1 returned parcel not checked 7 days after");
    const red = await night("2026-11-15");
    expect(red).toContain("not checked 10 days after the courier handed it back (now red)");
    expect(await night("2026-11-16")).not.toContain("not checked");
    // The month's last night: what the store owes, and how much of it waits for the check.
    const owes = await balance();
    expect(await night("2026-11-30")).toContain(
      `Extas Retail owes BDT ${owes.toLocaleString("en-IN", { minimumFractionDigits: 2 })} at the end of the month, of which BDT 1,875.00 is returns waiting for the check.`,
    );
  });
});
