import {
  Prisma,
  type RetailDeclineReason,
  type RetailParcelState,
  type RetailPieceStatus,
} from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { requirePin } from "@/modules/ai/settings.service";
import { createSalesReturn, voidSalesReturn } from "@/modules/sales/return.service";

import { settleExchangePieces } from "./exchanges.service";
import { putBackOnReserve, takeBackFromReserve } from "./reserve";
import { shopEventTx } from "./shop-events";

/*
 * Business > Returns (plan v6 sec 8.4 to 8.8): the parcels retail stores sent
 * back. Nothing changes money until the owner checks a piece:
 *   Hold          the ERP could not tell which pieces came back: the owner
 *                 ticks them (or "This parcel did not come": the store's loss).
 *   Return stock  pieces waiting for the check.
 *   Check         Approve: back in main stock and credited to the store at
 *                 the price it paid (a sales return on its invoice, so Accounts'
 *                 right is needed too). Decline, with a reason: the store's
 *                 loss, no money or stock changes.
 */

const ZERO = new Prisma.Decimal(0);

export const DECLINE_REASONS: Record<RetailDeclineReason, string> = {
  B_GRADE: "B-grade",
  C_GRADE: "C-grade",
  STAIN_OR_DAMAGE: "Stain or damage",
  USED: "Used",
  NO_TAG: "No tag",
  PIECE_MISSING: "Piece missing",
  WRONG_ITEM: "Wrong item",
  PARCEL_MISSING: "Parcel missing",
  OTHER: "Other",
};

export function assertCanCheckReturns(ctx: CompanyContext) {
  if (!ctx.can("retail.returns")) {
    throw new AppError("FORBIDDEN", "You may not check the stores' returns.");
  }
}

/** Approving credits the store: Accounts' work (a sales return), checked as QC too. */
const canApprove = (ctx: CompanyContext) =>
  ctx.can("accounts.receipts.record") && ctx.can("sales.returns.qc");

/** The site's stage name for a parcel (site-changes 2.5). */
export function stageOf(p: { state: RetailParcelState; resolvedAt: Date | null }) {
  if (p.state === "HOLD") return "HANDED_BACK";
  if (p.state === "CHECKED" || p.state === "MISSING") return "CHECKED";
  return p.resolvedAt ? "HOLD_RESOLVED" : "HANDED_BACK";
}

/**
 * What approving a store's returns waiting for the check would take off its
 * account, at the price it paid: each piece in Return stock, and the pieces a
 * parcel still on Hold should hold (at most as many as came back). An exchange
 * piece counts only where approving credits money: an old piece whose new
 * piece was billed in full meanwhile. Left out of the store's 30-day hold.
 */
export async function waitingCheckOf(ctx: CompanyContext, storeId: string) {
  const [waiting, held] = await Promise.all([
    ctx.db.retailReturnPiece.findMany({
      where: { status: "WAITING", parcel: { list: { storeId } } },
      select: {
        price: true,
        parcel: { select: { order: { select: { exchange: { select: { id: true } } } } } },
        line: { select: { exchangeState: true, replacedBy: { select: { exchangeState: true } } } },
      },
    }),
    ctx.db.retailReturnParcel.findMany({
      where: { state: "HOLD", list: { storeId } },
      select: {
        receivedCount: true,
        order: {
          select: {
            exchange: { select: { id: true } },
            delivery: { select: { returning: true } },
            lines: {
              where: { cancelledAt: null },
              select: { id: true, shopPrice: true, quantity: true },
            },
          },
        },
      },
    }),
  ]);
  const inStock = waiting
    .filter(
      (p) =>
        !p.parcel.order.exchange ||
        p.line.exchangeState === "BILLED" ||
        p.line.replacedBy.some((l) => l.exchangeState === "BILLED"),
    )
    .reduce((sum, p) => sum.plus(p.price), ZERO);
  const onHold = held
    .filter((p) => !p.order.exchange)
    .reduce((sum, p) => {
      const price = new Map(p.order.lines.map((l) => [l.id, l.shopPrice]));
      const returning = Array.isArray(p.order.delivery?.returning)
        ? (p.order.delivery!.returning as string[])
        : [];
      // Which pieces came back is not known yet: any of the order's pieces may have.
      const ids = returning.length
        ? returning
        : p.order.lines.flatMap((l) => Array.from({ length: l.quantity }, () => l.id));
      const prices = ids
        .map((id) => price.get(id))
        .filter((v): v is Prisma.Decimal => v !== undefined)
        .sort((a, b) => a.comparedTo(b));
      const count =
        p.receivedCount === null ? prices.length : Math.min(p.receivedCount, prices.length);
      return prices.slice(0, count).reduce((s, v) => s.plus(v), sum);
    }, ZERO);
  return inStock.plus(onHold);
}

