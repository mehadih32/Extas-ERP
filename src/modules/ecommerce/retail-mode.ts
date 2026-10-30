import type { SalesChannelIntegration } from "@prisma/client";

import type { CompanyContext } from "@/modules/auth/context";
import { holdOf } from "@/modules/retail/account.service";

import { EcommerceApiError } from "./errors";

/*
 * A shop linked to a retail store (Business > Retail stores) works the retail
 * way (plan v6 sec 9, site-changes 2): its orders are sales to the store at
 * the store's own prices, billed when the parcel leaves; it pays the ERP on
 * account, so customer payments and the old returns path are closed for it.
 * A shop with no store keeps the CN-005 way.
 */

type Call = { ctx: CompanyContext; integration: Pick<SalesChannelIntegration, "id"> };

/** The store this shop belongs to, or null (the CN-005 way). */
export async function retailStoreOf(call: Call) {
  return call.ctx.db.retailStore.findFirst({ where: { integrationId: call.integration.id } });
}

export type ShopStore = NonNullable<Awaited<ReturnType<typeof retailStoreOf>>>;

/** A closed store takes no new orders. */
export function assertStoreOpen(store: ShopStore) {
  if (store.closedAt) {
    throw new EcommerceApiError(
      409,
      "STORE_CLOSED",
      `The store "${store.name}" is closed in the ERP: it takes no new orders.`,
    );
  }
}

/** 409 ACCOUNT_ON_HOLD while the store owes money and has not paid for 30 days. */
export async function assertStoreNotOnHold(ctx: CompanyContext, store: ShopStore) {
  const hold = await holdOf(ctx, store);
  if (hold.onHold) {
    throw new EcommerceApiError(
      409,
      "ACCOUNT_ON_HOLD",
      `Orders to the ERP are on hold: ${hold.reason}. See GET /account.`,
      { reason: hold.reason, holdsOn: hold.holdsOn },
    );
  }
}

/** 410 for a path a retail store no longer uses. */
export function goneForStore(what: string, instead: string) {
  return new EcommerceApiError(410, "GONE", `${what} is closed for a retail store: ${instead}`);
}

/** The store this shop belongs to; a shop that is not a retail store gets 404. */
export async function requireRetailStore(call: Call) {
  const store = await retailStoreOf(call);
  if (!store) {
    throw new EcommerceApiError(404, "NOT_FOUND", "This shop is not a retail store in the ERP.");
  }
  return store;
}
