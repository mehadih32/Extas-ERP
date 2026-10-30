import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import { type BackgroundJob, Prisma, type SalesChannelIntegration } from "@prisma/client";

import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { assertMayWrite } from "@/lib/read-only";
import type { CompanyContext } from "@/modules/auth/context";
import { DeferJob, enqueueJobs, retryDelayMs } from "@/modules/jobs/queue";

import { catalogVariantOf, stockRowOf } from "./catalog.service";
import { assertCanManageShops, privateAddress } from "./integration.service";
import type { CatalogVariant, StockRow } from "./schemas";
import {
  SIGNATURE_HEADER,
  signatureMatches,
  signedHeaders,
  TIMESTAMP_HEADER,
  timestampFresh,
} from "./signature";

/*
 * ERP -> shop webhooks (CN-005). Every minute (webhook-clock.ts) each online
 * shop that is on, has a key and a webhook address gets what changed since the
 * last pass:
 *   - stock.changed: an A-grade stock row of the shop's warehouse changed
 *     (pieces in or out, a reservation made or released), with onHand,
 *     reserved and available;
 *   - variant.changed: a variant or its style changed (price, active, a new
 *     variant: isNew), as GET /catalog/variants shows it.
 * One WebhookEvent per SKU per pass, holding the exact body that is sent, and
 * a background job that sends it, signed like the API (signature.ts), retried
 * by the queue (30 s, 1 min, 2 min... then hourly) until 24 hours have gone.
 * After that the event is FAILED: the shop's own polling with updatedSince
 * catches up, so a missed webhook never leaves its stock wrong.
 *
 * The place each shop has reached is kept on the integration (stockSentTo,
 * variantsSentTo). A pass reads from a few minutes before it, so a change
 * saved late (a transaction that started before the last pass and finished
 * after it, or two changes in the same millisecond) is not lost; anything the
 * shop was already sent unchanged is left out, so nothing goes twice. Never
 * from before webhooksStartedAt: a shop that is new (or got a new address, was
 * switched on again, got its first key) hears only of changes from then on.
 */

export const WEBHOOK_JOB = "ecommerce.webhook.send" as const;
/** An event not delivered within this time is given up (the shop polls instead). */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;
/**
 * How long the shop has to answer one try. Short, because the background
 * queue runs one job at a time; a shop that does not answer is also paused
 * (webhooksPausedUntil) so only one of its webhooks waits for it per retry.
 */
export const SEND_TIMEOUT_MS = 5_000;
/**
 * Tries for each event: the queue's waits (30 s doubling, then an hour each,
 * jobs/queue.ts) add up to just over 24 hours by the 31st try.
 */
export const WEBHOOK_MAX_ATTEMPTS = 32;
/** Each pass reads this far back before the shop's place, for changes saved late. */
const OVERLAP_MS = 5 * 60_000;
/** Events are written this many at a time. */
const CHUNK = 500;

