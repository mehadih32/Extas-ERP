import { Prisma } from "@prisma/client";

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

/** Where a booking stood before a change to its items. */
export type BeforeChange = {
  stage: "DRAFT" | "APPROVED" | "SENT";
  revision: number;
  /** The last approved snapshot it is compared with (null: never approved). */
  base: BookingSnapshot | null;
  wasSent: boolean;
};

/**
 * Read before a booking's items change: the approved snapshot the change is
 * compared with. A booking approved before revisions were kept (one made
 * earlier, counted as sent) gets its snapshot now, as revision 0.
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
      base: readSnapshot(kept?.snapshot),
      wasSent: readRevisionChanges(b.revisionChanges)?.wasSent ?? false,
    } satisfies BeforeChange;
  }
  const kept = await tx.bookingRevision.findUnique({
    where: { bookingId_revision: { bookingId, revision: b.revision } },
    select: { snapshot: true },
  });
  let base = readSnapshot(kept?.snapshot);
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
 * After a booking's items changed: an approved or sent booking becomes a draft
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
};

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
 * in-house date is set, and the styles it is for are ready. With Fabric first
 * on its batch, fabric waits for each style's fabric part to be locked and
 * everything else for the tech pack to be approved; without it, a tech pack
 * not yet approved is only a warning.
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
  // The styles it is for, and whether each line is fabric.
  const projects = new Map<string, { id: string; code: string; targetQuantity: number }>();
  const fabricFor = new Set<string>();
  const restFor = new Set<string>();
  for (const l of lines) {
    for (const s of l.shares) {
      projects.set(s.project.id, s.project);
      (l.specs.role === "FABRIC" ? fabricFor : restFor).add(s.project.id);
    }
  }
  if (projects.size > 0) {
    const states = await techPackStates(db, [...projects.values()]);
    const code = (id: string) => projects.get(id)!.code;
    const fabricFirst = Boolean(b.order.batch?.fabricFirstAt);
    if (fabricFirst) {
      const unlocked = [...fabricFor].filter((id) => !states.get(id)!.fabricLocked);
      const changed = [...fabricFor].filter(
        (id) => states.get(id)!.fabricLocked && states.get(id)!.changes.length > 0,
      );
      if (fabricFor.size > 0) {
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
      const waiting = [...restFor].filter((id) => states.get(id)!.status !== "APPROVED");
      if (restFor.size > 0) {
        checks.push(
          waiting.length === 0
            ? { text: "The tech packs of its styles are approved", state: "ok" }
            : {
                text: `Fabric first: trims wait for the tech pack of ${waiting.map(code).join(", ")} to be approved`,
                state: "block",
              },
        );
      }
    } else {
      const waiting = [...projects.keys()].filter((id) => states.get(id)!.status !== "APPROVED");
      checks.push(
        waiting.length === 0
          ? { text: "The tech packs of its styles are approved", state: "ok" }
          : {
              text: `The tech pack of ${waiting.map(code).join(", ")} is not approved yet`,
              state: "warn",
            },
      );
    }
  }
  return checks;
}

/** Refuses an approval while a check blocks it. */
export function assertChecksPass(number: string, checks: ApprovalCheck[]) {
  const blocks = checks.filter((c) => c.state === "block");
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
    if (readSpecs(s.line.specs, s.line.rawMaterial.kind).role !== "FABRIC") continue;
    projects.set(s.project.id, s.project);
  }
  if (projects.size === 0) return null;
  const parts = await fabricPartsOf(db, [...projects.values()]);
  return Object.fromEntries(parts) as Record<string, FabricPart>;
}

/** A style whose fabric changed after the booking was approved on it. */
export type StyleChange = {
  project: { id: string; code: string; name: string };
  changes: FabricChange[];
};

/**
 * The styles whose fabric changed since the booking was approved (fabricBasis):
 * once the booking has gone out, the supplier may be making the old fabric.
 */
export async function styleChangesSince(db: Db, fabricBasis: unknown): Promise<StyleChange[]> {
  const basis = readFabricBasis(fabricBasis);
  if (basis.size === 0) return [];
  const projects = await db.productionProject.findMany({
    where: { id: { in: [...basis.keys()] } },
    select: { id: true, code: true, name: true, targetQuantity: true },
    orderBy: { code: "asc" },
  });
  const parts = await fabricPartsOf(db, projects);
  return projects.flatMap((p) => {
    const changes = diffFabricParts(basis.get(p.id)!, parts.get(p.id)!);
    return changes.length > 0
      ? [{ project: { id: p.id, code: p.code, name: p.name }, changes }]
      : [];
  });
}
