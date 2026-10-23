import { createHash } from "node:crypto";

import { Prisma, type Company, type SalesChannelIntegration } from "@prisma/client";
import { NextResponse } from "next/server";

import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientAddress, type RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";

import { EcommerceApiError, toApiError } from "./errors";
import { apiKeyRef } from "./keys";
import { shopContext } from "./shop-account";
import { SIGNATURE_HEADER, signatureMatches, TIMESTAMP_HEADER, timestampFresh } from "./signature";

/*
 * The wrapper every e-commerce API route runs in (CN-005, /api/v1/ecommerce).
 * In order:
 *   1. HTTPS only: a request the proxy says came over plain http is refused.
 *   2. The key: `Authorization: Bearer <key>`, looked up by its SHA-256. The
 *      integration it belongs to names the company; a body never does. Wrong
 *      keys from one address are slowed down (20 a minute).
 *   3. The integration's IP allow-list, when it has one, and its rate limit
 *      (requests a minute, 429 with Retry-After above it).
 *   4. The signature: a request with a body (POST, PATCH) carries
 *      X-Extas-Signature and X-Extas-Timestamp (signature.ts); a GET may.
 *   5. Idempotency-Key, required on every POST (and kept when a PATCH sends
 *      one): the first answer is kept, a repeat with the same request gets it
 *      back (with Idempotent-Replayed: true), the same key with another request
 *      is refused, and one still running answers 409 IDEMPOTENCY_IN_PROGRESS.
 *   6. The handler, in the integration's own context (shop-account.ts).
 *   7. Every call that names a valid key is written to the call log
 *      (IntegrationApiCall): method, path, status, error code, address, time.
 * Answers are plain JSON; errors are { error: { code, message, details } }.
 */

/** A body larger than this is refused: orders and returns are a few kilobytes. */
const MAX_BODY_BYTES = 512 * 1024;
/** Wrong keys tried from one address in a minute before it has to wait. */
const BAD_KEYS_PER_MINUTE = 20;
/** A first request still "running" this long after it started was cut off: it may be tried again. */
const ABANDONED_AFTER_MS = 2 * 60_000;
/** lastSyncedAt is written at most this often, not on every call. */
const SYNC_MARK_EVERY_MS = 60_000;

const BODY_METHODS = new Set(["POST", "PATCH", "PUT"]);

export type ShopIntegration = SalesChannelIntegration & { company: Company };

export type ShopCall = {
  integration: ShopIntegration;
  /** The integration's company, its account and SHOP_PERMISSIONS (shop-account.ts). */
  ctx: CompanyContext;
  request: Request;
  /** The body as JSON ({} when empty). */
  body: unknown;
  query: URLSearchParams;
  meta: RequestMeta;
};

/** An answer with its own status (the default is the route's successStatus). */
export class ShopResponse {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

type RouteContext<P> = { params: Promise<P> };

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers });

const fail = (status: number, code: string, message: string, details?: unknown) =>
  new EcommerceApiError(status, code, message, details);

/** A 429: the wrapper adds Retry-After to it. */
class TooMany extends EcommerceApiError {
  constructor(message: string) {
    super(429, "RATE_LIMITED", message);
  }
}

/** The integration a key belongs to, or a 401 (a 429 after too many wrong keys). */
async function authenticate(request: Request, address: string | undefined) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  const integration = match
    ? await prisma.salesChannelIntegration.findUnique({
        where: { apiKeyRef: apiKeyRef(match[1]!) },
        include: { company: true },
      })
    : null;
  if (
    !integration ||
    !integration.isActive ||
    integration.apiKeyRevokedAt ||
    !integration.company.isActive
  ) {
    try {
      checkRateLimit(`ecommerce-bad-key:${address ?? "unknown"}`, BAD_KEYS_PER_MINUTE, 60_000);
    } catch (error) {
      if (error instanceof AppError && error.code === "RATE_LIMITED") {
        throw new TooMany("Too many wrong keys from this address: wait a minute and try again.");
      }
      throw error;
    }
    throw fail(
      401,
      "UNAUTHENTICATED",
      match
        ? "This API key is not valid: it is wrong, revoked or its shop is switched off."
        : "Send the API key as Authorization: Bearer <key>.",
    );
  }
  return integration;
}

