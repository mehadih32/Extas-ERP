"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as links from "@/modules/sales/order-status.service";

/*
 * Share order status (an order's page): read-only links to the order's progress
 * for its buyer. Each needs sales.view and sales.order.share, checked here and
 * again in the service. Nothing is sent: the person copies the link and shares
 * it. Each returns { ok: true, data } or { ok: false, error }.
 */

const share = () => requirePermission("sales.view", "sales.order.share");

export const listStatusLinksAction = async (orderId: string) =>
  runAction(async () => links.listStatusLinks(await share(), orderId));

/** Makes a link; its address comes back only here, once. */
export const makeStatusLinkAction = async (orderId: string, input: unknown) =>
  runAction(async () => {
    const made = await links.makeStatusLink(await share(), orderId, input, await getRequestMeta());
    revalidatePath(`/sales/orders/${orderId}`);
    return made;
  });

export const stopStatusLinkAction = async (linkId: string) =>
  runAction(async () => {
    const stopped = await links.stopStatusLink(await share(), linkId, await getRequestMeta());
    revalidatePath(`/sales/orders/${stopped.orderId}`);
    return stopped;
  });
