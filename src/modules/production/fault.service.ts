import { Prisma, SupplierFaultKind, SupplierFaultStatus } from "@prisma/client";
import { z } from "zod";

import { FAULT_KIND_LABELS } from "@/components/production/labels";
import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeMaterialCosts } from "@/modules/materials/access";

/*
 * The supplier Fault Log: what each supplier or factory owes for (short
 * against the challan, faulty fabric, quality faults, missing pieces), with the
 * value to deduct. The batch receive logs shorts on its own; a Production
 * Manager or buyer logs the rest. Production Managers and Accounts mark an
 * entry deducted (taken off a payment) or waived, with a note; a mistake goes
 * back to open. Values follow the material-cost rule; the store sees the log
 * without them.
 */

const id = z.string().min(1);

export const listFaultsSchema = z.object({
  status: z.enum(SupplierFaultStatus).optional(),
  supplierId: id.optional(),
  batchId: id.optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

export const createFaultSchema = z.object({
  supplierId: id,
  kind: z.enum(SupplierFaultKind),
  batchId: id.nullish(),
  projectId: id.nullish(),
  materialId: id.nullish(),
  quantity: z.number().positive().max(100_000_000).multipleOf(0.001).nullish(),
  amount: z.number().min(0).max(1_000_000_000).multipleOf(0.01).nullish(),
  note: z.string().trim().min(3, "Say what was wrong").max(1000),
  occurredOn: z.iso.date().optional(),
  /** A photo of the fault (an uploaded file of this company). */
  photoId: id.nullish(),
});

export const settleFaultSchema = z.object({
  status: z.enum(SupplierFaultStatus),
  note: z.string().trim().max(500).nullish(),
});

/** Who may read the log (Production, buyers, the store, Accounts). */
export function canSeeFaults(ctx: Pick<CompanyContext, "can">) {
  return ctx.can("production.view") || ctx.can("materials.view") || ctx.can("accounts.view");
}

function assertCanSee(ctx: CompanyContext) {
  if (!canSeeFaults(ctx)) {
    throw new AppError("FORBIDDEN", "The fault log is for Production, the store and Accounts.");
  }
}

/** Logging a fault by hand: Production Managers and buyers. */
export function canLogFaults(ctx: Pick<CompanyContext, "can">) {
  return ctx.can("production.manage") || ctx.can("materials.purchase");
}

/** Marking a fault deducted or waived: Production Managers and Accounts. */
export function canSettleFaults(ctx: Pick<CompanyContext, "can">) {
  return ctx.can("production.manage") || ctx.can("accounts.payments.record");
}

const faultSelect = {
  id: true,
  number: true,
  kind: true,
  status: true,
  quantity: true,
  amount: true,
  note: true,
  occurredOn: true,
  settledAt: true,
  settledNote: true,
  createdAt: true,
  supplier: { select: { id: true, code: true, name: true } },
  batch: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  rawMaterial: { select: { id: true, code: true, name: true, unit: true } },
  bill: { select: { id: true, number: true } },
  createdBy: { select: { name: true } },
  settledBy: { select: { name: true } },
  photoId: true,
} satisfies Prisma.SupplierFaultSelect;

type FaultRow = Prisma.SupplierFaultGetPayload<{ select: typeof faultSelect }>;

/** A fault as plain values (amounts as "1250.00", days as "2026-10-08"); values masked by role. */
function present(ctx: CompanyContext, f: FaultRow) {
  const tz = ctx.company.timezone;
  const costs = canSeeMaterialCosts(ctx);
  return {
    id: f.id,
    number: f.number,
    kind: f.kind,
    status: f.status,
    quantity: f.quantity ? f.quantity.toFixed(3).replace(/\.?0+$/, "") : null,
    amount: costs && f.amount ? f.amount.toFixed(2) : null,
    note: f.note,
    occurredOn: dateOnly(f.occurredOn),
    settledOn: f.settledAt ? localDay(f.settledAt, tz) : null,
    settledNote: f.settledNote,
    settledBy: f.settledBy?.name ?? null,
    loggedBy: f.createdBy?.name ?? null,
    supplier: { id: f.supplier.id, code: f.supplier.code ?? "", name: f.supplier.name },
    batch: f.batch,
    project: f.project,
    material: f.rawMaterial,
    bill: f.bill,
    photoId: f.photoId,
  };
}

export type FaultItem = ReturnType<typeof present>;

/** The log, newest first, by status, supplier or batch; with the open total per supplier. */
export async function listFaults(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSee(ctx);
  const q = listFaultsSchema.parse(raw);
  const take = q.take ?? 50;
  const where: Prisma.SupplierFaultWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.supplierId ? { supplierId: q.supplierId } : {}),
    ...(q.batchId ? { batchId: q.batchId } : {}),
  };
  const rows = await ctx.db.supplierFault.findMany({
    where,
    select: faultSelect,
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const open = await ctx.db.supplierFault.groupBy({
    by: ["supplierId"],
    where: { ...where, status: "OPEN" },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const names = new Map(rows.map((r) => [r.supplier.id, r.supplier.name]));
  const missing = open.filter((o) => !names.has(o.supplierId)).map((o) => o.supplierId);
  if (missing.length > 0) {
    for (const p of await ctx.db.party.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true },
    })) {
      names.set(p.id, p.name);
    }
  }
  const costs = canSeeMaterialCosts(ctx);
  return {
    items: rows.slice(0, take).map((f) => present(ctx, f)),
    nextCursor: rows.length > take ? rows[take - 1]!.id : null,
    openBySupplier: open
      .map((o) => ({
        supplier: { id: o.supplierId, name: names.get(o.supplierId) ?? "" },
        count: o._count._all,
        amount: costs ? (o._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) : null,
      }))
      .sort((a, b) => b.count - a.count || a.supplier.name.localeCompare(b.supplier.name)),
    can: { log: canLogFaults(ctx), settle: canSettleFaults(ctx), seeAmounts: costs },
  };
}

export type FaultList = Awaited<ReturnType<typeof listFaults>>;

/** Logs a fault by hand (a Fabric Fault Note, a quality fault, missing pieces). */
export async function createFault(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createFaultSchema.parse(raw);
  if (!canLogFaults(ctx)) {
    throw new AppError("FORBIDDEN", "Only Production Managers and buyers log supplier faults.");
  }
  const today = localDay(new Date(), ctx.company.timezone);
  if (input.occurredOn && input.occurredOn > today) {
    throw new AppError("VALIDATION", "A fault cannot be logged for a later day.", {
      occurredOn: ["Choose today or an earlier day"],
    });
  }
  const supplier = await ctx.db.party.findUnique({
    where: { id: input.supplierId },
    select: { id: true, name: true, kind: true },
  });
  if (!supplier || supplier.kind === "BUYER") {
    throw new AppError("NOT_FOUND", "Supplier not found.");
  }
  const [batch, project, material, photo] = await Promise.all([
    input.batchId
      ? ctx.db.productionBatch.findUnique({ where: { id: input.batchId }, select: { id: true } })
      : null,
    input.projectId
      ? ctx.db.productionProject.findUnique({
          where: { id: input.projectId },
          select: { id: true, batchId: true },
        })
      : null,
    input.materialId
      ? ctx.db.rawMaterial.findUnique({ where: { id: input.materialId }, select: { id: true } })
      : null,
    input.photoId
      ? ctx.db.fileAsset.findUnique({ where: { id: input.photoId }, select: { id: true } })
      : null,
  ]);
  if (input.batchId && !batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  if (input.projectId && !project) throw new AppError("NOT_FOUND", "Production project not found.");
  if (input.materialId && !material) throw new AppError("NOT_FOUND", "Raw material not found.");
  if (input.photoId && !photo) throw new AppError("NOT_FOUND", "Photo not found.");
  return prisma.$transaction((tx) =>
    logFaultTx(tx, ctx, meta, {
      supplier,
      kind: input.kind,
      batchId: batch?.id ?? project?.batchId ?? null,
      projectId: project?.id ?? null,
      rawMaterialId: material?.id ?? null,
      quantity: input.quantity ?? null,
      amount: input.amount ?? null,
      note: input.note,
      occurredOn: input.occurredOn ?? today,
      photoId: photo?.id ?? null,
    }),
  );
}

/**
 * Writes a fault and its audit line in the caller's transaction, for a
 * supplier and records already checked (createFault, and the missing pieces
 * of a full packing list at finishing).
 */
export async function logFaultTx(
  tx: Prisma.TransactionClient,
  ctx: CompanyContext,
  meta: RequestMeta | undefined,
  data: {
    supplier: { id: string; name: string };
    kind: SupplierFaultKind;
    batchId: string | null;
    projectId: string | null;
    rawMaterialId: string | null;
    quantity: number | null;
    amount: number | null;
    note: string;
    occurredOn: string;
    photoId: string | null;
  },
) {
  const made = await tx.supplierFault.create({
    data: {
      companyId: ctx.company.id,
      number: await nextDocumentNumber(tx, ctx.company.id, "SUPPLIER_FAULT"),
      supplierId: data.supplier.id,
      kind: data.kind,
      batchId: data.batchId,
      projectId: data.projectId,
      rawMaterialId: data.rawMaterialId,
      quantity: data.quantity,
      amount: data.amount,
      note: data.note,
      occurredOn: dateColumn(data.occurredOn),
      photoId: data.photoId,
      createdById: ctx.user.id,
    },
    select: { id: true, number: true },
  });
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "SupplierFault",
      entityId: made.id,
      summary: `Logged ${made.number} for ${data.supplier.name}: ${FAULT_KIND_LABELS[data.kind].toLowerCase()}${data.amount ? `, ${data.amount.toFixed(2)} to deduct` : ""}`,
    },
    tx,
  );
  return made;
}

