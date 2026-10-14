import {
  type BookingSource,
  type GarmentCategory,
  type MeasurementUnit,
  Prisma,
  type RawMaterialKind,
} from "@prisma/client";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertAnyPermission, assertCanBuyMaterials, costMask } from "@/modules/materials/access";
import { findOrAddMaterials, OPEN_ORDER } from "@/modules/materials/material.service";
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  insertPurchaseOrder,
  type NewOrderLine,
  orderState,
} from "@/modules/materials/purchase-order.service";
import {
  canCancelOrder,
  canChangeOrder,
  canChangeOrderLines,
  canCloseOrder,
  canReceiveOnOrder,
} from "@/modules/materials/rules";
import { createPurchase } from "@/modules/materials/purchase.service";
import { assertUnitFits, loadActiveMaterials, resolveStore } from "@/modules/materials/stock";
import { money, pendingQuantity, qty, unitCost, ZERO } from "@/modules/materials/valuation";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import {
  type BatchMaterialPlan,
  batchMaterialPlan,
} from "@/modules/production/batch-orders.service";
import {
  collarTotals,
  fabricFor,
  type LineSpecs,
  matrixQuantity,
  specsText,
} from "@/modules/production/booking-math";
import {
  CATEGORY_LABELS,
  CATEGORY_PRESETS,
  DEFAULT_COLLAR_EXTRA,
  DEFAULT_COLLAR_SIZES,
  type LineRole,
  SOURCE_LABELS,
  sizeGroupOf,
} from "@/modules/production/booking-presets";
import {
  attachBookingSchema,
  type BookingLineInput,
  type CollarInput,
  createBookingSchema,
  lineSpecsSchema,
  listBookingsSchema,
  updateBookingPaperworkSchema,
  updateBookingSchema,
} from "@/modules/production/booking-schemas";
import { standardTermsText } from "@/modules/production/booking-terms";
import { assertMaterialImages } from "@/modules/production/material-image.service";
import { styleGrids } from "@/modules/production/material-need.service";
import { shareOut } from "@/modules/production/material-plan";
import { OPEN_STATUSES } from "@/modules/production/timeline";

/*
 * Bookings (Production > Bookings): fabric, yarn and trims booked the way the
 * garment trade books them, from a mill or trims supplier (Supplier PO) or as
 * ready stock off the open market (market purchase). A booking is a purchase
 * order with more on it: the garment family, each line's specification (GSM,
 * DIA, width, construction, yarn count, colour), the collar and cuff matrix and
 * strict terms in English or Bengali. Because it is a purchase order, its goods
 * arrive the way every order's do (central receive, supplier bills) and it shows
 * on the purchase orders too.
 *
 * A booking is made on its own or for a master batch, and is attached to a
 * batch (or taken off it while nothing has arrived): its lines are then shared
 * out over the batch's styles, colours and sizes like the batch's own orders,
 * so they count as ordered. A batch's fabric is only ever ordered this way.
 *
 * Seen with production.view, materials.view or materials.purchase (prices as
 * the material-cost rule says); made and changed by buyers (materials.purchase);
 * attached and taken off by buyers and Production Managers.
 */

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000 };

const trimmed = (d: Prisma.Decimal) => d.toFixed(3).replace(/\.?0+$/, "") || "0";
const numberOf = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

function assertCanSeeBookings(ctx: CompanyContext) {
  assertAnyPermission(
    ctx,
    ["production.view", "materials.view", "materials.purchase"],
    "You do not have permission to see bookings.",
  );
}

const canAttach = (ctx: CompanyContext) =>
  ctx.can("materials.purchase") || ctx.can("production.manage");

function assertCanAttach(ctx: CompanyContext) {
  if (!canAttach(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Only buyers (materials.purchase) and Production Managers attach bookings to a batch.",
    );
  }
}

// =============================================================================
// Reading
// =============================================================================

const bookingInclude = {
  order: {
    select: {
      id: true,
      number: true,
      status: true,
      orderDate: true,
      expectedDate: true,
      supplierRef: true,
      totalAmount: true,
      notes: true,
      closedReason: true,
      closedAt: true,
      createdAt: true,
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          contactPerson: true,
          phone: true,
          address: true,
          city: true,
        },
      },
      batch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          quantity: true,
          receivedQty: true,
          unitPrice: true,
          amount: true,
          priceLater: true,
          description: true,
          imageId: true,
          specs: true,
          rawMaterial: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true,
              unit: true,
              color: true,
              specification: true,
            },
          },
          shares: {
            orderBy: { id: "asc" },
            select: {
              colorName: true,
              sizeName: true,
              quantity: true,
              project: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  },
  collarSizes: { orderBy: { sortOrder: "asc" } },
  collarColours: {
    orderBy: { sortOrder: "asc" },
    include: { quantities: { select: { sizeId: true, pieces: true, sets: true } } },
  },
} satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** A stored line's specification, or just its role when it cannot be read. */
export function readSpecs(json: Prisma.JsonValue, kind: RawMaterialKind): LineSpecs {
  const parsed = lineSpecsSchema.safeParse(json);
  return parsed.success ? parsed.data : { role: kind === "FABRIC" ? "FABRIC" : "TRIM" };
}

function presentCollar(b: BookingRow) {
  if (!b.collarStyle) return null;
  const sizes = b.collarSizes.map((s) => ({
    id: s.id,
    label: s.label,
    collarLength: s.collarLength.toNumber(),
    collarWidth: s.collarWidth.toNumber(),
    cuffLength: numberOf(s.cuffLength),
    cuffWidth: numberOf(s.cuffWidth),
  }));
  const colours = b.collarColours.map((c) => {
    const cell = (sizeId: string) => c.quantities.find((q) => q.sizeId === sizeId);
    return {
      id: c.id,
      garmentColour: c.garmentColour,
      collarColour: c.collarColour,
      tippingColour: c.tippingColour,
      pieces: sizes.map((s) => cell(s.id)?.pieces ?? 0),
      sets: sizes.map((s) => cell(s.id)?.sets ?? 0),
    };
  });
  const bySize = sizes.map((_, i) => colours.reduce((t, c) => t + c.sets[i]!, 0));
  const byColour = colours.map((c) => c.sets.reduce((t, n) => t + n, 0));
  return {
    style: b.collarStyle,
    extraPercent: b.collarExtraPercent.toNumber(),
    notes: b.collarNotes,
    sizes,
    colours,
    bySize,
    byColour,
    piecesBySize: sizes.map((_, i) => colours.reduce((t, c) => t + c.pieces[i]!, 0)),
    totalPieces: colours.reduce((t, c) => t + c.pieces.reduce((s, n) => s + n, 0), 0),
    totalSets: byColour.reduce((t, n) => t + n, 0),
  };
}

