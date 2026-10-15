"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as costing from "@/modules/costing/costing.service";

/*
 * Order costing (Production > Costing). Each returns { ok: true, data } or
 * { ok: false, error }.
 *   costing.view     the costing sheets, their Order check card and fabric prices
 *   costing.manage   make and change sheets and their styles, add supplier quotes
 *   costing.decide   take or decline the order (the owner's)
 */

const view = () => requirePermission("costing.view");
const manage = () => requirePermission("costing.manage");
const decide = () => requirePermission("costing.decide");

/** Runs a change and refreshes the costing screens. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/production/costing", "layout");
    return result;
  });

export const listCostingsAction = async (query: unknown = {}) =>
  runAction(async () => costing.listCostings(await view(), query));

export const getCostingAction = async (costingId: string) =>
  runAction(async () => costing.getCosting(await view(), costingId));

export const fabricPricesAction = async (query: unknown) =>
  runAction(async () => costing.fabricPrices(await view(), query));

export const createCostingAction = async (input: unknown) =>
  change(async () => costing.createCosting(await manage(), input, await getRequestMeta()));

export const updateCostingAction = async (costingId: string, input: unknown) =>
  change(async () =>
    costing.updateCosting(await manage(), costingId, input, await getRequestMeta()),
  );

/** A new style (styleLineId null) or a change to one on the sheet. */
export const saveCostingStyleAction = async (
  costingId: string,
  styleLineId: string | null,
  input: unknown,
) =>
  change(async () =>
    costing.saveCostingStyle(await manage(), costingId, styleLineId, input, await getRequestMeta()),
  );

export const removeCostingStyleAction = async (costingId: string, styleLineId: string) =>
  change(async () =>
    costing.removeCostingStyle(await manage(), costingId, styleLineId, await getRequestMeta()),
  );

export const decideCostingAction = async (costingId: string, input: unknown) =>
  change(async () =>
    costing.decideCosting(await decide(), costingId, input, await getRequestMeta()),
  );

export const addFabricQuoteAction = async (input: unknown) =>
  change(async () => costing.addFabricQuote(await manage(), input, await getRequestMeta()));

export const removeFabricQuoteAction = async (quoteId: string) =>
  change(async () => costing.removeFabricQuote(await manage(), quoteId, await getRequestMeta()));
