import { Prisma } from "@prisma/client";

import { dateColumn, localDay } from "@/lib/dates";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import { byMark, identifyPartial, type Identification, piecesOf } from "@/modules/retail/partial";
import {
  exchangeDeliveredTx,
  exchangeParcelTx,
  exchangesAtRiskOf,
  exchangeStatus,
  OPEN_STATES,
} from "@/modules/retail/exchanges.service";
import { stageOf } from "@/modules/retail/returns.service";

import { amount } from "./catalog.service";
import { EcommerceApiError } from "./errors";
import { billStoreOrderTx, shopOrderOrNotFound } from "./orders.service";
import type { ShopStore } from "./retail-mode";
import type { ShopCall } from "./route";
import {
  deliveryResultSchema,
  exchangesQuerySchema,
  lateReturnSchema,
  pageQuerySchema,
  returnListSchema,
} from "./schemas";

/*
 * A retail store's returns through the API (plan v6 sec 8, site-changes 2.5).
 * Nothing here changes money: the store keeps owing for every piece until the
 * owner checks it in the ERP (Business > Returns).
 *   PUT /orders/{id}/delivery  the courier's result: which pieces the customer
 *                              kept, from the site's mark or worked out from
 *                              what the courier collected (GREEN, YELLOW, ORANGE).
 *   POST /return-lists         a lot the courier handed back: known parcels'
 *                              pieces go to Return stock, unclear ones on Hold.
 *   GET /returns               every parcel and the owner's decisions since a time.
 */

type Call = Pick<ShopCall, "ctx" | "integration" | "meta">;
type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