function presentBooking(ctx: CompanyContext, b: BookingRow) {
  const cost = costMask(ctx);
  const o = b.order;
  const day = localDay(new Date(), ctx.company.timezone);
  const expected = dateOnly(o.expectedDate);
  const state = orderState(o);
  const buy = ctx.can("materials.purchase");
  return {
    id: b.id,
    orderId: o.id,
    number: o.number,
    status: o.status,
    source: b.source,
    category: b.category,
    title: b.title,
    styleRef: b.styleRef,
    garmentPieces: b.garmentPieces,
    deliveryPlace: b.deliveryPlace,
    paymentTerms: b.paymentTerms,
    termsLanguage: b.termsLanguage,
    terms: b.terms,
    supplier: o.supplier,
    batch: o.batch,
    orderDate: dateOnly(o.orderDate)!,
    expectedDate: expected,
    isOverdue: OPEN_ORDER.includes(o.status) && expected !== null && expected < day,
    supplierRef: o.supplierRef,
    notes: o.notes,
    closedReason: o.closedReason,
    createdBy: o.createdBy,
    createdAt: o.createdAt,
    updatedAt: b.updatedAt,
    /** null for people who may not see material prices. */
    totalAmount: cost(o.totalAmount.toFixed(2)),
    lines: o.lines.map((l) => {
      const specs = readSpecs(l.specs, l.rawMaterial.kind);
      return {
        id: l.id,
        material: l.rawMaterial,
        role: specs.role,
        specs,
        quantity: trimmed(l.quantity),
        receivedQty: trimmed(l.receivedQty),
        pending: trimmed(pendingQuantity(l)),
        unitPrice: cost(l.unitPrice.toString()),
        amount: cost(l.amount.toFixed(2)),
        priceLater: l.priceLater,
        description: l.description,
        imageId: l.imageId,
        shares: l.shares.map((s) => ({
          project: s.project,
          colorName: s.colorName,
          sizeName: s.sizeName,
          quantity: trimmed(s.quantity),
        })),
      };
    }),
    collar: presentCollar(b),
    /** What this person may do with it now (the services refuse the rest). */
    can: {
      edit: buy && canChangeOrderLines(state).ok,
      editPaperwork: buy && canChangeOrder(state).ok,
      cancel: buy && canCancelOrder(state).ok,
      close: buy && canCloseOrder(state).ok,
      attach: canAttach(ctx) && !o.batch && canChangeOrder(state).ok,
      detach: canAttach(ctx) && Boolean(o.batch) && !state.received,
      /** On a batch: its central receive; on its own: a supplier bill on the order (buyers, Accounts). */
      receive:
        canReceiveOnOrder(state).ok && (o.batch ? buy : buy || ctx.can("accounts.payments.record")),
    },
  };
}

export type Booking = ReturnType<typeof presentBooking>;

export async function getBooking(ctx: CompanyContext, bookingId: string): Promise<Booking> {
  assertCanSeeBookings(ctx);
  const row = await ctx.db.booking.findUnique({
    where: { id: bookingId },
    include: bookingInclude,
  });
  if (!row) throw new AppError("NOT_FOUND", "Booking not found.");
  return presentBooking(ctx, row);
}

