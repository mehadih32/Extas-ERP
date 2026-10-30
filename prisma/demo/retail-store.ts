import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { PIN_CHECKED } from "@/modules/ai/settings.service";
import * as stores from "@/modules/retail/stores.service";

import { SAMPLE_SHOP } from "./cn005-shop";

/*
 * The retail sample on the demo site (plan v6, part 1): the store "Extas
 * Retail", tied to the sample online shop when it is there, with a rule for
 * each grade and one hand price on a style that has a cost, so Business >
 * Retail stores and the store's page (and their Help pictures) show something.
 * Once: when the store is there already it does nothing.
 */

export async function loadRetailStore(ctx: CompanyContext) {
  const there = await prisma.retailStore.findFirst({
    where: { companyId: ctx.company.id, name: stores.FIRST_STORE_NAME },
    select: { id: true },
  });
  if (there) return null;
  const shop = await prisma.salesChannelIntegration.findFirst({
    where: { companyId: ctx.company.id, name: SAMPLE_SHOP },
    select: { id: true, warehouseId: true },
  });
  const store = await stores.createStore(ctx, {
    name: stores.FIRST_STORE_NAME,
    kind: "ONLINE",
    warehouseId: shop?.warehouseId ?? "",
    integrationId: shop?.id ?? "",
    address: "House 12, Road 4, Uttara, Dhaka",
    phone: "01700-000000",
  });
  await stores.setPriceRules(
    ctx,
    store.id,
    { aRule: "PERCENT", aValue: "40", bRule: "FIXED", bValue: "350" },
    undefined,
    PIN_CHECKED,
  );
  const variant = await prisma.productVariant.findFirst({
    where: { companyId: ctx.company.id, avgCost: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    select: { styleId: true, avgCost: true },
  });
  if (variant) {
    await stores.setHandPrice(
      ctx,
      {
        storeId: store.id,
        grade: "A",
        styleId: variant.styleId,
        price: String(Math.ceil(Number(variant.avgCost) * 1.5)),
      },
      undefined,
      PIN_CHECKED,
    );
  }
  return { name: store.name, handPrice: Boolean(variant) };
}