async function retailOrderOf(call: Call, externalOrderId: string) {
  const order = await shopOrderOrNotFound(call, externalOrderId);
  const retail = await call.ctx.db.retailOrder.findUnique({
    where: { orderId: order.id },
    include: {
      lines: { include: { replaces: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      parcel: true,
      delivery: true,
      exchange: true,
    },
  });
  if (!retail) {
    throw new EcommerceApiError(
      409,
      "CONFLICT",
      `Order ${externalOrderId} came before the shop was a retail store: it has no delivery result here.`,
    );
  }
  return { order, retail };
}

/** The pieces coming back, as lines and counts. */
const asLines = (returning: string[] | null) => {
  if (!returning) return null;
  const counts = new Map<string, number>();
  for (const lineId of returning) counts.set(lineId, (counts.get(lineId) ?? 0) + 1);
  return [...counts].map(([lineId, quantity]) => ({ lineId, quantity }));
};

/** PUT /orders/{externalOrderId}/delivery */
export async function recordDelivery(call: Call, externalOrderId: string, raw: unknown) {
  const input = deliveryResultSchema.parse(raw);
  const { ctx, meta } = call;
  const { order, retail } = await retailOrderOf(call, externalOrderId);
  if (retail.parcel) {
    throw new EcommerceApiError(
      409,
      "ALREADY_HANDED_BACK",
      `The courier handed this parcel back already: its result can no longer change.`,
    );
  }
  const known = new Set(retail.lines.map((l) => l.lineId));
  const unknown = (input.mark?.keptLines ?? []).filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new EcommerceApiError(
      422,
      "VALIDATION",
      `These lines are not on the order: ${unknown.join(", ")}.`,
      {
        keptLines: unknown,
      },
    );
  }
  if (retail.exchange) return exchangeDelivery(call, order, retail, externalOrderId, input);
  const pieces = piecesOf(
    retail.lines.map((l) => ({
      lineId: l.lineId,
      quantity: l.quantity,
      price: Number(l.customerPrice),
    })),
  );
  const found: Identification =
    input.status === "DELIVERED"
      ? { match: "GREEN", returning: [] }
      : input.status === "RETURNED"
        ? byMark(pieces, [])
        : input.mark
          ? byMark(pieces, input.mark.keptLines)
          : identifyPartial({
              pieces,
              collected: input.collected,
              advance: Number(retail.advancePaid),
            });
  // The returning pieces by the ERP's own line ids.
  const idOf = new Map(retail.lines.map((l) => [l.lineId, l.id]));
  const returning = found.returning?.map((lineId) => idOf.get(lineId)!) ?? [];
  await runTransaction(async (tx) => {
    // An order that reaches a delivery result with no shipment is billed now.
    await billStoreOrderTx(tx, ctx, order.id, meta);
    const data = {
      status: input.status,
      courier: input.courier,
      consignmentId: input.consignmentId,
      collected: input.collected,
      at: new Date(input.at),
      markKept: input.mark ? input.mark.keptLines : Prisma.DbNull,
      discountGiven: input.mark?.discountGiven ?? 0,
      phoneConfirmed: input.mark?.phoneConfirmed ?? false,
      note: input.mark?.note ?? null,
      match: found.match,
      returning,
    };
    await tx.retailDelivery.upsert({
      where: { retailOrderId: retail.id },
      create: { companyId: ctx.company.id, retailOrderId: retail.id, ...data },
      update: data,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RetailDelivery",
        entityId: retail.id,
        summary: `${order.number}: courier result ${input.status.toLowerCase()} (${found.match.toLowerCase()})`,
      },
      tx,
    );
  }, TX_OPTIONS);
  const billed = await ctx.db.retailOrder.findUniqueOrThrow({ where: { id: retail.id } });
  return {
    externalOrderId,
    status: input.status,
    identification: found.match,
    returningLines: asLines(found.returning),
    billedAt: billed.billedAt?.toISOString() ?? null,
  };
}

type RetailOrderOf = Awaited<ReturnType<typeof retailOrderOf>>;

/**
 * An exchange parcel's courier result (site-changes 2.10.3): kept lines start
 * the deadline for their old piece, refused ones cancel the exchange. What the
 * courier collected is the store's own business. Final once sent: the same
 * result again gets the same answer.
 */
async function exchangeDelivery(
  call: Call,
  order: RetailOrderOf["order"],
  retail: RetailOrderOf["retail"],
  externalOrderId: string,
  input: ReturnType<typeof deliveryResultSchema.parse>,
) {
  const { ctx, meta } = call;
  if (input.status === "PARTIAL" && !input.mark) {
    throw new EcommerceApiError(
      422,
      "VALIDATION",
      "An exchange parcel's partial result names the kept lines (mark.keptLines).",
    );
  }
  const keptIds =
    input.status === "DELIVERED"
      ? retail.lines.map((l) => l.lineId)
      : input.status === "RETURNED"
        ? []
        : input.mark!.keptLines;
  const kept = new Set(keptIds);
  const answer = (billedAt: Date | null) => ({
    externalOrderId,
    status: input.status,
    identification: "GREEN" as const,
    returningLines: asLines(
      retail.lines.flatMap((l) =>
        Array.from({ length: l.quantity }, () =>
          kept.has(l.lineId) ? l.replaces!.lineId : l.lineId,
        ),
      ),
    ),
    billedAt: billedAt?.toISOString() ?? null,
  });
  if (retail.delivery) {
    const before = Array.isArray(retail.delivery.markKept)
      ? (retail.delivery.markKept as string[])
      : null;
    const same =
      retail.delivery.status === input.status &&
      JSON.stringify(before ? [...before].sort() : null) ===
        JSON.stringify(input.mark ? [...input.mark.keptLines].sort() : null);
    if (!same) {
      throw new EcommerceApiError(
        409,
        "CONFLICT",
        "The exchange parcel's courier result is in already and does not change.",
      );
    }
    return answer(retail.billedAt);
  }
  const store = await ctx.db.retailStore.findUniqueOrThrow({ where: { id: retail.storeId } });
  await runTransaction(async (tx) => {
    await lockRow(tx, "SalesOrder", order.id);
    await billStoreOrderTx(tx, ctx, order.id, meta);
    const returning = await exchangeDeliveredTx(tx, ctx, {
      exchangeId: retail.exchange!.id,
      lines: retail.lines.map((l) => ({
        id: l.id,
        quantity: l.quantity,
        replacesLineId: l.replacesLineId,
      })),
      kept: new Set(retail.lines.filter((l) => kept.has(l.lineId)).map((l) => l.id)),
      at: new Date(input.at),
      exchangeDays: store.exchangeDays,
    });
    await tx.retailDelivery.create({
      data: {
        companyId: ctx.company.id,
        retailOrderId: retail.id,
        status: input.status,
        courier: input.courier,
        consignmentId: input.consignmentId,
        collected: input.collected,
        at: new Date(input.at),
        markKept: input.mark ? input.mark.keptLines : Prisma.DbNull,
        discountGiven: input.mark?.discountGiven ?? 0,
        phoneConfirmed: input.mark?.phoneConfirmed ?? false,
        note: input.mark?.note ?? null,
        match: "GREEN",
        returning,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RetailDelivery",
        entityId: retail.id,
        summary: `${order.number} (exchange ${retail.exchange!.number}): courier result ${input.status.toLowerCase()}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  const billed = await ctx.db.retailOrder.findUniqueOrThrow({ where: { id: retail.id } });
  return answer(billed.billedAt);
}

type ParcelInput = ReturnType<typeof returnListSchema.parse>["parcels"][number];
type ParcelAnswer = {
  consignmentId: string;
  externalOrderId: string;
  result: "IN_RETURN_STOCK" | "HOLD" | "REFUSED";
  reason?: "NOT_OUR_ORDER" | "NOT_RETURNED" | "ALREADY_HANDED_BACK";
  pieces?: Array<{ lineId: string; sku: string }>;
};

const refused = (p: ParcelInput, reason: NonNullable<ParcelAnswer["reason"]>): ParcelAnswer => ({
  consignmentId: p.consignmentId,
  externalOrderId: p.externalOrderId,
  result: "REFUSED",
  reason,
});

/** One parcel of a return list, in its own transaction (its order locked). */
async function takeParcel(
  call: Call,
  store: ShopStore,
  list: { id: string; handedBackAt: Date },
  p: ParcelInput,
) {
  const listId = list.id;
  const { ctx } = call;
  const order = await ctx.db.salesOrder.findFirst({
    where: { integrationId: call.integration.id, externalOrderId: p.externalOrderId },
    include: {
      retailOrder: { include: { delivery: true, parcel: true, exchange: true } },
      shipments: { select: { consignmentId: true } },
    },
  });
  const retail = order?.retailOrder;
  if (!order || !retail || retail.storeId !== store.id) return refused(p, "NOT_OUR_ORDER");
  const consignments = new Set([
    ...order.shipments.map((s) => s.consignmentId),
    ...(retail.delivery ? [retail.delivery.consignmentId] : []),
  ]);
  // An exchange's old piece may come on its own pickup consignment: matched by the order.
  if (!retail.exchange && !consignments.has(p.consignmentId)) return refused(p, "NOT_OUR_ORDER");
  return runTransaction(async (tx: Tx): Promise<ParcelAnswer> => {
    await lockRow(tx, "SalesOrder", order.id);
    const parcel = await tx.retailReturnParcel.findUnique({
      where: { retailOrderId: retail.id },
      include: { pieces: { include: { line: true, variant: { select: { sku: true } } } } },
    });
    if (parcel) {
      // The same list sent again: the answer it had.
      if (parcel.listId !== listId) return refused(p, "ALREADY_HANDED_BACK");
      return {
        consignmentId: p.consignmentId,
        externalOrderId: p.externalOrderId,
        result: parcel.state === "HOLD" ? "HOLD" : "IN_RETURN_STOCK",
        pieces: parcel.pieces.map((x) => ({ lineId: x.line.lineId, sku: x.variant.sku })),
      };
    }
    if (!retail.billedAt) return refused(p, "NOT_RETURNED");
    const delivery = retail.delivery;
    const returning = Array.isArray(delivery?.returning) ? (delivery.returning as string[]) : null;
    if (delivery?.status === "DELIVERED" && !returning?.length) return refused(p, "NOT_RETURNED");
    const known = delivery && delivery.match !== "ORANGE" && returning && returning.length > 0;
    const created = await tx.retailReturnParcel.create({
      data: {
        companyId: ctx.company.id,
        listId,
        retailOrderId: retail.id,
        consignmentId: p.consignmentId,
        receivedCount: p.receivedCount ?? null,
        note: p.note ?? null,
        state: known ? "IN_RETURN_STOCK" : "HOLD",
        match: delivery?.match ?? "ORANGE",
      },
    });
    if (!known) {
      return { consignmentId: p.consignmentId, externalOrderId: p.externalOrderId, result: "HOLD" };
    }
    // An exchange's old pieces are lines of the order it replaced.
    const lines = await tx.retailOrderLine.findMany({
      where: { id: { in: returning } },
      include: { variant: { select: { sku: true } } },
    });
    const byId = new Map(lines.map((l) => [l.id, l]));
    await tx.retailReturnPiece.createMany({
      data: returning.map((lineId) => ({
        companyId: ctx.company.id,
        parcelId: created.id,
        retailOrderLineId: lineId,
        variantId: byId.get(lineId)!.variantId,
        price: byId.get(lineId)!.shopPrice,
      })),
    });
    if (retail.exchange) {
      await exchangeParcelTx(tx, ctx, {
        exchangeId: retail.exchange.id,
        handedBackAt: list.handedBackAt,
      });
    }
    return {
      consignmentId: p.consignmentId,
      externalOrderId: p.externalOrderId,
      result: "IN_RETURN_STOCK",
      pieces: returning.map((id) => ({
        lineId: byId.get(id)!.lineId,
        sku: byId.get(id)!.variant.sku,
      })),
    };
  }, TX_OPTIONS);
}

/** POST /return-lists */
export async function recordReturnList(call: Call, store: ShopStore, raw: unknown) {
  const input = returnListSchema.parse(raw);
  const { ctx, meta } = call;
  const list = await ctx.db.retailReturnList.upsert({
    where: { storeId_returnListId: { storeId: store.id, returnListId: input.returnListId } },
    create: {
      companyId: ctx.company.id,
      storeId: store.id,
      returnListId: input.returnListId,
      courier: input.courier,
      handedBackAt: dateColumn(input.handedBackAt),
    },
    update: {},
  });
  const parcels: ParcelAnswer[] = [];
  for (const p of input.parcels) parcels.push(await takeParcel(call, store, list, p));
  const count = (result: ParcelAnswer["result"]) =>
    parcels.filter((p) => p.result === result).length;
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "RetailReturnList",
    entityId: list.id,
    summary: `${store.name}: return list ${input.returnListId}, ${parcels.length} parcel(s): ${count("IN_RETURN_STOCK")} in Return stock, ${count("HOLD")} on Hold, ${count("REFUSED")} refused`,
  });
  return { returnListId: input.returnListId, parcels };
}

/** GET /returns?updatedSince=&limit=: the store's parcels and every decision on them. */
export async function returnsSince(call: Call, store: ShopStore, query: URLSearchParams) {
  const q = pageQuerySchema.parse(
    Object.fromEntries([...query].filter(([, value]) => value !== "")),
  );
  const since = q.updatedSince ? new Date(q.updatedSince) : undefined;
  const parcels = await call.ctx.db.retailReturnParcel.findMany({
    where: {
      list: { storeId: store.id },
      ...(since
        ? { OR: [{ updatedAt: { gt: since } }, { pieces: { some: { updatedAt: { gt: since } } } }] }
        : {}),
    },
    include: {
      list: true,
      order: { include: { order: { select: { externalOrderId: true } } } },
      pieces: {
        include: { line: { select: { lineId: true } }, variant: { select: { sku: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: { updatedAt: "asc" },
    take: q.limit,
  });
  return {
    data: parcels.map((p) => ({
      returnListId: p.list.returnListId,
      courier: p.list.courier,
      handedBackAt: p.list.handedBackAt.toISOString().slice(0, 10),
      consignmentId: p.consignmentId,
      externalOrderId: p.order.order.externalOrderId,
      stage: stageOf(p),
      state: p.state,
      identification: p.match,
      updatedAt: p.updatedAt.toISOString(),
      pieces: p.pieces.map((x) => ({
        pieceId: x.id,
        lineId: x.line.lineId,
        sku: x.variant.sku,
        status: x.atPacking ? "APPROVED_AT_PACKING" : x.status,
        reason: x.reason,
        differentPiece: x.differentPiece,
        credit: x.status === "APPROVED" ? amount(x.price) : 0,
        decidedAt: x.decidedAt?.toISOString() ?? null,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Exchanges (site-changes 2.10.3 and 2.10.5)
// ---------------------------------------------------------------------------

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** GET /exchanges?status=pending|all&updatedSince=&limit= */
export async function listExchanges(call: Call, store: ShopStore, query: URLSearchParams) {
  const q = exchangesQuerySchema.parse(
    Object.fromEntries([...query].filter(([, value]) => value !== "")),
  );
  const exchanges = await call.ctx.db.retailExchange.findMany({
    where: {
      storeId: store.id,
      ...(q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {}),
      ...(q.status === "pending"
        ? { order: { lines: { some: { exchangeState: { in: [...OPEN_STATES] } } } } }
        : {}),
    },
    include: {
      order: {
        include: {
          order: { select: { externalOrderId: true } },
          lines: {
            include: { variant: { select: { sku: true } }, replaces: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      of: { include: { order: { select: { externalOrderId: true } } } },
      events: { include: { line: { select: { lineId: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "asc" },
    take: q.limit,
  });
  const items = exchanges.map((x) => {
    const open = x.order.lines.filter(
      (l) => l.exchangeState && OPEN_STATES.includes(l.exchangeState),
    );
    return {
      exchangeId: x.number,
      externalOrderId: x.order.order.externalOrderId,
      ofExternalOrderId: x.of.order.externalOrderId,
      note: x.note,
      status: exchangeStatus(x.order.lines.map((l) => l.exchangeState)),
      lines: x.order.lines.map((l) => ({
        lineId: l.lineId,
        replacesLineId: l.replaces?.lineId ?? null,
        sku: l.variant.sku,
        quantity: l.quantity,
        shopPrice: amount(l.shopPrice),
        replacedShopPrice: l.replaces ? amount(l.replaces.shopPrice) : null,
        status: l.exchangeState,
        deliveredAt: day(l.deliveredOn),
        deadline: day(l.deadline),
      })),
      atRisk: amount(
        open.reduce((s, l) => s.plus(l.shopPrice.times(l.quantity)), new Prisma.Decimal(0)),
      ),
      deliveredAt: day(x.order.lines.find((l) => l.deliveredOn)?.deliveredOn ?? null),
      deadline: day(x.order.lines.find((l) => l.deadline)?.deadline ?? null),
      updatedAt: x.updatedAt.toISOString(),
      events: x.events.map((e) => ({
        eventId: e.id,
        type: `exchange.${e.type.toLowerCase()}`,
        exchangeId: x.number,
        lineId: e.line.lineId,
        date: localDay(e.createdAt, call.ctx.company.timezone),
        amount: amount(e.amount),
        ...(e.type === "SETTLED" ? { kind: e.kind } : {}),
        ...(e.type === "BILLED" && e.kind !== "REVERSED" ? { reason: e.kind } : {}),
        ...(e.type === "CREDITED" ? { reason: e.kind } : {}),
        ...(e.reversesId ? { reverses: e.reversesId } : {}),
      })),
    };
  });
  const totalAtRisk = await exchangesAtRiskOf(call.ctx, store.id);
  return { items, totalAtRisk: amount(totalAtRisk) };
}

/**
 * POST /exchanges/{exchangeId}/late-return: the site says an old piece came
 * back on no matching consignment. The parcel goes on Hold for the owner to
 * tick; it counts as back on the courier's date.
 */
export async function lateReturn(call: Call, store: ShopStore, number: string, raw: unknown) {
  const input = lateReturnSchema.parse(raw);
  const { ctx, meta } = call;
  const exchange = await ctx.db.retailExchange.findFirst({
    where: { storeId: store.id, number },
    include: { order: { include: { delivery: true, parcel: true } } },
  });
  if (!exchange)
    throw new EcommerceApiError(404, "NOT_FOUND", `Exchange ${number} is not this store's.`);
  const retail = exchange.order;
  if (!retail.delivery) {
    throw new EcommerceApiError(409, "CONFLICT", "The exchange parcel has no delivery result yet.");
  }
  if (retail.parcel) {
    throw new EcommerceApiError(
      409,
      "ALREADY_HANDED_BACK",
      "This exchange's pieces were handed back already.",
    );
  }
  const parcel = await runTransaction(async (tx) => {
    await lockRow(tx, "SalesOrder", retail.orderId);
    const list = await tx.retailReturnList.upsert({
      where: {
        storeId_returnListId: {
          storeId: store.id,
          returnListId: input.returnListId ?? `LATE-${exchange.number}`,
        },
      },
      create: {
        companyId: ctx.company.id,
        storeId: store.id,
        returnListId: input.returnListId ?? `LATE-${exchange.number}`,
        courier: input.courier,
        handedBackAt: dateColumn(input.handedBackAt),
      },
      update: {},
    });
    const created = await tx.retailReturnParcel.create({
      data: {
        companyId: ctx.company.id,
        listId: list.id,
        retailOrderId: retail.id,
        consignmentId: input.consignmentId ?? `LATE-${exchange.number}`,
        note: input.note ?? null,
        state: "HOLD",
        match: "GREEN",
      },
    });
    await exchangeParcelTx(tx, ctx, {
      exchangeId: exchange.id,
      handedBackAt: dateColumn(input.handedBackAt),
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "RetailReturnParcel",
        entityId: created.id,
        summary: `${exchange.number}: the site says the old piece came back late (${input.handedBackAt}); on Hold`,
      },
      tx,
    );
    return created;
  }, TX_OPTIONS);
  return { exchangeId: exchange.number, result: "HOLD" as const, parcelId: parcel.id };
}
