import { vi } from "vitest";

import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { PIN_CHECKED } from "@/modules/ai/settings.service";
import { createIntegration } from "@/modules/ecommerce/integration.service";
import { apiKeyHint, apiKeyRef, newApiKey, newWebhookSecret } from "@/modules/ecommerce/keys";
import { signedHeaders } from "@/modules/ecommerce/signature";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";

import { addToCompany, contextFor, makeCompany, makeUser } from "./helpers";

/*
 * A shop to test the e-commerce API with: a company with its owner (Super
 * Admin) and an Accounts person, the "Classic Polo" (EX-PL-001, retail 1450,
 * Navy / White x S M L, 10 pcs each at cost 500) and the "Basic Tee"
 * (EX-TS-002, White S, no stock), all in the default warehouse, and the
 * integration "Extas web shop" with its key and secret.
 */
export async function setupShop(name = "Extas") {
  vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
  const { company, roles } = await makeCompany(name);
  const ownerUser = await makeUser(`owner@${company.slug}.test`);
  await addToCompany(ownerUser.id, company.id, roles.SUPER_ADMIN);
  const owner = await contextFor(ownerUser.id, company.id);
  const accountsUser = await makeUser(`accounts@${company.slug}.test`);
  await addToCompany(accountsUser.id, company.id, roles.ACCOUNTS);
  const accounts = await contextFor(accountsUser.id, company.id);

  const sizes = [];
  for (const size of ["S", "M", "L"]) sizes.push(await catalog.createSize(owner, { name: size }));
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1F2A44" });
  const white = await catalog.createColor(owner, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const polo = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(owner, polo.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const tee = await styles.createStyle(owner, {
    code: "EX-TS-002",
    name: "Basic Tee",
    categoryId: tops.id,
    retailPrice: 600,
    wholesalePrice: 400,
  });
  await matrix.generateMatrix(owner, tee.id, { colorIds: [white.id], sizeIds: [sizes[0]!.id] });
  const variants = await prisma.productVariant.findMany({
    where: { companyId: company.id },
    include: { color: true, size: true, style: true },
  });
  for (const v of variants.filter((v) => v.styleId === polo.id)) {
    await stock.adjustStock(owner, {
      variantId: v.id,
      quantity: 10,
      type: "OPENING",
      unitCost: 500,
    });
  }
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { companyId: company.id, isDefault: true },
  });
  const sku = (style: string, color: string, size: string) =>
    variants.find((v) => v.style.code === style && v.color.name === color && v.size.name === size)!
      .sku;

  const integration = await createIntegration(
    owner,
    {
      name: "Extas web shop",
      warehouseId: warehouse.id,
      webhookUrl: "https://shop.example.com/erp/webhooks",
    },
    undefined,
    PIN_CHECKED,
  );
  const { apiKey, webhookSecret } = await giveKey(integration.id);
  return {
    company,
    owner,
    accounts,
    polo,
    tee,
    variants,
    sku,
    warehouse,
    integration,
    apiKey,
    webhookSecret,
  };
}

export type Shop = Awaited<ReturnType<typeof setupShop>>;

/** A new key and secret for an integration, as "Generate key" makes them (without the PIN). */
export async function giveKey(integrationId: string) {
  const apiKey = newApiKey();
  const webhookSecret = newWebhookSecret();
  await prisma.salesChannelIntegration.update({
    where: { id: integrationId },
    data: {
      apiKeyRef: apiKeyRef(apiKey),
      apiKeyHint: apiKeyHint(apiKey),
      apiKeyCreatedAt: new Date(),
      apiKeyRevokedAt: null,
      webhookSecretRef: encryptSecret(webhookSecret),
    },
  });
  return { apiKey, webhookSecret };
}

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

export type CallOptions<P> = {
  method?: string;
  /** The path after /api/v1/ecommerce, with any query ("/stock?limit=2"). */
  path: string;
  body?: unknown;
  params?: P;
  /** The key to send (the shop's own by default; null sends none). */
  key?: string | null;
  /** Sign the body with the shop's secret (true by default). */
  sign?: boolean;
  /** Sent as Idempotency-Key (a fresh one for every POST by default; null sends none). */
  idempotencyKey?: string | null;
  headers?: Record<string, string>;
};

let calls = 0;

/** Calls a route handler as the shop would, and returns the status, body and headers. */
export async function callShop<P = Record<string, never>>(
  shop: Pick<Shop, "apiKey" | "webhookSecret">,
  handler: Handler<P>,
  options: CallOptions<P>,
) {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const raw = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = options.key === undefined ? shop.apiKey : options.key;
  if (key) headers.authorization = `Bearer ${key}`;
  if (options.sign ?? method !== "GET")
    Object.assign(headers, signedHeaders(shop.webhookSecret, raw));
  const idempotencyKey =
    options.idempotencyKey === undefined
      ? method === "POST"
        ? `test-${Date.now()}-${++calls}`
        : null
      : options.idempotencyKey;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  Object.assign(headers, options.headers);
  const request = new Request(`https://erp.example.com/api/v1/ecommerce${options.path}`, {
    method,
    headers,
    ...(raw ? { body: raw } : {}),
  });
  const response = await handler(request, {
    params: Promise.resolve((options.params ?? {}) as P),
  });
  const text = await response.text();
  return {
    status: response.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each test reads its own fields
    body: (text ? JSON.parse(text) : null) as Record<string, any>,
    headers: response.headers,
  };
}

/** The context of the shop's own account (for checking what it did). */
export const shopUserOf = async (integrationId: string) =>
  (await prisma.salesChannelIntegration.findUniqueOrThrow({ where: { id: integrationId } }))
    .serviceUserId!;
