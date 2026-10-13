import { Prisma, type ProductionStatus } from "@prisma/client";

import { FAULT_KIND_LABELS, FAULT_STATUS_LABELS } from "@/components/production/labels";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount, formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { cmFigures } from "@/modules/production/batch-money.service";
import { money, ZERO } from "@/modules/production/costing";
import { finishingProjectSelect, stateOf } from "@/modules/production/finishing.service";
import {
  assertCanSeeProductionCosts,
  projectCostSummaries,
} from "@/modules/production/project-costs";

/*
 * A master batch's whole money story on one page, and on one PDF: what each
 * style made (cut, A, B, C, rejects, missing), what it all cost and where the
 * money went (each cost head and each material issued), the cost of a good
 * piece against the target price, what was taken back from the suppliers (the
 * factory's CM settlement with its faults and rejects over the allowance, and
 * the pieces an embroidery or print house spoiled), and what reached the
 * warehouse at what value. Only A and B pieces reach stock, so a good piece
 * carries the whole cost: cost a piece = total cost ÷ (A + B). For people who
 * see production costs; the PDF is made when asked for and not kept.
 */

const fixed = (value: Prisma.Decimal) => value.toFixed(2);

const perPiece = (amount: Prisma.Decimal, pieces: number) =>
  pieces > 0 ? fixed(money(amount.dividedBy(pieces))) : null;

/** One style on the summary: what it made and what it cost. */
type SummaryStyle = {
  id: string;
  code: string;
  name: string;
  status: ProductionStatus;
  target: number;
  /** Cut and good (null: no cutting recorded). */
  cut: number | null;
  a: number;
  b: number;
  c: number;
  reject: number;
  missing: number;
  cmRate: string | null;
  totalCost: string;
  /** Total cost ÷ (A + B): null with no good piece yet. */
  perPiece: string | null;
  targetPrice: string | null;
};

