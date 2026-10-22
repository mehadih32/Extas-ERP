import { isIP } from "node:net";

import { z } from "zod";

import { encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { requirePin } from "@/modules/ai/settings.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import { apiKeyHint, apiKeyRef, newApiKey, newWebhookSecret } from "./keys";
import { shopAccountOf } from "./shop-account";

/*
 * Settings > Integrations > E-commerce (CN-005): the shops connected to this
 * company. Making or rotating a key needs the owner's PIN (the key can take
 * orders and record money); the key and the webhook secret are shown once, in
 * the answer to that action, and never again. Revoking needs no PIN: it only
 * stops a key.
 */

export const ECOMMERCE_PERMISSION = "integrations.ecommerce.manage" as const;

export function assertCanManageShops(ctx: CompanyContext) {
  if (!ctx.can(ECOMMERCE_PERMISSION)) {
    throw new AppError("FORBIDDEN", "You may not set up online shops.");
  }
}

/** A private, local or link-local address: never a shop's webhook address. */
export function privateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(h) !== 0) return isPrivateIp(h);
  return (
    !h.includes(".") ||
    [".localhost", ".local", ".internal", ".invalid"].some((end) => h.endsWith(end))
  );
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80") ||
    v6.startsWith("::ffff:")
  );
}

/** The shop's webhook address: https, no user or password, not a private address. */
export const webhookUrlSchema = z
  .string()
  .trim()
  .max(500, "Use at most 500 characters")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Enter the shop's https:// address")
  .refine((value) => {
    try {
      return !privateAddress(new URL(value).hostname);
    } catch {
      return false;
    }
  }, "Enter the shop's public address, not a local or private one");

const ipEntry = z
  .string()
  .trim()
  .refine((value) => isIP(value) !== 0, "Enter one IP address per line, like 203.0.113.7");

export const integrationSchema = z.object({
  name: z.string().trim().min(2, "Give it a name").max(80, "Use at most 80 characters"),
  platform: z.enum(["CUSTOM_WEBSITE", "SHOPIFY", "WOOCOMMERCE", "OTHER"]).default("CUSTOM_WEBSITE"),
  warehouseId: z.string().min(1, "Choose the warehouse the shop sells from"),
  webhookUrl: z.union([webhookUrlSchema, z.literal("").transform(() => null)]).nullish(),
  ipAllowList: z.array(ipEntry).max(50, "At most 50 addresses").default([]),
  rateLimitPerMinute: z.coerce
    .number()
    .int()
    .min(10, "At least 10")
    .max(1000, "At most 1000")
    .default(120),
});

export const pinSchema = z.object({ pin: z.string().max(20).optional() });

/**
 * The webhooks' place set to now (webhooks.ts): a shop that is new, gets a new
 * webhook address, is switched on again or gets its first key hears about the
 * changes from now on, not about all history (it reads that from the API).
 */
const webhooksFromNow = () => {
  const now = new Date();
  return { stockSentTo: now, variantsSentTo: now, webhooksStartedAt: now };
};

async function checkWarehouse(ctx: CompanyContext, warehouseId: string) {
  const warehouse = await ctx.db.warehouse.findFirst({
    where: { id: warehouseId, deletedAt: null },
    select: { id: true },
  });
  if (!warehouse) {
    throw new AppError("VALIDATION", "Choose a warehouse of this company.", {
      warehouseId: ["Choose a warehouse from the list"],
    });
  }
}

async function findIntegration(ctx: CompanyContext, id: string) {
  const integration = await ctx.db.salesChannelIntegration.findUnique({ where: { id } });
  if (!integration) throw new AppError("NOT_FOUND", "Online shop not found.");
  return integration;
}

/** Adds a shop to this company (no key yet: "Generate key" makes one). */
export async function createIntegration(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageShops(ctx);
  const input = integrationSchema.parse(raw);
  await checkWarehouse(ctx, input.warehouseId);
  const integration = await ctx.db.salesChannelIntegration.create({
    data: {
      companyId: ctx.company.id,
      name: input.name,
      platform: input.platform,
      warehouseId: input.warehouseId,
      webhookUrl: input.webhookUrl ?? null,
      ipAllowList: input.ipAllowList,
      rateLimitPerMinute: input.rateLimitPerMinute,
      createdById: ctx.user.id,
      ...webhooksFromNow(),
    },
  });
  await shopAccountOf(integration);
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "SalesChannelIntegration",
    entityId: integration.id,
    summary: `Added the online shop "${integration.name}"`,
  });
  return integration;
}