/** The bookings, newest first: the list screen's rows (no lines, a fabric total per unit). */
export async function listBookings(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeBookings(ctx);
  const q = listBookingsSchema.parse(raw);
  const take = q.take ?? 50;
  const cost = costMask(ctx);
  const day = localDay(new Date(), ctx.company.timezone);
  const and: Prisma.BookingWhereInput[] = [];
  if (q.source) and.push({ source: q.source });
  if (q.category) and.push({ category: q.category });
  if (q.status) and.push({ order: { status: q.status } });
  if (q.batchId) and.push({ order: { batchId: q.batchId } });
  if (q.supplierId) and.push({ order: { supplierId: q.supplierId } });
  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" } as const;
    and.push({
      OR: [
        { title: contains },
        { styleRef: contains },
        { order: { number: contains } },
        { order: { supplierRef: contains } },
        { order: { supplier: { name: contains } } },
      ],
    });
  }
  const rows = await ctx.db.booking.findMany({
    where: { AND: and },
    select: {
      id: true,
      source: true,
      category: true,
      title: true,
      styleRef: true,
      createdAt: true,
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          orderDate: true,
          expectedDate: true,
          totalAmount: true,
          supplier: { select: { id: true, name: true } },
          batch: { select: { id: true, code: true, name: true } },
          lines: {
            select: { quantity: true, rawMaterial: { select: { kind: true, unit: true } } },
          },
        },
      },
      collarColours: { select: { quantities: { select: { sets: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    items: page.map((b) => {
      const expected = dateOnly(b.order.expectedDate);
      const fabric = new Map<MeasurementUnit, Prisma.Decimal>();
      for (const l of b.order.lines) {
        if (l.rawMaterial.kind !== "FABRIC") continue;
        const unit = l.rawMaterial.unit;
        fabric.set(unit, (fabric.get(unit) ?? ZERO).plus(l.quantity));
      }
      return {
        id: b.id,
        number: b.order.number,
        status: b.order.status,
        source: b.source,
        category: b.category,
        title: b.title,
        styleRef: b.styleRef,
        supplier: b.order.supplier,
        batch: b.order.batch,
        orderDate: dateOnly(b.order.orderDate)!,
        expectedDate: expected,
        isOverdue: OPEN_ORDER.includes(b.order.status) && expected !== null && expected < day,
        totalAmount: cost(b.order.totalAmount.toFixed(2)),
        lineCount: b.order.lines.length,
        /** Fabric (or yarn) booked, per unit. */
        fabric: [...fabric].map(([unit, total]) => ({ unit, quantity: trimmed(total) })),
        collarSets: b.collarColours.reduce(
          (t, c) => t + c.quantities.reduce((s, q) => s + q.sets, 0),
          0,
        ),
      };
    }),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    can: { create: ctx.can("materials.purchase") },
  };
}

export type BookingList = Awaited<ReturnType<typeof listBookings>>;

// =============================================================================
// Making and changing
// =============================================================================

type Input = {
  source: BookingSource;
  category: GarmentCategory;
  collar?: CollarInput | null;
  lines: BookingLineInput[];
};

/** A line checked and worked out, its material found or still to be added. */
type PreparedLine = {
  materialId: string | null;
  wanted: { name: string; kind: RawMaterialKind; unit: MeasurementUnit } | null;
  kind: RawMaterialKind;
  unit: MeasurementUnit;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  priceLater: boolean;
  description: string | null;
  imageId: string | null;
  specs: LineSpecs;
};

/** The collar matrix with every cell's sets worked out. */
function prepareCollar(collar: CollarInput) {
  const totals = collarTotals({
    extraPercent: collar.extraPercent,
    sizes: collar.sizes,
    colours: collar.colours,
  });
  return { ...collar, totals };
}

type PreparedCollar = ReturnType<typeof prepareCollar>;

/** Drops the empty fields, so a line keeps only what was given. */
function compactSpecs(specs: LineSpecs): LineSpecs {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(specs)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  if (out.weight && !out.weightUnit) out.weightUnit = "GSM";
  return out as LineSpecs;
}

/**
 * Checks the lines and works out their quantities: the collar and cuff lines
 * from the matrix, a fabric line with pieces and consumption from the
 * calculator, the rest as typed. Fractions of whole units are refused.
 */
async function prepareLines(ctx: CompanyContext, input: Input) {
  const collar = input.collar ? prepareCollar(input.collar) : null;
  const known = await loadActiveMaterials(
    ctx,
    input.lines.flatMap((l) => (l.materialId ? [l.materialId] : [])),
  );
  await assertMaterialImages(
    ctx,
    input.lines.map((l) => l.imageId),
  );
  const lines: PreparedLine[] = input.lines.map((l, i) => {
    const material = l.materialId ? known.get(l.materialId)! : null;
    const kind = material?.kind ?? l.kind!;
    const unit = material?.unit ?? l.unit!;
    const label = material ? material.code : l.name!;
    const role: LineRole = l.specs.role ?? (kind === "FABRIC" ? "FABRIC" : "TRIM");
    const specs = compactSpecs({ ...l.specs, role });
    if ((role === "COLLAR" || role === "CUFF") && collar && unit !== "PCS" && unit !== "SET") {
      throw new AppError(
        "VALIDATION",
        `${label}: collars and cuffs are counted in pieces or sets.`,
        {
          [`lines.${i}.unit`]: ["Count it in pieces or sets"],
        },
      );
    }
    const fromMatrix = matrixQuantity(role, unit, collar ? collar.totals.totalSets : null);
    const fromCalculator =
      specs.pieces && specs.perDozen && specs.lossPercent != null
        ? fabricFor(specs.pieces, specs.perDozen, specs.lossPercent, unit)
        : null;
    const amount = fromMatrix ?? fromCalculator ?? l.quantity ?? null;
    if (!amount || amount <= 0) {
      throw new AppError("VALIDATION", `${label}: enter the quantity to book.`, {
        [`lines.${i}.quantity`]: ["Enter the quantity"],
      });
    }
    const quantity = qty(amount);
    assertUnitFits({ code: label, unit }, quantity, `lines.${i}.quantity`);
    return {
      materialId: material?.id ?? null,
      wanted: material ? null : { name: l.name!, kind, unit },
      kind,
      unit,
      quantity,
      unitPrice: unitCost(l.unitPrice ?? 0),
      priceLater: l.unitPrice === null || l.unitPrice === undefined,
      description: l.description ?? null,
      imageId: l.imageId ?? null,
      specs,
    };
  });
  if (collar && !lines.some((l) => l.specs.role === "COLLAR" || l.specs.role === "CUFF")) {
    throw new AppError(
      "VALIDATION",
      "The collar and cuff matrix needs a Collar or Cuff item to book: add one, or take the matrix off.",
      { collar: ["Add a Collar or Cuff item"] },
    );
  }
  return { lines, collar };
}

/**
 * The order lines as written: new materials added to the catalogue (with the
 * booking's supplier as their usual one), and, for a booking on a batch, each
 * line the batch's styles need shared out over their styles, colours and sizes.
 */
async function writeableLines(
  tx: Tx,
  ctx: CompanyContext,
  meta: RequestMeta | undefined,
  category: GarmentCategory,
  supplierId: string,
  prepared: PreparedLine[],
  plan: BatchMaterialPlan | null,
): Promise<NewOrderLine[]> {
  const toAdd = prepared.filter((l) => l.wanted);
  const added = await findOrAddMaterials(
    tx,
    ctx,
    meta,
    toAdd.map((l) => ({
      name: l.wanted!.name,
      kind: l.kind,
      unit: l.unit,
      color: l.specs.colour ?? null,
      specification: specsText(l.specs, category) || null,
      supplierId,
    })),
  );
  let next = 0;
  const rows = new Map(plan?.materials.map((m) => [m.material.id, m]) ?? []);
  return prepared.map((l) => {
    const materialId = l.materialId ?? added[next++]!;
    const row = rows.get(materialId);
    return {
      rawMaterialId: materialId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: money(l.quantity.times(l.unitPrice)),
      priceLater: l.priceLater,
      imageId: l.imageId ?? row?.imageId ?? null,
      description: l.description ?? (row?.placements.join(", ") || null),
      specs: l.specs as Prisma.InputJsonValue,
      shares: row ? sharesFor(l.quantity, row, l.unit) : undefined,
    };
  });
}

function sharesFor(
  quantity: Prisma.Decimal,
  row: BatchMaterialPlan["materials"][number],
  unit: MeasurementUnit,
) {
  return shareOut(quantity, row.parts, unit)
    .filter((s) => s.share.gt(0))
    .map((s) => ({
      projectId: s.projectId,
      colorName: s.colorName,
      sizeName: s.sizeName,
      quantity: s.share,
    }));
}

async function writeCollar(tx: Tx, bookingId: string, collar: PreparedCollar | null) {
  if (!collar) return;
  const sizeIds: string[] = [];
  for (const [i, s] of collar.sizes.entries()) {
    const created = await tx.bookingCollarSize.create({
      data: {
        bookingId,
        label: s.label,
        sortOrder: i,
        collarLength: s.collarLength,
        collarWidth: s.collarWidth,
        cuffLength: s.cuffLength ?? null,
        cuffWidth: s.cuffWidth ?? null,
      },
      select: { id: true },
    });
    sizeIds.push(created.id);
  }
  for (const [i, c] of collar.colours.entries()) {
    const cells = sizeIds
      .map((sizeId, j) => ({ sizeId, pieces: c.pieces[j] ?? 0, sets: collar.totals.sets[i]![j]! }))
      .filter((cell) => cell.pieces > 0);
    await tx.bookingCollarColour.create({
      data: {
        bookingId,
        sortOrder: i,
        garmentColour: c.garmentColour,
        collarColour: c.collarColour || c.garmentColour,
        tippingColour: c.tippingColour ?? null,
        ...(cells.length > 0 ? { quantities: { createMany: { data: cells } } } : {}),
      },
    });
  }
}

/** The booking's own fields, with the standard terms when none are given. */
function bookingFields(
  input: Input & {
    title?: string | null;
    styleRef?: string | null;
    garmentPieces?: number | null;
    deliveryPlace?: string | null;
    paymentTerms?: string | null;
    termsLanguage: "EN" | "BN";
    terms?: string | null;
  },
  collar: PreparedCollar | null,
) {
  return {
    source: input.source,
    category: input.category,
    title: input.title ?? null,
    styleRef: input.styleRef ?? null,
    garmentPieces: input.garmentPieces ?? null,
    deliveryPlace: input.deliveryPlace ?? null,
    paymentTerms: input.paymentTerms ?? null,
    termsLanguage: input.termsLanguage,
    terms:
      input.terms?.trim() ||
      standardTermsText(input.source, input.category, input.termsLanguage, {
        collar: Boolean(collar),
      }),
    collarStyle: collar?.style ?? null,
    collarExtraPercent: collar?.extraPercent ?? 0,
    collarNotes: collar?.notes ?? null,
  };
}

/** A batch a booking can go on, with what its open styles still need. */
async function batchPlan(ctx: CompanyContext, batchId: string) {
  const plan = await batchMaterialPlan(ctx, batchId);
  if (plan.styles.length === 0) {
    throw new AppError(
      "CONFLICT",
      `${plan.batch.code} has no open style to book for. Add a style to it first.`,
    );
  }
  return plan;
}

const bookingSummary = (
  number: string,
  source: BookingSource,
  category: GarmentCategory,
  supplier: string,
) =>
  `${number} (${SOURCE_LABELS[source].toLowerCase()}, ${CATEGORY_LABELS[category].toLowerCase()}) to ${supplier}`;

/**
 * A market purchase bought and collected goes into stock as it is saved: only
 * on its own (a batch's goods arrive through the batch's central receive), and
 * with every price known, since the bill is written at once.
 */
function assertCanReceiveNow(input: { source: BookingSource; batchId?: string | null }) {
  if (input.source !== "MARKET_PURCHASE") {
    throw new AppError(
      "VALIDATION",
      "Only a market purchase goes into stock as it is saved. A supplier PO is received when the goods arrive.",
      { receiveNow: ["Only for a market purchase"] },
    );
  }
  if (input.batchId) {
    throw new AppError(
      "VALIDATION",
      "A batch's goods are received in the batch's central receive. Save the booking, then receive it there.",
      { receiveNow: ["Not for a booking on a batch"] },
    );
  }
}

function assertPricesForReceive(lines: PreparedLine[]) {
  const fieldErrors: Record<string, string[]> = {};
  lines.forEach((l, i) => {
    if (l.priceLater) fieldErrors[`lines.${i}.unitPrice`] = ["Enter the price paid"];
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(
      "VALIDATION",
      "Enter the price paid for every item: the goods go into stock now.",
      fieldErrors,
    );
  }
  if (lines.every((l) => l.unitPrice.lte(0))) {
    throw new AppError("VALIDATION", "The bill total must be more than zero.", {
      lines: ["Enter the prices paid"],
    });
  }
}

/** How the goods of a booking saved with "add to stock now" went in. */
export type IntoStock = { bill: string } | { problem: string } | null;

export async function createBooking(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
): Promise<Booking & { intoStock: IntoStock }> {
  const input = createBookingSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  if (input.receiveNow) assertCanReceiveNow(input);
  const supplier = await assertPartyCanTransact(ctx, input.supplierId, "PURCHASE");
  const today = localDay(new Date(), ctx.company.timezone);
  if (input.expectedDate && input.expectedDate < today) {
    throw new AppError("VALIDATION", "The goods cannot be expected before today.", {
      expectedDate: ["Choose today or a later day"],
    });
  }
  const plan = input.batchId ? await batchPlan(ctx, input.batchId) : null;
  const { lines, collar } = await prepareLines(ctx, input);
  if (input.receiveNow) {
    assertPricesForReceive(lines);
    // The store must be there before anything is written.
    await resolveStore(ctx);
  }
  const saved = await runTransaction(async (tx) => {
    if (plan) await lockRow(tx, "ProductionBatch", plan.batch.id);
    const orderLines = await writeableLines(
      tx,
      ctx,
      meta,
      input.category,
      supplier.id,
      lines,
      plan,
    );
    const orderId = await insertPurchaseOrder(tx, ctx, meta, {
      supplier,
      project: null,
      batch: plan?.batch ?? null,
      orderDay: today,
      expectedDate: input.expectedDate ?? null,
      supplierRef: input.supplierRef ?? null,
      notes: input.notes ?? null,
      lines: orderLines,
      total: orderLines.reduce((t, l) => t.plus(l.amount), ZERO),
    });
    const booking = await tx.booking.create({
      data: { companyId: ctx.company.id, orderId, ...bookingFields(input, collar) },
      select: { id: true, order: { select: { number: true } } },
    });
    await writeCollar(tx, booking.id, collar);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Booking",
        entityId: booking.id,
        summary: `Booking ${bookingSummary(booking.order.number, input.source, input.category, supplier.name)}: ${lines.length} item(s)${
          collar ? `, ${collar.totals.totalSets} collar sets` : ""
        }${plan ? ` for ${plan.batch.code}` : ""}`,
      },
      tx,
    );
    return { id: booking.id, orderId };
  }, TX_OPTIONS);
  const intoStock = input.receiveNow ? await receiveInFull(ctx, saved.orderId, meta) : null;
  return { ...(await getBooking(ctx, saved.id)), intoStock };
}

/**
 * Receives everything on a just-saved market purchase into the main store, at
 * its prices, on a bill Due to the seller (Accounts pays it). The booking is
 * already saved: if this fails, the goods wait to be received the usual way.
 */
async function receiveInFull(
  ctx: CompanyContext,
  orderId: string,
  meta: RequestMeta | undefined,
): Promise<IntoStock> {
  const lines = await ctx.db.purchaseOrderLine.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
    select: { id: true, quantity: true },
  });
  try {
    const bill = await createPurchase(
      ctx,
      {
        purchaseOrderId: orderId,
        paymentType: "DUE",
        items: lines.map((l) => ({ purchaseOrderLineId: l.id, quantity: l.quantity.toNumber() })),
      },
      meta,
    );
    return { bill: bill.number };
  } catch (error) {
    if (!(error instanceof AppError)) console.error("[bookings] receive now failed", error);
    return {
      problem: error instanceof AppError ? error.message : "The goods could not go into stock.",
    };
  }
}

