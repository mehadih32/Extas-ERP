import { type CourierProvider, Prisma, type SalesOrderStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { deliveredByVariant } from "@/modules/sales/documents.service";

import { EcommerceApiError, toApiError } from "./errors";
import { deliverShopOrderTx, returnUndeliveredTx, shopOrderOrNotFound } from "./orders.service";
import type { ShopCall } from "./route";
import {
  shipmentEventSchema,
  shipmentSchema,
  type ShopShipment,
  type ShopShipmentEvent,
} from "./schemas";

/*
 * Shipments of website orders through the e-commerce API (CN-005). The shop
 * books the parcel with its courier and tells the ERP the consignment; the
 * courier's status events follow. A delivered parcel delivers the order (the
 * invoice and the delivery challan); one that came back before any delivery
 * frees its stock. The ERP never calls the courier itself here.
 */

type Call = Pick<ShopCall, "integration" | "ctx" | "meta">;

const TX_OPTIONS = { timeout: 30_000 };

const lower = (status: string) => status.toLowerCase().replace(/_/g, " ");
const consignmentIdSchema = z.string().trim().min(1).max(100);

/** Orders that take no shipment. */
const NO_SHIPMENT: readonly SalesOrderStatus[] = ["CANCELLED", "RETURNED"];
/** Orders a booked shipment moves on to SHIPPED. */
const BEFORE_SHIPPING: readonly SalesOrderStatus[] = ["CONFIRMED", "PROCESSING", "PACKED"];

/** The courier a name means: Pathao and Steadfast by name, any other as OTHER. */
export const courierProvider = (name: string): CourierProvider =>
  /pathao/i.test(name) ? "PATHAO" : /steadfast/i.test(name) ? "STEADFAST" : "OTHER";

/** The company's courier account with this name (any case), made when it has none (no credentials). */
async function courierAccountFor(ctx: CompanyContext, name: string) {
  const provider = courierProvider(name);
  const find = () =>
    ctx.db.courierAccount.findFirst({
      where: { provider, name: { equals: name, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
    });
  const found = await find();
  if (found) return found;
  try {
    return await ctx.db.courierAccount.create({
      data: { companyId: ctx.company.id, provider, name },
    });
  } catch (error) {
    // Made at the same moment by another call.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const made = await find();
      if (made) return made;
    }
    throw error;
  }
}

const shipmentExists = (shipment: { id: string }) =>
  new EcommerceApiError(
    409,
    "SHIPMENT_EXISTS",
    "This courier's consignment is in the ERP already: send its events to POST /shipments/{consignmentId}/events.",
    { erpShipmentId: shipment.id },
  );

/** POST /shipments: the shop booked a parcel for an order; the order becomes shipped. */
export async function createShipment(call: Call, raw: unknown): Promise<ShopShipment> {
  const input = shipmentSchema.parse(raw);
  const { ctx, meta } = call;
  const order = await shopOrderOrNotFound(call, input.externalOrderId);
  const courier = await courierAccountFor(ctx, input.courier);
  try {
    return await runTransaction(async (tx) => {
      await lockRow(tx, "SalesOrder", order.id);
      const current = await tx.salesOrder.findFirstOrThrow({
        where: { id: order.id, companyId: ctx.company.id },
      });
      if (NO_SHIPMENT.includes(current.status)) {
        throw new EcommerceApiError(
          409,
          "CONFLICT",
          `This order is ${lower(current.status)}: it takes no shipment.`,
        );
      }
      const existing = await tx.shipment.findFirst({
        where: { courierAccountId: courier.id, consignmentId: input.consignmentId },
        select: { id: true },
      });
      if (existing) throw shipmentExists(existing);
      const shipment = await tx.shipment.create({
        data: {
          companyId: ctx.company.id,
          orderId: order.id,
          courierAccountId: courier.id,
          consignmentId: input.consignmentId,
          trackingCode: input.trackingCode ?? null,
          status: "CREATED",
          deliveryCharge: input.charge,
          codAmount: input.codAmount ?? current.codAmount ?? 0,
        },
      });
      const orderStatus = BEFORE_SHIPPING.includes(current.status) ? "SHIPPED" : current.status;
      if (orderStatus !== current.status) {
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: orderStatus } });
      }
      await auditInCompany(
        ctx,
        meta,
        {
          action: "CREATE",
          entityType: "Shipment",
          entityId: shipment.id,
          summary: `Shipment ${courier.name} ${input.consignmentId} for ${current.number}${
            orderStatus !== current.status ? " (order shipped)" : ""
          }`,
        },
        tx,
      );
      return {
        erpShipmentId: shipment.id,
        externalOrderId: input.externalOrderId,
        courier: courier.name,
        consignmentId: input.consignmentId,
        status: shipment.status,
        orderStatus,
      };
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const saved = await ctx.db.shipment.findFirst({
        where: { courierAccountId: courier.id, consignmentId: input.consignmentId },
        select: { id: true },
      });
      if (saved) throw shipmentExists(saved);
    }
    throw error;
  }
}

