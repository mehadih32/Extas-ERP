import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET as health } from "@/app/api/v1/ecommerce/health/route";
import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import * as integrations from "@/modules/ecommerce/integration.service";
import { apiKeyRef } from "@/modules/ecommerce/keys";
import { ecommerceRoute, ShopResponse } from "@/modules/ecommerce/route";
import { shopEmail } from "@/modules/ecommerce/shop-address";
import { signBody, signedHeaders } from "@/modules/ecommerce/signature";
import { addMemberSchema } from "@/modules/rbac/member.service";

import { callShop, giveKey, type Shop, setupShop } from "./ecommerce-helpers";
import { addToCompany, contextFor, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A POST route for the wrapper's own checks: it counts its runs and echoes the body. */
let runs = 0;
const echo = ecommerceRoute(async ({ body, ctx }) => {
  runs++;
  if ((body as { fail?: string }).fail === "boom") throw new Error("boom");
  if ((body as { fail?: string }).fail === "conflict") {
    throw new AppError("CONFLICT", "Not now.");
  }
  return new ShopResponse(201, { got: body, run: runs, company: ctx.company.id });
});

run("E-commerce API: keys, signatures and idempotency (CN-005)", () => {
  let shop: Shop;
  beforeEach(async () => {
    await resetDb();
    runs = 0;
    shop = await setupShop();
  });

  it("answers health for a valid key with its company and shop, and logs the call", async () => {
    const res = await callShop(shop, health, { path: "/health" });
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe("Extas");
    expect(res.body.integration).toMatchObject({
      name: "Extas web shop",
      platform: "CUSTOM_WEBSITE",
    });
    const calls = await prisma.integrationApiCall.findMany({
      where: { integrationId: shop.integration.id },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/api/v1/ecommerce/health",
      status: 200,
    });
    const integration = await prisma.salesChannelIntegration.findUniqueOrThrow({
      where: { id: shop.integration.id },
    });
    expect(integration.lastSyncedAt).not.toBeNull();
  });

  it("refuses a missing, wrong, revoked or switched-off key with the contract's error shape", async () => {
    const none = await callShop(shop, health, { path: "/health", key: null });
    expect(none.status).toBe(401);
    expect(none.body).toEqual({
      error: { code: "UNAUTHENTICATED", message: expect.stringContaining("Bearer") },
    });
    const wrong = await callShop(shop, health, { path: "/health", key: `${shop.apiKey}x` });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("UNAUTHENTICATED");

    await integrations.setIntegrationActive(shop.owner, shop.integration.id, false);
    expect((await callShop(shop, health, { path: "/health" })).status).toBe(401);
    await integrations.setIntegrationActive(shop.owner, shop.integration.id, true);
    expect((await callShop(shop, health, { path: "/health" })).status).toBe(200);

    await integrations.revokeKey(shop.owner, shop.integration.id);
    expect((await callShop(shop, health, { path: "/health" })).status).toBe(401);
  });

  it("slows down an address that keeps trying wrong keys", async () => {
    const from = { "x-forwarded-for": "198.51.100.9" };
    for (let i = 0; i < 20; i++) {
      const res = await callShop(shop, health, { path: "/health", key: "nope", headers: from });
      expect(res.status).toBe(401);
    }
    const res = await callShop(shop, health, { path: "/health", key: "nope", headers: from });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("takes the company from the key, never from the body", async () => {
    const other = await setupShop("Fabric Apparel");
    const mine = await callShop(shop, echo, {
      path: "/echo",
      body: { companyId: other.company.id },
    });
    expect(mine.status).toBe(201);
    expect(mine.body.company).toBe(shop.company.id);
    const theirs = await callShop(other, health, { path: "/health" });
    expect(theirs.body.company.name).toBe("Fabric Apparel");
  });

  it("refuses plain http, an address off the allow-list, and too many requests", async () => {
    const http = await callShop(shop, health, {
      path: "/health",
      headers: { "x-forwarded-proto": "http" },
    });
    expect(http.status).toBe(403);
    expect(http.body.error.code).toBe("HTTPS_REQUIRED");

    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { ipAllowList: ["203.0.113.7"], rateLimitPerMinute: 10 },
    });
    const off = await callShop(shop, health, {
      path: "/health",
      headers: { "x-forwarded-for": "198.51.100.1" },
    });
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe("IP_NOT_ALLOWED");
    const on = { "x-forwarded-for": "203.0.113.7" };
    // A refused address is not counted: 10 calls fit in the minute.
    for (let i = 0; i < 10; i++) {
      expect((await callShop(shop, health, { path: "/health", headers: on })).status).toBe(200);
    }
    const limited = await callShop(shop, health, { path: "/health", headers: on });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.headers.get("retry-after")).toBe("60");
    const logged = await prisma.integrationApiCall.count({
      where: { integrationId: shop.integration.id, status: 429 },
    });
    expect(logged).toBe(1);
  });

  it("checks the signature and the time on a request with a body", async () => {
    const body = { hello: "shop" };
    const unsigned = await callShop(shop, echo, { path: "/echo", body, sign: false });
    expect(unsigned.status).toBe(401);
    expect(unsigned.body.error.code).toBe("STALE_TIMESTAMP");

    const raw = JSON.stringify(body);
    const now = String(Math.floor(Date.now() / 1000));
    const wrongSecret = await callShop(shop, echo, {
      path: "/echo",
      body,
      sign: false,
      headers: { "X-Extas-Timestamp": now, "X-Extas-Signature": signBody("not-the-secret", raw) },
    });
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.body.error.code).toBe("BAD_SIGNATURE");

    const tampered = await callShop(shop, echo, {
      path: "/echo",
      body: { hello: "someone else" },
      sign: false,
      headers: { "X-Extas-Timestamp": now, "X-Extas-Signature": signBody(shop.webhookSecret, raw) },
    });
    expect(tampered.body.error.code).toBe("BAD_SIGNATURE");

    const old = await callShop(shop, echo, {
      path: "/echo",
      body,
      sign: false,
      headers: signedHeaders(shop.webhookSecret, raw, new Date(Date.now() - 6 * 60_000)),
    });
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe("STALE_TIMESTAMP");

    const good = await callShop(shop, echo, { path: "/echo", body });
    expect(good.status).toBe(201);
    expect(good.body.got).toEqual(body);
    expect(runs).toBe(1);

    // A GET needs no signature, but one it sends must be right.
    const badGet = await callShop(shop, health, {
      path: "/health",
      sign: false,
      headers: { "X-Extas-Timestamp": now, "X-Extas-Signature": "sha256=00" },
    });
    expect(badGet.body.error.code).toBe("BAD_SIGNATURE");
  });

  it("needs an Idempotency-Key on every POST and gives a repeat the first answer", async () => {
    const missing = await callShop(shop, echo, {
      path: "/echo",
      body: { a: 1 },
      idempotencyKey: null,
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(runs).toBe(0);

    const first = await callShop(shop, echo, {
      path: "/echo",
      body: { a: 1 },
      idempotencyKey: "k-1",
    });
    const again = await callShop(shop, echo, {
      path: "/echo",
      body: { a: 1 },
      idempotencyKey: "k-1",
    });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(runs).toBe(1);

    const reused = await callShop(shop, echo, {
      path: "/echo",
      body: { a: 2 },
      idempotencyKey: "k-1",
    });
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(runs).toBe(1);

    // Keys are the shop's own: another shop may use the same one.
    const other = await setupShop("Fabric Apparel");
    const theirs = await callShop(other, echo, {
      path: "/echo",
      body: { a: 1 },
      idempotencyKey: "k-1",
    });
    expect(theirs.status).toBe(201);
    expect(runs).toBe(2);
  });

  it("keeps a refusal for its key, frees the key after a server error, and waits for one running", async () => {
    const refused = await callShop(shop, echo, {
      path: "/echo",
      body: { fail: "conflict" },
      idempotencyKey: "k-conflict",
    });
    expect(refused.status).toBe(409);
    const refusedAgain = await callShop(shop, echo, {
      path: "/echo",
      body: { fail: "conflict" },
      idempotencyKey: "k-conflict",
    });
    expect(refusedAgain.body).toEqual(refused.body);
    expect(runs).toBe(1);

    const broke = await callShop(shop, echo, {
      path: "/echo",
      body: { fail: "boom" },
      idempotencyKey: "k-boom",
    });
    expect(broke.status).toBe(500);
    expect(broke.body.error.code).toBe("INTERNAL");
    expect(broke.body.error.details.errorId).toMatch(/^ERR-/);
    await callShop(shop, echo, { path: "/echo", body: { fail: "boom" }, idempotencyKey: "k-boom" });
    expect(runs).toBe(3);

    const body = { a: "slow" };
    const { createHash } = await import("node:crypto");
    const requestHash = createHash("sha256")
      .update(`POST\n/api/v1/ecommerce/echo\n${JSON.stringify(body)}`)
      .digest("hex");
    const row = await prisma.integrationIdempotency.create({
      data: {
        companyId: shop.company.id,
        integrationId: shop.integration.id,
        key: "k-running",
        method: "POST",
        path: "/api/v1/ecommerce/echo",
        requestHash,
      },
    });
    const busy = await callShop(shop, echo, { path: "/echo", body, idempotencyKey: "k-running" });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(runs).toBe(3);
    // Cut off long ago: it may run again.
    await prisma.integrationIdempotency.update({
      where: { id: row.id },
      data: { createdAt: new Date(Date.now() - 3 * 60_000) },
    });
    const retried = await callShop(shop, echo, {
      path: "/echo",
      body,
      idempotencyKey: "k-running",
    });
    expect(retried.status).toBe(201);
    expect(runs).toBe(4);
  });
});

run("E-commerce settings: keys shown once, hashed, rotated and revoked", () => {
  let shop: Shop;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
  });

  it("makes a key only with the PIN, keeps only its hash, and seals the secret", async () => {
    await expect(integrations.generateKey(shop.owner, shop.integration.id, {})).rejects.toThrow(
      /PIN/,
    );
    await setPin(shop.owner, { pin: "2468" });
    await expect(
      integrations.generateKey(shop.owner, shop.integration.id, { pin: "1111" }),
    ).rejects.toThrow(/PIN is not right/);
    const made = await integrations.generateKey(shop.owner, shop.integration.id, { pin: "2468" });
    expect(made.apiKey).toMatch(/^extas_sk_[A-Za-z0-9_-]{43}$/);
    expect(made.webhookSecret).toMatch(/^extas_whsec_[A-Za-z0-9_-]{43}$/);
    const row = await prisma.salesChannelIntegration.findUniqueOrThrow({
      where: { id: shop.integration.id },
    });
    expect(row.apiKeyRef).toBe(apiKeyRef(made.apiKey));
    expect(JSON.stringify(row)).not.toContain(made.apiKey);
    expect(JSON.stringify(row)).not.toContain(made.webhookSecret);
    expect(decryptSecret(row.webhookSecretRef!)).toBe(made.webhookSecret);
    expect(row.apiKeyHint).toBe(`${made.apiKey.slice(0, 13)}…${made.apiKey.slice(-4)}`);

    // Rotating: the old key and secret stop at once.
    const old = { apiKey: shop.apiKey, webhookSecret: shop.webhookSecret };
    expect((await callShop(old, health, { path: "/health" })).status).toBe(401);
    expect((await callShop(made, health, { path: "/health" })).status).toBe(200);
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "SalesChannelIntegration",
        entityId: shop.integration.id,
        action: "UPDATE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.summary).toContain("Rotated");
    expect(audit?.summary).not.toContain(made.apiKey);

    await integrations.revokeKey(shop.owner, shop.integration.id);
    expect((await callShop(made, health, { path: "/health" })).status).toBe(401);
    await expect(integrations.revokeKey(shop.owner, shop.integration.id)).rejects.toThrow(/no key/);
    const back = await giveKey(shop.integration.id);
    expect((await callShop(back, health, { path: "/health" })).status).toBe(200);
  });

  it("is only for people allowed to set up shops", async () => {
    const role = await prisma.role.findFirstOrThrow({
      where: { companyId: shop.company.id, systemRole: "SALES_EXECUTIVE" },
    });
    const sales = await makeUser("sales@extas.test");
    await addToCompany(sales.id, shop.company.id, role.id);
    const ctx = await contextFor(sales.id, shop.company.id);
    await expect(
      integrations.createIntegration(ctx, { name: "Mine", warehouseId: shop.warehouse.id }),
    ).rejects.toThrow(/may not set up online shops/);
    await expect(integrations.revokeKey(ctx, shop.integration.id)).rejects.toThrow(AppError);
    expect(shop.accounts.can("integrations.ecommerce.manage")).toBe(false);
    expect(shop.owner.can("integrations.ecommerce.manage")).toBe(true);
  });

  it("takes only a public https webhook address and real IP addresses", async () => {
    const base = { name: "Shop 2", warehouseId: shop.warehouse.id };
    for (const webhookUrl of [
      "http://shop.example.com/hook",
      "https://localhost/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest",
      "https://[::1]/hook",
      "https://user:pw@shop.example.com/hook",
      "https://erp.internal/hook",
    ]) {
      await expect(
        integrations.createIntegration(shop.owner, { ...base, webhookUrl }),
        webhookUrl,
      ).rejects.toThrow();
    }
    await expect(
      integrations.createIntegration(shop.owner, { ...base, ipAllowList: ["not-an-ip"] }),
    ).rejects.toThrow();
    const ok = await integrations.createIntegration(shop.owner, {
      ...base,
      webhookUrl: "",
      ipAllowList: ["203.0.113.7", "2001:db8::1"],
    });
    expect(ok.webhookUrl).toBeNull();
    const other = await setupShop("Fabric Apparel");
    await expect(
      integrations.createIntegration(shop.owner, { ...base, warehouseId: other.warehouse.id }),
    ).rejects.toThrow(/warehouse of this company/);
  });

  it("gives each shop its own locked account that no person can take", async () => {
    const row = await prisma.salesChannelIntegration.findUniqueOrThrow({
      where: { id: shop.integration.id },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: row.serviceUserId! } });
    expect(user).toMatchObject({
      email: shopEmail(shop.integration.id),
      name: "Shop: Extas web shop",
      status: "SUSPENDED",
      passwordHash: null,
    });
    expect(await prisma.companyMembership.count({ where: { userId: user.id } })).toBe(0);
    expect(
      addMemberSchema.safeParse({ email: user.email, name: "Someone", roleId: "x" }).success,
    ).toBe(false);
  });
});