function checkSignature(request: Request, integration: ShopIntegration, rawBody: string) {
  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const needed = BODY_METHODS.has(request.method);
  if (!needed && !signature && !timestamp) return;
  if (!integration.webhookSecretRef) {
    throw fail(
      409,
      "NO_SECRET",
      "This integration has no signing secret yet: generate a key in the ERP.",
    );
  }
  if (!timestampFresh(timestamp)) {
    throw fail(
      401,
      "STALE_TIMESTAMP",
      "X-Extas-Timestamp must be the current time in Unix seconds (at most 5 minutes off).",
    );
  }
  if (!signatureMatches(decryptSecret(integration.webhookSecretRef), rawBody, signature)) {
    throw fail(
      401,
      "BAD_SIGNATURE",
      "X-Extas-Signature does not match the body: sign the raw body with HMAC-SHA256 and the webhook secret (sha256=<hex>).",
    );
  }
}

function parseBody(rawBody: string): unknown {
  if (!rawBody.trim()) return {};
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw fail(422, "VALIDATION", "The body must be valid JSON.");
  }
}

type Started = { id: string } | { replay: { status: number; body: unknown } };

/** Claims an Idempotency-Key for this request, or finds the answer it already had. */
async function claimKey(
  integration: ShopIntegration,
  key: string,
  method: string,
  path: string,
  requestHash: string,
  retried = false,
): Promise<Started> {
  try {
    const row = await prisma.integrationIdempotency.create({
      data: {
        companyId: integration.companyId,
        integrationId: integration.id,
        key,
        method,
        path,
        requestHash,
      },
      select: { id: true },
    });
    return row;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }
  const first = await prisma.integrationIdempotency.findUnique({
    where: { integrationId_key: { integrationId: integration.id, key } },
  });
  if (!first) {
    if (retried) throw fail(409, "IDEMPOTENCY_IN_PROGRESS", "Try again in a moment.");
    return claimKey(integration, key, method, path, requestHash, true);
  }
  if (first.requestHash !== requestHash) {
    throw fail(
      422,
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was used for another request: use a new key for a new request.",
    );
  }
  if (first.status !== null) return { replay: { status: first.status, body: first.response } };
  if (!retried && Date.now() - first.createdAt.getTime() > ABANDONED_AFTER_MS) {
    // The first try was cut off before it answered: it may run again.
    await prisma.integrationIdempotency.deleteMany({ where: { id: first.id, status: null } });
    return claimKey(integration, key, method, path, requestHash, true);
  }
  throw fail(
    409,
    "IDEMPOTENCY_IN_PROGRESS",
    "A request with this Idempotency-Key is still running: wait for its answer, then repeat it.",
  );
}

/** Keeps the first answer for its key; a server error frees the key to be tried again. */
async function settleKey(id: string, status: number, body: unknown) {
  if (status >= 500) {
    await prisma.integrationIdempotency.deleteMany({ where: { id } });
    return;
  }
  await prisma.integrationIdempotency.update({
    where: { id },
    data: { status, response: body as Prisma.InputJsonValue, completedAt: new Date() },
  });
}

async function logCall(
  integration: ShopIntegration,
  request: Request,
  row: { status: number; errorCode?: string; idempotencyKey?: string | null; address?: string },
  started: number,
) {
  try {
    const now = new Date();
    await prisma.integrationApiCall.create({
      data: {
        companyId: integration.companyId,
        integrationId: integration.id,
        method: request.method,
        path: new URL(request.url).pathname.slice(0, 300),
        status: row.status,
        errorCode: row.errorCode ?? null,
        idempotencyKey: row.idempotencyKey?.slice(0, 200) ?? null,
        ipAddress: row.address ?? null,
        durationMs: Date.now() - started,
      },
    });
    if (
      row.status < 400 &&
      (!integration.lastSyncedAt ||
        now.getTime() - integration.lastSyncedAt.getTime() > SYNC_MARK_EVERY_MS)
    ) {
      await prisma.salesChannelIntegration.update({
        where: { id: integration.id },
        data: { lastSyncedAt: now },
      });
    }
  } catch (error) {
    // The log never stops the answer.
    console.error("[ecommerce] could not log a call", error);
  }
}

/**
 * Wraps an e-commerce API route handler. It returns the answer's body (or a
 * ShopResponse with its own status); anything it throws becomes the contract's
 * error shape with the right status.
 */
