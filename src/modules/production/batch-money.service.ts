import { PaymentMethod, Prisma, type ProductionStatus } from "@prisma/client";
import { z } from "zod";

import { FAULT_KIND_LABELS } from "@/components/production/labels";
import { amountInWords } from "@/lib/amount-words";
import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount, formatDay } from "@/lib/format";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { ZERO } from "@/modules/accounts/balances";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { paySupplier } from "@/modules/accounts/supplier-payment.service";
import { lockSupplierAccount, settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import {
  cmAgreedText,
  cmFor,
  cmPieces,
  cmSettlementMath,
  type CmStyleLine,
  rejectPenalty,
} from "@/modules/production/batch-money";
import { canSettleFaults } from "@/modules/production/fault.service";
import { finishingProjectSelect, stateOf } from "@/modules/production/finishing.service";
import { recordPartyActivity } from "@/modules/parties/party.service";
import { assertCanSeeProductionCosts } from "@/modules/production/project-costs";
import { settledByProject } from "@/modules/production/settlement.service";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * A master batch's money with its factory and suppliers:
 *   - Advance CM: Accounts pays the factory (or a fabric supplier) for the batch;
 *     the payment settles the bills of the batch's styles first and what is left
 *     stays on their ledger as an advance (supplier-settlement.ts). Accessories
 *     suppliers run on one continuous ledger and are never paid by batch.
 *   - The final CM settlement: each style's CM (its CM a piece × the A, B, C and
 *     rejected pieces the factory handed over), less the factory's open faults on
 *     the batch with a value (missing pieces at the final unit cost, fabric
 *     faults...), the rejects over the batch's allowance (2% of the pieces cut
 *     unless changed) at the style's target price and, when the person settling
 *     chooses, the CM of the C-grade pieces, less the advance taken and what was
 *     paid for the styles:
 *       Total CM - Deductions - Advance taken = Final payable.
 *     Saving it marks those faults deducted, keeps a statement (CMS-), printed
 *     as the factory's final bill, and takes the deductions off the factory's
 *     Supplier Due at once (Dr Accounts Payable, Cr Deductions from Suppliers);
 *     that settles the bills of the batch's styles first, like a batch payment.
 *     The factory's bills and payments are on their ledger already, so nothing
 *     else is posted. Undoing it puts the faults back and reverses the entry.
 * Production Managers and Accounts see it; they (who mark faults deducted) save
 * and undo it. Only Accounts pays.
 */

type Db = Prisma.TransactionClient;

const fixed = (value: Prisma.Decimal) => value.toFixed(2);