/** Changes a shop's name, warehouse, webhook address, allow-list or rate limit. */
export async function updateIntegration(
  ctx: CompanyContext,
  id: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageShops(ctx);
  const input = integrationSchema.parse(raw);
  const before = await findIntegration(ctx, id);
  await checkWarehouse(ctx, input.warehouseId);
  const integration = await ctx.db.salesChannelIntegration.update({
    where: { id: before.id },
    data: {
      name: input.name,
      platform: input.platform,
      warehouseId: input.warehouseId,
      webhookUrl: input.webhookUrl ?? null,
      ipAllowList: input.ipAllowList,
      rateLimitPerMinute: input.rateLimitPerMinute,
      ...(input.webhookUrl && input.webhookUrl !== before.webhookUrl ? webhooksFromNow() : {}),
    },
  });
  if (integration.name !== before.name) await shopAccountOf(integration);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "SalesChannelIntegration",
    entityId: integration.id,
    summary: `Changed the online shop "${integration.name}"`,
    before: {
      name: before.name,
      warehouseId: before.warehouseId,
      webhookUrl: before.webhookUrl,
      ipAllowList: before.ipAllowList,
      rateLimitPerMinute: before.rateLimitPerMinute,
    },
    after: {
      name: integration.name,
      warehouseId: integration.warehouseId,
      webhookUrl: integration.webhookUrl,
      ipAllowList: integration.ipAllowList,
      rateLimitPerMinute: integration.rateLimitPerMinute,
    },
  });
  return integration;
}

/** Switches a shop on or off: switched off, its key is refused until it is on again. */
export async function setIntegrationActive(
  ctx: CompanyContext,
  id: string,
  isActive: boolean,
  meta?: RequestMeta,
) {
  assertCanManageShops(ctx);
  const integration = await findIntegration(ctx, id);
  await ctx.db.salesChannelIntegration.update({
    where: { id: integration.id },
    data: { isActive, ...(isActive && !integration.isActive ? webhooksFromNow() : {}) },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "SalesChannelIntegration",
    entityId: integration.id,
    summary: `${isActive ? "Switched on" : "Switched off"} the online shop "${integration.name}"`,
  });
}

/**
 * Makes a new API key and webhook secret (Generate key, or Rotate when one
 * exists: the old key and secret stop at once). Needs the PIN. The answer is
 * the only time they are shown.
 */
export async function generateKey(
  ctx: CompanyContext,
  id: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageShops(ctx);
  const { pin } = pinSchema.parse(raw);
  const integration = await findIntegration(ctx, id);
  const rotating = Boolean(integration.apiKeyRef);
  await requirePin(ctx, pin, rotating ? "rotate the shop's key" : "make the shop's key");
  const apiKey = newApiKey();
  const webhookSecret = newWebhookSecret();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.salesChannelIntegration.update({
      where: { id: integration.id },
      data: {
        apiKeyRef: apiKeyRef(apiKey),
        apiKeyHint: apiKeyHint(apiKey),
        apiKeyCreatedAt: now,
        apiKeyRevokedAt: null,
        webhookSecretRef: encryptSecret(webhookSecret),
        ...(rotating ? {} : webhooksFromNow()),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SalesChannelIntegration",
        entityId: integration.id,
        summary: `${rotating ? "Rotated" : "Made"} the API key of the online shop "${integration.name}" (${apiKeyHint(apiKey)})`,
      },
      tx,
    );
  });
  return { apiKey, webhookSecret, hint: apiKeyHint(apiKey), createdAt: now };
}

/** Stops a shop's key at once (no PIN: it only takes access away). */
export async function revokeKey(ctx: CompanyContext, id: string, meta?: RequestMeta) {
  assertCanManageShops(ctx);
  const integration = await findIntegration(ctx, id);
  if (!integration.apiKeyRef) {
    throw new AppError("CONFLICT", "This shop has no key to revoke.");
  }
  await ctx.db.salesChannelIntegration.update({
    where: { id: integration.id },
    data: { apiKeyRef: null, apiKeyRevokedAt: new Date() },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "SalesChannelIntegration",
    entityId: integration.id,
    summary: `Revoked the API key of the online shop "${integration.name}" (${integration.apiKeyHint ?? ""})`,
  });
}