export const EVENT_TYPES = ["stock.changed", "variant.changed", "summary.missing", "ping"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** What the shop receives: the body of every webhook. */
export type WebhookBody<T = unknown> = { id: string; type: EventType; createdAt: string; data: T };

/** variant.changed's data: the variant as the catalog shows it, and whether it is new. */
export type VariantChanged = CatalogVariant & { isNew: boolean };

// ---------------------------------------------------------------------------
// What is sent
// ---------------------------------------------------------------------------

/** The same JSON whatever the order of its keys (the database keeps them in its own order). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** What is compared to tell whether the shop already has a change (isNew aside). */
const comparable = (data: unknown) => {
  if (!data || typeof data !== "object") return canonical(data);
  return canonical({ ...(data as Record<string, unknown>), isNew: undefined });
};

// ---------------------------------------------------------------------------
// The pass: what changed for each shop
// ---------------------------------------------------------------------------

type Shop = SalesChannelIntegration;
type Planned = {
  type: "stock.changed" | "variant.changed";
  sku: string;
  data: StockRow | VariantChanged;
};

/** A cursor that is still usable: set, not in the future, at most a day old. */
const usable = (cursor: Date | null, now: Date) =>
  cursor !== null &&
  cursor.getTime() <= now.getTime() &&
  now.getTime() - cursor.getTime() <= GIVE_UP_AFTER_MS;

/** The latest event the shop was given for each SKU since `since` (to leave out repeats). */
async function lastSent(shop: Shop, type: Planned["type"], skus: string[], since: Date) {
  const sent = new Map<string, string>();
  for (let i = 0; i < skus.length; i += CHUNK) {
    const rows = await prisma.webhookEvent.findMany({
      where: {
        integrationId: shop.id,
        direction: "OUTGOING",
        eventType: type,
        externalId: { in: skus.slice(i, i + CHUNK) },
        // A minute more, for the app's and the database's clocks.
        receivedAt: { gte: new Date(since.getTime() - 60_000) },
      },
      orderBy: { receivedAt: "asc" },
      select: { externalId: true, payload: true },
    });
    for (const row of rows) {
      sent.set(row.externalId!, comparable((row.payload as { data?: unknown } | null)?.data));
    }
  }
  return sent;
}

async function stockChanges(shop: Shop, since: Date, now: Date): Promise<Planned[]> {
  if (!shop.warehouseId) return [];
  const balances = await prisma.stockBalance.findMany({
    where: {
      companyId: shop.companyId,
      warehouseId: shop.warehouseId,
      grade: "A_GRADE",
      updatedAt: { gt: since, lte: now },
      warehouse: { deletedAt: null },
    },
    include: {
      variant: { select: { sku: true } },
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "asc" },
  });
  const rows = balances.map(stockRowOf);
  const sent = await lastSent(
    shop,
    "stock.changed",
    rows.map((r) => r.sku),
    since,
  );
  return rows
    .filter((row) => sent.get(row.sku) !== comparable(row))
    .map((row) => ({ type: "stock.changed" as const, sku: row.sku, data: row }));
}

async function variantChanges(shop: Shop, since: Date, now: Date): Promise<Planned[]> {
  const window = { gt: since, lte: now };
  const variants = await prisma.productVariant.findMany({
    where: {
      companyId: shop.companyId,
      OR: [{ updatedAt: window }, { style: { updatedAt: window } }],
    },
    include: { style: true, color: true, size: true },
    orderBy: { updatedAt: "asc" },
  });
  const rows = variants.map((variant) => ({ variant, row: catalogVariantOf(variant) }));
  const sent = await lastSent(
    shop,
    "variant.changed",
    rows.map((r) => r.row.sku),
    since,
  );
  const changed = rows.filter(({ row }) => sent.get(row.sku) !== comparable(row));
  // New: made since the last pass, and never sent to this shop before.
  const candidates = changed
    .filter(({ variant }) => variant.createdAt > since)
    .map((r) => r.row.sku);
  const known = new Set(
    candidates.length
      ? (
          await prisma.webhookEvent.findMany({
            where: {
              integrationId: shop.id,
              direction: "OUTGOING",
              eventType: "variant.changed",
              externalId: { in: candidates },
            },
            select: { externalId: true },
            distinct: ["externalId"],
          })
        ).map((e) => e.externalId!)
      : [],
  );
  return changed.map(({ variant, row }) => ({
    type: "variant.changed" as const,
    sku: row.sku,
    data: { ...row, isNew: variant.createdAt > since && !known.has(row.sku) },
  }));
}

class PassTaken extends Error {}

/**
 * One shop's pass: the events for what changed since its place, then its place
 * moved to `now`, in one transaction (a second process doing the same pass at
 * the same moment finds the place moved and writes nothing). A shop that has
 * no place yet, or was not served for over a day, starts from now.
 */
export async function scanShop(shop: Shop, now: Date = new Date()): Promise<number> {
  const stockFrom = usable(shop.stockSentTo, now) ? shop.stockSentTo! : null;
  const variantsFrom = usable(shop.variantsSentTo, now) ? shop.variantsSentTo! : null;
  const started = shop.webhooksStartedAt?.getTime() ?? 0;
  const back = (from: Date) => new Date(Math.max(from.getTime() - OVERLAP_MS, started));
  const paused =
    shop.webhooksPausedUntil && shop.webhooksPausedUntil > now ? shop.webhooksPausedUntil : null;
  const planned = [
    ...(stockFrom ? await stockChanges(shop, back(stockFrom), now) : []),
    ...(variantsFrom ? await variantChanges(shop, back(variantsFrom), now) : []),
  ];
  const events = planned.map((p) => {
    const id = randomUUID();
    const body: WebhookBody = { id, type: p.type, createdAt: now.toISOString(), data: p.data };
    return {
      id,
      companyId: shop.companyId,
      source: "ECOMMERCE" as const,
      direction: "OUTGOING" as const,
      integrationId: shop.id,
      eventType: p.type,
      externalId: p.sku,
      payload: body as unknown as Prisma.InputJsonObject,
      receivedAt: now,
    };
  });
  try {
    await prisma.$transaction(
      async (tx) => {
        const moved = await tx.salesChannelIntegration.updateMany({
          where: {
            id: shop.id,
            stockSentTo: shop.stockSentTo,
            variantsSentTo: shop.variantsSentTo,
          },
          data: {
            stockSentTo: now,
            variantsSentTo: now,
            // Started again from now: nothing from before it.
            ...(stockFrom && variantsFrom ? {} : { webhooksStartedAt: now }),
          },
        });
        if (moved.count !== 1) throw new PassTaken();
        for (let i = 0; i < events.length; i += CHUNK) {
          const chunk = events.slice(i, i + CHUNK);
          await tx.webhookEvent.createMany({ data: chunk });
          await enqueueJobs(
            tx,
            chunk.map((event) => ({
              kind: WEBHOOK_JOB,
              companyId: shop.companyId,
              payload: { eventId: event.id },
              maxAttempts: WEBHOOK_MAX_ATTEMPTS,
              // A paused shop's new webhooks wait for the pause too.
              ...(paused ? { runAfter: paused } : {}),
            })),
          );
        }
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    if (error instanceof PassTaken) return 0;
    throw error;
  }
  return events.length;
}

/** Queues one webhook to a shop now (a retail store's summary.missing, plan v6 sec 6). */
export async function queueShopEvent(
  shop: Shop,
  type: "summary.missing",
  data: Prisma.InputJsonObject,
  now: Date = new Date(),
) {
  const id = randomUUID();
  const body: WebhookBody = { id, type, createdAt: now.toISOString(), data };
  const paused =
    shop.webhooksPausedUntil && shop.webhooksPausedUntil > now ? shop.webhooksPausedUntil : null;
  await prisma.$transaction(async (tx) => {
    await tx.webhookEvent.create({
      data: {
        id,
        companyId: shop.companyId,
        source: "ECOMMERCE",
        direction: "OUTGOING",
        integrationId: shop.id,
        eventType: type,
        payload: body as unknown as Prisma.InputJsonObject,
        receivedAt: now,
      },
    });
    await enqueueJobs(tx, [
      {
        kind: WEBHOOK_JOB,
        companyId: shop.companyId,
        payload: { eventId: id },
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
        ...(paused ? { runAfter: paused } : {}),
      },
    ]);
  });
}

/** Every shop that is on, has a key and a webhook address: one pass each. */
export async function scanShopChanges(now: Date = new Date()) {
  const shops = await prisma.salesChannelIntegration.findMany({
    where: {
      isActive: true,
      apiKeyRef: { not: null },
      webhookSecretRef: { not: null },
      webhookUrl: { not: null },
      company: { isActive: true },
    },
    orderBy: { createdAt: "asc" },
  });
  let events = 0;
  for (const shop of shops) {
    try {
      events += await scanShop(shop, now);
    } catch (error) {
      // One shop's trouble never stops the others; the next pass tries again.
      console.error(`[ecommerce] the webhook pass failed for shop ${shop.id}`, error);
    }
  }
  if (events > 0) {
    const { kickJobWorker } = await import("@/modules/jobs/worker");
    kickJobWorker();
  }
  return { shops: shops.length, events };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type Delivery = {
  ok: boolean;
  /** The shop's HTTP status, or null when it was never reached. */
  status: number | null;
  ms: number;
  /** A short plain-English reason when it did not work. */
  error: string | null;
};

const PRIVATE_NETWORK = "The shop's webhook address points to a private network.";
const NOT_FOUND_DNS = "The shop's webhook address could not be found (DNS).";

/**
 * Why an address may not be sent to, or null when it may: https only, no
 * password, and not a private address or name. The addresses a name resolves
 * to are checked when the connection is made (shopLookup), on every try.
 */
export function refuseAddress(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "The shop's webhook address is not a valid address.";
  }
  if (url.protocol !== "https:") return "The shop's webhook address must start with https://.";
  if (url.username || url.password) return "The shop's webhook address may not hold a password.";
  return privateAddress(url.hostname) ? PRIVATE_NETWORK : null;
}

/** A webhook address refused while connecting: its message is the plain reason. */
class AddressRefused extends Error {
  readonly code = "EXTAS_ADDRESS_REFUSED";
}

/**
 * The name lookup a webhook connects with: it resolves the shop's name and
 * refuses it, before anything is connected, when any of its addresses is
 * private. The address checked is the address connected to, so a name that
 * answers a public address to a first look and a private one later (DNS
 * rebinding) never reaches the server's own network.
 */
export const shopLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(
    hostname,
    { family: options.family, hints: options.hints, all: true },
    (error, found) => {
      if (error || !found || found.length === 0) {
        return callback(new AddressRefused(NOT_FOUND_DNS), "", 0);
      }
      if (found.some((f) => privateAddress(f.address))) {
        return callback(new AddressRefused(PRIVATE_NETWORK), "", 0);
      }
      if (options.all) return callback(null, found);
      return callback(null, found[0]!.address, found[0]!.family);
    },
  );
};

/**
 * One POST over https with shopLookup and a connection of its own (never one
 * kept from before): no redirects followed, 5 seconds at most. The answer is
 * the shop's status; its words are not read.
 */
function postToShop(address: string, headers: Record<string, string>, body: string) {
  return new Promise<number>((resolve, reject) => {
    const sending = httpsRequest(
      address,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: shopLookup,
        agent: false,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
      (response) => {
        response.on("error", () => undefined);
        resolve(response.statusCode ?? 0);
        response.destroy();
      },
    );
    sending.on("error", reject);
    sending.end(body);
  });
}

/** The headers of one try: the signature and time (signed now), the event and its id. */
function headersFor(secret: string, raw: string, type: string, id: string) {
  return {
    "Content-Type": "application/json",
    "User-Agent": "Extas-ERP-Webhooks/1",
    "X-Extas-Event": type,
    "X-Extas-Delivery": id,
    ...signedHeaders(secret, raw, new Date()),
  };
}

/** Posts one body to the shop: no redirects followed, 5 seconds at most. */
export async function deliver(
  address: string,
  secret: string,
  event: { id: string; type: string; raw: string },
): Promise<Delivery> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const refused = refuseAddress(address);
  if (refused) return { ok: false, status: null, ms: elapsed(), error: refused };
  try {
    const status = await postToShop(
      address,
      headersFor(secret, event.raw, event.type, event.id),
      event.raw,
    );
    if (status >= 200 && status < 300) return { ok: true, status, ms: elapsed(), error: null };
    const error =
      status >= 300 && status < 400
        ? `The shop answered with a redirect (${status}): enter its final address.`
        : `The shop answered ${status}.`;
    return { ok: false, status, ms: elapsed(), error };
  } catch (error) {
    const failed = error as { name?: string; code?: string; message?: string } | null;
    return {
      ok: false,
      status: null,
      ms: elapsed(),
      error:
        failed?.code === "EXTAS_ADDRESS_REFUSED"
          ? (failed.message ?? PRIVATE_NETWORK)
          : failed?.name === "TimeoutError" || failed?.name === "AbortError"
            ? `The shop did not answer within ${SEND_TIMEOUT_MS / 1000} seconds.`
            : "The shop's webhook address could not be reached.",
    };
  }
}

/** A time as the queue stores it: UTC wall-clock time (jobs/queue.ts). */
const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * After a failed try: the shop's other webhooks waiting in the queue move to
 * `until` (this event's own next try) without a try of their own, so a shop
 * that does not answer costs one timeout per retry, not one per SKU. The first
 * webhook due then is the one try; a delivered one ends the pause.
 */
async function pauseShop(shopId: string, until: Date, eventId: string) {
  await prisma.salesChannelIntegration.update({
    where: { id: shopId },
    data: { webhooksPausedUntil: until },
  });
  await prisma.$executeRaw`
    UPDATE "BackgroundJob" AS j
    SET "runAfter" = ${utc(until)}, "updatedAt" = ${utc(new Date())}
    FROM "WebhookEvent" AS e
    WHERE j."kind" = ${WEBHOOK_JOB}
      AND j."status" = 'QUEUED'
      AND j."runAfter" < ${utc(until)}
      AND j."payload"->>'eventId' = e."id"
      AND e."integrationId" = ${shopId}
      AND e."id" <> ${eventId}`;
}

/** Ends a shop's pause: its webhooks waiting in the queue are due now. */
async function resumeShop(shopId: string, now: Date) {
  await prisma.salesChannelIntegration.update({
    where: { id: shopId },
    data: { webhooksPausedUntil: null },
  });
  await prisma.$executeRaw`
    UPDATE "BackgroundJob" AS j
    SET "runAfter" = ${utc(now)}, "updatedAt" = ${utc(now)}
    FROM "WebhookEvent" AS e
    WHERE j."kind" = ${WEBHOOK_JOB}
      AND j."status" = 'QUEUED'
      AND j."runAfter" > ${utc(now)}
      AND j."payload"->>'eventId' = e."id"
      AND e."integrationId" = ${shopId}`;
}

/** Ends an event without a try (processedAt: when it ended, for the housekeeping). */
async function closeEvent(
  event: { id: string },
  status: "IGNORED" | "FAILED",
  error: string,
  now: Date,
) {
  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status, error, processedAt: now },
  });
}

