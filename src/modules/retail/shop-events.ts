import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enqueueJobs } from "@/modules/jobs/queue";

/*
 * The retail site's own webhooks (site-changes 2.8): what the ERP decided
 * about a store's returns, exchanges, deliveries, lines, payments and hold.
 * Each event is made once, with its eventId, in the same transaction as the
 * change it reports, and the background worker sends it like every other
 * webhook (ecommerce/webhooks.ts: signed, retried for 24 hours). A store
 * with no online shop or no webhook address gets nothing pushed; the site
 * then reads the same eventIds through the pull calls (GET /returns,
 * GET /exchanges, GET /account).
 */

export const RETAIL_EVENT_TYPES = [
  "delivery.identified",
  "return.parcel.resolved",
  "return.piece.decided",
  "order.line.short",
  "order.line.filled",
  "exchange.settled",
  "exchange.billed",
  "exchange.credited",
  "exchange.cancelled",
  "account.hold",
  "account.released",
  "payment.recorded",
  "switch.orders.moved",
] as const;
export type RetailEventType = (typeof RETAIL_EVENT_TYPES)[number];

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Queues one event to the store's site and gives its eventId (a new UUID,
 * or `id` when the event already has one, as an exchange event does).
 */
export async function shopEventTx(
  db: Db,
  storeId: string,
  type: RetailEventType,
  data: Prisma.InputJsonObject,
  opts: { id?: string; now?: Date } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  const now = opts.now ?? new Date();
  const store = await db.retailStore.findUnique({
    where: { id: storeId },
    select: { companyId: true, integration: true },
  });
  const shop = store?.integration;
  if (!store || !shop?.isActive || !shop.webhookUrl) return id;
  const body = { id, type, createdAt: now.toISOString(), data: { eventId: id, ...data } };
  const paused =
    shop.webhooksPausedUntil && shop.webhooksPausedUntil > now ? shop.webhooksPausedUntil : null;
  await db.webhookEvent.create({
    data: {
      id,
      companyId: store.companyId,
      source: "ECOMMERCE",
      direction: "OUTGOING",
      integrationId: shop.id,
      eventType: type,
      payload: body as unknown as Prisma.InputJsonObject,
      receivedAt: now,
    },
  });
  const { WEBHOOK_JOB, WEBHOOK_MAX_ATTEMPTS } = await import("@/modules/ecommerce/webhooks");
  await enqueueJobs(db, [
    {
      kind: WEBHOOK_JOB,
      companyId: store.companyId,
      payload: { eventId: id },
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      ...(paused ? { runAfter: paused } : {}),
    },
  ]);
  return id;
}