/**
 * POST /shipments/{consignmentId}/events: a courier's status, saved on the
 * shipment (the same status at the same time again is saved once). The
 * shipment takes the status of its latest event. DELIVERED delivers the order;
 * RETURNED frees its stock when nothing of it was delivered (after a delivery
 * it is only saved: the shop sends POST /returns). When the order cannot follow
 * (money held, cancelled meanwhile...) the event stays saved and the answer
 * says why in orderError.
 */
export async function addShipmentEvent(
  call: Call,
  rawConsignmentId: string,
  raw: unknown,
): Promise<ShopShipmentEvent> {
  const consignmentId = consignmentIdSchema.parse(rawConsignmentId);
  const input = shipmentEventSchema.parse(raw);
  const { ctx, meta, integration } = call;
  const shipment = await ctx.db.shipment.findFirst({
    where: { consignmentId, order: { integrationId: integration.id } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { courierAccount: { select: { name: true } } },
  });
  if (!shipment) {
    throw new EcommerceApiError(
      404,
      "NOT_FOUND",
      `There is no shipment ${consignmentId} for this shop's orders: send POST /shipments first.`,
    );
  }
  const occurredAt = new Date(input.occurredAt);
  const status = await runTransaction(async (tx) => {
    await lockRow(tx, "SalesOrder", shipment.orderId);
    const repeat = await tx.shipmentEvent.findFirst({
      where: { shipmentId: shipment.id, status: input.status, occurredAt },
      select: { id: true },
    });
    if (!repeat) {
      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: input.status,
          rawStatus: input.courierStatus ?? null,
          message: input.note ?? null,
          occurredAt,
        },
      });
    }
    const latest = await tx.shipmentEvent.findFirstOrThrow({
      where: { shipmentId: shipment.id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { status: true },
    });
    const current = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: latest.status,
        lastSyncedAt: new Date(),
        ...(input.status === "DELIVERED" && !current.deliveredAt
          ? { deliveredAt: occurredAt }
          : {}),
        ...(input.status === "RETURNED" && !current.returnedAt ? { returnedAt: occurredAt } : {}),
      },
    });
    if (!repeat) {
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "Shipment",
          entityId: shipment.id,
          summary: `Shipment ${shipment.courierAccount.name} ${consignmentId}: ${lower(input.status)} at ${occurredAt.toISOString()}`,
        },
        tx,
      );
    }
    return latest.status;
  }, TX_OPTIONS);

  // The order follows the courier in its own step: the event is kept even when it cannot.
  let orderError: ShopShipmentEvent["orderError"];
  try {
    if (input.status === "DELIVERED") {
      await runTransaction((tx) => deliverShopOrderTx(tx, ctx, shipment.orderId, meta), TX_OPTIONS);
    } else if (input.status === "RETURNED") {
      // A cancelled order's parcel coming back changes nothing: its stock is free already.
      const before = await ctx.db.salesOrder.findUniqueOrThrow({
        where: { id: shipment.orderId },
        select: { status: true },
      });
      const delivered = await deliveredByVariant(prisma, shipment.orderId);
      if (before.status !== "CANCELLED" && [...delivered.values()].every((n) => n <= 0)) {
        await runTransaction(
          (tx) =>
            returnUndeliveredTx(
              tx,
              ctx,
              shipment.orderId,
              `${shipment.courierAccount.name} ${consignmentId} returned${
                input.note ? ` (${input.note})` : ""
              }`,
              meta,
            ),
          TX_OPTIONS,
        );
      }
    }
  } catch (error) {
    const answer = toApiError(error);
    if (answer.status >= 500) throw error;
    orderError = { code: answer.body.error.code, message: answer.body.error.message };
  }
  const order = await ctx.db.salesOrder.findUniqueOrThrow({
    where: { id: shipment.orderId },
    select: { status: true },
  });
  return {
    erpShipmentId: shipment.id,
    consignmentId,
    status,
    orderStatus: order.status,
    ...(orderError ? { orderError } : {}),
  };
}