export const payForBatchSchema = z.object({
  /** The batch's factory when left out. */
  supplierId: z.string().min(1).optional(),
  amount: z
    .number()
    .positive("Enter the amount")
    .max(1_000_000_000)
    .multipleOf(0.01, "Up to 2 decimal places"),
  paymentDate: z.iso.date().optional(),
  method: z.enum(PaymentMethod).default("CASH"),
  accountId: z.string().min(1).optional(),
  reference: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const settleCmSchema = z.object({
  /** Take the CM of the C-grade pieces off too (asked each time). */
  deductCGrade: z.boolean(),
  note: z.string().trim().max(1000).nullish(),
});

export const undoCmSettlementSchema = z.object({
  reason: z.string().trim().min(3, "Say why it is undone").max(500),
});

const batchSelect = {
  id: true,
  code: true,
  name: true,
  rejectTolerancePercent: true,
  factory: {
    select: { id: true, code: true, name: true, phone: true, supplierCategories: true },
  },
} satisfies Prisma.ProductionBatchSelect;

async function loadBatch(db: Db, ctx: CompanyContext, batchId: string) {
  const batch = await db.productionBatch.findFirst({
    where: { id: batchId, companyId: ctx.company.id },
    select: batchSelect,
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  return batch;
}

const livePayment = { journalEntry: { is: { isReversed: false } } } as const;

/** Payments to a supplier for the batch (advances) and for its styles, oldest first. */
async function paymentsFor(
  db: Db,
  ctx: CompanyContext,
  batchId: string,
  styleIds: string[],
  supplierId?: string,
) {
  const rows = await db.payment.findMany({
    where: {
      companyId: ctx.company.id,
      direction: "PAID",
      ...(supplierId ? { partyId: supplierId } : { partyId: { not: null } }),
      OR: [{ batchId }, { projectId: { in: styleIds } }],
      ...livePayment,
    },
    select: {
      id: true,
      number: true,
      paymentDate: true,
      amount: true,
      method: true,
      reference: true,
      notes: true,
      batchId: true,
      party: { select: { id: true, name: true } },
      project: { select: { id: true, code: true } },
    },
    orderBy: [{ paymentDate: "asc" }, { number: "asc" }],
  });
  const tz = ctx.company.timezone;
  return rows.map((p) => ({
    id: p.id,
    number: p.number,
    on: localDay(p.paymentDate, tz),
    amount: fixed(p.amount),
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    supplier: p.party!,
    /** null: an advance for the whole batch. */
    style: p.batchId ? null : p.project,
  }));
}

// =============================================================================
// Paying for a batch (Advance CM)
// =============================================================================

/**
 * Accounts pays the batch's factory (or another supplier) for the batch: an
 * advance on the CM, or a fabric payment settled with the batch's styles.
 */
export async function payForBatch(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = payForBatchSchema.parse(raw);
  const batch = await loadBatch(prisma, ctx, batchId);
  const supplierId = input.supplierId ?? batch.factory?.id;
  if (!supplierId) {
    throw new AppError("VALIDATION", `${batch.code} has no factory. Choose who is paid.`, {
      supplierId: ["Choose who is paid"],
    });
  }
  const paid = await paySupplier(
    ctx,
    {
      supplierId,
      batchId: batch.id,
      amount: input.amount,
      paymentDate: input.paymentDate,
      method: input.method,
      accountId: input.accountId,
      reference: input.reference ?? undefined,
      notes:
        input.notes ||
        (supplierId === batch.factory?.id
          ? `Advance CM for ${batch.code}`
          : `Advance for ${batch.code}`),
    },
    meta,
  );
  return {
    id: paid.id,
    number: paid.number,
    amount: paid.amount,
    supplier: paid.supplier,
    advanceLeft: paid.advanceLeft,
  };
}

/** The batch's money panel: what was paid for it, by whom, and where its CM settlement stands. */
export async function getBatchMoney(ctx: CompanyContext, batchId: string) {
  assertCanSeeProductionCosts(ctx);
  const batch = await loadBatch(prisma, ctx, batchId);
  const styles = await prisma.productionProject.findMany({
    where: { batchId: batch.id, companyId: ctx.company.id },
    select: { id: true },
  });
  const [payments, standing] = await Promise.all([
    paymentsFor(
      prisma,
      ctx,
      batch.id,
      styles.map((s) => s.id),
    ),
    standingSettlement(prisma, ctx, batch.id),
  ]);
  const advances = payments.filter((p) => p.style === null);
  const total = advances.reduce((t, p) => t.plus(p.amount), new Prisma.Decimal(0));
  return {
    batch: { id: batch.id, code: batch.code },
    factory: batch.factory
      ? {
          id: batch.factory.id,
          code: batch.factory.code,
          name: batch.factory.name,
          /** Fabric and factory suppliers settle by project; accessories run on one ledger. */
          byProject: settledByProject(batch.factory.supplierCategories),
        }
      : null,
    advances,
    advanceTotal: fixed(total),
    settlement: standing
      ? { id: standing.id, number: standing.number, payable: fixed(standing.payable) }
      : null,
    can: {
      pay: ctx.can("accounts.payments.record"),
      settle: canSettleFaults(ctx),
    },
  };
}

export type BatchMoney = Awaited<ReturnType<typeof getBatchMoney>>;

// =============================================================================
// The final CM settlement
// =============================================================================

function standingSettlement(db: Db, ctx: CompanyContext, batchId: string) {
  return db.cmSettlement.findFirst({
    where: { companyId: ctx.company.id, batchId, undoneAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** One style on the settlement: its pieces by grade, its CM a piece and its CM. */
type SettlementStyle = {
  id: string;
  code: string;
  name: string;
  status: ProductionStatus;
  cmRate: string | null;
  /** The CM per dozen, when it was agreed per dozen (null: per piece, and on older settlements). */
  cmPerDozen: string | null;
  a: number;
  b: number;
  c: number;
  reject: number;
  /** Lost or stolen: never paid for (their cost is in the fault log). */
  missing: number;
  pieces: number;
  cm: string | null;
  cGradeCm: string | null;
  /** The full packing list's number, once received. */
  packed: string | null;
  /** Pieces cut and handed to the factory (spoiled ones taken off); null on older settlements. */
  cut: number | null;
  /** Rejects that cost the factory nothing: the batch's allowance of the pieces cut. */
  allowance: number | null;
  /** Rejects over the allowance, each charged at the target price. */
  overAllowance: number;
  /** The style's target price a piece, which each reject over the allowance is charged at. */
  targetPrice: string | null;
  rejectPenalty: string;
};

/** The settlement as it would be saved now, from the styles' finishing, the faults and the payments. */
async function draftOf(db: Db, ctx: CompanyContext, batchId: string) {
  const batch = await loadBatch(db, ctx, batchId);
  const factory = batch.factory;
  const projects = await db.productionProject.findMany({
    where: { batchId: batch.id, companyId: ctx.company.id, status: { not: "CANCELLED" } },
    select: {
      ...finishingProjectSelect,
      cmRate: true,
      cmPer: true,
      cmPerDozen: true,
      targetUnitCost: true,
    },
    orderBy: { code: "asc" },
  });
  const percent = batch.rejectTolerancePercent;
  const styles: SettlementStyle[] = [];
  const lines: CmStyleLine[] = [];
  const penalties: Prisma.Decimal[] = [];
  for (const p of projects) {
    const state = await stateOf(db, ctx, p);
    const t = state.totals;
    const perDozen = p.cmPer === "DOZEN" ? p.cmPerDozen : null;
    const line: CmStyleLine = {
      cmRate: p.cmRate,
      cmPerDozen: perDozen,
      a: t.a,
      b: t.b,
      c: t.c,
      reject: t.reject,
    };
    const cm = cmFor(line, cmPieces(line));
    const cGradeCm = cmFor(line, t.c);
    // The pieces the factory was handed: cut and good, or what it accounted for when no cut is kept.
    const cut = t.cut ?? t.a + t.b + t.c + t.reject + t.missing;
    const rule = rejectPenalty({ cut, rejects: t.reject, percent, rate: p.targetUnitCost });
    penalties.push(rule.penalty);
    styles.push({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      cmRate: p.cmRate ? fixed(p.cmRate) : null,
      cmPerDozen: perDozen ? fixed(perDozen) : null,
      a: t.a,
      b: t.b,
      c: t.c,
      reject: t.reject,
      missing: t.missing,
      pieces: cmPieces(line),
      cm: cm ? fixed(cm) : null,
      cGradeCm: cGradeCm ? fixed(cGradeCm) : null,
      packed: state.packed ? state.packed.number : null,
      cut,
      allowance: rule.allowance,
      overAllowance: rule.over,
      targetPrice: p.targetUnitCost ? fixed(p.targetUnitCost) : null,
      rejectPenalty: fixed(rule.penalty),
    });
    lines.push(line);
  }
  const styleIds = projects.map((p) => p.id);
  const faultRows = factory
    ? await db.supplierFault.findMany({
        where: {
          companyId: ctx.company.id,
          supplierId: factory.id,
          status: "OPEN",
          OR: [{ batchId: batch.id }, { projectId: { in: styleIds } }],
        },
        select: {
          id: true,
          number: true,
          kind: true,
          quantity: true,
          amount: true,
          note: true,
          occurredOn: true,
          project: { select: { code: true } },
        },
        orderBy: [{ occurredOn: "asc" }, { number: "asc" }],
      })
    : [];
  const faults = faultRows.map((f) => ({
    id: f.id,
    number: f.number,
    kind: f.kind,
    what: FAULT_KIND_LABELS[f.kind],
    style: f.project?.code ?? null,
    quantity: f.quantity ? f.quantity.toFixed(3).replace(/\.?0+$/, "") : null,
    /** null: the value is still to agree, so it is not taken off. */
    amount: f.amount ? fixed(f.amount) : null,
    note: f.note,
    on: dateOnly(f.occurredOn),
  }));
  const payments = factory ? await paymentsFor(db, ctx, batch.id, styleIds, factory.id) : [];
  const advance = payments
    .filter((p) => p.style === null)
    .reduce((t, p) => t.plus(p.amount), new Prisma.Decimal(0));
  const forStyles = payments
    .filter((p) => p.style !== null)
    .reduce((t, p) => t.plus(p.amount), new Prisma.Decimal(0));
  const valued = faults.flatMap((f) => (f.amount ? [f.amount] : []));
  const math = (deductCGrade: boolean) => {
    const m = cmSettlementMath({
      styles: lines,
      faults: valued,
      rejectPenalties: penalties,
      deductCGrade,
      paid: advance.plus(forStyles),
    });
    return {
      totalCm: fixed(m.totalCm),
      faults: fixed(m.faults),
      /** Rejects over the allowance, at the styles' target price. */
      rejects: fixed(m.rejects),
      cGradeCm: fixed(m.cGradeCm),
      deductions: fixed(m.deductions),
      advance: fixed(advance),
      paidForStyles: fixed(forStyles),
      paid: fixed(m.paid),
      payable: fixed(m.payable),
    };
  };
  const noRate = styles.filter((s) => s.cmRate === null && s.pieces > 0).map((s) => s.code);
  const notPacked = styles.filter((s) => !s.packed && s.status !== "COMPLETED").map((s) => s.code);
  // Rejects over the allowance with no target price to charge them at.
  const noTarget = styles
    .filter((s) => s.overAllowance > 0 && s.targetPrice === null)
    .map((s) => s.code);
  return {
    batch: { id: batch.id, code: batch.code, name: batch.name },
    /** Rejects up to this share of the pieces cut cost the factory nothing ("2"). */
    rejectAllowancePercent: percent.toFixed(2).replace(/\.?0+$/, ""),
    factory: factory
      ? { id: factory.id, code: factory.code, name: factory.name, phone: factory.phone }
      : null,
    styles,
    faults,
    payments,
    cGradePieces: styles.reduce((t, s) => t + s.c, 0),
    /** The sums without and with the C-grade CM taken off. */
    keepC: math(false),
    deductC: math(true),
    warnings: { noRate, notPacked, noTarget },
  };
}

type Draft = Awaited<ReturnType<typeof draftOf>>;

/** What a saved settlement keeps: the draft as it stood, with the choice made. */
type Snapshot = Omit<Draft, "keepC" | "deductC" | "rejectAllowancePercent"> & {
  /** null on settlements saved before the reject allowance. */
  rejectAllowancePercent: string | null;
  deductCGrade: boolean;
  totals: Draft["keepC"];
};

/** A saved snapshot, with what settlements saved before the reject allowance did not keep. */
function readSnapshot(value: Prisma.JsonValue): Snapshot {
  const raw = value as unknown as Snapshot;
  return {
    ...raw,
    rejectAllowancePercent: raw.rejectAllowancePercent ?? null,
    styles: raw.styles.map((st) => ({
      ...st,
      cut: st.cut ?? null,
      allowance: st.allowance ?? null,
      overAllowance: st.overAllowance ?? 0,
      targetPrice: st.targetPrice ?? null,
      rejectPenalty: st.rejectPenalty ?? "0.00",
      cmPerDozen: st.cmPerDozen ?? null,
    })),
    warnings: { ...raw.warnings, noTarget: raw.warnings?.noTarget ?? [] },
    totals: { ...raw.totals, rejects: raw.totals.rejects ?? "0.00" },
  };
}

const settlementInclude = {
  createdBy: { select: { name: true } },
  undoneBy: { select: { name: true } },
  journalEntry: { select: { id: true, number: true } },
} as const satisfies Prisma.CmSettlementInclude;

function present(
  ctx: CompanyContext,
  s: Prisma.CmSettlementGetPayload<{ include: typeof settlementInclude }>,
) {
  const snapshot = readSnapshot(s.snapshot);
  return {
    id: s.id,
    number: s.number,
    settledOn: dateOnly(s.settledOn),
    deductCGrade: s.deductCGrade,
    deductions: fixed(s.deductions),
    /** The entry that took the deductions off the factory's Supplier Due. */
    posted: s.journalEntry ? { id: s.journalEntry.id, number: s.journalEntry.number } : null,
    /** Saved before deductions were posted: undo it and save it again to post them. */
    notPosted: !s.journalEntry && s.deductions.gt(0),
    note: s.note,
    by: s.createdBy?.name ?? null,
    at: s.createdAt.toISOString(),
    undone: s.undoneAt
      ? {
          on: localDay(s.undoneAt, ctx.company.timezone),
          by: s.undoneBy?.name ?? null,
          reason: s.undoReason,
        }
      : null,
    snapshot,
  };
}

/**
 * The batch's CM figures for its summary: the settlement saved, or the draft as
 * it would be saved now (the C-grade CM paid). Read inside the caller's checks.
 */
export async function cmFigures(ctx: CompanyContext, batchId: string) {
  const standing = await standingSettlement(prisma, ctx, batchId);
  if (standing) {
    const snapshot = readSnapshot(standing.snapshot);
    return {
      saved: { id: standing.id, number: standing.number, posted: Boolean(standing.journalEntryId) },
      totals: snapshot.totals,
      styles: snapshot.styles,
      faults: snapshot.faults,
      rejectAllowancePercent: snapshot.rejectAllowancePercent,
    };
  }
  const draft = await draftOf(prisma, ctx, batchId);
  return {
    saved: null,
    totals: draft.keepC,
    styles: draft.styles,
    faults: draft.faults,
    rejectAllowancePercent: draft.rejectAllowancePercent as string | null,
  };
}

/** The CM settlement screen: the standing statement, or the draft to save, and the earlier ones undone. */
export async function getCmSettlementScreen(ctx: CompanyContext, batchId: string) {
  assertCanSeeProductionCosts(ctx);
  const batch = await loadBatch(prisma, ctx, batchId);
  const saved = await prisma.cmSettlement.findMany({
    where: { companyId: ctx.company.id, batchId: batch.id },
    include: settlementInclude,
    orderBy: { createdAt: "desc" },
  });
  const standing = saved.find((s) => !s.undoneAt) ?? null;
  const draft = standing ? null : await draftOf(prisma, ctx, batch.id);
  const settler = canSettleFaults(ctx);
  return {
    today: localDay(new Date(), ctx.company.timezone),
    batch: { id: batch.id, code: batch.code, name: batch.name },
    factory: batch.factory ? { id: batch.factory.id, name: batch.factory.name } : null,
    standing: standing ? present(ctx, standing) : null,
    draft,
    undone: saved.filter((s) => s.undoneAt).map((s) => present(ctx, s)),
    can: {
      settle:
        settler &&
        draft !== null &&
        draft.factory !== null &&
        draft.warnings.noRate.length === 0 &&
        draft.styles.some((s) => s.pieces > 0),
      undo: settler && standing !== null,
      pay: ctx.can("accounts.payments.record"),
      /** Open the entry on the factory's ledger in Accounts. */
      seeJournal: ctx.can("accounts.view"),
    },
  };
}

export type CmSettlementScreen = Awaited<ReturnType<typeof getCmSettlementScreen>>;

/**
 * Saves the final CM settlement: the statement as it stands, with the factory's
 * faults it takes off marked deducted and the deductions taken off the factory's
 * Supplier Due. One at a time per batch.
 */
export async function settleCm(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!canSettleFaults(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Only Production Managers and Accounts settle the CM with the factory.",
    );
  }
  const input = settleCmSchema.parse(raw);
  const companyId = ctx.company.id;
  const head = await prisma.productionBatch.findFirst({
    where: { id: batchId, companyId },
    select: { factoryId: true },
  });
  if (!head) throw new AppError("NOT_FOUND", "Master batch not found.");
  const made = await runTransaction(
    async (tx) => {
      // The factory's account before anything else (lock order), then the batch.
      if (head.factoryId) await lockSupplierAccount(tx, companyId, head.factoryId);
      await lockRow(tx, "ProductionBatch", batchId);
      const draft = await draftOf(tx, ctx, batchId);
      const { batch, factory } = draft;
      if (!factory) {
        throw new AppError(
          "VALIDATION",
          `${batch.code} has no factory. Set its factory on the batch first.`,
        );
      }
      if (factory.id !== head.factoryId) {
        throw new AppError(
          "CONFLICT",
          `${batch.code}'s factory changed meanwhile. Open the settlement again.`,
        );
      }
      const standing = await standingSettlement(tx, ctx, batch.id);
      if (standing) {
        throw new AppError(
          "CONFLICT",
          `${batch.code} is settled already on ${standing.number}. Undo it to settle again.`,
        );
      }
      if (draft.warnings.noRate.length > 0) {
        throw new AppError(
          "VALIDATION",
          `Agree the CM a piece of ${draft.warnings.noRate.join(", ")} first, on the factory agreement.`,
        );
      }
      if (!draft.styles.some((s) => s.pieces > 0)) {
        throw new AppError(
          "VALIDATION",
          "Nothing to settle yet: no pieces are graded or delivered to stock.",
        );
      }
      const totals = input.deductCGrade ? draft.deductC : draft.keepC;
      const number = await nextDocumentNumber(tx, companyId, "CM_SETTLEMENT");
      const snapshot: Snapshot = {
        batch,
        rejectAllowancePercent: draft.rejectAllowancePercent,
        factory,
        styles: draft.styles,
        faults: draft.faults,
        payments: draft.payments,
        cGradePieces: draft.cGradePieces,
        warnings: draft.warnings,
        deductCGrade: input.deductCGrade,
        totals,
      };
      const settlement = await tx.cmSettlement.create({
        data: {
          companyId,
          batchId: batch.id,
          factoryId: factory.id,
          number,
          settledOn: dateColumn(localDay(new Date(), ctx.company.timezone)),
          deductCGrade: input.deductCGrade,
          totalCm: totals.totalCm,
          deductions: totals.deductions,
          paid: totals.paid,
          payable: totals.payable,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          note: input.note || null,
          createdById: ctx.user.id,
        },
      });
      const taken = draft.faults.filter((f) => f.amount !== null).map((f) => f.id);
      if (taken.length > 0) {
        const { count } = await tx.supplierFault.updateMany({
          where: { id: { in: taken }, companyId, status: "OPEN" },
          data: {
            status: "DEDUCTED",
            settledAt: new Date(),
            settledById: ctx.user.id,
            settledNote: `Taken off the CM on ${number}`,
            cmSettlementId: settlement.id,
          },
        });
        if (count !== taken.length) {
          throw new AppError("CONFLICT", "A fault changed meanwhile. Open the settlement again.");
        }
      }
      // The deductions come off the factory's Supplier Due now: the batch's bills first.
      const faultsOff = new Prisma.Decimal(totals.faults);
      const rejectsOff = new Prisma.Decimal(totals.rejects);
      const cGradeOff = input.deductCGrade ? new Prisma.Decimal(totals.cGradeCm) : ZERO;
      const deducted = faultsOff.plus(rejectsOff).plus(cGradeOff);
      let entry: { id: string; number: string } | null = null;
      if (deducted.gt(0)) {
        const acc = await ensureControlAccounts(companyId, tx);
        entry = await postJournalEntry(tx, {
          companyId,
          description: `CM settlement ${number} for ${batch.code}: deductions taken off ${factory.name}'s Supplier Due`,
          sourceType: "CM_SETTLEMENT",
          sourceId: settlement.id,
          postedById: ctx.user.id,
          lines: [
            {
              accountId: acc.PAYABLE,
              partyId: factory.id,
              debit: deducted,
              memo: `Deductions on ${number}`,
            },
            {
              accountId: acc.SUPPLIER_DEDUCTIONS,
              credit: faultsOff,
              memo: `Faults taken off on ${number} (missing pieces, fabric faults…)`,
            },
            {
              accountId: acc.SUPPLIER_DEDUCTIONS,
              credit: rejectsOff,
              memo: `Rejects over the ${draft.rejectAllowancePercent}% allowance taken off on ${number}, at the target price`,
            },
            {
              accountId: acc.SUPPLIER_DEDUCTIONS,
              credit: cGradeOff,
              memo: `CM of the C-grade pieces taken off on ${number}`,
            },
          ],
        });
        await tx.cmSettlement.update({
          where: { id: settlement.id },
          data: { journalEntryId: entry.id },
        });
        await settleSupplierBills(tx, companyId, factory.id);
        await recordPartyActivity(factory.id, new Date(), tx);
      }
      const amount = (v: string | Prisma.Decimal) => formatAmount(v, 2, ctx.company.currency);
      await auditInCompany(
        ctx,
        meta,
        {
          action: "CREATE",
          entityType: "CmSettlement",
          entityId: settlement.id,
          summary: `Final CM settlement ${number} for ${batch.code} with ${factory.name}: total CM ${amount(totals.totalCm)} - deductions ${amount(totals.deductions)}${
            input.deductCGrade ? " (with the C-grade CM)" : ""
          }${
            rejectsOff.gt(0)
              ? ` (${amount(rejectsOff)} for rejects over the ${draft.rejectAllowancePercent}% allowance)`
              : ""
          } - advance and payments ${amount(totals.paid)} = final payable ${amount(totals.payable)}${
            taken.length > 0
              ? `; ${taken.length} fault${taken.length === 1 ? "" : "s"} marked deducted`
              : ""
          }${
            entry
              ? `; ${amount(deducted)} taken off ${factory.name}'s Supplier Due on ${entry.number}`
              : ""
          }`,
        },
        tx,
      );
      const members = await activeMembers(companyId, tx);
      await sendInApp(
        tx,
        companyId,
        membersWith(members, ["accounts.payments.record"]).map((userId) => ({ userId })),
        {
          subject: `CM settled: ${batch.code}`,
          body: `${number}: the final payable to ${factory.name} for ${batch.code} is ${amount(totals.payable)}.${
            entry
              ? ` ${amount(deducted)} of deductions came off their Supplier Due (${entry.number}).`
              : ""
          }`,
          entityType: "ProductionBatch",
          entityId: batch.id,
        },
      );
      return {
        id: settlement.id,
        number,
        payable: totals.payable,
        faults: taken.length,
        deducted: fixed(deducted),
        entry: entry?.number ?? null,
      };
    },
    { timeout: 60_000 },
  );
  return made;
}

/**
 * Undoes a settlement saved by mistake (or to settle again): its faults are open again
 * and its deductions are back on the factory's Supplier Due.
 */
export async function undoCmSettlement(
  ctx: CompanyContext,
  settlementId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!canSettleFaults(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Only Production Managers and Accounts settle the CM with the factory.",
    );
  }
  const { reason } = undoCmSettlementSchema.parse(raw);
  const companyId = ctx.company.id;
  const found = await prisma.cmSettlement.findFirst({
    where: { id: settlementId, companyId },
    select: { factoryId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "CM settlement not found.");
  return runTransaction(async (tx) => {
    await lockSupplierAccount(tx, companyId, found.factoryId);
    const settlement = await tx.cmSettlement.findFirstOrThrow({
      where: { id: settlementId, companyId },
      select: { id: true, number: true, batchId: true, factoryId: true, journalEntryId: true },
    });
    await lockRow(tx, "ProductionBatch", settlement.batchId);
    const { count } = await tx.cmSettlement.updateMany({
      where: { id: settlement.id, undoneAt: null },
      data: { undoneAt: new Date(), undoneById: ctx.user.id, undoReason: reason },
    });
    if (count === 0) throw new AppError("CONFLICT", `${settlement.number} is undone already.`);
    const reopened = await tx.supplierFault.updateMany({
      where: { companyId, cmSettlementId: settlement.id, status: "DEDUCTED" },
      data: {
        status: "OPEN",
        settledAt: null,
        settledById: null,
        settledNote: null,
        cmSettlementId: null,
      },
    });
    // The deductions go back on the factory's Supplier Due.
    if (settlement.journalEntryId) {
      await reverseJournalEntry(tx, settlement.journalEntryId, {
        description: `Undo CM settlement ${settlement.number}: ${reason}`,
        postedById: ctx.user.id,
      });
      await settleSupplierBills(tx, companyId, settlement.factoryId);
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "CmSettlement",
        entityId: settlement.id,
        summary: `Undid the CM settlement ${settlement.number}: ${reason}${
          reopened.count > 0
            ? `; ${reopened.count} fault${reopened.count === 1 ? " is" : "s are"} open again`
            : ""
        }${settlement.journalEntryId ? "; the deductions are back on the Supplier Due" : ""}`,
      },
      tx,
    );
    return { id: settlement.id, number: settlement.number, batchId: settlement.batchId };
  });
}

/** The factory's final CM bill, as saved. */
export function cmSettlementDocument(
  ctx: CompanyContext,
  s: ReturnType<typeof present>,
): PrintDocument {
  const currency = ctx.company.currency;
  const amount = (v: string | Prisma.Decimal) => formatAmount(v, 2, currency);
  const { snapshot: d } = s;
  const t = d.totals;
  const count = (n: number) => n.toLocaleString("en-US");
  // A CM agreed per dozen prints as agreed ("120.00 a dozen"); all per piece prints as before.
  const anyDozen = d.styles.some((st) => st.cmPerDozen !== null);
  const styleTotal = d.styles.reduce(
    (acc, st) => ({
      a: acc.a + st.a,
      b: acc.b + st.b,
      c: acc.c + st.c,
      reject: acc.reject + st.reject,
      pieces: acc.pieces + st.pieces,
    }),
    { a: 0, b: 0, c: 0, reject: 0, pieces: 0 },
  );
  const overRows = d.styles
    .filter((st) => st.overAllowance > 0)
    .map((st) => ({
      cells: [
        `Rejects over the ${d.rejectAllowancePercent ?? "2"}% allowance`,
        `${st.code}, ${count(st.overAllowance)} of ${count(st.reject)} rejects`,
        Number(st.rejectPenalty) > 0 ? amount(st.rejectPenalty) : "No target price",
      ],
      details: [
        `Allowance ${count(st.allowance ?? 0)} of ${count(st.cut ?? 0)} pieces cut${
          st.targetPrice ? `; ${amount(st.targetPrice)} a piece (target price)` : ""
        }`,
      ],
    }));
  const deductionRows = [
    ...overRows,
    ...d.faults.map((f) => ({
      cells: [
        `${f.number} · ${f.what}`,
        [
          f.style,
          f.quantity ? `${f.quantity} ${f.kind === "MISSING_PIECES" ? "pieces" : ""}`.trim() : null,
        ]
          .filter(Boolean)
          .join(", ") || "–",
        f.amount ? amount(f.amount) : "To agree (not taken off)",
      ],
      details: f.note ? [f.note] : undefined,
    })),
    ...(d.deductCGrade && d.cGradePieces > 0
      ? [
          {
            cells: [
              "CM of the C-grade pieces",
              `${count(d.cGradePieces)} pieces`,
              amount(t.cGradeCm),
            ],
          },
        ]
      : []),
  ];
  return {
    type: "CM_SETTLEMENT",
    title: "Final CM settlement",
    subtitle: d.factory?.name ?? undefined,
    reference: s.number,
    letterhead: letterheadOf(ctx.company),
    ...(s.undone ? { stamp: { text: "UNDONE", tone: "danger" as const } } : {}),
    meta: [
      { label: "Number", value: s.number },
      { label: "Settled on", value: formatDay(s.settledOn) },
      { label: "Master batch", value: d.batch.code },
    ],
    parties: [
      {
        heading: "Factory",
        lines: [d.factory?.name, d.factory?.phone].filter((l): l is string => Boolean(l)),
      },
      { heading: "For", lines: [`${d.batch.code} · ${d.batch.name}`] },
    ],
    blocks: [
      {
        kind: "table",
        title: "CM by style",
        columns: [
          { label: "Style", weight: 2.2 },
          { label: anyDozen ? "CM agreed" : "CM a piece", align: "right", weight: 1.2 },
          { label: "A", align: "right", weight: 0.8 },
          { label: "B", align: "right", weight: 0.8 },
          { label: "C", align: "right", weight: 0.8 },
          { label: "Rejects", align: "right", weight: 0.9 },
          { label: "Pieces", align: "right", weight: 0.9 },
          { label: "CM", align: "right", weight: 1.3 },
        ],
        rows: [
          ...d.styles.map((st) => ({
            cells: [
              st.code,
              cmAgreedText(st, amount, anyDozen) ?? "–",
              count(st.a),
              count(st.b),
              count(st.c),
              count(st.reject),
              count(st.pieces),
              st.cm ? amount(st.cm) : "–",
            ],
            details: [
              st.name,
              ...(st.missing > 0 ? [`${count(st.missing)} missing (not paid)`] : []),
              ...(st.allowance !== null && st.reject > 0
                ? [
                    `Reject allowance ${count(st.allowance)} (${d.rejectAllowancePercent}% of ${count(st.cut ?? 0)} cut)${
                      st.overAllowance > 0 ? `, ${count(st.overAllowance)} over` : ""
                    }`,
                  ]
                : []),
            ],
          })),
          {
            style: "total" as const,
            cells: [
              "Total CM",
              "",
              count(styleTotal.a),
              count(styleTotal.b),
              count(styleTotal.c),
              count(styleTotal.reject),
              count(styleTotal.pieces),
              amount(t.totalCm),
            ],
          },
        ],
      },
      {
        kind: "table",
        title: "Deductions",
        columns: [
          { label: "What", weight: 2.4 },
          { label: "For", weight: 1.6 },
          { label: "Value", align: "right", weight: 1.4 },
        ],
        rows: deductionRows,
        empty: "Nothing to deduct.",
      },
      {
        kind: "table",
        title: "Advance taken and paid",
        columns: [
          { label: "Voucher", weight: 1.6 },
          { label: "Day", weight: 1.2 },
          { label: "For", weight: 1.8 },
          { label: "Amount", align: "right", weight: 1.4 },
        ],
        rows: d.payments.map((p) => ({
          cells: [
            p.number,
            formatDay(p.on),
            p.style ? p.style.code : `Advance (${d.batch.code})`,
            amount(p.amount),
          ],
        })),
        empty: "No advance taken.",
      },
      {
        kind: "totals",
        rows: [
          { label: "Total CM", value: amount(t.totalCm) },
          { label: "Less deductions", value: amount(t.deductions) },
          { label: "Less advance taken and paid", value: amount(t.paid) },
          {
            label: Number(t.payable) < 0 ? "Final payable (the factory owes)" : "Final payable",
            value: amount(t.payable),
            strong: true,
          },
        ],
        words: amountInWords(new Prisma.Decimal(t.payable).abs(), currency),
      },
      {
        kind: "note",
        text: d.deductCGrade
          ? "The CM of the C-grade pieces is taken off."
          : d.cGradePieces > 0
            ? `The CM of the ${count(d.cGradePieces)} C-grade pieces is paid (not taken off).`
            : "No C-grade pieces.",
      },
      ...(s.posted
        ? [
            {
              kind: "note" as const,
              text: `The deductions (${amount(s.deductions)}) are taken off the factory's Supplier Due on ${s.posted.number}.`,
            },
          ]
        : []),
      ...(s.note ? [{ kind: "text" as const, title: "Notes", paragraphs: [s.note] }] : []),
    ],
    signatures: ["Factory", "Production Manager", "Accounts"],
  };
}

/** The final CM bill PDF (logged; nothing is kept). */
export async function cmSettlementPdf(
  ctx: CompanyContext,
  settlementId: string,
  meta?: RequestMeta,
) {
  assertCanSeeProductionCosts(ctx);
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const row = await prisma.cmSettlement.findFirst({
    where: { id: settlementId, companyId: ctx.company.id },
    include: settlementInclude,
  });
  if (!row) throw new AppError("NOT_FOUND", "CM settlement not found.");
  const settlement = present(ctx, row);
  const bytes = await renderOnDemand(ctx, cmSettlementDocument(ctx, settlement));
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "CmSettlement",
    entityId: row.id,
    summary: `Printed the CM settlement ${row.number}`,
  });
  return {
    fileName: documentFileName(ctx.company.name, `CM settlement ${row.number}`),
    bytes,
  };
}
