import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  catalogVariantOf,
  stockRowOf,
  storeCatalogVariantOf,
} from "@/modules/ecommerce/catalog.service";
import type { StockRow } from "@/modules/ecommerce/schemas";
import {
  type VariantChanged,
  WEBHOOK_JOB,
  WEBHOOK_MAX_ATTEMPTS,
  type WebhookBody,
} from "@/modules/ecommerce/webhooks";
import type { FreshStartTicks } from "@/modules/fresh-start/plan";
import { enqueueJobs } from "@/modules/jobs/queue";
import { pricesOfStore } from "@/modules/retail/stores.service";

/*
 * The connected online shops after a fresh start. Their stock and SKUs would
 * otherwise stay as they were: the wipe erases the stock rows and (unless kept)
 * the products, and the shops hear of changes only. So each shop that is on,
 * has a key and a webhook address is sent, through the usual webhook sender
 * (signed, retried, ECOMMERCE_WEBHOOKS=off sends nothing):
 *   - stock.changed with 0 pieces for every stock row of its warehouse it could
 *     see (A-grade; B-grade too for a store offered B-grade pieces);
 *   - when the products are erased, variant.changed with active: false for each
 *     SKU it could see (and each B-grade listing), so the shop takes them off.
 * Kept products are sent again by the usual pass (the wipe marks them changed,
 * plan.ts), with their new cost and the store's prices worked out afresh.
 * The rows are read just before the wipe (nobody writes to the company then)
 * and the events are saved in the wipe's own transaction.
 */

type Planned = { type: "stock.changed" | "variant.changed"; key: string; data: unknown };
export type ShopResync = {
  shop: { id: string; webhooksPausedUntil: Date | null };
  events: Planned[];
};

const variantInclude = {
  style: {
    select: { code: true, name: true, retailPrice: true, isActive: true, updatedAt: true },
  },
  color: { select: { name: true } },
  size: { select: { name: true } },
} as const;

/** What each connected shop of the company is told after the wipe. */
export async function planShopResync(
  companyId: string,
  ticks: FreshStartTicks,
  now: Date = new Date(),
): Promise<ShopResync[]> {
  if (process.env.ECOMMERCE_WEBHOOKS === "off") return [];
  const shops = await prisma.salesChannelIntegration.findMany({
    where: {
      companyId,
      isActive: true,
      apiKeyRef: { not: null },
      webhookSecretRef: { not: null },
      webhookUrl: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });
  const at = now.toISOString();
  const out: ShopResync[] = [];
  for (const shop of shops) {
    const store = await prisma.retailStore.findFirst({
      where: { companyId, integrationId: shop.id },
    });
    const bGrade = Boolean(store?.sellsBGrade);
    const events: Planned[] = [];
    /** The SKUs the store's site lists as B-grade (they had B-grade stock there). */
    const bListed = new Set<string>();
    if (shop.warehouseId) {
      const balances = await prisma.stockBalance.findMany({
        where: {
          companyId,
          warehouseId: shop.warehouseId,
          ...(bGrade ? {} : { grade: "A_GRADE" }),
          warehouse: { deletedAt: null },
        },
        include: {
          variant: { select: { sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
      });
      for (const balance of balances) {
        const row: StockRow = {
          ...stockRowOf(balance),
          onHand: 0,
          reserved: 0,
          available: 0,
          updatedAt: at,
        };
        if (row.grade === "B") bListed.add(row.sku);
        const key = row.grade === "B" ? `${row.sku}:B` : row.sku;
        events.push({ type: "stock.changed", key, data: row });
      }
    }
    if (!ticks.keepProducts) {
      const variants = await prisma.productVariant.findMany({
        where: { companyId },
        include: variantInclude,
      });
      const off = { active: false, isNew: false, updatedAt: at };
      if (!store) {
        for (const v of variants) {
          events.push({
            type: "variant.changed",
            key: v.sku,
            data: { ...catalogVariantOf(v), ...off },
          });
        }
      } else {
        const ids = variants.map((v) => v.id);
        const prices = await pricesOfStore(store, ids, "A");
        const bIds = variants.filter((v) => bListed.has(v.sku)).map((v) => v.id);
        const bPrices = bIds.length ? await pricesOfStore(store, bIds, "B") : null;
        for (const v of variants) {
          const price = prices.get(v.id);
          if (price) {
            const data: VariantChanged = { ...storeCatalogVariantOf(v, price), ...off };
            events.push({ type: "variant.changed", key: v.sku, data });
          }
          const bPrice = bPrices?.get(v.id);
          if (bPrice) {
            const data: VariantChanged = { ...storeCatalogVariantOf(v, bPrice, "B"), ...off };
            events.push({ type: "variant.changed", key: `${v.sku}:B`, data });
          }
        }
      }
    }
    if (events.length) out.push({ shop, events });
  }
  return out;
}

/** Saves the planned webhooks and their sending jobs (inside the wipe's transaction). */
export async function queueShopResync(
  tx: Prisma.TransactionClient,
  companyId: string,
  plan: ShopResync[],
  now: Date = new Date(),
): Promise<number> {
  let count = 0;
  for (const { shop, events } of plan) {
    const paused =
      shop.webhooksPausedUntil && shop.webhooksPausedUntil > now ? shop.webhooksPausedUntil : null;
    const rows = events.map((event) => {
      const id = randomUUID();
      const body = { id, type: event.type, createdAt: now.toISOString(), data: event.data };
      return {
        id,
        companyId,
        source: "ECOMMERCE" as const,
        direction: "OUTGOING" as const,
        integrationId: shop.id,
        eventType: event.type,
        externalId: event.key,
        payload: body satisfies WebhookBody as unknown as Prisma.InputJsonObject,
        receivedAt: now,
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx.webhookEvent.createMany({ data: chunk });
      await enqueueJobs(
        tx,
        chunk.map((event) => ({
          kind: WEBHOOK_JOB,
          companyId,
          payload: { eventId: event.id },
          maxAttempts: WEBHOOK_MAX_ATTEMPTS,
          ...(paused ? { runAfter: paused } : {}),
        })),
      );
    }
    count += rows.length;
  }
  return count;
}
