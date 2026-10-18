import { type MeasurementUnit, Prisma, type RawMaterialKind } from "@prisma/client";

import { dateOnly } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { matrixQuantity, specsText } from "@/modules/production/booking-math";
import {
  type BookingSnapshot,
  diffSnapshots,
  fabricAtRisk,
  readRevisionChanges,
  type RevisionChanges,
} from "@/modules/production/booking-revisions";
import { readSpecs } from "@/modules/production/booking-schemas";
import {
  type FabricChange,
  type FabricPart,
  diffFabricParts,
  readFabricBasis,
} from "@/modules/production/tech-pack";
import { fabricPartsOf, techPackStates } from "@/modules/production/tech-pack-approval.service";
import { OPEN_STATUSES } from "@/modules/production/timeline";

/*
 * What a booking's approval rests on: the snapshot kept for each approved
 * revision (and compared with when the booking changes), the checks run
 * before it is approved, and the styles' fabric parts it was approved on (to
 * show when a style's fabric changes after the booking went out). The
 * approving itself is in booking.service.ts.
 */

type Tx = Prisma.TransactionClient;

const trimmed = (d: Prisma.Decimal) => d.toFixed(3).replace(/\.?0+$/, "") || "0";

const snapshotSelect = {
  category: true,
  garmentPieces: true,
  deliveryPlace: true,
  paymentTerms: true,
  termsLanguage: true,
  terms: true,
  collarStyle: true,
  collarExtraPercent: true,
  collarSizes: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true } },
  collarColours: {
    orderBy: { sortOrder: "asc" },
    select: { garmentColour: true, quantities: { select: { sizeId: true, sets: true } } },
  },
  order: {
    select: {
      number: true,
      expectedDate: true,
      supplier: { select: { id: true, name: true } },
      batch: { select: { code: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          quantity: true,
          unitPrice: true,
          priceLater: true,
          specs: true,
          rawMaterial: { select: { code: true, name: true, kind: true, unit: true } },
          shares: {
            orderBy: { id: "asc" },
            select: {
              projectId: true,
              colorName: true,
              sizeName: true,
              quantity: true,
              project: { select: { code: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BookingSelect;

type SnapshotRow = Prisma.BookingGetPayload<{ select: typeof snapshotSelect }>;

/** What a booking says, as kept when it is approved. */
export function snapshotOf(b: SnapshotRow): BookingSnapshot {
  const seen = new Map<string, number>();
  const lines = b.order.lines.map((l) => {
    const specs = readSpecs(l.specs, l.rawMaterial.kind);
    // The same material booked twice (rib for collars and for cuffs) keeps two lines apart.
    const n = (seen.get(l.rawMaterial.code) ?? 0) + 1;
    seen.set(l.rawMaterial.code, n);
    const shares = new Map<string, Prisma.Decimal>();
    for (const s of l.shares) {
      const label = [s.project.code, s.colorName, s.sizeName].filter(Boolean).join(" · ");
      shares.set(label, (shares.get(label) ?? new Prisma.Decimal(0)).plus(s.quantity));
    }
    return {
      code: n === 1 ? l.rawMaterial.code : `${l.rawMaterial.code} (${n})`,
      name: l.rawMaterial.name,
      unit: l.rawMaterial.unit,
      quantity: trimmed(l.quantity),
      unitPrice: l.unitPrice.toString(),
      priceLater: l.priceLater,
      role: specs.role,
      specs: [specs.colour, specsText(specs, b.category)].filter(Boolean).join(" · "),
      shares: [...shares].map(([label, quantity]) => ({ label, quantity: trimmed(quantity) })),
    };
  });
  const sizes = new Map(b.collarSizes.map((s) => [s.id, s.label]));
  return {
    number: b.order.number,
    supplier: b.order.supplier,
    expectedDate: dateOnly(b.order.expectedDate),
    garmentPieces: b.garmentPieces,
    lines,
    collar: b.collarStyle
      ? {
          style: b.collarStyle,
          extraPercent: b.collarExtraPercent.toNumber(),
          totalSets: b.collarColours.reduce(
            (t, c) => t + c.quantities.reduce((s, q) => s + q.sets, 0),
            0,
          ),
          cells: b.collarColours.flatMap((c) =>
            b.collarSizes.flatMap((s) => {
              const cell = c.quantities.find((q) => q.sizeId === s.id);
              return cell
                ? [{ label: `${c.garmentColour} · ${sizes.get(s.id)}`, sets: cell.sets }]
                : [];
            }),
          ),
        }
      : null,
    batch: b.order.batch?.code ?? null,
    paperwork: {
      deliveryPlace: b.deliveryPlace,
      paymentTerms: b.paymentTerms,
      termsLanguage: b.termsLanguage,
      terms: b.terms,
    },
  };
}

async function loadSnapshotRow(db: Db, bookingId: string) {
  return db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: snapshotSelect });
}

/** What a booking says now, as kept when it is approved. */
export async function bookingSnapshot(db: Db, bookingId: string): Promise<BookingSnapshot> {
  return snapshotOf(await loadSnapshotRow(db, bookingId));
}

/** Reads a kept snapshot (null when it cannot be read). */
export function readSnapshot(json: unknown): BookingSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Partial<BookingSnapshot>;
  if (typeof value.number !== "string" || !Array.isArray(value.lines) || !value.supplier) {
    return null;
  }
  return value as BookingSnapshot;
}

// =============================================================================
// Revisions
// =============================================================================

/** Where a booking stood before it changed. */
export type BeforeChange = {
  stage: "DRAFT" | "APPROVED" | "SENT";
  revision: number;
  /** The last approved snapshot it is compared with (null: never approved). */
  base: BookingSnapshot | null;
  wasSent: boolean;
};

/**
 * A snapshot kept before v6.3 has no paperwork and no batch: they are taken
 * as they stand now (before the change) and kept with it, so a change to them
 * from now on makes a revision too.
 */
async function completed(
  tx: Tx,
  bookingId: string,
  revision: number,
  base: BookingSnapshot | null,
): Promise<BookingSnapshot | null> {
  if (!base || (base.paperwork && base.batch !== undefined)) return base;
  const now = await bookingSnapshot(tx, bookingId);
  const whole: BookingSnapshot = {
    ...base,
    batch: base.batch === undefined ? now.batch : base.batch,
    paperwork: base.paperwork ?? now.paperwork,
  };
  await tx.bookingRevision.updateMany({
    where: { bookingId, revision },
    data: { snapshot: whole as unknown as Prisma.InputJsonValue },
  });
  return whole;
}

/**
 * Read before a booking changes (its items, its paperwork or its batch): the
 * approved snapshot the change is compared with. A booking approved before
 * revisions were kept (one made earlier, counted as sent) gets its snapshot
 * now, as revision 0.
 */
export async function beforeChange(tx: Tx, companyId: string, bookingId: string) {
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      stage: true,
      revision: true,
      revisionChanges: true,
      approvedAt: true,
      approvedById: true,
      sentAt: true,
      createdAt: true,
    },
  });
  if (b.stage === "DRAFT") {
    if (b.revision === 0) {
      return { stage: b.stage, revision: 0, base: null, wasSent: false } satisfies BeforeChange;
    }
    const kept = await tx.bookingRevision.findUnique({
      where: { bookingId_revision: { bookingId, revision: b.revision - 1 } },
      select: { snapshot: true },
    });
    return {
      stage: b.stage,
      revision: b.revision,
      base: await completed(tx, bookingId, b.revision - 1, readSnapshot(kept?.snapshot)),
      wasSent: readRevisionChanges(b.revisionChanges)?.wasSent ?? false,
    } satisfies BeforeChange;
  }
  const kept = await tx.bookingRevision.findUnique({
    where: { bookingId_revision: { bookingId, revision: b.revision } },
    select: { snapshot: true },
  });
  let base = await completed(tx, bookingId, b.revision, readSnapshot(kept?.snapshot));
  if (!base) {
    base = await bookingSnapshot(tx, bookingId);
    await tx.bookingRevision.upsert({
      where: { bookingId_revision: { bookingId, revision: b.revision } },
      create: {
        companyId,
        bookingId,
        revision: b.revision,
        snapshot: base as unknown as Prisma.InputJsonValue,
        approvedAt: b.approvedAt ?? b.sentAt ?? b.createdAt,
        approvedById: b.approvedById,
      },
      update: { snapshot: base as unknown as Prisma.InputJsonValue },
    });
  }
  return {
    stage: b.stage,
    revision: b.revision,
    base,
    wasSent: b.stage === "SENT",
  } satisfies BeforeChange;
}

/**
 * After a booking changed: an approved or sent booking becomes a draft
 * of its next revision (R1, R2...) listing what changed, and the fabric at risk
 * when the last one had been sent; a draft revision's list is brought up to
 * date. Nothing changes when the items came out the same. Says whether it made
 * a new revision.
 */
export async function afterChange(tx: Tx, bookingId: string, before: BeforeChange) {
  if (!before.base) return null;
  const now = await bookingSnapshot(tx, bookingId);
  const changes = diffSnapshots(before.base, now);
  const from = before.stage === "DRAFT" ? before.revision - 1 : before.revision;
  const record: RevisionChanges = {
    from,
    wasSent: before.wasSent,
    changes,
    atRisk: before.wasSent ? fabricAtRisk(before.base, now) : [],
  };
  if (before.stage === "DRAFT") {
    await tx.booking.update({
      where: { id: bookingId },
      data: { revisionChanges: record as unknown as Prisma.InputJsonValue },
    });
    return null;
  }
  if (changes.length === 0) return null;
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      stage: "DRAFT",
      revision: before.revision + 1,
      revisionChanges: record as unknown as Prisma.InputJsonValue,
      approvedAt: null,
      approvedById: null,
      sentAt: null,
      sentById: null,
    },
  });
  return { revision: before.revision + 1, record };
}

