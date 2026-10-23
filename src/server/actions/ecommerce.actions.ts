"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as integrations from "@/modules/ecommerce/integration.service";
import { getShop, listShops } from "@/modules/ecommerce/screens.service";
import { sendTestEvent } from "@/modules/ecommerce/webhooks";

/*
 * Settings > Integrations > E-commerce (CN-005): the online shops. Everything
 * needs integrations.ecommerce.manage, here and again in the services. Making
 * or rotating a key also needs the PIN; its answer is the only time the key
 * and the webhook secret are shown.
 */

const manager = () => requirePermission(integrations.ECOMMERCE_PERMISSION);

const refresh = (id?: string) => {
  revalidatePath("/settings/integrations");
  if (id) revalidatePath(`/settings/integrations/ecommerce/${id}`);
};

export async function listShopsAction() {
  return runAction(async () => listShops(await manager()));
}

export async function getShopAction(id: string, query: unknown = {}) {
  return runAction(async () => getShop(await manager(), id, query));
}

export async function createShopAction(input: unknown) {
  return runAction(async () => {
    const shop = await integrations.createIntegration(
      await manager(),
      input,
      await getRequestMeta(),
    );
    refresh();
    return { id: shop.id };
  });
}

export async function updateShopAction(id: string, input: unknown) {
  return runAction(async () => {
    await integrations.updateIntegration(await manager(), id, input, await getRequestMeta());
    refresh(id);
    return null;
  });
}

export async function setShopActiveAction(id: string, isActive: boolean) {
  return runAction(async () => {
    await integrations.setIntegrationActive(
      await manager(),
      id,
      isActive === true,
      await getRequestMeta(),
    );
    refresh(id);
    return null;
  });
}

/** Generate key or Rotate key (asks the PIN): the key and the secret, this once. */
export async function generateShopKeyAction(id: string, input: unknown) {
  return runAction(async () => {
    const made = await integrations.generateKey(await manager(), id, input, await getRequestMeta());
    refresh(id);
    return made;
  });
}

export async function revokeShopKeyAction(id: string) {
  return runAction(async () => {
    await integrations.revokeKey(await manager(), id, await getRequestMeta());
    refresh(id);
    return null;
  });
}

export async function sendShopTestAction(id: string) {
  return runAction(async () => {
    const result = await sendTestEvent(await manager(), id);
    refresh(id);
    return result;
  });
}