/** Locks the booking's order for the transaction and reads what the rules need. */
async function lockBooking(tx: Tx, ctx: CompanyContext, bookingId: string) {
  const found = await tx.booking.findFirst({
    where: { id: bookingId, companyId: ctx.company.id },
    select: { orderId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Booking not found.");
  await lockRow(tx, "PurchaseOrder", found.orderId);
  const order = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: found.orderId },
    select: {
      id: true,
      number: true,
      status: true,
      orderDate: true,
      batchId: true,
      supplier: { select: { name: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          receivedQty: true,
          rawMaterial: { select: { id: true, unit: true } },
        },
      },
    },
  });
  return { bookingId, order };
}

/** The order's expected day, never before the order day. */
function expectedColumn(expectedDate: string | null | undefined, orderDate: Date) {
  if (expectedDate === undefined) return undefined;
  if (expectedDate === null) return null;
  const column = dateColumn(expectedDate);
  if (column < orderDate) {
    throw new AppError("VALIDATION", "The goods cannot be expected before the booking date.", {
      expectedDate: ["Choose a day on or after the booking date"],
    });
  }
  return column;
}

/**
 * Changes everything on a booking nothing has arrived on: the supplier, the
 * garment family, the items and their specification, the collar matrix and the
 * terms. A booking on a batch shares its new lines out over the batch again.
 */