const VARIANT = {
  id: true,
  sku: true,
  color: { select: { name: true } },
  size: { select: { name: true } },
} as const;

const parcelInclude = {
  list: { include: { store: { select: { id: true, name: true } } } },
  order: {
    include: {
      order: {
        select: {
          id: true,
          number: true,
          externalOrderId: true,
          customerName: true,
          customerPhone: true,
        },
      },
      delivery: true,
      exchange: { select: { id: true, number: true } },
      lines: {
        // A line the site cancelled never left, so it cannot come back.
        where: { cancelledAt: null },
        include: {
          variant: { select: VARIANT },
          replaces: { include: { variant: { select: VARIANT } } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  },
  pieces: {
    include: {
      variant: { select: { sku: true } },
      line: { select: { lineId: true } },
      reservedFor: { select: { order: { select: { order: { select: { number: true } } } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.RetailReturnParcelInclude;

type ParcelRow = Prisma.RetailReturnParcelGetPayload<{ include: typeof parcelInclude }>;

const money2 = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v).toFixed(2);

/**
 * The lines whose pieces can be in the parcel: an order's own, or for an
 * exchange the old piece of each kept line (the new one when it was refused).
 */
function returnableLines(p: ParcelRow) {
  // Two new lines that replace one old line: one row for that old line, with both pieces.
  type Line = ParcelRow["order"]["lines"][number];
  const rows = new Map<string, Omit<Line, "replaces"> & { quantity: number }>();
  for (const l of p.order.lines) {
    // A kept line's old piece comes back; a refused line's own new piece does.
    const line = p.order.exchange && l.replaces && l.deliveredOn !== null ? l.replaces : l;
    const seen = rows.get(line.id);
    rows.set(line.id, { ...line, quantity: (seen?.quantity ?? 0) + l.quantity });
  }
  return [...rows.values()];
}

function parcelView(p: ParcelRow, now: Date, checkDays: number) {
  const days = Math.floor((now.getTime() - p.list.handedBackAt.getTime()) / 86_400_000);
  const expected = p.order.delivery?.returning;
  const expectedCount = Array.isArray(expected) ? expected.length : null;
  return {
    id: p.id,
    store: p.list.store.name,
    returnListId: p.list.returnListId,
    courier: p.list.courier,
    handedBackAt: p.list.handedBackAt.toISOString().slice(0, 10),
    consignmentId: p.consignmentId,
    order: p.order.order.number,
    orderId: p.order.order.id,
    externalOrderId: p.order.order.externalOrderId,
    customer: [p.order.order.customerName, p.order.order.customerPhone].filter(Boolean).join(", "),
    state: p.state,
    match: p.match,
    receivedCount: p.receivedCount,
    /** The site counted another number of pieces than the ERP expects: shown to the owner. */
    countDiffers:
      p.receivedCount !== null &&
      (p.pieces.length > 0 ? p.pieces.length : (expectedCount ?? -1)) !== p.receivedCount,
    note: p.note,
    daysSinceHandedBack: days,
    late: p.state !== "CHECKED" && p.state !== "MISSING" && days > checkDays,
    delivery: p.order.delivery
      ? {
          status: p.order.delivery.status,
          collected: money2(p.order.delivery.collected),
          note: p.order.delivery.note,
        }
      : null,
    exchange: p.order.exchange?.number ?? null,
    lines: returnableLines(p).map((l) => ({
      id: l.id,
      lineId: l.lineId,
      sku: l.variant.sku,
      variantId: l.variant.id,
      color: l.variant.color.name,
      size: l.variant.size.name,
      quantity: l.quantity,
      shopPrice: money2(l.shopPrice),
      customerPrice: money2(l.customerPrice),
    })),
    pieces: p.pieces.map((x) => ({
      id: x.id,
      sku: x.variant.sku,
      lineId: x.line.lineId,
      price: money2(x.price),
      status: x.status,
      reason: x.reason ? DECLINE_REASONS[x.reason] : null,
      differentPiece: x.differentPiece,
      decidedAt: x.decidedAt,
      /** Sent on a new order from Return stock: its check is the packing check. */
      reservedFor: x.reservedFor?.order.order.number ?? null,
      atPacking: x.atPacking,
      /** A decision that "Undo the check" can take back (undoDecision). */
      undoable: x.status !== "WAITING" && !x.atPacking && !x.reservedForLineId && !p.order.exchange,
    })),
  };
}

export type ReturnParcel = ReturnType<typeof parcelView>;

/** Business > Returns: Hold, Return stock and History. */
export async function returnsPage(ctx: CompanyContext) {
  if (!ctx.can("retail.view") && !ctx.can("retail.manage") && !ctx.can("retail.returns")) {
    throw new AppError("FORBIDDEN", "You may not see the stores' returns.");
  }
  const [open, history, stores] = await Promise.all([
    ctx.db.retailReturnParcel.findMany({
      where: { state: { in: ["HOLD", "IN_RETURN_STOCK"] } },
      include: parcelInclude,
      orderBy: { createdAt: "asc" },
      take: 300,
    }),
    ctx.db.retailReturnParcel.findMany({
      where: { state: { in: ["CHECKED", "MISSING"] } },
      include: parcelInclude,
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    ctx.db.retailStore.findMany({ select: { id: true, checkDays: true } }),
  ]);
  const now = new Date();
  const checkDays = new Map(stores.map((s) => [s.id, s.checkDays]));
  const view = (p: ParcelRow) => parcelView(p, now, checkDays.get(p.list.store.id) ?? 5);
  const waitingValue = open
    .flatMap((p) => p.pieces)
    .filter((x) => x.status === "WAITING")
    .reduce((sum, x) => sum.plus(x.price), ZERO);
  return {
    canCheck: ctx.can("retail.returns"),
    canApprove: canApprove(ctx),
    currency: ctx.company.currency,
    reasons: Object.entries(DECLINE_REASONS).map(([value, label]) => ({ value, label })),
    hold: open.filter((p) => p.state === "HOLD").map(view),
    waiting: open.filter((p) => p.state === "IN_RETURN_STOCK").map(view),
    waitingPieces: open.flatMap((p) => p.pieces).filter((x) => x.status === "WAITING").length,
    waitingValue: waitingValue.toFixed(2),
    history: history.map(view),
  };
}

export type ReturnsPage = Awaited<ReturnType<typeof returnsPage>>;

async function parcelOrThrow(ctx: CompanyContext, parcelId: string) {
  const parcel = await ctx.db.retailReturnParcel.findUnique({
    where: { id: parcelId },
    include: parcelInclude,
  });
  if (!parcel) throw new AppError("NOT_FOUND", "There is no such returned parcel.");
  return parcel;
}

const resolveSchema = z.object({
  /** The pieces that came back, per order line (the ERP's line id). */
  came: z
    .array(z.object({ lineId: z.string().min(1), quantity: z.coerce.number().int().min(0) }))
    .max(200)
    .default([]),
  /** "This parcel did not come": the store's loss, nothing goes to Return stock. */
  missing: z.boolean().default(false),
});

/** Hold: the owner ticks the pieces that came back (or that the parcel never came). */
export async function resolveHold(
  ctx: CompanyContext,
  parcelId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanCheckReturns(ctx);
  const input = resolveSchema.parse(raw);
  const parcel = await parcelOrThrow(ctx, parcelId);
  if (parcel.state !== "HOLD") {
    throw new AppError("CONFLICT", "This parcel is not on Hold any more.");
  }
  const lines = new Map(returnableLines(parcel).map((l) => [l.id, l]));
  const pieces: Array<{ lineId: string; variantId: string; price: Prisma.Decimal }> = [];
  if (!input.missing) {
    for (const c of input.came) {
      const line = lines.get(c.lineId);
      if (!line) throw new AppError("VALIDATION", "A piece is not on this order.");
      if (c.quantity > line.quantity) {
        throw new AppError(
          "VALIDATION",
          `At most ${line.quantity} of ${line.variant.sku} came back.`,
          {
            came: [`At most ${line.quantity}`],
          },
        );
      }
      for (let i = 0; i < c.quantity; i++) {
        pieces.push({ lineId: line.id, variantId: line.variantId, price: line.shopPrice });
      }
    }
    if (pieces.length === 0) {
      throw new AppError(
        "VALIDATION",
        "Tick the pieces that came back, or say the parcel did not come.",
        {
          came: ["Tick at least one piece"],
        },
      );
    }
  }
  await runTransaction(async (tx) => {
    const claimed = await tx.retailReturnParcel.updateMany({
      where: { id: parcel.id, companyId: ctx.company.id, state: "HOLD" },
      data: {
        state: input.missing ? "MISSING" : "IN_RETURN_STOCK",
        resolvedById: ctx.user.id,
        resolvedAt: new Date(),
      },
    });
    if (claimed.count !== 1)
      throw new AppError("CONFLICT", "Someone else settled this parcel just now.");
    if (pieces.length > 0) {
      await tx.retailReturnPiece.createMany({
        data: pieces.map((p) => ({
          companyId: ctx.company.id,
          parcelId: parcel.id,
          retailOrderLineId: p.lineId,
          variantId: p.variantId,
          price: p.price,
        })),
      });
    }
    if (parcel.order.exchange) {
      // A piece that did not come waits again (billed in full once its deadline passes): the
      // old piece of a kept line, the new piece of a refused one. Each ticked piece covers one
      // new line's piece; a new line not covered waits again.
      const left = new Map<string, number>();
      for (const p of pieces) left.set(p.lineId, (left.get(p.lineId) ?? 0) + 1);
      for (const l of parcel.order.lines) {
        if (l.exchangeState !== "RETURNED_WAITING_CHECK") continue;
        const old = l.deliveredOn ? (l.replacesLineId ?? l.id) : l.id;
        const came = left.get(old) ?? 0;
        if (came >= l.quantity) {
          left.set(old, came - l.quantity);
          continue;
        }
        await tx.retailOrderLine.update({
          where: { id: l.id },
          data: { exchangeState: "WAITING_RETURN" },
        });
      }
    }
    const came = new Map<string, number>();
    for (const p of pieces) came.set(p.lineId, (came.get(p.lineId) ?? 0) + 1);
    const resolvedEventId = await shopEventTx(tx, parcel.list.store.id, "return.parcel.resolved", {
      returnListId: parcel.list.returnListId,
      consignmentId: parcel.consignmentId,
      externalOrderId: parcel.order.order.externalOrderId,
      result: input.missing ? "PARCEL_MISSING" : "IN_RETURN_STOCK",
      pieces: [...came].map(([id, quantity]) => {
        const line = lines.get(id)!;
        return { lineId: line.lineId, sku: line.variant.sku, quantity };
      }),
    });
    await tx.retailReturnParcel.update({ where: { id: parcel.id }, data: { resolvedEventId } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RetailReturnParcel",
        entityId: parcel.id,
        summary: input.missing
          ? `${parcel.consignmentId} (${parcel.order.order.number}): the parcel did not come, the store's loss`
          : `${parcel.consignmentId} (${parcel.order.order.number}): ${pieces.length} piece(s) to Return stock`,
      },
      tx,
    );
  });
}

const checkSchema = z.object({
  decisions: z
    .array(
      z.object({
        pieceId: z.string().min(1),
        decision: z.enum(["APPROVE", "DECLINE"]),
        reason: z
          .enum(Object.keys(DECLINE_REASONS) as [RetailDeclineReason, ...RetailDeclineReason[]])
          .optional(),
        /** The piece in the parcel was another of the order's SKUs. */
        variantId: z.string().min(1).optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, "Decide at least one piece")
    .max(500),
});

/**
 * The check: each piece approved or declined. Approved pieces go back into
 * main stock and come off the store's account at the price it paid, as one
 * sales return per SKU on the order's invoice, dated today. The pieces are
 * claimed first, so a piece is decided once.
 */
export async function checkParcel(
  ctx: CompanyContext,
  parcelId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanCheckReturns(ctx);
  const input = checkSchema.parse(raw);
  const parcel = await parcelOrThrow(ctx, parcelId);
  if (parcel.state !== "IN_RETURN_STOCK") {
    throw new AppError("CONFLICT", "This parcel has no pieces waiting for the check.");
  }
  const approving = input.decisions.filter((d) => d.decision === "APPROVE");
  if (approving.length > 0 && !canApprove(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Approving credits the store's account: it needs Accounts' right to record money too.",
    );
  }
  const declineWithout = input.decisions.find((d) => d.decision === "DECLINE" && !d.reason);
  if (declineWithout) {
    throw new AppError("VALIDATION", "Choose why each declined piece is declined.", {
      reason: ["Choose a reason"],
    });
  }
  const pieces = new Map(parcel.pieces.map((x) => [x.id, x]));
  const exchange = await ctx.db.retailExchange.findUnique({
    where: { retailOrderId: parcel.order.id },
  });
  // An exchange parcel's pieces settle by their own lines: no other piece stands in for one.
  const lineOfVariant = new Map(
    exchange ? [] : parcel.order.lines.map((l) => [l.variantId, l] as const),
  );
  for (const d of input.decisions) {
    const piece = pieces.get(d.pieceId);
    if (!piece || piece.status !== "WAITING") {
      throw new AppError("CONFLICT", "A piece was decided already, or is not in this parcel.");
    }
    if (d.variantId && !lineOfVariant.has(d.variantId)) {
      throw new AppError("VALIDATION", "The piece found must be one of the order's SKUs.");
    }
  }
  const now = new Date();
  // Claim every piece first: a second check of the same piece finds nothing to decide.
  await prisma.$transaction(async (tx) => {
    for (const d of input.decisions) {
      const piece = pieces.get(d.pieceId)!;
      const other =
        d.variantId && d.variantId !== piece.variantId ? lineOfVariant.get(d.variantId)! : null;
      const claimed = await tx.retailReturnPiece.updateMany({
        where: { id: piece.id, companyId: ctx.company.id, status: "WAITING" },
        data: {
          status: d.decision === "APPROVE" ? "APPROVED" : "DECLINED",
          reason: d.decision === "DECLINE" ? d.reason! : null,
          note: d.note || null,
          decidedById: ctx.user.id,
          decidedAt: now,
          ...(other
            ? {
                differentPiece: true,
                variantId: other.variantId,
                retailOrderLineId: other.id,
                price: other.shopPrice,
              }
            : {}),
        },
      });
      if (claimed.count !== 1)
        throw new AppError("CONFLICT", "Someone else checked a piece just now.");
    }
  });
  try {
    if (exchange) await settleExchangePieces(ctx, parcel.id, input.decisions, meta);
    else if (approving.length > 0) await creditApproved(ctx, parcel, approving, meta);
  } catch (error) {
    // The store was credited already: the pieces stay decided, never credited twice.
    if (error instanceof CreditedThen) throw error.cause;
    // Nothing was credited: the pieces wait for the check again.
    await prisma.retailReturnPiece.updateMany({
      where: {
        id: { in: (exchange ? input.decisions : approving).map((d) => d.pieceId) },
        salesReturnId: null,
      },
      data: {
        status: "WAITING",
        reason: null,
        decidedById: null,
        decidedAt: null,
        differentPiece: false,
      },
    });
    throw error;
  }
  // Pieces sent on a new order from Return stock: this was their packing check.
  for (const d of input.decisions) {
    const piece = pieces.get(d.pieceId)!;
    if (!piece.reservedForLineId) continue;
    if (d.decision === "APPROVE") {
      await ctx.db.retailReturnPiece.update({ where: { id: piece.id }, data: { atPacking: true } });
    } else {
      const line = await ctx.db.retailOrderLine.update({
        where: { id: piece.reservedForLineId },
        data: { waitingStock: true },
        include: {
          variant: { select: { sku: true } },
          order: { select: { storeId: true, order: { select: { externalOrderId: true } } } },
        },
      });
      await shopEventTx(prisma, line.order.storeId, "order.line.short", {
        externalOrderId: line.order.order.externalOrderId,
        lineId: line.lineId,
        sku: line.variant.sku,
        reason: "RETURN_PIECE_FAILED_CHECK",
      });
    }
  }
  await piecesDecided(
    ctx,
    input.decisions.map((d) => d.pieceId),
  );
  const left = await ctx.db.retailReturnPiece.count({
    where: { parcelId: parcel.id, status: "WAITING" },
  });
  if (left === 0) {
    await ctx.db.retailReturnParcel.update({
      where: { id: parcel.id },
      data: { state: "CHECKED" },
    });
  }
  const declined = input.decisions.length - approving.length;
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "RetailReturnParcel",
    entityId: parcel.id,
    summary: `${parcel.consignmentId} (${parcel.order.order.number}) checked: ${approving.length} approved, ${declined} declined`,
  });
}

/** One sales return per SKU approved, on the order's invoice, at the price the store paid. */
async function creditApproved(
  ctx: CompanyContext,
  parcel: ParcelRow,
  approving: Array<{ pieceId: string; variantId?: string }>,
  meta?: RequestMeta,
) {
  const order = await ctx.db.salesOrder.findUniqueOrThrow({
    where: { id: parcel.order.order.id },
    include: { invoice: true, items: true },
  });
  if (!order.invoice) throw new AppError("CONFLICT", "This order was never billed.");
  const pieces = await ctx.db.retailReturnPiece.findMany({
    where: { id: { in: approving.map((d) => d.pieceId) } },
  });
  const byVariant = new Map<string, string[]>();
  for (const p of pieces) byVariant.set(p.variantId, [...(byVariant.get(p.variantId) ?? []), p.id]);
  const items = [...byVariant].map(([variantId, ids]) => {
    const item = order.items.find((i) => i.variantId === variantId);
    if (!item) throw new AppError("CONFLICT", "A piece is not on the order's invoice.");
    return { orderItemId: item.id, quantity: ids.length, qc: "GOOD" as const };
  });
  const credit = await createSalesReturn(
    ctx,
    {
      invoiceId: order.invoice.id,
      items,
      reason: `Retail return checked: ${parcel.list.returnListId} ${parcel.consignmentId}`,
    },
    meta,
  );
  try {
    await ctx.db.retailReturnPiece.updateMany({
      where: { id: { in: pieces.map((p) => p.id) } },
      data: { salesReturnId: credit.id },
    });
    // A shop's piece approved back is a shop's piece again (plan v6 sec 3a).
    const back = await putBackOnReserve(
      prisma,
      ctx.company.id,
      pieces.map((p) => p.retailOrderLineId),
    );
    const onReserve = pieces.filter((_, i) => back[i]).map((p) => p.id);
    if (onReserve.length > 0) {
      await ctx.db.retailReturnPiece.updateMany({
        where: { id: { in: onReserve } },
        data: { reservePutBack: true },
      });
    }
  } catch (error) {
    throw new CreditedThen(error);
  }
}

const undoSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Write why the decision is undone")
    .max(300, "At most 300 characters"),
  pin: z.string().optional(),
});

/**
 * Undo a check decision made by mistake (site-changes 2.5.4, "Corrections"),
 * with a reason and the owner's PIN. The piece waits for the check again.
 * An approval is undone by voiding its sales return (a reversing entry, never
 * a delete): that takes back every piece approved with it, so they all wait
 * again, and pieces put back on the shops' reserve come off it. The site gets
 * return.piece.decided with status WAITING and `reverses`. An exchange's
 * pieces (their money settled through the exchange) and a piece passed at
 * packing (it went out on a new order) cannot be undone.
 */
export async function undoDecision(
  ctx: CompanyContext,
  pieceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanCheckReturns(ctx);
  const input = undoSchema.parse(raw);
  const piece = await ctx.db.retailReturnPiece.findUnique({
    where: { id: pieceId },
    include: {
      variant: { select: { sku: true } },
      parcel: { include: { order: { include: { exchange: { select: { number: true } } } } } },
    },
  });
  if (!piece) throw new AppError("NOT_FOUND", "There is no such returned piece.");
  if (piece.status === "WAITING") {
    throw new AppError("CONFLICT", "This piece waits for the check: there is nothing to undo.");
  }
  if (piece.parcel.order.exchange) {
    throw new AppError(
      "CONFLICT",
      `This piece came back on exchange ${piece.parcel.order.exchange.number}: its money settled through the exchange, so the check cannot be undone.`,
    );
  }
  if (piece.atPacking || piece.reservedForLineId) {
    throw new AppError(
      "CONFLICT",
      "This piece went out on a new order: its check cannot be undone.",
    );
  }
  if (piece.status === "APPROVED" && !canApprove(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Undoing an approval takes back the store's credit: it needs Accounts' right to record money too.",
    );
  }
  await requirePin(ctx, input.pin, "undo a return check");
  // An approval: every piece credited on the same sales return comes back with it.
  const together = piece.salesReturnId
    ? await ctx.db.retailReturnPiece.findMany({ where: { salesReturnId: piece.salesReturnId } })
    : [piece];
  if (piece.salesReturnId) {
    await voidSalesReturn(
      ctx,
      piece.salesReturnId,
      { reason: `Retail return check undone: ${input.reason}` },
      meta,
    );
  }
  await prisma.$transaction(async (tx) => {
    for (const p of together) {
      if (p.reservePutBack) await takeBackFromReserve(tx, ctx.company.id, p.retailOrderLineId);
    }
    await tx.retailReturnPiece.updateMany({
      where: { id: { in: together.map((p) => p.id) }, companyId: ctx.company.id },
      data: {
        status: "WAITING",
        reason: null,
        note: null,
        decidedById: null,
        decidedAt: null,
        salesReturnId: null,
        reservePutBack: false,
      },
    });
    await tx.retailReturnParcel.update({
      where: { id: piece.parcelId },
      data: { state: "IN_RETURN_STOCK" },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RetailReturnParcel",
        entityId: piece.parcelId,
        summary: `${piece.parcel.consignmentId}: check undone for ${together.length} piece(s) (${piece.variant.sku}${together.length > 1 ? " and the pieces approved with it" : ""}), they wait for the check again. Why: ${input.reason}`,
      },
      tx,
    );
  });
  await piecesDecided(
    ctx,
    together.map((p) => p.id),
    true,
  );
  return { pieces: together.length };
}

/**
 * return.piece.decided to the site, one per piece (site-changes 2.5.4), with
 * the claim details; an exchange's piece carries its exchangeId and no credit
 * (its money comes through the exchange.* events). A correction names the
 * event it reverses. The piece keeps the event's id for GET /returns.
 */
async function piecesDecided(ctx: CompanyContext, pieceIds: string[], reverses = false) {
  const pieces = await ctx.db.retailReturnPiece.findMany({
    where: { id: { in: pieceIds } },
    include: {
      line: { select: { lineId: true } },
      variant: { select: { sku: true } },
      parcel: {
        include: {
          list: true,
          order: {
            select: {
              order: { select: { externalOrderId: true } },
              exchange: { select: { number: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const x of pieces) {
    await prisma.$transaction(async (tx) => {
      const exchange = x.parcel.order.exchange;
      const eventId = await shopEventTx(tx, x.parcel.list.storeId, "return.piece.decided", {
        ...pieceEventData(x),
        ...(exchange ? { exchangeId: exchange.number } : {}),
        ...(reverses && x.eventId ? { reverses: x.eventId } : {}),
      });
      await tx.retailReturnPiece.update({
        where: { id: x.id },
        data: { eventId, reversesEventId: reverses ? x.eventId : null },
      });
    });
  }
}

/** One piece's decision as the site sees it (the webhook and GET /returns). */
export function pieceEventData(x: {
  id: string;
  status: RetailPieceStatus;
  atPacking: boolean;
  reason: RetailDeclineReason | null;
  differentPiece: boolean;
  price: Prisma.Decimal;
  decidedAt: Date | null;
  line: { lineId: string };
  variant: { sku: string };
  parcel: {
    consignmentId: string;
    list: { returnListId: string; courier: string; handedBackAt: Date };
    order: { order: { externalOrderId: string | null }; exchange: { number: string } | null };
  };
}) {
  return {
    pieceId: x.id,
    returnListId: x.parcel.list.returnListId,
    consignmentId: x.parcel.consignmentId,
    courier: x.parcel.list.courier,
    handedBackAt: x.parcel.list.handedBackAt.toISOString().slice(0, 10),
    externalOrderId: x.parcel.order.order.externalOrderId,
    lineId: x.line.lineId,
    sku: x.variant.sku,
    status: x.atPacking ? "APPROVED_AT_PACKING" : x.status,
    reason: x.reason,
    differentPiece: x.differentPiece,
    credit: x.status === "APPROVED" && !x.parcel.order.exchange ? Number(x.price.toFixed(2)) : 0,
    decidedAt: x.decidedAt?.toISOString() ?? null,
  };
}

/** A step after the store's credit failed: the credit stands, so nothing is undone. */
class CreditedThen extends Error {
  constructor(override readonly cause: unknown) {
    super("The store was credited, then a later step failed.");
  }
}
