"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany } from "@/modules/auth/context";
import * as account from "@/modules/retail/account.service";
import * as stores from "@/modules/retail/stores.service";

/*
 * Business > Retail stores (plan v6). Seeing them needs retail.view or
 * retail.manage, changing them retail.manage: checked in the services. Every
 * price change also needs the owner's PIN.
 */

const refresh = (id?: string) => {
  revalidatePath("/business/stores");
  if (id) revalidatePath(`/business/stores/${id}`);
};

export async function listStoresAction() {
  return runAction(async () => stores.listStores(await requireCompany()));
}

export async function getStoreAction(id: string, query: unknown = {}) {
  return runAction(async () => {
    const ctx = await requireCompany();
    const page = await stores.getStore(ctx, id, query);
    return { ...page, account: await account.storeAccount(ctx, id) };
  });
}

export async function releaseHoldAction(id: string, input: unknown) {
  return runAction(async () => {
    await account.releaseHold(await requireCompany(), id, input, await getRequestMeta());
    refresh(id);
    return null;
  });
}

export async function createStoreAction(input: unknown) {
  return runAction(async () => {
    const store = await stores.createStore(await requireCompany(), input, await getRequestMeta());
    refresh();
    return { id: store.id };
  });
}

export async function updateStoreAction(id: string, input: unknown) {
  return runAction(async () => {
    await stores.updateStore(await requireCompany(), id, input, await getRequestMeta());
    refresh(id);
    return null;
  });
}

export async function setStoreClosedAction(id: string, closed: boolean) {
  return runAction(async () => {
    await stores.setStoreClosed(
      await requireCompany(),
      id,
      closed === true,
      await getRequestMeta(),
    );
    refresh(id);
    return null;
  });
}

export async function setPriceRulesAction(id: string, input: unknown) {
  return runAction(async () => {
    await stores.setPriceRules(await requireCompany(), id, input, await getRequestMeta());
    refresh(id);
    return null;
  });
}

export async function setHandPriceAction(input: unknown) {
  return runAction(async () => {
    const row = await stores.setHandPrice(await requireCompany(), input, await getRequestMeta());
    refresh(row.storeId);
    return null;
  });
}

export async function removeHandPriceAction(input: unknown, storeId: string) {
  return runAction(async () => {
    await stores.removeHandPrice(await requireCompany(), input, await getRequestMeta());
    refresh(storeId);
    return null;
  });
}
