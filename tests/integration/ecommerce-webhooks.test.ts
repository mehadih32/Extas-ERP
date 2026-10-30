import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The owner's bot alarms: counted, never sent anywhere.
const pushes = vi.hoisted(() => ({ sent: [] as unknown[] }));
vi.mock("@/modules/ai/bot/send-push", () => ({
  sendPush: async (_companyId: string, push: unknown) => {
    pushes.sent.push(push);
  },
}));
// No real name is ever looked up: each test says what the shop's name resolves to.
const dns = vi.hoisted(() => ({ addresses: ["93.184.216.34"] as string[] }));
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  const lookup = vi.fn(
    (_host: string, _options: unknown, callback: (e: null, found: unknown[]) => void) =>
      callback(
        null,
        dns.addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      ),
  );
  return { ...actual, default: { ...actual, lookup }, lookup };
});

type Sent = {
  url: string;
  body: string;
  headers: Record<string, string>;
  /** How it connected: through the ERP's own checking lookup, on a connection of its own. */
  lookup: boolean;
  /** The address the connection was made to: the one the lookup checked. */
  connectedTo: string;
  agent: unknown;
};

/*
 * The shop's side, mocked at node:https: the request connects the way node:https
 * does (a name goes through the request's own lookup first; a refusal there is
 * the request's error and nothing is sent), then the shop's answer is given.
 */
const shopSide = vi.hoisted(() => ({
  answer: null as null | ((sent: Sent) => Response | Promise<Response>),
}));
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  const { EventEmitter } = await import("node:events");
  const { isIP } = await import("node:net");
  type Options = { headers: Record<string, string>; lookup?: typeof import("node:dns").lookup };
  const request = (url: string, options: Options, onResponse: (response: unknown) => void) => {
    const sending = Object.assign(new EventEmitter(), {
      end(body: string) {
        void (async () => {
          const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
          let connectedTo = host;
          if (isIP(host) === 0) {
            if (!options.lookup)
              return sending.emit("error", new Error("Looked up without a check."));
            const found = await new Promise<{ error: Error | null; address?: string }>((resolve) =>
              options.lookup!(host, { all: true }, (error, addresses) =>
                resolve({
                  error,
                  address: (addresses as unknown as Array<{ address: string }>)[0]?.address,
                }),
              ),
            );
            if (found.error) return sending.emit("error", found.error);
            connectedTo = found.address!;
          }
          if (!shopSide.answer) return sending.emit("error", new Error("No shop is listening."));
          try {
            const response = await shopSide.answer({
              url,
              body,
              headers: Object.fromEntries(new Headers(options.headers).entries()),
              lookup: typeof options.lookup === "function",
              connectedTo,
              agent: (options as { agent?: unknown }).agent,
            });
            onResponse(
              Object.assign(new EventEmitter(), {
                statusCode: response.status,
                destroy: () => undefined,
              }),
            );
          } catch (error) {
            sending.emit("error", error);
          }
        })();
        return sending;
      },
    });
    return sending;
  };
  return { ...actual, default: { ...actual, request }, request };
});

import { lookup as dnsLookup } from "node:dns";

import { prisma } from "@/lib/prisma";
import { PIN_CHECKED, setPin } from "@/modules/ai/settings.service";
import { purgeShopLogs } from "@/modules/ecommerce/housekeeping";
import * as integrations from "@/modules/ecommerce/integration.service";
import { getShop, listShops } from "@/modules/ecommerce/screens.service";
import { signatureMatches, signedHeaders, timestampFresh } from "@/modules/ecommerce/signature";
import { ecommerceWebhookTick } from "@/modules/ecommerce/webhook-clock";
import {
  deliver,
  GIVE_UP_AFTER_MS,
  mockShopReceive,
  scanShopChanges,
  sendTestEvent,
  WEBHOOK_MAX_ATTEMPTS,
} from "@/modules/ecommerce/webhooks";
import { runHousekeeping } from "@/modules/housekeeping/scheduler";
import * as stores from "@/modules/retail/stores.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import { enqueueJob, retryDelayMs } from "@/modules/jobs/queue";
import { runDueJobs } from "@/modules/jobs/worker";
import { reserveStock } from "@/modules/sales/stock-ops";