/**
 * The background job (ecommerce.webhook.send): sends one event. Switched off,
 * no address or no key: IGNORED. Older than 24 hours: FAILED, and stops. A
 * newer change of the same SKU waiting or sent: IGNORED (it has the latest
 * values). Otherwise one try: a 2xx answer is PROCESSED; anything else is
 * counted and thrown, so the queue tries again later.
 */
export async function runWebhookSendJob(job: BackgroundJob) {
  const eventId = (job.payload as { eventId?: unknown } | null)?.eventId;
  if (typeof eventId !== "string") return;
  const event = await prisma.webhookEvent.findUnique({
    where: { id: eventId },
    include: { integration: { include: { company: { select: { isActive: true } } } } },
  });
  if (!event || event.direction !== "OUTGOING" || event.status !== "RECEIVED") return;
  const now = new Date();
  const shop = event.integration;
  if (!shop || !shop.isActive || !shop.company.isActive) {
    return closeEvent(event, "IGNORED", "The shop is switched off.", now);
  }
  if (!shop.webhookUrl) {
    return closeEvent(event, "IGNORED", "The shop has no webhook address.", now);
  }
  if (!shop.apiKeyRef || !shop.webhookSecretRef) {
    return closeEvent(event, "IGNORED", "The shop has no key.", now);
  }
  if (now.getTime() - event.receivedAt.getTime() > GIVE_UP_AFTER_MS) {
    return closeEvent(
      event,
      "FAILED",
      "Not delivered within 24 hours: the shop reads the change when it asks for what changed.",
      now,
    );
  }
  // Paused after a failed try: this one waits for the next try too, not counted.
  // Compared with when the queue took the job (its clock), so it is never taken again at once.
  const taken = job.lockedAt ?? now;
  if (shop.webhooksPausedUntil && shop.webhooksPausedUntil > taken) {
    throw new DeferJob(shop.webhooksPausedUntil);
  }
  if (event.externalId) {
    const newer = await prisma.webhookEvent.count({
      where: {
        integrationId: shop.id,
        direction: "OUTGOING",
        eventType: event.eventType,
        externalId: event.externalId,
        receivedAt: { gt: event.receivedAt },
        status: { in: ["RECEIVED", "PROCESSED"] },
      },
    });
    if (newer > 0) {
      return closeEvent(event, "IGNORED", "A newer change of this SKU replaces it.", now);
    }
  }
  const result = await deliver(shop.webhookUrl, decryptSecret(shop.webhookSecretRef), {
    id: event.id,
    type: event.eventType,
    raw: JSON.stringify(event.payload),
  });
  const tried = { attempts: { increment: 1 }, lastAttemptAt: now, responseStatus: result.status };
  if (result.ok) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { ...tried, status: "PROCESSED", processedAt: now, error: null },
    });
    await prisma.salesChannelIntegration.update({
      where: { id: shop.id },
      data: { lastSyncedAt: now, webhooksPausedUntil: null },
    });
    return;
  }
  await pauseShop(shop.id, new Date(now.getTime() + retryDelayMs(job.attempts)), event.id);
  const lastTry = job.attempts >= job.maxAttempts;
  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: {
      ...tried,
      error: result.error,
      ...(lastTry ? { status: "FAILED" as const, processedAt: now } : {}),
    },
  });
  // The reason only: never the body or the secret.
  throw new Error(`Webhook not delivered: ${result.error}`);
}