export async function updateBooking(
  ctx: CompanyContext,
  bookingId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateBookingSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  const current = await ctx.db.booking.findUnique({
    where: { id: bookingId },
    select: { order: { select: { batchId: true } } },
  });
  if (!current) throw new AppError("NOT_FOUND", "Booking not found.");
  const supplier = await assertPartyCanTransact(ctx, input.supplierId, "PURCHASE");
  const plan = current.order.batchId ? await batchMaterialPlan(ctx, current.order.batchId) : null;
  const { lines, collar } = await prepareLines(ctx, input);
  await runTransaction(async (tx) => {
    const { order } = await lockBooking(tx, ctx, bookingId);
    assertAllowed(canChangeOrderLines(orderState(order)));
    if (order.batchId !== (plan?.batch.id ?? null)) {
      throw new AppError(
        "CONFLICT",
        "The booking was attached or taken off a batch meanwhile; open it again.",
      );
    }
    const expectedDate = expectedColumn(input.expectedDate ?? null, order.orderDate);
    const orderLines = await writeableLines(
      tx,
      ctx,
      meta,
      input.category,
      supplier.id,
      lines,
      plan,
    );
    await tx.purchaseOrderLine.deleteMany({ where: { orderId: order.id } });
    for (const { shares, ...line } of orderLines) {
      await tx.purchaseOrderLine.create({
        data: {
          ...line,
          orderId: order.id,
          ...(shares?.length ? { shares: { create: shares } } : {}),
        },
      });
    }
    const total = orderLines.reduce((t, l) => t.plus(l.amount), ZERO);
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: {
        supplierId: supplier.id,
        expectedDate,
        supplierRef: input.supplierRef ?? null,
        notes: input.notes ?? null,
        totalAmount: total,
      },
    });
    await tx.bookingCollarSize.deleteMany({ where: { bookingId } });
    await tx.bookingCollarColour.deleteMany({ where: { bookingId } });
    await tx.booking.update({ where: { id: bookingId }, data: bookingFields(input, collar) });
    await writeCollar(tx, bookingId, collar);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Booking",
        entityId: bookingId,
        summary: `Updated booking ${bookingSummary(order.number, input.source, input.category, supplier.name)}: ${lines.length} item(s), ${total.toFixed(2)}${
          collar ? `, ${collar.totals.totalSets} collar sets` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getBooking(ctx, bookingId);
}

/**
 * The paperwork of an open booking, also after goods have arrived: the expected
 * day, references, delivery place, payment terms, the terms and their language.
 */
export async function updateBookingPaperwork(
  ctx: CompanyContext,
  bookingId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateBookingPaperworkSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  await runTransaction(async (tx) => {
    const { order } = await lockBooking(tx, ctx, bookingId);
    assertAllowed(canChangeOrder(orderState(order)));
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { source: true, category: true, collarStyle: true },
    });
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: {
        expectedDate: expectedColumn(input.expectedDate ?? null, order.orderDate),
        supplierRef: input.supplierRef ?? null,
        notes: input.notes ?? null,
      },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        title: input.title ?? null,
        styleRef: input.styleRef ?? null,
        deliveryPlace: input.deliveryPlace ?? null,
        paymentTerms: input.paymentTerms ?? null,
        termsLanguage: input.termsLanguage,
        terms:
          input.terms?.trim() ||
          standardTermsText(booking.source, booking.category, input.termsLanguage, {
            collar: Boolean(booking.collarStyle),
          }),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Booking",
        entityId: bookingId,
        summary: `Updated the paperwork of booking ${order.number} to ${order.supplier.name}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getBooking(ctx, bookingId);
}