/** Marks a fault deducted or waived (with a note), or puts it back to open. */
export async function settleFault(
  ctx: CompanyContext,
  faultId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = settleFaultSchema.parse(raw);
  if (!canSettleFaults(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Only Production Managers and Accounts mark faults deducted or waived.",
    );
  }
  const fault = await ctx.db.supplierFault.findUnique({
    where: { id: faultId },
    select: { id: true, number: true, status: true, supplier: { select: { name: true } } },
  });
  if (!fault) throw new AppError("NOT_FOUND", "Fault not found.");
  if (fault.status === input.status) {
    throw new AppError("CONFLICT", `${fault.number} is already ${input.status.toLowerCase()}.`);
  }
  if (input.status === "WAIVED" && !input.note) {
    throw new AppError("VALIDATION", "Say why it is waived.", { note: ["Say why"] });
  }
  const open = input.status === "OPEN";
  await prisma.$transaction(async (tx) => {
    await tx.supplierFault.update({
      where: { id: fault.id },
      data: {
        status: input.status,
        settledAt: open ? null : new Date(),
        settledById: open ? null : ctx.user.id,
        settledNote: open ? null : (input.note ?? null),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SupplierFault",
        entityId: fault.id,
        summary: `${fault.number} (${fault.supplier.name}) ${open ? "put back to open" : input.status === "DEDUCTED" ? "marked deducted" : "waived"}${input.note ? `: ${input.note}` : ""}`,
      },
      tx,
    );
  });
  return { id: fault.id, number: fault.number, status: input.status };
}