/** The summary's figures. */
export async function getBatchSummary(ctx: CompanyContext, batchId: string) {
  assertCanSeeProductionCosts(ctx);
  const companyId = ctx.company.id;
  const batch = await prisma.productionBatch.findFirst({
    where: { id: batchId, companyId },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      targetDate: true,
      createdAt: true,
      rejectTolerancePercent: true,
      factory: { select: { id: true, name: true } },
    },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  const projects = await prisma.productionProject.findMany({
    where: { batchId: batch.id, companyId },
    select: { ...finishingProjectSelect, targetUnitCost: true, cmRate: true },
    orderBy: { code: "asc" },
  });
  const ids = projects.map((p) => p.id);
  const costs = await projectCostSummaries(prisma, companyId, ids);

  // Each style: what it made and what it cost.
  const styles: SummaryStyle[] = [];
  for (const p of projects) {
    const t = (await stateOf(prisma, ctx, p)).totals;
    const cost = costs.get(p.id)!;
    const good = t.a + t.b;
    styles.push({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      target: p.targetQuantity,
      cut: t.cut,
      a: t.a,
      b: t.b,
      c: t.c,
      reject: t.reject,
      missing: t.missing,
      cmRate: p.cmRate ? fixed(p.cmRate) : null,
      totalCost: fixed(cost.totalCost),
      perPiece: perPiece(cost.totalCost, good),
      targetPrice: p.targetUnitCost ? fixed(p.targetUnitCost) : null,
    });
  }
  const sum = (pick: (s: SummaryStyle) => number) => styles.reduce((t, s) => t + pick(s), 0);
  const totalCost = [...costs.values()].reduce((t, c) => t.plus(c.totalCost), ZERO);

  // Where the money went: cost heads (bills and costs paid) and the materials issued.
  const [allocations, expenses, issued] = ids.length
    ? await Promise.all([
        prisma.supplierBillAllocation.findMany({
          where: { projectId: { in: ids }, bill: { companyId, status: { not: "VOID" } } },
          select: {
            amount: true,
            expenseHead: { select: { id: true, name: true } },
            bill: { select: { supplier: { select: { id: true, name: true } } } },
          },
        }),
        prisma.expense.findMany({
          where: { companyId, projectId: { in: ids }, voidedAt: null },
          select: {
            amount: true,
            paymentType: true,
            head: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } },
          },
        }),
        prisma.rawMaterialMovement.groupBy({
          by: ["rawMaterialId"],
          where: {
            companyId,
            productionProjectId: { in: ids },
            type: { in: ["ISSUE_TO_PRODUCTION", "RETURN_FROM_PRODUCTION"] },
          },
          _sum: { value: true, quantity: true },
        }),
      ])
    : [[], [], []];
  const heads = new Map<string, { what: string; amount: Prisma.Decimal }>();
  const addHead = (head: { id: string; name: string }, amount: Prisma.Decimal) => {
    const was = heads.get(head.id) ?? { what: head.name, amount: ZERO };
    heads.set(head.id, { ...was, amount: was.amount.plus(amount) });
  };
  for (const a of allocations) addHead(a.expenseHead, a.amount);
  for (const e of expenses) addHead(e.head, e.amount);
  const materials = await prisma.rawMaterial.findMany({
    where: { id: { in: issued.map((m) => m.rawMaterialId) } },
    select: { id: true, code: true, name: true, unit: true, kind: true },
  });
  const spent = [
    ...issued
      .map((m) => {
        const material = materials.find((x) => x.id === m.rawMaterialId)!;
        return {
          what: `${material.name} (issued from the store)`,
          kind: "MATERIAL" as const,
          quantity: ZERO.minus(m._sum.quantity ?? 0)
            .toFixed(3)
            .replace(/\.?0+$/, ""),
          unit: material.unit,
          amount: ZERO.minus(money(m._sum.value ?? 0)),
        };
      })
      .filter((m) => !m.amount.isZero()),
    ...[...heads.values()].map((h) => ({
      what: h.what,
      kind: "COST" as const,
      quantity: null,
      unit: null,
      amount: h.amount,
    })),
  ]
    .sort((a, b) => b.amount.comparedTo(a.amount))
    .map((l) => ({ ...l, amount: fixed(l.amount) }));

  // Who was paid or owed for the batch: their bills and costs on its styles.
  const bySupplier = new Map<string, { name: string; amount: Prisma.Decimal }>();
  const addSupplier = (s: { id: string; name: string } | null, amount: Prisma.Decimal) => {
    if (!s) return;
    const was = bySupplier.get(s.id) ?? { name: s.name, amount: ZERO };
    bySupplier.set(s.id, { ...was, amount: was.amount.plus(amount) });
  };
  for (const a of allocations) addSupplier(a.bill.supplier, a.amount);
  for (const e of expenses) addSupplier(e.supplier, e.amount);

  // Penalties: the factory's CM settlement (saved, or as it stands) and every fault on the batch.
  const cm = await cmFigures(ctx, batch.id);
  const faultRows = await prisma.supplierFault.findMany({
    where: { companyId, OR: [{ batchId: batch.id }, { projectId: { in: ids } }] },
    select: {
      id: true,
      number: true,
      kind: true,
      status: true,
      quantity: true,
      amount: true,
      journalEntryId: true,
      cmSettlementId: true,
      supplier: { select: { id: true, name: true } },
      project: { select: { code: true } },
    },
    orderBy: [{ occurredOn: "asc" }, { number: "asc" }],
  });
  const faults = faultRows.map((f) => ({
    id: f.id,
    number: f.number,
    kind: f.kind,
    what: FAULT_KIND_LABELS[f.kind],
    status: f.status,
    statusText: FAULT_STATUS_LABELS[f.status],
    supplier: f.supplier,
    style: f.project?.code ?? null,
    quantity: f.quantity ? f.quantity.toFixed(3).replace(/\.?0+$/, "") : null,
    amount: f.amount ? fixed(f.amount) : null,
    /** Taken off the supplier's Supplier Due by itself (spoiled at embroidery or print). */
    offTheirDue: Boolean(f.journalEntryId),
  }));
  const valued = (pick: (f: (typeof faultRows)[number]) => boolean) =>
    faultRows.filter(pick).reduce((t, f) => t.plus(f.amount ?? 0), ZERO);
  // What came off suppliers' dues in the books: the posted settlement and the houses' faults.
  const settlementOff =
    cm.saved && cm.saved.posted ? new Prisma.Decimal(cm.totals.deductions) : ZERO;
  const housesOff = valued((f) => f.journalEntryId !== null);
  const recovered = settlementOff.plus(housesOff);
  const good = sum((s) => s.a + s.b);

  // What reached the warehouse.
  const lines = ids.length
    ? await prisma.stockIntakeLine.findMany({
        where: { intake: { companyId, projectId: { in: ids }, status: "CONFIRMED" } },
        select: {
          grade: true,
          quantity: true,
          unitCost: true,
          costAdjustment: true,
          intake: { select: { warehouse: { select: { id: true, name: true } } } },
        },
      })
    : [];
  const stock = new Map<
    string,
    { warehouse: string; a: number; b: number; value: Prisma.Decimal }
  >();
  for (const l of lines) {
    const key = l.intake.warehouse?.id ?? "";
    const was = stock.get(key) ?? {
      warehouse: l.intake.warehouse?.name ?? "No warehouse given",
      a: 0,
      b: 0,
      value: ZERO,
    };
    stock.set(key, {
      ...was,
      a: was.a + (l.grade === "A_GRADE" ? l.quantity : 0),
      b: was.b + (l.grade === "B_GRADE" ? l.quantity : 0),
      value: was.value.plus(l.unitCost.times(l.quantity)).plus(l.costAdjustment),
    });
  }
  const stockRows = [...stock.values()].map((s) => ({ ...s, value: fixed(money(s.value)) }));
  const stockValue = [...stock.values()].reduce((t, s) => t.plus(money(s.value)), ZERO);

  const targetPriced = styles.filter((s) => s.targetPrice !== null);
  const targetValue = targetPriced.reduce(
    (t, s) => t.plus(new Prisma.Decimal(s.targetPrice!).times(s.target)),
    ZERO,
  );
  const targetPieces = targetPriced.reduce((t, s) => t + s.target, 0);
  const tz = ctx.company.timezone;
  return {
    today: localDay(new Date(), tz),
    batch: {
      id: batch.id,
      code: batch.code,
      name: batch.name,
      kind: batch.kind,
      factory: batch.factory,
      startedOn: localDay(batch.createdAt, tz),
      targetOn: batch.targetDate ? localDay(batch.targetDate, tz) : null,
      rejectAllowancePercent: batch.rejectTolerancePercent.toFixed(2).replace(/\.?0+$/, ""),
    },
    styles,
    pieces: {
      target: sum((s) => s.target),
      cut: styles.every((s) => s.cut === null) ? null : sum((s) => s.cut ?? 0),
      a: sum((s) => s.a),
      b: sum((s) => s.b),
      c: sum((s) => s.c),
      reject: sum((s) => s.reject),
      missing: sum((s) => s.missing),
      good,
    },
    money: {
      totalCost: fixed(totalCost),
      /** Total cost ÷ the A and B pieces (null with none yet). */
      perPiece: perPiece(totalCost, good),
      /** What the styles' target prices allow on average (null without any). */
      targetPrice: targetPieces > 0 ? fixed(money(targetValue.dividedBy(targetPieces))) : null,
      recovered: fixed(recovered),
      netCost: fixed(totalCost.minus(recovered)),
      netPerPiece: perPiece(totalCost.minus(recovered), good),
    },
    spent,
    suppliers: [...bySupplier.entries()]
      .map(([id, s]) => ({ id, name: s.name, amount: fixed(s.amount) }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    penalties: {
      cm: {
        saved: cm.saved,
        totals: cm.totals,
        rejectAllowancePercent: cm.rejectAllowancePercent,
        overAllowance: cm.styles
          .filter((s) => s.overAllowance > 0)
          .map((s) => ({
            code: s.code,
            over: s.overAllowance,
            allowance: s.allowance,
            reject: s.reject,
            targetPrice: s.targetPrice,
            amount: s.rejectPenalty,
          })),
      },
      faults,
      missing: fixed(valued((f) => f.kind === "MISSING_PIECES")),
      spoiled: fixed(valued((f) => f.kind === "SPOILED_PIECES")),
      housesOff: fixed(housesOff),
    },
    stock: {
      rows: stockRows,
      a: stockRows.reduce((t, s) => t + s.a, 0),
      b: stockRows.reduce((t, s) => t + s.b, 0),
      value: fixed(stockValue),
    },
  };
}

export type BatchSummary = Awaited<ReturnType<typeof getBatchSummary>>;

/** The summary on letterhead. */
export function batchSummaryDocument(ctx: CompanyContext, s: BatchSummary): PrintDocument {
  const currency = ctx.company.currency;
  const amount = (v: string | Prisma.Decimal) => formatAmount(v, 2, currency);
  const count = (n: number) => n.toLocaleString("en-US");
  const p = s.pieces;
  const cmTotals = s.penalties.cm.totals;
  return {
    type: "BATCH_SUMMARY",
    title: "Batch summary",
    subtitle: s.batch.name,
    reference: s.batch.code,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "Master batch", value: s.batch.code },
      { label: "Started", value: formatDay(s.batch.startedOn) },
      { label: "Printed", value: formatDay(s.today) },
    ],
    parties: [
      {
        heading: "Factory",
        lines: [s.batch.factory?.name ?? "Not given"],
      },
      {
        heading: "Pieces",
        lines: [
          `${count(p.target)} to make, ${p.cut === null ? "cut not recorded" : `${count(p.cut)} cut`}`,
          `${count(p.good)} good (A and B) in stock`,
        ],
      },
    ],
    blocks: [
      {
        kind: "figures",
        figures: [
          { label: "Total cost", value: amount(s.money.totalCost) },
          {
            label: "Cost a good piece",
            value: s.money.perPiece ? amount(s.money.perPiece) : "–",
            hint: s.money.targetPrice ? `Target ${amount(s.money.targetPrice)}` : undefined,
          },
          { label: "Taken back from suppliers", value: amount(s.money.recovered) },
          {
            label: "Net cost a good piece",
            value: s.money.netPerPiece ? amount(s.money.netPerPiece) : "–",
          },
        ],
      },
      {
        kind: "table",
        title: "Pieces and cost by style",
        columns: [
          { label: "Style", weight: 2 },
          { label: "Cut", align: "right", weight: 0.8 },
          { label: "A", align: "right", weight: 0.8 },
          { label: "B", align: "right", weight: 0.7 },
          { label: "C", align: "right", weight: 0.6 },
          { label: "Rejects", align: "right", weight: 0.8 },
          { label: "Missing", align: "right", weight: 0.8 },
          { label: "Cost", align: "right", weight: 1.4 },
          { label: "A piece", align: "right", weight: 1.1 },
        ],
        rows: [
          ...s.styles.map((st) => ({
            cells: [
              st.code,
              st.cut === null ? "–" : count(st.cut),
              count(st.a),
              count(st.b),
              count(st.c),
              count(st.reject),
              count(st.missing),
              amount(st.totalCost),
              st.perPiece ? amount(st.perPiece) : "–",
            ],
            details: [
              `${st.name}, ${count(st.target)} to make${
                st.targetPrice ? `, target ${amount(st.targetPrice)} a piece` : ""
              }`,
            ],
          })),
          {
            style: "total" as const,
            cells: [
              "Batch",
              p.cut === null ? "–" : count(p.cut),
              count(p.a),
              count(p.b),
              count(p.c),
              count(p.reject),
              count(p.missing),
              amount(s.money.totalCost),
              s.money.perPiece ? amount(s.money.perPiece) : "–",
            ],
          },
        ],
      },
      {
        kind: "table",
        title: "Where the money went",
        columns: [
          { label: "What", weight: 3 },
          { label: "Quantity", align: "right", weight: 1.2 },
          { label: "Amount", align: "right", weight: 1.4 },
        ],
        rows: s.spent.map((l) => ({
          cells: [
            l.what,
            l.quantity ? `${l.quantity} ${l.unit?.toLowerCase() ?? ""}`.trim() : "–",
            amount(l.amount),
          ],
        })),
        empty: "No cost yet.",
      },
      {
        kind: "table",
        title: "Penalties and deductions",
        columns: [
          { label: "What", weight: 2.6 },
          { label: "Who", weight: 1.8 },
          { label: "Status", weight: 1.2 },
          { label: "Value", align: "right", weight: 1.3 },
        ],
        rows: [
          ...s.penalties.cm.overAllowance.map((o) => ({
            cells: [
              `Rejects over the ${s.penalties.cm.rejectAllowancePercent ?? "2"}% allowance, ${o.code}`,
              s.batch.factory?.name ?? "The factory",
              s.penalties.cm.saved ? "Deducted" : "On the CM settlement",
              o.targetPrice ? amount(o.amount) : "No target price",
            ],
            details: [
              `${count(o.over)} of ${count(o.reject)} rejects over the allowance of ${count(o.allowance ?? 0)}`,
            ],
          })),
          ...s.penalties.faults.map((f) => ({
            cells: [
              `${f.number} · ${f.what}${f.style ? `, ${f.style}` : ""}`,
              f.supplier.name,
              f.offTheirDue ? "Off their Supplier Due" : f.statusText,
              f.amount ? amount(f.amount) : "To agree",
            ],
            details: f.quantity
              ? [
                  `${f.quantity} ${f.kind === "SHORT_RECEIVE" || f.kind === "FABRIC_FAULT" ? "" : "pieces"}`.trim(),
                ]
              : undefined,
          })),
        ],
        empty: "No penalty or fault on this batch.",
      },
      {
        kind: "totals",
        rows: [
          { label: "Total CM", value: amount(cmTotals.totalCm) },
          { label: "Less faults", value: amount(cmTotals.faults) },
          { label: "Less rejects over the allowance", value: amount(cmTotals.rejects) },
          { label: "Less advance taken and paid", value: amount(cmTotals.paid) },
          {
            label: s.penalties.cm.saved
              ? `Final payable to the factory (${s.penalties.cm.saved.number})`
              : "Final payable to the factory (not settled yet)",
            value: amount(cmTotals.payable),
            strong: true,
          },
        ],
      },
      {
        kind: "table",
        title: "Delivered to stock",
        columns: [
          { label: "Warehouse", weight: 2.4 },
          { label: "A", align: "right", weight: 1 },
          { label: "B", align: "right", weight: 1 },
          { label: "Value", align: "right", weight: 1.4 },
        ],
        rows: [
          ...s.stock.rows.map((r) => ({
            cells: [r.warehouse, count(r.a), count(r.b), amount(r.value)],
          })),
          ...(s.stock.rows.length > 1
            ? [
                {
                  style: "total" as const,
                  cells: ["All", count(s.stock.a), count(s.stock.b), amount(s.stock.value)],
                },
              ]
            : []),
        ],
        empty: "Nothing delivered to stock yet.",
      },
      {
        kind: "note",
        text: "Cost a good piece = total cost ÷ the A and B pieces: C pieces, rejects and missing pieces never reach stock. What was taken back from suppliers (their faults and the rejects over the allowance) is booked as Deductions from Suppliers, so the net cost is the total cost less it.",
      },
    ],
    signatures: ["Production Manager", "Accounts", "CEO"],
  };
}

/** The summary PDF (logged; nothing is kept). */
export async function batchSummaryPdf(ctx: CompanyContext, batchId: string, meta?: RequestMeta) {
  assertCanSeeProductionCosts(ctx);
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const summary = await getBatchSummary(ctx, batchId);
  const bytes = await renderOnDemand(ctx, batchSummaryDocument(ctx, summary));
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "ProductionBatch",
    entityId: summary.batch.id,
    summary: `Printed the summary of ${summary.batch.code}`,
  });
  return {
    fileName: documentFileName(ctx.company.name, `Batch summary ${summary.batch.code}`),
    bytes,
  };
}
