import {
  Prisma,
  type SupplierCategory,
  SupplierFaultKind,
  SupplierFaultStatus,
} from "@prisma/client";
import { z } from "zod";

import { FAULT_KIND_LABELS } from "@/components/production/labels";
import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount } from "@/lib/format";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { lockSupplierAccount, settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import { recordPartyActivity } from "@/modules/parties/party.service";

/*
 * The supplier Fault Log: what each supplier or factory owes for (short
 * against the challan, faulty fabric, quality faults, missing pieces), with the
 * value to deduct. The batch receive logs shorts on its own; a Production
 * Manager or buyer logs the rest. Production Managers and Accounts mark an
 * entry deducted (taken off a payment) or waived, with a note; a mistake goes
 * back to open. Values follow the material-cost rule; the store sees the log
 * without them.
 *
 * Pieces spoiled at an embroidery or print house (a supplier of that type) are
 * that house's, never the factory's: taking them back logs the fault at the
 * fabric in a cut piece and takes it off the house's own Supplier Due at once
 * (Dr Accounts Payable, Cr Deductions from Suppliers). Reopening or waiving such
 * a fault reverses the entry; marking it deducted again posts it again. Other
 * faults are taken off by hand or by the factory's final CM settlement.
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
  cmSettlement: { select: { number: true, undoneAt: true } },
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
    /** The standing CM settlement that took it off (it changes only by undoing that). */
    cmSettlement: heldByCm(f.cmSettlement),
    photoId: f.photoId,
  };
}

/** The number of the CM settlement holding a fault, while that settlement stands. */
function heldByCm(settlement: { number: string; undoneAt: Date | null } | null) {
  return settlement && !settlement.undoneAt ? settlement.number : null;
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

/** An embroidery or print house: the pieces it spoils come off its own Supplier Due. */
export function chargesOwnSpoilage(categories: readonly SupplierCategory[]) {
  return categories.includes("EMBROIDERY_PRINT");
}

/** Whether a fault is taken off its supplier's Supplier Due by itself when deducted. */
function postsOnDeduct(f: {
  kind: SupplierFaultKind;
  amount: Prisma.Decimal | null;
  supplier: { supplierCategories: SupplierCategory[] };
}) {
  return (
    f.kind === "SPOILED_PIECES" &&
    f.amount !== null &&
    f.amount.gt(0) &&
    chargesOwnSpoilage(f.supplier.supplierCategories)
  );
}

/**
 * Takes a fault's value off its supplier's Supplier Due and marks it deducted:
 * Dr Accounts Payable (the supplier), Cr Deductions from Suppliers, settling
 * their oldest bills. In the caller's transaction, after lockSupplierAccount.
 */
export async function deductFaultTx(
  tx: Prisma.TransactionClient,
  ctx: CompanyContext,
  fault: { id: string; number: string; amount: Prisma.Decimal; note: string | null },
  supplier: { id: string; name: string },
  settledNote?: string,
) {
  const companyId = ctx.company.id;
  const acc = await ensureControlAccounts(companyId, tx);
  const entry = await postJournalEntry(tx, {
    companyId,
    description: `${fault.number}: spoiled pieces taken off ${supplier.name}'s Supplier Due`,
    sourceType: "SUPPLIER_FAULT",
    sourceId: fault.id,
    postedById: ctx.user.id,
    lines: [
      {
        accountId: acc.PAYABLE,
        partyId: supplier.id,
        debit: fault.amount,
        memo: `Fault ${fault.number}`,
      },
      {
        accountId: acc.SUPPLIER_DEDUCTIONS,
        credit: fault.amount,
        memo: fault.note ?? `Fault ${fault.number}`,
      },
    ],
  });
  await tx.supplierFault.update({
    where: { id: fault.id },
    data: {
      status: "DEDUCTED",
      settledAt: new Date(),
      settledById: ctx.user.id,
      settledNote: settledNote ?? `Taken off ${supplier.name}'s Supplier Due on ${entry.number}`,
      journalEntryId: entry.id,
    },
  });
  await settleSupplierBills(tx, companyId, supplier.id);
  await recordPartyActivity(supplier.id, new Date(), tx);
  return entry;
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
  const found = await ctx.db.supplierFault.findUnique({
    where: { id: faultId },
    select: { id: true, supplierId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Fault not found.");
  if (input.status === "WAIVED" && !input.note) {
    throw new AppError("VALIDATION", "Say why it is waived.", { note: ["Say why"] });
  }
  const companyId = ctx.company.id;
  const open = input.status === "OPEN";
  const done = await runTransaction(async (tx) => {
    // The supplier's account first (lock order): the fault may move their Supplier Due.
    await lockSupplierAccount(tx, companyId, found.supplierId);
    const fault = await tx.supplierFault.findUniqueOrThrow({
      where: { id: found.id },
      select: {
        id: true,
        number: true,
        kind: true,
        status: true,
        amount: true,
        note: true,
        journalEntryId: true,
        cmSettlement: { select: { number: true, undoneAt: true } },
        supplier: { select: { id: true, name: true, supplierCategories: true } },
      },
    });
    // A fault the CM settlement took off is in that settlement's entry, not its own:
    // changing it alone would leave the money off the factory's Supplier Due.
    const cm = heldByCm(fault.cmSettlement);
    if (cm) {
      throw new AppError(
        "CONFLICT",
        `Taken off the CM on ${cm}; undo that settlement to change it.`,
      );
    }
    if (fault.status === input.status) {
      throw new AppError("CONFLICT", `${fault.number} is already ${input.status.toLowerCase()}.`);
    }
    let entry: { number: string; undone: boolean } | null = null;
    if (fault.journalEntryId) {
      // Leaving "deducted": its value goes back on the supplier's Supplier Due.
      const reversal = await reverseJournalEntry(tx, fault.journalEntryId, {
        description: `${fault.number} ${open ? "put back to open" : "waived"}: back on ${fault.supplier.name}'s Supplier Due`,
        postedById: ctx.user.id,
      });
      await tx.supplierFault.update({ where: { id: fault.id }, data: { journalEntryId: null } });
      await settleSupplierBills(tx, companyId, fault.supplier.id);
      entry = { number: reversal.number, undone: true };
    }
    if (input.status === "DEDUCTED" && postsOnDeduct(fault)) {
      const made = await deductFaultTx(
        tx,
        ctx,
        { id: fault.id, number: fault.number, amount: fault.amount!, note: fault.note },
        fault.supplier,
        input.note ?? undefined,
      );
      entry = { number: made.number, undone: false };
    } else {
      await tx.supplierFault.update({
        where: { id: fault.id },
        data: {
          status: input.status,
          settledAt: open ? null : new Date(),
          settledById: open ? null : ctx.user.id,
          settledNote: open ? null : (input.note ?? null),
        },
      });
    }
    const value = fault.amount ? formatAmount(fault.amount, 2, ctx.company.currency) : "";
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SupplierFault",
        entityId: fault.id,
        summary: `${fault.number} (${fault.supplier.name}) ${open ? "put back to open" : input.status === "DEDUCTED" ? "marked deducted" : "waived"}${input.note ? `: ${input.note}` : ""}${
          entry
            ? entry.undone
              ? `; ${value} back on their Supplier Due (${entry.number})`
              : `; ${value} taken off their Supplier Due (${entry.number})`
            : ""
        }`,
      },
      tx,
    );
    return { number: fault.number, entry: entry?.number ?? null };
  });
  return { id: found.id, number: done.number, status: input.status, entry: done.entry };
}
