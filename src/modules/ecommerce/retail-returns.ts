import { Prisma } from "@prisma/client";

import { dateColumn } from "@/lib/dates";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import { byMark, identifyPartial, type Identification, piecesOf } from "@/modules/retail/partial";
import { stageOf } from "@/modules/retail/returns.service";

import { amount } from "./catalog.service";
import { EcommerceApiError } from "./errors";
import { billStoreOrderTx, shopOrderOrNotFound } from "./orders.service";
import type { ShopStore } from "./retail-mode";
import type { ShopCall } from "./route";
import { deliveryResultSchema, pageQuerySchema, returnListSchema } from "./schemas";

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
    include: { lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, parcel: true },
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
async function takeParcel(call: Call, store: ShopStore, listId: string, p: ParcelInput) {
  const { ctx } = call;
  const order = await ctx.db.salesOrder.findFirst({
    where: { integrationId: call.integration.id, externalOrderId: p.externalOrderId },
    include: {
      retailOrder: { include: { delivery: true, parcel: true } },
      shipments: { select: { consignmentId: true } },
    },
  });
  const retail = order?.retailOrder;
  if (!order || !retail || retail.storeId !== store.id) return refused(p, "NOT_OUR_ORDER");
  const consignments = new Set([
    ...order.shipments.map((s) => s.consignmentId),
    ...(retail.delivery ? [retail.delivery.consignmentId] : []),
  ]);
  if (!consignments.has(p.consignmentId)) return refused(p, "NOT_OUR_ORDER");
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
    if (delivery?.status === "DELIVERED") return refused(p, "NOT_RETURNED");
    const returning = Array.isArray(delivery?.returning) ? (delivery.returning as string[]) : null;
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
    const lines = await tx.retailOrderLine.findMany({
      where: { retailOrderId: retail.id },
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
  for (const p of input.parcels) parcels.push(await takeParcel(call, store, list.id, p));
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
        orderBy: { createdAt: "asc" },
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
        status: x.status,
        reason: x.reason,
        differentPiece: x.differentPiece,
        credit: x.status === "APPROVED" ? amount(x.price) : 0,
        decidedAt: x.decidedAt?.toISOString() ?? null,
      })),
    })),
  };
}