import { type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PIN = "4826";

/** The shop's side: every request the ERP makes, and the answer to give. */
function mockShop(answer: (sent: Sent) => Response | Promise<Response> = () => ok()) {
  const sent: Sent[] = [];
  shopSide.answer = (one) => {
    sent.push(one);
    return answer(one);
  };
  return { sent };
}
const ok = () => new Response("{}", { status: 200 });

const outgoing = (shop: Shop, where: Record<string, unknown> = {}) =>
  prisma.webhookEvent.findMany({
    where: { integrationId: shop.integration.id, direction: "OUTGOING", ...where },
    orderBy: { receivedAt: "asc" },
  });

/** Reserves pieces the way a confirmed order does (sales/stock-ops.ts). */
async function reserve(shop: Shop, sku: string, qty: number) {
  const variant = shop.variants.find((v) => v.sku === sku)!;
  await prisma.$transaction((tx) =>
    reserveStock(
      tx,
      { companyId: shop.company.id, warehouseId: shop.warehouse.id, variantId: variant.id },
      qty,
      false,
    ),
  );
}

/** A moment later than everything saved so far (timestamps are in milliseconds). */
const later = async () => new Promise((resolve) => setTimeout(resolve, 5));

run("E-commerce webhooks: ERP to shop (CN-005)", () => {
  let shop: Shop;
  let navyS: string;
  beforeEach(async () => {
    await resetDb();
    await prisma.backgroundJob.deleteMany();
    dns.addresses = ["93.184.216.34"];
    shop = await setupShop();
    navyS = shop.sku("EX-PL-001", "Navy", "S");
    await later();
  });
  afterEach(() => {
    shopSide.answer = null;
  });

  // ---------------------------------------------------------------------------
  // The pass
  // ---------------------------------------------------------------------------

  it("sends nothing for what changed before the shop was connected", async () => {
    // The opening stock and the styles were made just before the shop.
    expect(await scanShopChanges()).toEqual({ shops: 1, events: 0 });
    expect(await outgoing(shop)).toHaveLength(0);
  });

  it("makes one stock.changed per SKU after a reservation, once, with a job that retries for a day", async () => {
    await reserve(shop, navyS, 2);
    await reserve(shop, navyS, 1);
    expect(await scanShopChanges()).toEqual({ shops: 1, events: 1 });
    const [event] = await outgoing(shop);
    expect(event).toMatchObject({
      source: "ECOMMERCE",
      direction: "OUTGOING",
      eventType: "stock.changed",
      externalId: navyS,
      status: "RECEIVED",
      attempts: 0,
    });
    // The exact body that is sent: id, type, createdAt and the stock row (latest values).
    expect(event!.payload).toEqual({
      id: event!.id,
      type: "stock.changed",
      createdAt: expect.any(String),
      data: {
        sku: navyS,
        warehouseId: shop.warehouse.id,
        warehouseName: shop.warehouse.name,
        onHand: 10,
        reserved: 3,
        available: 7,
        updatedAt: expect.any(String),
      },
    });
    const jobs = await prisma.backgroundJob.findMany({ where: { kind: "ecommerce.webhook.send" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      companyId: shop.company.id,
      payload: { eventId: event!.id },
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    });
    // Nothing changed since: nothing more, however often the clock runs.
    expect((await scanShopChanges()).events).toBe(0);
    expect((await scanShopChanges()).events).toBe(0);
    expect(await outgoing(shop)).toHaveLength(1);
  });

  it("gives the queue enough tries to keep trying for 24 hours, and no more", () => {
    let waited = 0;
    for (let attempt = 1; attempt < WEBHOOK_MAX_ATTEMPTS; attempt++)
      waited += retryDelayMs(attempt);
    expect(waited).toBeGreaterThanOrEqual(GIVE_UP_AFTER_MS);
    expect(waited - retryDelayMs(WEBHOOK_MAX_ATTEMPTS - 1)).toBeLessThan(
      GIVE_UP_AFTER_MS + 3_600_000,
    );
  });

  it("does not lose a change saved late, nor send it twice", async () => {
    // A shop connected an hour ago (a change from before it was connected is never sent).
    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { webhooksStartedAt: new Date(Date.now() - 3_600_000) },
    });
    // It reads a few minutes back: the opening stock and the 7 variants, once.
    expect((await scanShopChanges()).events).toBe(13);
    expect((await scanShopChanges()).events).toBe(0);
    const reservedSent = async () =>
      (await outgoing(shop, { externalId: navyS, eventType: "stock.changed" })).map(
        (e) => (e.payload as { data: { reserved: number } }).data.reserved,
      );
    expect(await reservedSent()).toEqual([0]);
    const { stockSentTo } = await prisma.salesChannelIntegration.findUniqueOrThrow({
      where: { id: shop.integration.id },
    });
    // A transaction that began before the pass and was saved after it: its time is
    // before the shop's place, as if it had been missed.
    const variant = shop.variants.find((v) => v.sku === navyS)!;
    await prisma.$executeRaw`
      UPDATE "StockBalance" SET reserved = 4, "updatedAt" = ${new Date(stockSentTo!.getTime() - 1000)}
      WHERE "variantId" = ${variant.id} AND "warehouseId" = ${shop.warehouse.id}`;
    expect((await scanShopChanges()).events).toBe(1);
    expect(await reservedSent()).toEqual([0, 4]);
    expect((await scanShopChanges()).events).toBe(0);
    // Two changes of the same SKU in the same instant: the second one's values go too.
    await prisma.$executeRaw`
      UPDATE "StockBalance" SET reserved = 5, "updatedAt" = ${new Date(stockSentTo!.getTime() - 1000)}
      WHERE "variantId" = ${variant.id} AND "warehouseId" = ${shop.warehouse.id}`;
    expect((await scanShopChanges()).events).toBe(1);
    expect(await reservedSent()).toEqual([0, 4, 5]);
  });

  it("sends a retail store's site only its own buying price, never the ERP's cost or prices", async () => {
    await setPin(shop.owner, { pin: PIN });
    const store = await stores.createStore(shop.owner, {
      name: "Extas Retail",
      kind: "ONLINE",
      warehouseId: shop.warehouse.id,
      integrationId: shop.integration.id,
    });
    await later();
    // The store's own price rule changes: every SKU it can buy is sent again.
    await stores.setPriceRules(shop.owner, store.id, { aRule: "PERCENT", aValue: "25", pin: PIN });
    expect((await scanShopChanges()).events).toBeGreaterThan(0);
    const sent = await outgoing(shop, { eventType: "variant.changed" });
    const polo = sent.find((e) => e.externalId === navyS)!;
    const data = (polo.payload as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ sku: navyS, grade: "A", shopPrice: 625, isNew: false });
    expect(data).not.toHaveProperty("avgCost");
    expect(data).not.toHaveProperty("retailPrice");
    for (const e of sent) {
      expect(JSON.stringify(e.payload)).not.toMatch(/avgCost|retailPrice/);
    }

    // The ERP's own price list changes: the store's site hears nothing new of it.
    await later();
    await styles.updateStyle(shop.owner, shop.polo.id, { retailPrice: 1550 });
    await scanShopChanges();
    for (const e of await outgoing(shop, { eventType: "variant.changed" })) {
      expect(JSON.stringify(e.payload)).not.toMatch(/avgCost|retailPrice|1550/);
    }
  });

  it("sends variant.changed for a price change, and isNew for a new variant", async () => {
    await styles.updateStyle(shop.owner, shop.polo.id, { retailPrice: 1550 });
    expect((await scanShopChanges()).events).toBe(6);
    const priced = await outgoing(shop, { eventType: "variant.changed" });
    expect(priced.map((e) => e.externalId).sort()).toEqual(
      shop.variants
        .filter((v) => v.styleId === shop.polo.id)
        .map((v) => v.sku)
        .sort(),
    );
    expect((priced[0]!.payload as { data: unknown }).data).toMatchObject({
      styleCode: "EX-PL-001",
      styleName: "Classic Polo",
      retailPrice: 1550,
      avgCost: 500,
      active: true,
      isNew: false,
    });

    // A variant's own price, and switching one off.
    const white = shop.variants.find((v) => v.sku === shop.sku("EX-PL-001", "White", "M"))!;
    await matrix.updateVariant(shop.owner, white.id, { retailPrice: 1600, isActive: false });
    expect((await scanShopChanges()).events).toBe(1);
    expect((await outgoing(shop, { externalId: white.sku }))[1]!.payload).toMatchObject({
      data: { retailPrice: 1600, active: false, isNew: false },
    });

    // A new colour of the Basic Tee: a new variant.
    const navy = await prisma.color.findFirstOrThrow({
      where: { companyId: shop.company.id, name: "Navy" },
    });
    const small = await prisma.size.findFirstOrThrow({
      where: { companyId: shop.company.id, name: "S" },
    });
    await matrix.generateMatrix(shop.owner, shop.tee.id, {
      colorIds: [navy.id],
      sizeIds: [small.id],
    });
    const result = await scanShopChanges();
    const fresh = await prisma.productVariant.findFirstOrThrow({
      where: { styleId: shop.tee.id, colorId: navy.id },
    });
    const events = await outgoing(shop, { externalId: fresh.sku });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      type: "variant.changed",
      data: { sku: fresh.sku, styleCode: "EX-TS-002", color: "Navy", size: "S", isNew: true },
    });
    // The style's change (its matrix) may send its other variant too, never as new.
    expect(result.events).toBeGreaterThanOrEqual(1);
    const others = (await outgoing(shop, { eventType: "variant.changed" })).filter(
      (e) => e.externalId !== fresh.sku && e.receivedAt >= events[0]!.receivedAt,
    );
    expect(others.every((e) => !(e.payload as { data: { isNew: boolean } }).data.isNew)).toBe(true);
  });

  it("sends nothing to a shop that is off, has no webhook address or no key", async () => {
    await reserve(shop, navyS, 1);
    await integrations.setIntegrationActive(shop.owner, shop.integration.id, false);
    expect(await scanShopChanges()).toEqual({ shops: 0, events: 0 });
    // Switched on again: it starts from then, not with what changed while it was off.
    await setPin(shop.owner, { pin: PIN });
    await integrations.setIntegrationActive(shop.owner, shop.integration.id, true, undefined, {
      pin: PIN,
    });
    await later();
    expect((await scanShopChanges()).events).toBe(0);

    await integrations.updateIntegration(shop.owner, shop.integration.id, {
      name: "Extas web shop",
      warehouseId: shop.warehouse.id,
      webhookUrl: "",
      pin: PIN,
    });
    await reserve(shop, navyS, 1);
    expect(await scanShopChanges()).toEqual({ shops: 0, events: 0 });

    // A new address starts from now too.
    await integrations.updateIntegration(shop.owner, shop.integration.id, {
      name: "Extas web shop",
      warehouseId: shop.warehouse.id,
      webhookUrl: "https://shop.example.com/new/webhooks",
      pin: PIN,
    });
    await later();
    expect((await scanShopChanges()).events).toBe(0);

    await integrations.revokeKey(shop.owner, shop.integration.id);
    await reserve(shop, navyS, 1);
    expect(await scanShopChanges()).toEqual({ shops: 0, events: 0 });
    expect(await outgoing(shop)).toHaveLength(0);
  });

  it("starts a shop that was not served for over a day from now", async () => {
    await reserve(shop, navyS, 1);
    const old = new Date(Date.now() - GIVE_UP_AFTER_MS - 60_000);
    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { stockSentTo: old, variantsSentTo: old, webhooksStartedAt: old },
    });
    expect((await scanShopChanges()).events).toBe(0);
    await later();
    await reserve(shop, navyS, 1);
    expect((await scanShopChanges()).events).toBe(1);
  });

  it("runs on the clock, but never on a restore drill copy or a copy on standby", async () => {
    await reserve(shop, navyS, 1);
    const standby = await import("@/modules/backups/standby");
    const drill = vi.spyOn(standby, "onDrill").mockResolvedValueOnce(true);
    expect(await ecommerceWebhookTick()).toBeNull();
    drill.mockRestore();
    const onStandby = vi.spyOn(standby, "onStandby").mockResolvedValueOnce(true);
    expect(await ecommerceWebhookTick()).toBeNull();
    onStandby.mockRestore();
    expect(await outgoing(shop)).toHaveLength(0);
    expect(await ecommerceWebhookTick()).toEqual({ shops: 1, events: 1 });
  });

  it("keeps each company's shops apart", async () => {
    const other = await setupShop("Fabric Apparel");
    await later();
    await reserve(shop, navyS, 1);
    expect(await scanShopChanges()).toEqual({ shops: 2, events: 1 });
    expect(await outgoing(other)).toHaveLength(0);
    // One company cannot read the other's shop.
    await expect(getShop(other.owner, shop.integration.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // ---------------------------------------------------------------------------
  // The job: sending
  // ---------------------------------------------------------------------------

  it("signs and sends the stored body, and marks it delivered", async () => {
    const { sent } = mockShop();
    await reserve(shop, navyS, 2);
    await scanShopChanges();
    expect(await runDueJobs()).toBe(1);
    expect(sent).toHaveLength(1);
    const [one] = sent;
    const [event] = await outgoing(shop);
    expect(one!.url).toBe("https://shop.example.com/erp/webhooks");
    // Connected through the ERP's checking lookup, on a fresh connection.
    expect(one).toMatchObject({ lookup: true, agent: false, connectedTo: "93.184.216.34" });
    expect(JSON.parse(one!.body)).toEqual(event!.payload);
    // What the shop checks: the HMAC of the raw body with the webhook secret, and the time.
    expect(
      signatureMatches(shop.webhookSecret, one!.body, one!.headers["x-extas-signature"]!),
    ).toBe(true);
    expect(signatureMatches("wrong-secret", one!.body, one!.headers["x-extas-signature"]!)).toBe(
      false,
    );
    expect(timestampFresh(one!.headers["x-extas-timestamp"]!)).toBe(true);
    expect(one!.headers).toMatchObject({
      "content-type": "application/json",
      "x-extas-event": "stock.changed",
      "x-extas-delivery": event!.id,
    });
    expect(await outgoing(shop)).toMatchObject([
      { status: "PROCESSED", attempts: 1, responseStatus: 200, error: null },
    ]);
    const integration = await prisma.salesChannelIntegration.findUniqueOrThrow({
      where: { id: shop.integration.id },
    });
    expect(integration.lastSyncedAt).not.toBeNull();
    expect(await prisma.backgroundJob.findFirst()).toMatchObject({ status: "SUCCEEDED" });
  });

  it("tries again later after a 500 or no answer, and is delivered when the shop is back", async () => {
    let answer: "500" | "timeout" | "ok" = "500";
    const { sent } = mockShop(() => {
      if (answer === "500") return new Response("down", { status: 500 });
      if (answer === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
      return ok();
    });
    await reserve(shop, navyS, 1);
    await scanShopChanges();
    expect(await runDueJobs()).toBe(1);
    expect(await outgoing(shop)).toMatchObject([
      { status: "RECEIVED", attempts: 1, responseStatus: 500, error: "The shop answered 500." },
    ]);
    const job = await prisma.backgroundJob.findFirstOrThrow();
    expect(job).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(job.lastError).toContain("The shop answered 500.");
    // Not before the wait.
    expect(await runDueJobs()).toBe(0);

    answer = "timeout";
    expect(await runDueJobs(20, () => new Date(Date.now() + 31_000))).toBe(1);
    expect(await outgoing(shop)).toMatchObject([
      {
        status: "RECEIVED",
        attempts: 2,
        responseStatus: null,
        error: "The shop did not answer within 5 seconds.",
      },
    ]);

    answer = "ok";
    expect(await runDueJobs(20, () => new Date(Date.now() + 120_000))).toBe(1);
    expect(sent).toHaveLength(3);
    expect(await outgoing(shop)).toMatchObject([
      { status: "PROCESSED", attempts: 3, responseStatus: 200, error: null },
    ]);
    // Each try was signed afresh with the same body.
    expect(new Set(sent.map((s) => s.body)).size).toBe(1);
  });

  it("gives up after 24 hours without another try", async () => {
    const { sent } = mockShop();
    await reserve(shop, navyS, 1);
    await scanShopChanges();
    await prisma.webhookEvent.updateMany({
      data: { receivedAt: new Date(Date.now() - GIVE_UP_AFTER_MS - 1000) },
    });
    expect(await runDueJobs()).toBe(1);
    expect(sent).toHaveLength(0);
    const [event] = await outgoing(shop);
    expect(event).toMatchObject({ status: "FAILED", attempts: 0 });
    expect(event!.error).toContain("24 hours");
    expect(await prisma.backgroundJob.findFirst()).toMatchObject({ status: "SUCCEEDED" });
  });

  it("marks it failed on the queue's last try", async () => {
    mockShop(() => new Response("", { status: 503 }));
    await reserve(shop, navyS, 1);
    await scanShopChanges();
    await prisma.backgroundJob.updateMany({ data: { attempts: WEBHOOK_MAX_ATTEMPTS - 1 } });
    expect(await runDueJobs()).toBe(1);
    expect(await outgoing(shop)).toMatchObject([{ status: "FAILED", responseStatus: 503 }]);
    expect(await prisma.backgroundJob.findFirst()).toMatchObject({ status: "FAILED" });
  });

  it("refuses an address that points to a private network, or answers with a redirect", async () => {
    const { sent } = mockShop(
      () => new Response("", { status: 302, headers: { location: "http://10.0.0.1/" } }),
    );
    await reserve(shop, navyS, 1);
    await scanShopChanges();

    // The name now resolves to the server's own network: nothing is sent.
    dns.addresses = ["93.184.216.34", "10.0.0.7"];
    await runDueJobs();
    expect(sent).toHaveLength(0);
    expect((await outgoing(shop))[0]).toMatchObject({
      status: "RECEIVED",
      attempts: 1,
      error: "The shop's webhook address points to a private network.",
    });

    // An address saved before the rules, or changed in the database: checked at send time.
    for (const address of [
      "https://127.0.0.1/hook",
      "https://[::1]/hook",
      "http://shop.example.com/hook",
      "https://intranet/hook",
    ]) {
      await prisma.salesChannelIntegration.update({
        where: { id: shop.integration.id },
        // A paused shop would not try at all: each address is tried here.
        data: { webhookUrl: address, webhooksPausedUntil: null },
      });
      await prisma.backgroundJob.updateMany({ data: { runAfter: new Date(0) } });
      await runDueJobs();
      expect(sent, address).toHaveLength(0);
    }

    // A public address that redirects: the redirect is not followed.
    dns.addresses = ["93.184.216.34"];
    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { webhookUrl: "https://shop.example.com/erp/webhooks", webhooksPausedUntil: null },
    });
    await prisma.backgroundJob.updateMany({ data: { runAfter: new Date(0) } });
    await runDueJobs();
    expect(sent).toHaveLength(1);
    expect((await outgoing(shop))[0]).toMatchObject({
      status: "RECEIVED",
      responseStatus: 302,
      error: "The shop answered with a redirect (302): enter its final address.",
    });
  });

  it("looks the name up once per try and connects to the very address it checked (DNS rebinding)", async () => {
    const { sent } = mockShop();
    const looked = vi.mocked(dnsLookup);
    const usual = looked.getMockImplementation();
    looked.mockClear();
    const event = { id: "rebind-1", type: "ping", raw: "{}" };
    // A name that answers a public address to the first look and the server's own one later.
    let answers = 0;
    dns.addresses = ["93.184.216.34"];
    looked.mockImplementation(((
      _host: string,
      _options: unknown,
      callback: (e: null, found: unknown[]) => void,
    ) => {
      answers += 1;
      const address = answers === 1 ? "93.184.216.34" : "10.0.0.7";
      callback(null, [{ address, family: 4 }]);
    }) as unknown as typeof dnsLookup);
    try {
      const first = await deliver("https://rebind.example.com/hook", "secret", event);
      expect(first).toMatchObject({ ok: true, status: 200 });
      // One look, at the connection, and the connection went to that address.
      expect(looked).toHaveBeenCalledTimes(1);
      expect(sent).toEqual([expect.objectContaining({ connectedTo: "93.184.216.34" })]);

      const second = await deliver("https://rebind.example.com/hook", "secret", event);
      expect(second).toMatchObject({
        ok: false,
        status: null,
        error: "The shop's webhook address points to a private network.",
      });
      expect(sent).toHaveLength(1);
    } finally {
      looked.mockImplementation(usual!);
    }

    // A name that cannot be found is not sent to either.
    looked.mockImplementationOnce(((
      _host: string,
      _options: unknown,
      callback: (e: Error, found: unknown[]) => void,
    ) => callback(new Error("ENOTFOUND"), [])) as unknown as typeof dnsLookup);
    expect(await deliver("https://gone.example.com/hook", "secret", event)).toMatchObject({
      ok: false,
      error: "The shop's webhook address could not be found (DNS).",
    });
    expect(sent).toHaveLength(1);
  });

  it("pauses a shop that does not answer, so an owner's alarm never waits behind it", async () => {
    let answer: "hang" | "ok" = "hang";
    const { sent } = mockShop(() => {
      if (answer === "hang") throw new DOMException("The operation timed out.", "AbortError");
      return ok();
    });
    pushes.sent = [];
    const navyM = shop.sku("EX-PL-001", "Navy", "M");
    await reserve(shop, navyS, 1);
    await reserve(shop, navyM, 1);
    await scanShopChanges();
    // An alarm (a failed backup) queued after the shop's two webhooks.
    await enqueueJob(prisma, {
      kind: "ai.bot.push",
      companyId: shop.company.id,
      payload: { kind: "text", text: "The backup failed.", alarm: true },
    });

    // The first job of the tick is the alarm, before any webhook.
    expect(await runDueJobs(1)).toBe(1);
    expect(pushes.sent).toHaveLength(1);
    expect(sent).toHaveLength(0);

    // One try for the shop: it hangs, the shop is paused, its other webhook is not tried.
    expect(await runDueJobs()).toBe(1);
    expect(sent).toHaveLength(1);
    const paused = (
      await prisma.salesChannelIntegration.findUniqueOrThrow({
        where: { id: shop.integration.id },
      })
    ).webhooksPausedUntil!;
    expect(paused.getTime()).toBeGreaterThan(Date.now() + 20_000);
    const events = await outgoing(shop);
    expect(events.map((e) => e.attempts).sort()).toEqual([0, 1]);
    const waiting = await prisma.backgroundJob.findFirstOrThrow({
      where: { kind: "ecommerce.webhook.send", attempts: 0 },
    });
    expect(waiting.runAfter.getTime()).toBe(paused.getTime());

    // A change while paused waits for the pause too.
    await later();
    await reserve(shop, shop.sku("EX-PL-001", "White", "L"), 1);
    expect((await scanShopChanges()).events).toBe(1);
    expect(await runDueJobs()).toBe(0);

    // A webhook due anyway (queued another way) is put back, its try not counted.
    await prisma.backgroundJob.update({
      where: { id: waiting.id },
      data: { runAfter: new Date(0) },
    });
    expect(await runDueJobs()).toBe(1);
    expect(sent).toHaveLength(1);
    expect(
      await prisma.backgroundJob.findUniqueOrThrow({ where: { id: waiting.id } }),
    ).toMatchObject({ status: "QUEUED", attempts: 0, runAfter: paused });

    // After the wait the shop answers: one try ends the pause and the rest go.
    answer = "ok";
    expect(await runDueJobs(20, () => new Date(Date.now() + 60_000))).toBe(3);
    expect(sent).toHaveLength(4);
    expect((await outgoing(shop)).map((e) => e.status)).toEqual([
      "PROCESSED",
      "PROCESSED",
      "PROCESSED",
    ]);
    expect(
      (
        await prisma.salesChannelIntegration.findUniqueOrThrow({
          where: { id: shop.integration.id },
        })
      ).webhooksPausedUntil,
    ).toBeNull();
  });

  it("skips an event when the shop was switched off, or a newer change of the SKU replaces it", async () => {
    const { sent } = mockShop();
    await reserve(shop, navyS, 1);
    await scanShopChanges();
    await later();
    await reserve(shop, navyS, 1);
    await scanShopChanges();
    expect(await runDueJobs()).toBe(2);
    expect((await outgoing(shop)).map((e) => e.status)).toEqual(["IGNORED", "PROCESSED"]);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ data: { reserved: 2 } });

    await later();
    await reserve(shop, navyS, 1);
    await scanShopChanges();
    await integrations.setIntegrationActive(shop.owner, shop.integration.id, false);
    await runDueJobs();
    const last = (await outgoing(shop)).at(-1)!;
    expect(last).toMatchObject({ status: "IGNORED", error: "The shop is switched off." });
    expect(last.processedAt).not.toBeNull();
    expect(sent).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Send test
  // ---------------------------------------------------------------------------

  it("sends a signed test at once to the shop's address and logs it", async () => {
    const { sent } = mockShop();
    const result = await sendTestEvent(shop.owner, shop.integration.id);
    expect(result).toMatchObject({ ok: true, status: 200, error: null, mock: false });
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]!.body);
    expect(body).toMatchObject({
      type: "ping",
      data: { shop: "Extas web shop", company: "Extas" },
    });
    expect(
      signatureMatches(shop.webhookSecret, sent[0]!.body, sent[0]!.headers["x-extas-signature"]!),
    ).toBe(true);
    expect(sent[0]!.headers["x-extas-event"]).toBe("ping");
    expect(await outgoing(shop)).toMatchObject([
      {
        id: body.id,
        eventType: "ping",
        externalId: null,
        status: "PROCESSED",
        responseStatus: 200,
        attempts: 1,
      },
    ]);
    // Never queued: no job.
    expect(await prisma.backgroundJob.count()).toBe(0);

    mockShop(() => new Response("", { status: 401 }));
    expect(await sendTestEvent(shop.owner, shop.integration.id)).toMatchObject({
      ok: false,
      status: 401,
      error: "The shop answered 401.",
    });
    expect((await outgoing(shop)).at(-1)).toMatchObject({ status: "FAILED", responseStatus: 401 });
  });

  it("checks the test with the built-in mock shop until the shop's address is entered", async () => {
    const { sent } = mockShop();
    await setPin(shop.owner, { pin: PIN });
    await integrations.updateIntegration(shop.owner, shop.integration.id, {
      name: "Extas web shop",
      warehouseId: shop.warehouse.id,
      webhookUrl: "",
      pin: PIN,
    });
    const result = await sendTestEvent(shop.owner, shop.integration.id);
    expect(result).toMatchObject({ ok: true, status: 200, error: null, mock: true });
    expect(sent).toHaveLength(0);
    const [event] = await outgoing(shop);
    expect(event).toMatchObject({ eventType: "ping", status: "PROCESSED" });
    expect(event!.error).toContain("built-in mock shop");

    // The mock checks what a shop must: the signature and the time.
    const raw = JSON.stringify({ id: "x", type: "ping" });
    const good = new Headers(signedHeaders(shop.webhookSecret, raw));
    expect(mockShopReceive(shop.webhookSecret, raw, good)).toEqual({ status: 200, error: null });
    expect(mockShopReceive("another-secret", raw, good).status).toBe(401);
    expect(mockShopReceive(shop.webhookSecret, `${raw} `, good).status).toBe(401);
    const stale = new Headers(
      signedHeaders(shop.webhookSecret, raw, new Date(Date.now() - 6 * 60_000)),
    );
    expect(mockShopReceive(shop.webhookSecret, raw, stale)).toMatchObject({ status: 401 });
  });

  it("sends no test from a restore drill or standby copy, and a good test ends a pause", async () => {
    const { sent } = mockShop();
    const standby = await import("@/modules/backups/standby");
    for (const which of ["onDrill", "onStandby"] as const) {
      const spy = vi.spyOn(standby, which).mockResolvedValue(true);
      await expect(sendTestEvent(shop.owner, shop.integration.id)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("sends nothing to the shop"),
      });
      spy.mockRestore();
    }
    expect(sent).toHaveLength(0);
    expect(await outgoing(shop)).toHaveLength(0);

    // Paused shop: a test the shop answers brings its waiting webhooks forward.
    await reserve(shop, navyS, 1);
    await scanShopChanges();
    const until = new Date(Date.now() + 3_600_000);
    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { webhooksPausedUntil: until },
    });
    await prisma.backgroundJob.updateMany({ data: { runAfter: until } });
    expect(await sendTestEvent(shop.owner, shop.integration.id)).toMatchObject({ ok: true });
    expect(await runDueJobs()).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it("asks for a key before a test, and lets only shop managers send one", async () => {
    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { webhookSecretRef: null },
    });
    await expect(sendTestEvent(shop.owner, shop.integration.id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("rotate its key"),
    });
    await integrations.revokeKey(shop.owner, shop.integration.id);
    await expect(sendTestEvent(shop.owner, shop.integration.id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Generate the shop's key first"),
    });
    await expect(sendTestEvent(shop.accounts, shop.integration.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  // ---------------------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------------------

  it("clears old call logs, kept answers and delivered webhooks; failed webhooks stay", async () => {
    const day = 24 * 60 * 60_000;
    const ago = (days: number) => new Date(Date.now() - days * day);
    const base = { companyId: shop.company.id, integrationId: shop.integration.id };
    await prisma.integrationApiCall.createMany({
      data: [
        {
          ...base,
          method: "GET",
          path: "/api/v1/ecommerce/stock",
          status: 200,
          createdAt: ago(91),
        },
        {
          ...base,
          method: "GET",
          path: "/api/v1/ecommerce/stock",
          status: 200,
          createdAt: ago(89),
        },
      ],
    });
    await prisma.integrationIdempotency.createMany({
      data: [
        {
          ...base,
          key: "old",
          method: "POST",
          path: "/x",
          requestHash: "h",
          status: 201,
          createdAt: ago(31),
          completedAt: ago(31),
        },
        {
          ...base,
          key: "new",
          method: "POST",
          path: "/x",
          requestHash: "h",
          status: 201,
          createdAt: ago(29),
          completedAt: ago(29),
        },
        {
          ...base,
          key: "cut-off",
          method: "POST",
          path: "/x",
          requestHash: "h",
          createdAt: ago(31),
        },
      ],
    });
    const hook = (
      status: "PROCESSED" | "IGNORED" | "FAILED" | "RECEIVED",
      days: number,
      direction: "OUTGOING" | "INCOMING" = "OUTGOING",
    ) => ({
      ...base,
      source: "ECOMMERCE" as const,
      direction,
      eventType: "stock.changed",
      payload: {},
      status,
      receivedAt: ago(days),
      processedAt: status === "RECEIVED" ? null : ago(days),
    });
    await prisma.webhookEvent.createMany({
      data: [
        hook("PROCESSED", 91),
        hook("IGNORED", 91),
        hook("FAILED", 91),
        hook("PROCESSED", 89),
        hook("PROCESSED", 91, "INCOMING"),
      ],
    });
    expect(await purgeShopLogs()).toBe(5);
    expect(await prisma.integrationApiCall.count()).toBe(1);
    expect((await prisma.integrationIdempotency.findMany()).map((r) => r.key)).toEqual(["new"]);
    const left = await prisma.webhookEvent.findMany({ orderBy: { receivedAt: "asc" } });
    expect(left.map((e) => `${e.direction} ${e.status}`).sort()).toEqual([
      "INCOMING PROCESSED",
      "OUTGOING FAILED",
      "OUTGOING PROCESSED",
    ]);
    // Part of the nightly housekeeping; nothing more the second time.
    expect((await runHousekeeping()).shopLogsCleared).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // The services behind Settings > Integrations > E-commerce
  // ---------------------------------------------------------------------------

  it("shows the shops and one shop's page only to whoever manages online shops, never a key", async () => {
    await expect(listShops(shop.accounts)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getShop(shop.accounts, shop.integration.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const list = await listShops(shop.owner);
    expect(list).toMatchObject({
      companyName: "Extas",
      apiAddress: expect.stringMatching(/\/api\/v1\/ecommerce$/),
      warehouses: [{ id: shop.warehouse.id }],
      shops: [{ name: "Extas web shop", hasKey: true, isActive: true, failedThisWeek: 0 }],
    });
    const page = await getShop(shop.owner, shop.integration.id);
    const integration = await prisma.salesChannelIntegration.findUniqueOrThrow({
      where: { id: shop.integration.id },
    });
    const shown = JSON.stringify([list, page]);
    expect(shown).not.toContain(integration.apiKeyRef!);
    expect(shown).not.toContain(integration.webhookSecretRef!);
    expect(shown).not.toContain(shop.apiKey);
    expect(shown).not.toContain(shop.webhookSecret);
    expect(page.shop).toMatchObject({ hasKey: true, apiKeyHint: integration.apiKeyHint });
  });

  it("filters the webhook log by status and shows the latest API calls", async () => {
    mockShop(() => new Response("", { status: 500 }));
    await sendTestEvent(shop.owner, shop.integration.id);
    mockShop();
    await sendTestEvent(shop.owner, shop.integration.id);
    await prisma.integrationApiCall.create({
      data: {
        companyId: shop.company.id,
        integrationId: shop.integration.id,
        method: "POST",
        path: "/api/v1/ecommerce/orders",
        status: 409,
        errorCode: "INSUFFICIENT_STOCK",
      },
    });
    const all = await getShop(shop.owner, shop.integration.id);
    expect(all.filter).toBe("ALL");
    expect(all.webhooks.map((w) => w.status)).toEqual(["PROCESSED", "FAILED"]);
    expect(all.calls).toMatchObject([
      { method: "POST", status: 409, errorCode: "INSUFFICIENT_STOCK" },
    ]);
    const failed = await getShop(shop.owner, shop.integration.id, { status: "FAILED" });
    expect(failed.webhooks.map((w) => w.status)).toEqual(["FAILED"]);
    // Anything else shows everything.
    expect((await getShop(shop.owner, shop.integration.id, { status: "nonsense" })).filter).toBe(
      "ALL",
    );
  });

  it("makes a key only with the PIN, shows it once, and a rotated key replaces the old one", async () => {
    await setPin(shop.owner, { pin: PIN });
    await expect(
      integrations.generateKey(shop.owner, shop.integration.id, {}),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { pin: expect.any(Array) } });
    await expect(
      integrations.generateKey(shop.owner, shop.integration.id, { pin: "0000" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      integrations.generateKey(shop.accounts, shop.integration.id, { pin: "4826" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const made = await integrations.generateKey(shop.owner, shop.integration.id, { pin: "4826" });
    expect(made.apiKey).toMatch(/^extas_sk_/);
    expect(made.webhookSecret).toMatch(/^extas_whsec_/);
    const page = await getShop(shop.owner, shop.integration.id);
    expect(JSON.stringify(page)).not.toContain(made.apiKey);
    expect(JSON.stringify(page)).not.toContain(made.webhookSecret);
    expect(page.shop.apiKeyHint).toBe(made.hint);
    // The test is now signed with the new secret.
    const { sent } = mockShop();
    await sendTestEvent(shop.owner, shop.integration.id);
    expect(
      signatureMatches(made.webhookSecret, sent[0]!.body, sent[0]!.headers["x-extas-signature"]!),
    ).toBe(true);
    expect(
      signatureMatches(shop.webhookSecret, sent[0]!.body, sent[0]!.headers["x-extas-signature"]!),
    ).toBe(false);
  });

  it("asks for the PIN for a new webhook URL or an address taken off the IP allow-list", async () => {
    await setPin(shop.owner, { pin: PIN });
    const base = {
      name: "Extas web shop",
      warehouseId: shop.warehouse.id,
      webhookUrl: "https://shop.example.com/erp/webhooks",
    };
    const edit = (changes: Record<string, unknown>) =>
      integrations.updateIntegration(shop.owner, shop.integration.id, { ...base, ...changes });
    const saved = () =>
      prisma.salesChannelIntegration.findUniqueOrThrow({ where: { id: shop.integration.id } });

    // Nothing that needs it: name and rate limit change without a PIN.
    await edit({ name: "Extas online", rateLimitPerMinute: 60 });
    expect(await saved()).toMatchObject({ name: "Extas online", rateLimitPerMinute: 60 });

    // A new webhook URL: refused without the PIN or with a wrong one, nothing changed.
    const moved = { webhookUrl: "https://shop.example.com/v2/webhooks" };
    await expect(edit(moved)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Give your PIN to change the shop's webhook URL.",
      details: { pin: expect.any(Array) },
    });
    await expect(edit({ ...moved, pin: "0000" })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { pin: ["The PIN is not right"] },
    });
    expect((await saved()).webhookUrl).toBe(base.webhookUrl);
    await edit({ ...moved, pin: PIN });
    expect((await saved()).webhookUrl).toBe(moved.webhookUrl);
    // Clearing it is a change too.
    await expect(edit({ webhookUrl: "" })).rejects.toMatchObject({
      details: { pin: expect.any(Array) },
    });

    // Starting a list narrows who may call: no PIN.
    await edit({ ...moved, ipAllowList: ["203.0.113.7"] });
    expect((await saved()).ipAllowList).toEqual(["203.0.113.7"]);

    // Adding an address to a list, emptying it or swapping one lets more call: PIN.
    const widen = "Give your PIN to let more addresses call the shop's API.";
    for (const ipAllowList of [["203.0.113.7", "198.51.100.4"], [], ["198.51.100.9"]]) {
      await expect(edit({ ...moved, ipAllowList })).rejects.toMatchObject({
        code: "VALIDATION",
        message: widen,
      });
    }
    expect((await saved()).ipAllowList).toEqual(["203.0.113.7"]);
    await edit({ ...moved, ipAllowList: ["203.0.113.7", "2001:DB8::1", "198.51.100.4"], pin: PIN });
    // Saved written one way.
    expect((await saved()).ipAllowList).toEqual(["203.0.113.7", "2001:db8::1", "198.51.100.4"]);
    // The same address written another way is not a new one.
    await edit({ ...moved, ipAllowList: ["::ffff:203.0.113.7", "2001:db8:0::1", "198.51.100.4"] });

    // Taking addresses off while one stays narrows it: no PIN.
    await edit({ ...moved, ipAllowList: ["198.51.100.4"] });
    expect((await saved()).ipAllowList).toEqual(["198.51.100.4"]);

    // With no PIN set yet, the answer says to set one first.
    await prisma.aiSettings.updateMany({ data: { pinHash: null } });
    await expect(
      edit({ webhookUrl: "https://shop.example.com/v3/webhooks" }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { pinNotSet: expect.any(Array) } });
  });

  it("asks for the PIN to add a shop with a webhook URL, not for one without", async () => {
    await setPin(shop.owner, { pin: PIN });
    const base = { name: "Second shop", warehouseId: shop.warehouse.id };
    const withUrl = { ...base, webhookUrl: "https://second.example.com/hooks" };
    await expect(integrations.createIntegration(shop.owner, withUrl)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Give your PIN to add a shop with a webhook URL.",
      details: { pin: expect.any(Array) },
    });
    await expect(
      integrations.createIntegration(shop.owner, { ...withUrl, pin: "0000" }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { pin: ["The PIN is not right"] } });
    expect(await prisma.salesChannelIntegration.count()).toBe(1);
    const made = await integrations.createIntegration(shop.owner, { ...withUrl, pin: PIN });
    expect(made.webhookUrl).toBe(withUrl.webhookUrl);
    // No URL, an allow-list only (it narrows who may call): no PIN.
    const plain = await integrations.createIntegration(shop.owner, {
      ...base,
      name: "Third shop",
      ipAllowList: ["::FFFF:203.0.113.7"],
    });
    expect(plain.ipAllowList).toEqual(["203.0.113.7"]);
    // Server code that already checked it (the demo's sample shop) passes the proof.
    await integrations.createIntegration(
      shop.owner,
      { ...withUrl, name: "Sample shop" },
      undefined,
      PIN_CHECKED,
    );
  });
});
