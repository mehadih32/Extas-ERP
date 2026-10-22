import type { WebhookStatus } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";

import { assertCanManageShops } from "./integration.service";

/*
 * What Settings > Integrations > E-commerce shows (CN-005): the company's
 * online shops, and one shop's page with its key's hint, its webhook log and
 * its latest API calls. Never a key or a secret: the key is kept only as a
 * hash, and the secret is shown once, when it is made.
 */

/** The address a shop calls: this ERP's own (APP_URL) and the API's base path. */
export function apiAddress(): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/v1/ecommerce`;
}

/** What the webhook log can be filtered by. */
export const WEBHOOK_FILTERS = ["ALL", "PROCESSED", "RECEIVED", "FAILED", "IGNORED"] as const;
export type WebhookFilter = (typeof WEBHOOK_FILTERS)[number];

const shopQuerySchema = z.object({
  status: z.enum(WEBHOOK_FILTERS).catch("ALL").default("ALL"),
});

/** How many rows of the webhook log and of the call log a shop's page shows. */
export const LOG_ROWS = 50;

const SHOP_FIELDS = {
  id: true,
  name: true,
  platform: true,
  isActive: true,
  apiKeyHint: true,
  apiKeyCreatedAt: true,
  apiKeyRevokedAt: true,
  apiKeyRef: true,
  webhookUrl: true,
  warehouseId: true,
  ipAllowList: true,
  rateLimitPerMinute: true,
  lastSyncedAt: true,
  createdAt: true,
  warehouse: { select: { id: true, name: true } },
} as const;

type ShopRow = {
  id: string;
  name: string;
  platform: string;
  isActive: boolean;
  apiKeyHint: string | null;
  apiKeyCreatedAt: Date | null;
  apiKeyRevokedAt: Date | null;
  apiKeyRef: string | null;
  webhookUrl: string | null;
  warehouseId: string | null;
  ipAllowList: string[];
  rateLimitPerMinute: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
  warehouse: { id: string; name: string } | null;
};

/** A shop as the screens show it: whether it has a key, never the key's hash. */
function present(row: ShopRow) {
  const { apiKeyRef, ...rest } = row;
  return { ...rest, hasKey: apiKeyRef !== null };
}

export type ShopView = ReturnType<typeof present>;

/** The warehouses a shop may sell from (for "Add online shop" and "Edit"). */
async function warehouseChoices(ctx: CompanyContext) {
  return ctx.db.warehouse.findMany({
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true },
  });
}

/** The company's shops, and what "Add online shop" needs. */
export async function listShops(ctx: CompanyContext) {
  assertCanManageShops(ctx);
  const [rows, warehouses, failing] = await Promise.all([
    ctx.db.salesChannelIntegration.findMany({
      orderBy: { createdAt: "asc" },
      select: SHOP_FIELDS,
    }),
    warehouseChoices(ctx),
    ctx.db.webhookEvent.groupBy({
      by: ["integrationId"],
      where: {
        direction: "OUTGOING",
        status: "FAILED",
        receivedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
      },
      _count: { _all: true },
    }),
  ]);
  const failed = new Map(failing.map((f) => [f.integrationId, f._count._all]));
  return {
    companyName: ctx.company.name,
    apiAddress: apiAddress(),
    warehouses,
    shops: rows.map((row) => ({ ...present(row), failedThisWeek: failed.get(row.id) ?? 0 })),
  };
}

/** One shop's page: the shop, its webhook log (filtered by status) and its latest API calls. */
export async function getShop(ctx: CompanyContext, id: string, raw: unknown = {}) {
  assertCanManageShops(ctx);
  const { status } = shopQuerySchema.parse(raw ?? {});
  const row = await ctx.db.salesChannelIntegration.findUnique({
    where: { id },
    select: SHOP_FIELDS,
  });
  if (!row) throw new AppError("NOT_FOUND", "Online shop not found.");
  const [webhooks, calls, warehouses, waiting] = await Promise.all([
    ctx.db.webhookEvent.findMany({
      where: {
        integrationId: row.id,
        direction: "OUTGOING",
        ...(status === "ALL" ? {} : { status: status as WebhookStatus }),
      },
      orderBy: { receivedAt: "desc" },
      take: LOG_ROWS,
      select: {
        id: true,
        eventType: true,
        externalId: true,
        status: true,
        attempts: true,
        responseStatus: true,
        error: true,
        receivedAt: true,
        lastAttemptAt: true,
      },
    }),
    ctx.db.integrationApiCall.findMany({
      where: { integrationId: row.id },
      orderBy: { createdAt: "desc" },
      take: LOG_ROWS,
      select: {
        id: true,
        method: true,
        path: true,
        status: true,
        errorCode: true,
        createdAt: true,
      },
    }),
    warehouseChoices(ctx),
    ctx.db.webhookEvent.count({
      where: { integrationId: row.id, direction: "OUTGOING", status: "RECEIVED" },
    }),
  ]);
  return {
    shop: present(row),
    companyName: ctx.company.name,
    apiAddress: apiAddress(),
    warehouses,
    filter: status,
    waiting,
    webhooks,
    calls,
  };
}

export type ShopPage = Awaited<ReturnType<typeof getShop>>;
export type ShopList = Awaited<ReturnType<typeof listShops>>;