async function orderIdOf(ctx: CompanyContext, bookingId: string) {
  const found = await ctx.db.booking.findUnique({
    where: { id: bookingId },
    select: { orderId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Booking not found.");
  return found.orderId;
}

/** Cancels a booking nothing has arrived on (the supplier will not deliver). */
export async function cancelBooking(
  ctx: CompanyContext,
  bookingId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  await cancelPurchaseOrder(ctx, await orderIdOf(ctx, bookingId), raw, meta);
  return getBooking(ctx, bookingId);
}

/** Closes a partly received booking: the rest will not come. */
export async function closeBooking(
  ctx: CompanyContext,
  bookingId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  await closePurchaseOrder(ctx, await orderIdOf(ctx, bookingId), raw, meta);
  return getBooking(ctx, bookingId);
}

// =============================================================================
// Batches
// =============================================================================

/**
 * Puts an open booking on a master batch: its goods are then received in the
 * batch's central receive, and each line the batch's styles need is shared out
 * over their styles, colours and sizes so it counts as ordered for them. Lines
 * no style needs stay on the booking without a share (listed in `unmatched`).
 */
export async function attachBooking(
  ctx: CompanyContext,
  bookingId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { batchId } = attachBookingSchema.parse(raw);
  assertCanAttach(ctx);
  const plan = await batchPlan(ctx, batchId);
  const rows = new Map(plan.materials.map((m) => [m.material.id, m]));
  const unmatched = await runTransaction(async (tx) => {
    const { order } = await lockBooking(tx, ctx, bookingId);
    await lockRow(tx, "ProductionBatch", plan.batch.id);
    if (order.batchId === plan.batch.id) {
      throw new AppError("CONFLICT", `${order.number} is already on ${plan.batch.code}.`);
    }
    if (order.batchId) {
      throw new AppError(
        "CONFLICT",
        `${order.number} is on another batch; take it off that batch first.`,
      );
    }
    assertAllowed(canChangeOrder(orderState(order)));
    const missing: string[] = [];
    for (const line of order.lines) {
      await tx.purchaseOrderLineShare.deleteMany({ where: { lineId: line.id } });
      const row = rows.get(line.rawMaterial.id);
      if (!row) {
        missing.push(line.rawMaterial.id);
        continue;
      }
      const shares = sharesFor(line.quantity, row, line.rawMaterial.unit);
      if (shares.length > 0) {
        await tx.purchaseOrderLineShare.createMany({
          data: shares.map((s) => ({ ...s, lineId: line.id })),
        });
      }
    }
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { batchId: plan.batch.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Booking",
        entityId: bookingId,
        summary: `Attached booking ${order.number} (${order.supplier.name}) to ${plan.batch.code}: ${
          order.lines.length - missing.length
        } of ${order.lines.length} item(s) count for its styles`,
      },
      tx,
    );
    return missing;
  }, TX_OPTIONS);
  const booking = await getBooking(ctx, bookingId);
  return {
    booking,
    /** Items no style of the batch needs (not counted as ordered for any style). */
    unmatched: booking.lines
      .filter((l) => unmatched.includes(l.material.id))
      .map((l) => `${l.material.code} ${l.material.name}`),
  };
}

/** Takes a booking off its batch while nothing has arrived on it. */
export async function detachBooking(ctx: CompanyContext, bookingId: string, meta?: RequestMeta) {
  assertCanAttach(ctx);
  await runTransaction(async (tx) => {
    const { order } = await lockBooking(tx, ctx, bookingId);
    if (!order.batchId) throw new AppError("CONFLICT", `${order.number} is not on a batch.`);
    if (orderState(order).received) {
      throw new AppError(
        "CONFLICT",
        `Goods have already arrived on ${order.number} for its batch, so it stays on it.`,
      );
    }
    const batch = await tx.productionBatch.findUniqueOrThrow({
      where: { id: order.batchId },
      select: { code: true },
    });
    await tx.purchaseOrderLineShare.deleteMany({
      where: { lineId: { in: order.lines.map((l) => l.id) } },
    });
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { batchId: null } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Booking",
        entityId: bookingId,
        summary: `Took booking ${order.number} (${order.supplier.name}) off ${batch.code}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getBooking(ctx, bookingId);
}

/** The batch page's bookings: those on the batch, and the open ones that could be attached. */
export async function getBatchBookings(ctx: CompanyContext, batchId: string) {
  assertCanSeeBookings(ctx);
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    select: { id: true, code: true, name: true },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  const select = {
    id: true,
    source: true,
    category: true,
    title: true,
    order: {
      select: {
        number: true,
        status: true,
        expectedDate: true,
        supplier: { select: { id: true, name: true } },
        lines: {
          select: {
            quantity: true,
            receivedQty: true,
            rawMaterial: { select: { kind: true, unit: true } },
          },
        },
      },
    },
  } satisfies Prisma.BookingSelect;
  const mayAttach = canAttach(ctx);
  const [attached, open] = await Promise.all([
    ctx.db.booking.findMany({
      where: { order: { batchId: batch.id } },
      select,
      orderBy: { createdAt: "asc" },
    }),
    mayAttach
      ? ctx.db.booking.findMany({
          where: { order: { batchId: null, status: { in: OPEN_ORDER } } },
          select,
          orderBy: { createdAt: "desc" },
          take: 40,
        })
      : Promise.resolve([]),
  ]);
  const present = (b: (typeof attached)[number]) => {
    const fabric = new Map<MeasurementUnit, Prisma.Decimal>();
    for (const l of b.order.lines) {
      if (l.rawMaterial.kind !== "FABRIC") continue;
      fabric.set(l.rawMaterial.unit, (fabric.get(l.rawMaterial.unit) ?? ZERO).plus(l.quantity));
    }
    const received = b.order.lines.some((l) => l.receivedQty.gt(0));
    return {
      id: b.id,
      number: b.order.number,
      status: b.order.status,
      source: b.source,
      category: b.category,
      title: b.title,
      supplier: b.order.supplier,
      expectedDate: dateOnly(b.order.expectedDate),
      itemCount: b.order.lines.length,
      fabric: [...fabric].map(([unit, total]) => ({ unit, quantity: trimmed(total) })),
      canDetach: mayAttach && !received,
    };
  };
  return {
    batch,
    attached: attached.map(present),
    attachable: open.map(present),
    can: { attach: mayAttach, create: ctx.can("materials.purchase") },
  };
}

export type BatchBookings = Awaited<ReturnType<typeof getBatchBookings>>;

/** Master batches with an open style, newest first: where a booking can be attached. */
export async function listAttachableBatches(ctx: CompanyContext) {
  assertCanAttach(ctx);
  return ctx.db.productionBatch.findMany({
    where: { projects: { some: { status: { in: [...OPEN_STATUSES] } } } },
    select: { id: true, code: true, name: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 60,
  });
}

// =============================================================================
// The wizard
// =============================================================================

/** A category guessed from the styles' product categories ("Polo" is knitwear). */
function guessCategory(names: Array<string | null | undefined>): GarmentCategory {
  const text = names.filter(Boolean).join(" ").toLowerCase();
  if (/sweater|cardigan|pullover|jumper/.test(text)) return "SWEATER";
  if (/jacket|vest|coat|hoodie|parka|outer/.test(text)) return "OUTERWEAR";
  if (/polo|t-?shirt|tee|knit|jersey|henley|tank/.test(text)) return "KNITWEAR";
  if (/shirt|trouser|pant|chino|denim|jean|woven|blouse/.test(text)) return "WOVEN";
  return "KNITWEAR";
}

type FormLine = {
  materialId: string | null;
  material: {
    id: string;
    code: string;
    name: string;
    kind: RawMaterialKind;
    unit: MeasurementUnit;
  } | null;
  name: string;
  kind: RawMaterialKind;
  unit: MeasurementUnit;
  quantity: string;
  unitPrice: string;
  description: string;
  imageId: string | null;
  specs: LineSpecs;
};

type FormCollar = {
  style: NonNullable<CollarInput["style"]>;
  extraPercent: number;
  notes: string;
  sizes: Array<{
    label: string;
    collarLength: number;
    collarWidth: number;
    cuffLength: number | null;
    cuffWidth: number | null;
  }>;
  colours: Array<{
    garmentColour: string;
    collarColour: string;
    tippingColour: string;
    pieces: number[];
  }>;
};

/** The batch's garment colours by collar size group, from its open styles' pieces. */
async function collarFromBatch(styleIds: string[]): Promise<FormCollar | null> {
  // The styles come from the batch's plan, read through the company's own client.
  const grids = await styleGrids(prisma, styleIds);
  const cells = [...grids.values()].flat().filter((c) => c.quantity > 0);
  if (cells.length === 0) return null;
  const sizes: FormCollar["sizes"] = DEFAULT_COLLAR_SIZES.map((s) => ({ ...s }));
  const colours = new Map<string, number[]>();
  for (const cell of cells) {
    let group = sizeGroupOf(
      cell.sizeName,
      sizes.map((s) => s.label),
    );
    if (group === -1) {
      const last = sizes[sizes.length - 1]!;
      sizes.push({ ...last, label: cell.sizeName });
      group = sizes.length - 1;
    }
    const row = colours.get(cell.colorName) ?? [];
    row[group] = (row[group] ?? 0) + cell.quantity;
    colours.set(cell.colorName, row);
  }
  return {
    style: "SOLID",
    extraPercent: DEFAULT_COLLAR_EXTRA,
    notes: "",
    sizes,
    colours: [...colours].map(([colour, pieces]) => ({
      garmentColour: colour,
      collarColour: colour,
      tippingColour: "",
      pieces: sizes.map((_, i) => pieces[i] ?? 0),
    })),
  };
}

/**
 * What the booking wizard starts with: a booking to change, or a new one (for
 * a batch: its fabric still to order, its garment colours in the collar matrix
 * and its other materials to add with a tap). Buyers only.
 */
export async function getBookingForm(
  ctx: CompanyContext,
  from: { bookingId?: string; batchId?: string } = {},
) {
  assertCanBuyMaterials(ctx);
  const today = localDay(new Date(), ctx.company.timezone);
  if (from.bookingId) {
    const b = await getBooking(ctx, from.bookingId);
    return {
      today,
      booking: {
        id: b.id,
        number: b.number,
        orderDate: b.orderDate,
        canChangeItems: b.can.edit,
        canChangePaperwork: b.can.editPaperwork,
      },
      batch: b.batch,
      batchMaterials: [] as BatchPick[],
      values: {
        source: b.source,
        category: b.category,
        supplier: { id: b.supplier.id, code: b.supplier.code ?? "", name: b.supplier.name },
        expectedDate: b.expectedDate ?? "",
        supplierRef: b.supplierRef ?? "",
        title: b.title ?? "",
        styleRef: b.styleRef ?? "",
        garmentPieces: b.garmentPieces,
        deliveryPlace: b.deliveryPlace ?? "",
        paymentTerms: b.paymentTerms ?? "",
        termsLanguage: b.termsLanguage,
        terms: b.terms,
        notes: b.notes ?? "",
        collar: b.collar
          ? ({
              style: b.collar.style,
              extraPercent: b.collar.extraPercent,
              notes: b.collar.notes ?? "",
              sizes: b.collar.sizes.map((s) => ({
                label: s.label,
                collarLength: s.collarLength,
                collarWidth: s.collarWidth,
                cuffLength: s.cuffLength,
                cuffWidth: s.cuffWidth,
              })),
              colours: b.collar.colours.map((c) => ({
                garmentColour: c.garmentColour,
                collarColour: c.collarColour,
                tippingColour: c.tippingColour ?? "",
                pieces: c.pieces,
              })),
            } satisfies FormCollar)
          : null,
        lines: b.lines.map((l): FormLine => ({
          materialId: l.material.id,
          material: {
            id: l.material.id,
            code: l.material.code,
            name: l.material.name,
            kind: l.material.kind,
            unit: l.material.unit,
          },
          name: l.material.name,
          kind: l.material.kind,
          unit: l.material.unit,
          quantity: l.quantity,
          unitPrice: l.priceLater ? "" : (l.unitPrice ?? ""),
          description: l.description ?? "",
          imageId: l.imageId,
          specs: l.specs,
        })),
      },
    };
  }
  let batch: { id: string; code: string; name: string } | null = null;
  let batchMaterials: BatchPick[] = [];
  let values = blankValues();
  if (from.batchId) {
    const plan = await batchPlan(ctx, from.batchId);
    batch = plan.batch;
    const styles = await ctx.db.productionProject.findMany({
      where: { id: { in: plan.styles.map((s) => s.id) } },
      select: { id: true, code: true, category: { select: { name: true } }, name: true },
    });
    const category = guessCategory(styles.flatMap((s) => [s.category?.name, s.name]));
    const pieces = plan.styles.reduce((t, s) => t + s.targetQuantity, 0);
    batchMaterials = plan.materials.map((m) => ({
      material: {
        id: m.material.id,
        code: m.material.code,
        name: m.material.name,
        kind: m.material.kind,
        unit: m.material.unit,
        color: m.material.color,
      },
      supplier: m.material.supplier,
      toOrder: trimmed(m.toOrder),
      needed: trimmed(m.needed),
      placements: m.placements,
      imageId: m.imageId,
    }));
    const fabric = batchMaterials.filter((m) => m.material.kind === "FABRIC" && m.toOrder !== "0");
    const suppliers = [...new Set(fabric.map((f) => f.supplier?.id).filter(Boolean))];
    const supplier = suppliers.length === 1 ? fabric[0]!.supplier : null;
    const preset = CATEGORY_PRESETS[category];
    values = {
      ...values,
      category,
      supplier: supplier
        ? { id: supplier.id, code: supplier.code ?? "", name: supplier.name }
        : null,
      title: plan.batch.name,
      styleRef: plan.styles
        .map((s) => s.code)
        .join(", ")
        .slice(0, 80),
      garmentPieces: pieces > 0 ? pieces : null,
      collar: preset.collarMatrix ? await collarFromBatch(plan.styles.map((s) => s.id)) : null,
      lines: fabric.map((f) => pickedLine(f)),
    };
  }
  return {
    today,
    booking: null,
    batch,
    batchMaterials,
    values,
  };
}

/** One of a batch's materials, to add to its booking with a tap. */
type BatchPick = {
  material: {
    id: string;
    code: string;
    name: string;
    kind: RawMaterialKind;
    unit: MeasurementUnit;
    color: string | null;
  };
  supplier: { id: string; code: string | null; name: string } | null;
  toOrder: string;
  needed: string;
  placements: string[];
  imageId: string | null;
};

function pickedLine(pick: BatchPick): FormLine {
  const role: LineRole =
    pick.material.kind === "FABRIC"
      ? "FABRIC"
      : /collar/i.test(`${pick.material.name} ${pick.placements.join(" ")}`)
        ? "COLLAR"
        : /cuff/i.test(`${pick.material.name} ${pick.placements.join(" ")}`)
          ? "CUFF"
          : "TRIM";
  return {
    materialId: pick.material.id,
    material: {
      id: pick.material.id,
      code: pick.material.code,
      name: pick.material.name,
      kind: pick.material.kind,
      unit: pick.material.unit,
    },
    name: pick.material.name,
    kind: pick.material.kind,
    unit: pick.material.unit,
    quantity: pick.toOrder === "0" ? "" : pick.toOrder,
    unitPrice: "",
    description: pick.placements.join(", "),
    imageId: pick.imageId,
    specs: { role, colour: pick.material.color },
  };
}

function blankValues() {
  return {
    source: "SUPPLIER_PO" as BookingSource,
    category: "KNITWEAR" as GarmentCategory,
    supplier: null as { id: string; code: string; name: string } | null,
    expectedDate: "",
    supplierRef: "",
    title: "",
    styleRef: "",
    garmentPieces: null as number | null,
    deliveryPlace: "",
    paymentTerms: "",
    termsLanguage: "EN" as "EN" | "BN",
    terms: "",
    notes: "",
    collar: null as FormCollar | null,
    lines: [] as FormLine[],
  };
}

export type BookingForm = Awaited<ReturnType<typeof getBookingForm>>;
export type BookingFormLine = FormLine;
export type BookingFormCollar = FormCollar;
export type BookingBatchPick = BatchPick;
