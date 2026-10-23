import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { createIntegration } from "@/modules/ecommerce/integration.service";
import { apiKeyHint, apiKeyRef, newApiKey, newWebhookSecret } from "@/modules/ecommerce/keys";
import { getDefaultWarehouse } from "@/modules/inventory/stock.service";

/*
 * The CN-005 sample on the demo site: an online shop, "Extas web shop
 * (sample)", so Settings > Integrations and the shop's page (and their Help
 * pictures) show something. Its key is made up and thrown away at once (only
 * its hash is kept, as for a real key), so nobody can call the demo with it.
 * Its webhook address is under ".example", a name kept for examples that never
 * resolves, and the demo's webhook clock is off (deploy/compose.yml): nothing
 * is ever sent from practice data. A few past webhooks and API calls fill its
 * logs. Once: when the sample is there already it does nothing.
 */

export const SAMPLE_SHOP = "Extas web shop (sample)";

const MINUTE = 60_000;

export async function loadSampleShop(ctx: CompanyContext) {
  const there = await prisma.salesChannelIntegration.findFirst({
    where: { companyId: ctx.company.id, name: SAMPLE_SHOP },
    select: { id: true },
  });
  if (there) return null;
  const warehouse = await getDefaultWarehouse(ctx);
  const shop = await createIntegration(ctx, {
    name: SAMPLE_SHOP,
    platform: "CUSTOM_WEBSITE",
    warehouseId: warehouse.id,
    webhookUrl: "https://shop.extas.example/erp/webhooks",
  });
  const key = newApiKey();
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * MINUTE);
  await prisma.salesChannelIntegration.update({
    where: { id: shop.id },
    data: {
      apiKeyRef: apiKeyRef(key),
      apiKeyHint: apiKeyHint(key),
      apiKeyCreatedAt: at(3 * 24 * 60),
      // Sealed only where the demo has its key; otherwise "Rotate key" makes one.
      webhookSecretRef: process.env.ENCRYPTION_KEY ? encryptSecret(newWebhookSecret()) : null,
      lastSyncedAt: at(4),
    },
  });

  const variants = await prisma.productVariant.findMany({
    where: { companyId: ctx.company.id, removedAt: null },
    orderBy: { sku: "asc" },
    take: 3,
    include: { style: true, color: true, size: true },
  });
  const base = {
    companyId: ctx.company.id,
    integrationId: shop.id,
    source: "ECOMMERCE" as const,
    direction: "OUTGOING" as const,
  };
  const hooks: Prisma.WebhookEventCreateManyInput[] = [];
  const body = (type: string, minutesAgo: number, data: Prisma.InputJsonObject) => {
    const id = randomUUID();
    return { id, payload: { id, type, createdAt: at(minutesAgo).toISOString(), data } };
  };
  const [first, second, third] = variants;
  if (first) {
    const stock = (reserved: number) => ({
      sku: first.sku,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      onHand: 24,
      reserved,
      available: 24 - reserved,
      updatedAt: at(6).toISOString(),
    });
    hooks.push(
      {
        ...base,
        ...body("stock.changed", 6, stock(2)),
        eventType: "stock.changed",
        externalId: first.sku,
        status: "PROCESSED",
        attempts: 1,
        responseStatus: 200,
        receivedAt: at(6),
        lastAttemptAt: at(6),
        processedAt: at(6),
      },
      {
        ...base,
        ...body("stock.changed", 2, stock(3)),
        eventType: "stock.changed",
        externalId: first.sku,
        status: "RECEIVED",
        attempts: 2,
        responseStatus: 503,
        error: "The shop answered 503.",
        receivedAt: at(2),
        lastAttemptAt: at(1),
      },
    );
  }
  if (second) {
    hooks.push({
      ...base,
      ...body("variant.changed", 40, {
        sku: second.sku,
        styleCode: second.style.code,
        retailPrice: Number(second.retailPrice ?? second.style.retailPrice),
        active: true,
        isNew: false,
      }),
      eventType: "variant.changed",
      externalId: second.sku,
      status: "PROCESSED",
      attempts: 1,
      responseStatus: 200,
      receivedAt: at(40),
      lastAttemptAt: at(40),
      processedAt: at(40),
    });
  }
  if (third) {
    hooks.push({
      ...base,
      ...body("stock.changed", 26 * 60, { sku: third.sku, warehouseId: warehouse.id }),
      eventType: "stock.changed",
      externalId: third.sku,
      status: "FAILED",
      attempts: 31,
      responseStatus: null,
      error:
        "Not delivered within 24 hours: the shop reads the change when it asks for what changed.",
      receivedAt: at(26 * 60),
      lastAttemptAt: at(2 * 60),
      processedAt: at(2 * 60),
    });
  }
  hooks.push({
    ...base,
    ...body("ping", 90, { message: "A test from Extas ERP", shop: SAMPLE_SHOP }),
    eventType: "ping",
    externalId: null,
    status: "PROCESSED",
    attempts: 1,
    responseStatus: 200,
    error: "Checked by the ERP's built-in mock shop (no webhook address yet).",
    receivedAt: at(90),
    lastAttemptAt: at(90),
    processedAt: at(90),
  });
  await prisma.webhookEvent.createMany({ data: hooks });

  const call = (
    minutesAgo: number,
    method: string,
    path: string,
    status: number,
    errorCode: string | null = null,
  ) => ({
    companyId: ctx.company.id,
    integrationId: shop.id,
    method,
    path: `/api/v1/ecommerce${path}`,
    status,
    errorCode,
    ipAddress: "203.0.113.7",
    durationMs: 40 + minutesAgo,
    createdAt: at(minutesAgo),
  });
  await prisma.integrationApiCall.createMany({
    data: [
      call(95, "GET", "/health", 200),
      call(60, "GET", "/stock?limit=100", 200),
      call(30, "POST", "/orders", 201),
      call(25, "POST", "/orders", 409, "INSUFFICIENT_STOCK"),
      call(12, "POST", "/payments", 201),
      call(4, "GET", "/catalog/variants?limit=100", 200),
    ],
  });
  return { name: SAMPLE_SHOP, webhooks: hooks.length };
}
