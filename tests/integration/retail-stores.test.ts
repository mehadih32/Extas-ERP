import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import * as stores from "@/modules/retail/stores.service";

import { type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";

/*
 * Business > Retail stores (plan v6, part 1). The shop from ./ecommerce-helpers
 * has the Classic Polo (Navy / White x S M L, cost 500 each) and the Basic Tee
 * (no stock, so no cost).
 */
run("Retail stores and their prices (plan v6)", () => {
  let shop: Shop;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    await setPin(shop.owner, { pin: PIN });
  });

  const addStore = (name = stores.FIRST_STORE_NAME) =>
    stores.createStore(shop.owner, {
      name,
      kind: "ONLINE",
      warehouseId: shop.warehouse.id,
      integrationId: shop.integration.id,
      phone: "01700-000000",
    });
  const polo = () => shop.variants.filter((v) => v.styleId === shop.polo.id);
  const priceOf = async (storeId: string, variantId: string, grade: "A" | "B" = "A") =>
    (await stores.storePrices(shop.owner, storeId, [variantId], grade)).get(variantId) ?? null;

  it("adds the store to the buyer list as a retail buyer, and keeps its name in step", async () => {
    const store = await addStore();
    const party = await prisma.party.findUniqueOrThrow({ where: { id: store.partyId } });
    expect(party).toMatchObject({ kind: "BUYER", buyerType: "RETAIL", name: "Extas Retail" });
    await expect(addStore()).rejects.toThrow();

    await stores.updateStore(shop.owner, store.id, {
      name: "Extas Retail Online",
      kind: "ONLINE",
      address: "Uttara, Dhaka",
    });
    const renamed = await prisma.party.findUniqueOrThrow({ where: { id: store.partyId } });
    expect(renamed).toMatchObject({ name: "Extas Retail Online", address: "Uttara, Dhaka" });
  });

  it("lets only those with the retail rights see or change stores", async () => {
    await expect(stores.listStores(shop.accounts)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      stores.createStore(shop.accounts, { name: "Showroom", kind: "SHOWROOM" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const list = await stores.listStores(shop.owner);
    expect(list.canManage).toBe(true);
  });

  it("has no price without a rule or a hand price, never 0", async () => {
    const store = await addStore();
    const navyS = polo()[0]!;
    expect(await priceOf(store.id, navyS.id)).toBeNull();
    const page = await stores.getStore(shop.owner, store.id);
    const poloRow = page.styles.find((s) => s.id === shop.polo.id)!;
    expect(poloRow.a).toBeNull();
    expect(poloRow.aMissing).toBe(6);
  });

  it("needs the PIN for every price change, and logs each one", async () => {
    const store = await addStore();
    await expect(
      stores.setPriceRules(shop.owner, store.id, { aRule: "PERCENT", aValue: "25" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      stores.setPriceRules(shop.owner, store.id, { aRule: "PERCENT", aValue: "25", pin: "1111" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await stores.setPriceRules(shop.owner, store.id, {
      aRule: "PERCENT",
      aValue: "25",
      bRule: "FIXED",
      bValue: "350",
      pin: PIN,
    });
    await expect(
      stores.setHandPrice(shop.owner, {
        storeId: store.id,
        grade: "A",
        styleId: shop.polo.id,
        price: "800",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const page = await stores.getStore(shop.owner, store.id);
    expect(page.history.map((h) => h.after)).toEqual(
      expect.arrayContaining(["Cost + 25%", "BDT 350.00 each"]),
    );
  });

  it("prices from the rule, then the style, colour and SKU hand prices, most exact first", async () => {
    const store = await addStore();
    await stores.setPriceRules(shop.owner, store.id, {
      aRule: "PERCENT",
      aValue: "25",
      bRule: "FIXED",
      bValue: "350",
      pin: PIN,
    });
    const navy = polo().filter((v) => v.color.name === "Navy");
    const [navyS, navyM] = [
      navy.find((v) => v.size.name === "S")!,
      navy.find((v) => v.size.name === "M")!,
    ];
    const whiteS = polo().find((v) => v.color.name === "White" && v.size.name === "S")!;
    expect(String(await priceOf(store.id, navyS.id))).toBe("625");
    expect(String(await priceOf(store.id, navyS.id, "B"))).toBe("350");

    const hand = (extra: Record<string, string>) =>
      stores.setHandPrice(shop.owner, {
        storeId: store.id,
        grade: "A",
        styleId: shop.polo.id,
        pin: PIN,
        ...extra,
      });
    await hand({ price: "700" });
    await hand({ colorId: navyS.colorId, price: "750" });
    await hand({ colorId: navyS.colorId, variantId: navyS.id, price: "800" });
    expect(String(await priceOf(store.id, navyS.id))).toBe("800");
    expect(String(await priceOf(store.id, navyM.id))).toBe("750");
    expect(String(await priceOf(store.id, whiteS.id))).toBe("700");

    // A new price at the same place replaces the old one; the old one stays in the history.
    await hand({ price: "720" });
    expect(String(await priceOf(store.id, whiteS.id))).toBe("720");
    const rows = await prisma.retailPrice.findMany({
      where: { storeId: store.id, variantId: null, colorId: null },
    });
    expect(rows.filter((r) => r.removedAt === null)).toHaveLength(1);
    expect(rows).toHaveLength(2);

    // Taking a hand price off falls back to the next one, then the rule.
    const sku = await prisma.retailPrice.findFirstOrThrow({
      where: { storeId: store.id, variantId: navyS.id, removedAt: null },
    });
    await stores.removeHandPrice(shop.owner, { priceId: sku.id, pin: PIN });
    expect(String(await priceOf(store.id, navyS.id))).toBe("750");
  });

  it("refuses a colour or SKU that is not of the style, and a price of 0", async () => {
    const store = await addStore();
    const teeWhite = shop.variants.find((v) => v.styleId === shop.tee.id)!;
    await expect(
      stores.setHandPrice(shop.owner, {
        storeId: store.id,
        grade: "A",
        styleId: shop.polo.id,
        variantId: teeWhite.id,
        price: "500",
        pin: PIN,
      }),
    ).rejects.toThrow();
    await expect(
      stores.setHandPrice(shop.owner, {
        storeId: store.id,
        grade: "A",
        styleId: shop.polo.id,
        price: "0",
        pin: PIN,
      }),
    ).rejects.toThrow();
  });

  it("gives no rule price to a style with no cost, and flags a hand price whose cost moved", async () => {
    const store = await addStore();
    await stores.setPriceRules(shop.owner, store.id, { aRule: "AMOUNT", aValue: "120", pin: PIN });
    const tee = shop.variants.find((v) => v.styleId === shop.tee.id)!;
    expect(await priceOf(store.id, tee.id)).toBeNull();

    await stores.setHandPrice(shop.owner, {
      storeId: store.id,
      grade: "A",
      styleId: shop.polo.id,
      price: "900",
      pin: PIN,
    });
    let page = await stores.getStore(shop.owner, store.id);
    expect(page.handPrices[0]!.costChanged).toBe(false);
    await prisma.productVariant.updateMany({
      where: { styleId: shop.polo.id },
      data: { avgCost: 560 },
    });
    page = await stores.getStore(shop.owner, store.id);
    expect(page.handPrices[0]!.costChanged).toBe(true);
    const list = await stores.listStores(shop.owner);
    expect(list.stores[0]!.costChanged).toBe(1);
  });
});