// =============================================================================
// Checks before approval
// =============================================================================

export type ApprovalCheck = {
  text: string;
  /** ok: passed; block: must be put right first; warn: may be approved anyway. */
  state: "ok" | "block" | "warn";
  /** A block the owner may approve past, giving a reason (kept in the activity log). */
  override?: true;
};

/** A fabric line: booked as fabric and its material is a fabric. */
const isFabricLine = (specs: { role?: string }, kind: RawMaterialKind) =>
  specs.role === "FABRIC" && kind === "FABRIC";

const checkSelect = {
  stage: true,
  collarStyle: true,
  collarColours: { select: { quantities: { select: { sets: true } } } },
  order: {
    select: {
      number: true,
      status: true,
      expectedDate: true,
      batch: { select: { id: true, code: true, fabricFirstAt: true } },
      project: { select: { id: true, code: true, targetQuantity: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          quantity: true,
          specs: true,
          rawMaterial: { select: { code: true, kind: true, unit: true } },
          shares: {
            select: {
              quantity: true,
              project: { select: { id: true, code: true, targetQuantity: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BookingSelect;

/**
 * The checks a booking passes before it is approved: it books something, each
 * item's shares add up to it, the collar and cuff items match the matrix, the
 * in-house date is set, and the styles it is for are ready:
 *  - collar, cuff and trims wait for each style's tech pack to be approved, and
 *    again while its trims part changed since (v6.4.2), until it is approved
 *    again (the owner may approve past either, giving a reason);
 *  - fabric, with Fabric first on its batch, waits for each style's fabric part
 *    to be locked; without it, a tech pack not yet approved is only a warning.
 * On a batch, an item in no style's materials list counts for every open style
 * of the batch, so the gate cannot be skipped by booking something unlisted.
 * Off any batch, a booking is for no style (a booking that goes on a batch
 * later is approved again), unless its order is kept for one style: then that
 * style's tech pack counts.
 */
export async function approvalChecks(db: Db, bookingId: string): Promise<ApprovalCheck[]> {
  const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: checkSelect });
  const checks: ApprovalCheck[] = [];
  const lines = b.order.lines.map((l) => ({ ...l, specs: readSpecs(l.specs, l.rawMaterial.kind) }));
  checks.push(
    lines.length > 0
      ? { text: `Books ${lines.length} item(s)`, state: "ok" }
      : { text: "Add at least one item to book", state: "block" },
  );
  const uneven = lines.filter((l) => {
    if (l.shares.length === 0) return false;
    const sum = l.shares.reduce((t, s) => t.plus(s.quantity), new Prisma.Decimal(0));
    return !sum.equals(l.quantity);
  });
  checks.push(
    uneven.length === 0
      ? { text: "Each item's style shares add up to it", state: "ok" }
      : {
          text: `The style shares of ${uneven.map((l) => l.rawMaterial.code).join(", ")} do not add up to what is booked: save the booking again`,
          state: "block",
        },
  );
  if (b.collarStyle) {
    const sets = b.collarColours.reduce(
      (t, c) => t + c.quantities.reduce((s, q) => s + q.sets, 0),
      0,
    );
    const off = lines.filter((l) => {
      const want = matrixQuantity(l.specs.role, l.rawMaterial.unit, sets);
      return want !== null && !l.quantity.equals(want);
    });
    checks.push(
      off.length === 0
        ? { text: "Collars and cuffs match the matrix", state: "ok" }
        : {
            text: `${off.map((l) => l.rawMaterial.code).join(", ")} do not match the collar and cuff matrix: save the booking again`,
            state: "block",
          },
    );
  }
  checks.push(
    b.order.expectedDate
      ? { text: "In-house date set", state: "ok" }
      : { text: "Set the in-house date (Deliver by) in the paperwork", state: "block" },
  );
  // The styles it is for, and whether each line is fabric: its material too, not only
  // the role kept on the line (an older line may say fabric for buttons).
  const projects = new Map<string, { id: string; code: string; targetQuantity: number }>();
  const fabricFor = new Set<string>();
  const restFor = new Set<string>();
  const setFor = (l: (typeof lines)[number]) =>
    isFabricLine(l.specs, l.rawMaterial.kind) ? fabricFor : restFor;
  for (const l of lines) {
    for (const s of l.shares) {
      projects.set(s.project.id, s.project);
      setFor(l).add(s.project.id);
    }
  }
  const batch = b.order.batch;
  // Off any batch, an order kept for one style waits for that style's tech pack.
  const own = !batch ? b.order.project : null;
  if (own) {
    for (const l of lines.filter((l) => l.shares.length === 0)) {
      projects.set(own.id, own);
      setFor(l).add(own.id);
    }
  }
  const unlisted = batch ? lines.filter((l) => l.shares.length === 0) : [];
  if (batch && unlisted.length > 0) {
    const styles = await db.productionProject.findMany({
      where: { batchId: batch.id, status: { in: [...OPEN_STATUSES] } },
      select: { id: true, code: true, targetQuantity: true },
      orderBy: { code: "asc" },
    });
    for (const l of unlisted) {
      for (const st of styles) {
        projects.set(st.id, st);
        setFor(l).add(st.id);
      }
    }
    if (styles.length > 0) {
      checks.push({
        text: `${unlisted.map((l) => l.rawMaterial.code).join(", ")} ${unlisted.length === 1 ? "is" : "are"} in no style's materials list: counted for every style of ${batch.code}`,
        state: "warn",
      });
    }
  }
  if (projects.size > 0) {
    const states = await techPackStates(db, [...projects.values()]);
    const code = (id: string) => projects.get(id)!.code;
    const notApproved = (ids: Set<string>) =>
      [...ids].filter((id) => states.get(id)!.status !== "APPROVED");
    const fabricFirst = Boolean(batch?.fabricFirstAt);
    if (fabricFirst && fabricFor.size > 0) {
      const unlocked = [...fabricFor].filter((id) => !states.get(id)!.fabricLocked);
      const changed = [...fabricFor].filter(
        (id) => states.get(id)!.fabricLocked && states.get(id)!.changes.length > 0,
      );
      checks.push(
        unlocked.length === 0 && changed.length === 0
          ? { text: "Fabric first: each style's fabric part is locked", state: "ok" }
          : {
              text: [
                unlocked.length > 0
                  ? `Fabric first: lock the fabric part of ${unlocked.map(code).join(", ")}`
                  : null,
                changed.length > 0
                  ? `the fabric of ${changed.map(code).join(", ")} changed since it was locked: lock it again`
                  : null,
              ]
                .filter(Boolean)
                .join("; "),
              state: "block",
            },
      );
    }
    const restWaiting = notApproved(restFor);
    // Approved, but its trims, collar or cuff changed since: they wait to be approved again.
    const trimsChanged = [...restFor].filter(
      (id) => states.get(id)!.status === "APPROVED" && states.get(id)!.trimsChanges.length > 0,
    );
    const fabricWaiting = fabricFirst ? [] : notApproved(fabricFor);
    if (restWaiting.length > 0) {
      checks.push({
        text: `Collar, cuff and trims wait for the tech pack of ${restWaiting.map(code).join(", ")} to be approved`,
        state: "block",
        override: true,
      });
    }
    if (trimsChanged.length > 0) {
      checks.push({
        text: `The trims of ${trimsChanged.map(code).join(", ")} changed since the tech pack was approved: collar, cuff and trims wait for them to be approved again`,
        state: "block",
        override: true,
      });
    }
    if (fabricWaiting.length > 0) {
      checks.push({
        text: `The tech pack of ${fabricWaiting.map(code).join(", ")} is not approved yet`,
        state: "warn",
      });
    }
    const gated = restFor.size > 0 || (!fabricFirst && fabricFor.size > 0);
    if (
      gated &&
      restWaiting.length === 0 &&
      trimsChanged.length === 0 &&
      fabricWaiting.length === 0
    ) {
      checks.push({ text: "The tech packs of its styles are approved", state: "ok" });
    }
  }
  return checks;
}

/**
 * Refuses an approval while a check blocks it. With the owner's reason, the
 * blocks the owner may approve past (override) let it through; the others never.
 */
export function assertChecksPass(number: string, checks: ApprovalCheck[], reason?: string) {
  const blocks = checks.filter((c) => c.state === "block" && !(reason && c.override));
  if (blocks.length > 0) {
    throw new AppError(
      "CONFLICT",
      `${number} cannot be approved yet: ${blocks.map((c) => c.text).join("; ")}.`,
    );
  }
}

/** The fabric parts of the styles a booking's fabric is for, as kept when it is approved. */
export async function fabricBasisOf(db: Db, bookingId: string) {
  const shares = await db.purchaseOrderLineShare.findMany({
    where: { line: { order: { booking: { id: bookingId } } } },
    select: {
      line: { select: { specs: true, rawMaterial: { select: { kind: true } } } },
      project: { select: { id: true, targetQuantity: true } },
    },
  });
  const projects = new Map<string, { id: string; targetQuantity: number }>();
  for (const s of shares) {
    if (!isFabricLine(readSpecs(s.line.specs, s.line.rawMaterial.kind), s.line.rawMaterial.kind)) {
      continue;
    }
    projects.set(s.project.id, s.project);
  }
  if (projects.size === 0) return null;
  const parts = await fabricPartsOf(db, [...projects.values()]);
  return Object.fromEntries(parts) as Record<string, FabricPart>;
}

/** Fabric booked, per unit. */
export type FabricAmount = { unit: MeasurementUnit; quantity: string };

/** A style whose fabric changed after the booking was approved on it. */
export type StyleChange = {
  project: { id: string; code: string; name: string };
  changes: FabricChange[];
  /** The fabric this booking has for the style: made to the old fabric part. */
  atRisk: FabricAmount[];
};

const addUp = (amounts: Map<MeasurementUnit, Prisma.Decimal>): FabricAmount[] =>
  [...amounts].map(([unit, total]) => ({ unit, quantity: trimmed(total) }));

/** The fabric each booking has for each style, per unit (its fabric lines' shares). */
async function fabricShares(db: Db, bookingIds: string[], projectIds: string[]) {
  const shares = await db.purchaseOrderLineShare.findMany({
    where: {
      projectId: { in: projectIds },
      line: { order: { booking: { id: { in: bookingIds } } } },
    },
    select: {
      projectId: true,
      quantity: true,
      line: {
        select: {
          specs: true,
          rawMaterial: { select: { kind: true, unit: true } },
          order: { select: { booking: { select: { id: true } } } },
        },
      },
    },
  });
  const byBooking = new Map<string, Map<string, Map<MeasurementUnit, Prisma.Decimal>>>();
  for (const s of shares) {
    if (!isFabricLine(readSpecs(s.line.specs, s.line.rawMaterial.kind), s.line.rawMaterial.kind)) {
      continue;
    }
    const bookingId = s.line.order.booking?.id;
    if (!bookingId) continue;
    const styles = byBooking.get(bookingId) ?? new Map();
    byBooking.set(bookingId, styles);
    const units = styles.get(s.projectId) ?? new Map<MeasurementUnit, Prisma.Decimal>();
    styles.set(s.projectId, units);
    const unit = s.line.rawMaterial.unit;
    units.set(unit, (units.get(unit) ?? new Prisma.Decimal(0)).plus(s.quantity));
  }
  return byBooking;
}

/**
 * The styles whose fabric changed since the booking was approved (fabricBasis),
 * with the fabric the booking has for each: once the booking has gone out, the
 * supplier may be making the old fabric.
 */
export async function styleChangesSince(
  db: Db,
  fabricBasis: unknown,
  bookingId: string,
): Promise<StyleChange[]> {
  const basis = readFabricBasis(fabricBasis);
  if (basis.size === 0) return [];
  const projects = await db.productionProject.findMany({
    where: { id: { in: [...basis.keys()] } },
    select: { id: true, code: true, name: true, targetQuantity: true },
    orderBy: { code: "asc" },
  });
  const parts = await fabricPartsOf(db, projects);
  const changed = projects.flatMap((p) => {
    const changes = diffFabricParts(basis.get(p.id)!, parts.get(p.id)!);
    return changes.length > 0
      ? [{ project: { id: p.id, code: p.code, name: p.name }, changes }]
      : [];
  });
  if (changed.length === 0) return [];
  const booked = await fabricShares(
    db,
    [bookingId],
    changed.map((c) => c.project.id),
  );
  const styles = booked.get(bookingId);
  return changed.map((c) => ({ ...c, atRisk: addUp(styles?.get(c.project.id) ?? new Map()) }));
}

/** A red flag for a list: the styles whose fabric changed and the fabric at risk. */
export type FabricRisk = { styles: string[]; atRisk: FabricAmount[] };

/**
 * For the booking list and the batch page: each approved or sent booking whose
 * styles' fabric changed since it was approved, with the fabric it has for
 * them. One read for all the rows.
 */
export async function fabricRisks(
  db: Db,
  rows: ReadonlyArray<{ id: string; fabricBasis: unknown }>,
): Promise<Map<string, FabricRisk>> {
  const risks = new Map<string, FabricRisk>();
  const bases = rows
    .map((r) => ({ id: r.id, basis: readFabricBasis(r.fabricBasis) }))
    .filter((r) => r.basis.size > 0);
  if (bases.length === 0) return risks;
  const ids = [...new Set(bases.flatMap((r) => [...r.basis.keys()]))];
  const projects = await db.productionProject.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, targetQuantity: true },
    orderBy: { code: "asc" },
  });
  const parts = await fabricPartsOf(db, projects);
  const changedFor = new Map<string, typeof projects>();
  for (const r of bases) {
    const changed = projects.filter(
      (p) => r.basis.has(p.id) && diffFabricParts(r.basis.get(p.id)!, parts.get(p.id)!).length > 0,
    );
    if (changed.length > 0) changedFor.set(r.id, changed);
  }
  if (changedFor.size === 0) return risks;
  const booked = await fabricShares(db, [...changedFor.keys()], ids);
  for (const [bookingId, changed] of changedFor) {
    const total = new Map<MeasurementUnit, Prisma.Decimal>();
    for (const p of changed) {
      for (const [unit, quantity] of booked.get(bookingId)?.get(p.id) ?? []) {
        total.set(unit, (total.get(unit) ?? new Prisma.Decimal(0)).plus(quantity));
      }
    }
    risks.set(bookingId, { styles: changed.map((p) => p.code), atRisk: addUp(total) });
  }
  return risks;
}