export function ecommerceRoute<P = Record<string, never>>(
  handler: (call: ShopCall, params: P) => Promise<unknown>,
  options: { successStatus?: number } = {},
) {
  return async (request: Request, context: RouteContext<P>): Promise<NextResponse> => {
    const started = Date.now();
    const address = clientAddress(request.headers);
    let integration: ShopIntegration | null = null;
    let idempotencyKey: string | null = null;
    let claimed: string | null = null;
    let status = 500;
    let body: unknown;
    let errorCode: string | undefined;
    let headers: Record<string, string> | undefined;
    let replayed = false;
    try {
      if (request.headers.get("x-forwarded-proto")?.toLowerCase() === "http") {
        throw fail(403, "HTTPS_REQUIRED", "Call the API over https://.");
      }
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
        throw fail(413, "TOO_LARGE", "The body is larger than 512 KB.");
      }
      integration = await authenticate(request, address);
      if (
        integration.ipAllowList.length > 0 &&
        !(address && integration.ipAllowList.includes(address))
      ) {
        throw fail(403, "IP_NOT_ALLOWED", "This address is not on the integration's allow-list.");
      }
      try {
        checkRateLimit(`ecommerce:${integration.id}`, integration.rateLimitPerMinute, 60_000);
      } catch (error) {
        if (error instanceof AppError && error.code === "RATE_LIMITED") {
          throw new TooMany(
            `At most ${integration.rateLimitPerMinute} requests a minute: wait and try again.`,
          );
        }
        throw error;
      }
      checkSignature(request, integration, rawBody);
      const parsed = parseBody(rawBody);

      const path = new URL(request.url).pathname;
      idempotencyKey = request.headers.get("idempotency-key");
      if (request.method === "POST" && !idempotencyKey) {
        throw fail(
          400,
          "IDEMPOTENCY_KEY_REQUIRED",
          "Send an Idempotency-Key header with every POST.",
        );
      }
      if (idempotencyKey !== null) {
        if (!/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) {
          throw fail(
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Idempotency-Key must be 1 to 200 visible characters (a UUID is ideal).",
          );
        }
        const requestHash = createHash("sha256")
          .update(`${request.method}\n${path}\n${rawBody}`)
          .digest("hex");
        const start = await claimKey(
          integration,
          idempotencyKey,
          request.method,
          path,
          requestHash,
        );
        if ("replay" in start) {
          status = start.replay.status;
          body = start.replay.body;
          headers = { "Idempotent-Replayed": "true" };
          replayed = true;
          errorCode = (body as { error?: { code?: string } } | null)?.error?.code;
        } else {
          claimed = start.id;
        }
      }
      // A repeat gets the first answer again: nothing runs twice.
      if (!replayed) {
        const ctx = await shopContext(integration, integration.company);
        const result = await handler(
          {
            integration,
            ctx,
            request,
            body: parsed,
            query: new URL(request.url).searchParams,
            meta: { ipAddress: address, userAgent: request.headers.get("user-agent") ?? undefined },
          },
          await context.params,
        );
        if (result instanceof ShopResponse) {
          status = result.status;
          body = result.body;
        } else {
          status = options.successStatus ?? 200;
          body = result;
        }
      }
    } catch (error) {
      const answer = toApiError(error);
      status = answer.status;
      body = answer.body;
      errorCode = answer.body.error.code;
      if (error instanceof TooMany) headers = { "Retry-After": "60" };
      if (status >= 500 && !(error instanceof EcommerceApiError)) {
        noteUnexpected(error, request, integration?.companyId);
      }
    }
    if (claimed) {
      try {
        await settleKey(claimed, status, body);
      } catch (error) {
        console.error("[ecommerce] could not keep an idempotent answer", error);
      }
    }
    if (integration) {
      await logCall(integration, request, { status, errorCode, idempotencyKey, address }, started);
    }
    return json(status, body ?? {}, headers);
  };
}

/** Keeps an unexpected error for Bug Guard: the route and the error, never the request's data. */
function noteUnexpected(error: unknown, request: Request, companyId: string | undefined) {
  void import("@/modules/bug-guard/server-errors")
    .then(({ recordServerError }) =>
      recordServerError({
        error,
        routeType: "api",
        method: request.method,
        path: new URL(request.url).pathname,
        cookie: null,
        companyId,
      }),
    )
    .catch(() => undefined);
}