// ---------------------------------------------------------------------------
// "Send test" and the built-in mock shop
// ---------------------------------------------------------------------------

/**
 * The ERP's own mock shop: it checks a webhook the way a shop must (the time
 * within 5 minutes, the signature of the raw body with the webhook secret) and
 * answers 200 or 401. "Send test" uses it until the shop's address is entered,
 * so the key and secret can be checked before the shop is built.
 */
export function mockShopReceive(
  secret: string,
  rawBody: string,
  headers: Headers,
): { status: number; error: string | null } {
  if (!timestampFresh(headers.get(TIMESTAMP_HEADER))) {
    return { status: 401, error: "The time on the message is more than 5 minutes off." };
  }
  if (!signatureMatches(secret, rawBody, headers.get(SIGNATURE_HEADER))) {
    return { status: 401, error: "The signature does not match the body." };
  }
  return { status: 200, error: null };
}

export type TestResult = Delivery & {
  /** Checked against the ERP's built-in mock shop (no webhook address yet). */
  mock: boolean;
};

/**
 * "Send test": a signed "ping" sent at once (not queued) to the shop's webhook
 * address, or to the built-in mock shop when it has none, and logged with the
 * other webhooks.
 */
export async function sendTestEvent(ctx: CompanyContext, id: string): Promise<TestResult> {
  assertCanManageShops(ctx);
  // A Full check session on the live site only reads: it sends nothing to a shop either.
  await assertMayWrite();
  // Nor does a restore drill copy or a copy on standby (like the webhook clock).
  const { onDrill, onStandby } = await import("@/modules/backups/standby");
  if ((await onDrill()) || (await onStandby())) {
    throw new AppError(
      "CONFLICT",
      "This is a restore drill or standby copy of the ERP: it sends nothing to the shop.",
    );
  }
  const shop = await ctx.db.salesChannelIntegration.findUnique({ where: { id } });
  if (!shop) throw new AppError("NOT_FOUND", "Online shop not found.");
  if (!shop.apiKeyRef) {
    throw new AppError(
      "CONFLICT",
      "Generate the shop's key first: the test is signed with its webhook secret.",
    );
  }
  if (!shop.webhookSecretRef) {
    throw new AppError(
      "CONFLICT",
      "This shop has no webhook secret yet: rotate its key to make one.",
    );
  }
  const secret = decryptSecret(shop.webhookSecretRef);
  const now = new Date();
  const body: WebhookBody = {
    id: randomUUID(),
    type: "ping",
    createdAt: now.toISOString(),
    data: { message: "A test from Extas ERP", shop: shop.name, company: ctx.company.name },
  };
  const raw = JSON.stringify(body);
  let result: TestResult;
  if (shop.webhookUrl) {
    result = {
      ...(await deliver(shop.webhookUrl, secret, { id: body.id, type: "ping", raw })),
      mock: false,
    };
  } else {
    const started = Date.now();
    const answer = mockShopReceive(
      secret,
      raw,
      new Headers(headersFor(secret, raw, "ping", body.id)),
    );
    result = {
      ok: answer.status === 200,
      status: answer.status,
      ms: Date.now() - started,
      error: answer.error,
      mock: true,
    };
  }
  await ctx.db.webhookEvent.create({
    data: {
      id: body.id,
      companyId: ctx.company.id,
      source: "ECOMMERCE",
      direction: "OUTGOING",
      integrationId: shop.id,
      eventType: "ping",
      payload: body as unknown as Prisma.InputJsonObject,
      status: result.ok ? "PROCESSED" : "FAILED",
      error: result.mock
        ? `Checked by the ERP's built-in mock shop (no webhook address yet)${result.error ? `: ${result.error}` : "."}`
        : result.error,
      attempts: 1,
      lastAttemptAt: now,
      responseStatus: result.status,
      processedAt: now,
    },
  });
  if (result.ok && !result.mock) {
    await ctx.db.salesChannelIntegration.update({
      where: { id: shop.id },
      data: { lastSyncedAt: now },
    });
    // The shop answers again: its paused webhooks go at once.
    if (shop.webhooksPausedUntil && shop.webhooksPausedUntil > now) await resumeShop(shop.id, now);
  }
  return result;
}
