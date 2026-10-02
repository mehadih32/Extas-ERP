import type { Prisma } from "@prisma/client";

import { dateOnly, dayRange } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanKeepStore, costMask } from "@/modules/materials/access";
import { OPEN_ORDER } from "@/modules/materials/material.service";
import { issueSchema, listIssuesSchema } from "@/modules/materials/schemas";
import {
  assertUnitFits,
  describeLines,
  documentDate,
  lineMemo,
  linkMovementsToEntry,
  lockMaterials,
  materialLabel,
  resolveStore,
  stockIn,
  stockOut,
} from "@/modules/materials/stock";
import { PROJECT_MATERIAL_MOVES, projectMaterialUsage } from "@/modules/materials/usage";
import {
  formatQuantity,
  pendingQuantity,
  qty,
  valueOut,
  ZERO,
} from "@/modules/materials/valuation";
import {
  lockOpenProjects,
  projectCostSummary,
  refreshProjectCosts,
} from "@/modules/production/project-costs";

/*
 * Materials handed to production. An issue note (MI-) takes materials out of a
 * store at its average cost and charges them to the project's work in
 * progress; a return note (MR-) brings unused materials back at what the
 * project was charged for them:
 *   Issue    Dr Work in Progress   Cr Raw Materials
 *   Return   Dr Raw Materials      Cr Work in Progress
 * Notes are not voided: a mistaken issue is corrected with a return, and the
 * other way round.
 */

const TX_OPTIONS = { timeout: 30_000 };

type IssueInput = ReturnType<typeof issueSchema.parse>;

function prepare(ctx: CompanyContext, input: IssueInput) {
  return {
    date: documentDate(ctx, input.date),
    lines: input.lines.map((l) => ({ materialId: l.materialId, quantity: qty(l.quantity) })),
  };
}

/** Issues materials from a store to an open production project, at average cost. */
export async function issueToProduction(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = issueSchema.parse(raw);
  assertCanKeepStore(ctx);
  const companyId = ctx.company.id;
  const store = await resolveStore(ctx, input.warehouseId);
  const { date, lines } = prepare(ctx, input);

  const issueId = await prisma.$transaction(async (tx) => {
    const project = (
      await lockOpenProjects(
        tx,
        companyId,
        [input.projectId],
        "no more materials can be issued to it",
      )
    ).get(input.projectId)!;
    const state = await lockMaterials(
      tx,
      companyId,
      lines.map((l) => l.materialId),
    );
    lines.forEach((l, i) =>
      assertUnitFits(state.get(l.materialId)!, l.quantity, `lines.${i}.quantity`),
    );
    const issue = await tx.materialIssue.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "MATERIAL_ISSUE"),
        kind: "ISSUE",
        projectId: project.id,
        warehouseId: store.id,
        date,
        receivedBy: input.receivedBy ?? null,
        note: input.note ?? null,
        createdById: ctx.user.id,
      },
    });
    const out = [];
    for (const l of lines) {
      const moved = await stockOut(tx, state, {
        companyId,
        createdById: ctx.user.id,
        materialId: l.materialId,
        warehouseId: store.id,
        type: "ISSUE_TO_PRODUCTION",
        quantity: l.quantity,
        date,
        note: input.note,
        links: { productionProjectId: project.id, issueId: issue.id },
      });
      out.push({ material: state.get(l.materialId)!, quantity: l.quantity, ...moved });
    }
    const total = out.reduce((t, o) => t.plus(o.value), ZERO);
    let journalEntryId: string | null = null;
    if (total.gt(0)) {
      const acc = await ensureControlAccounts(companyId, tx);
      const entry = await postJournalEntry(tx, {
        companyId,
        date,
        description: `Materials issued ${issue.number} to ${project.code}${
          input.receivedBy ? ` (received by ${input.receivedBy})` : ""
        }`,
        sourceType: "MATERIAL_ISSUE",
        sourceId: issue.id,
        postedById: ctx.user.id,
        lines: [
          { accountId: acc.WORK_IN_PROGRESS, debit: total, memo: `${project.code} · materials` },
          ...out.map((o) => ({
            accountId: acc.RAW_MATERIALS,
            credit: o.value,
            memo: lineMemo(o.material, o.quantity),
          })),
        ],
      });
      journalEntryId = entry.id;
      await linkMovementsToEntry(
        tx,
        out.map((o) => o.movement.id),
        entry.id,
      );
    }
    await tx.materialIssue.update({
      where: { id: issue.id },
      data: { totalValue: total, journalEntryId },
    });
    await refreshProjectCosts(tx, companyId, [project.id]);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "MaterialIssue",
        entityId: issue.id,
        summary: `Issued ${issue.number} to ${project.code} from ${store.name}: ${describeLines(out)}`,
      },
      tx,
    );
    return issue.id;
  }, TX_OPTIONS);
  return getIssue(ctx, issueId);
}

/**
 * Takes unused materials back from a production project into a store, at what
 * the project was charged for them (its own average for each material).
 */
export async function returnFromProduction(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = issueSchema.parse(raw);
  assertCanKeepStore(ctx);
  const companyId = ctx.company.id;
  const store = await resolveStore(ctx, input.warehouseId);
  const { date, lines } = prepare(ctx, input);

  const issueId = await prisma.$transaction(async (tx) => {
    const project = (
      await lockOpenProjects(
        tx,
        companyId,
        [input.projectId],
        "materials can no longer come back from it",
      )
    ).get(input.projectId)!;
    const state = await lockMaterials(
      tx,
      companyId,
      lines.map((l) => l.materialId),
    );
    // What the project still holds of each material, and what it was charged for it.
    const held = await tx.rawMaterialMovement.groupBy({
      by: ["rawMaterialId"],
      where: {
        companyId,
        productionProjectId: project.id,
        rawMaterialId: { in: lines.map((l) => l.materialId) },
        type: { in: PROJECT_MATERIAL_MOVES },
      },
      _sum: { quantity: true, value: true },
    });
    const holdings = new Map(
      held.map((h) => [
        h.rawMaterialId,
        { quantity: ZERO.minus(h._sum.quantity ?? ZERO), value: ZERO.minus(h._sum.value ?? ZERO) },
      ]),
    );
    const planned = lines.map((l, i) => {
      const m = state.get(l.materialId)!;
      assertUnitFits(m, l.quantity, `lines.${i}.quantity`);
      const holding = holdings.get(m.id) ?? { quantity: ZERO, value: ZERO };
      if (l.quantity.gt(holding.quantity)) {
        throw new AppError(
          "VALIDATION",
          holding.quantity.gt(0)
            ? `Only ${formatQuantity(holding.quantity, m.unit)} of ${materialLabel(m)} is with ${project.code}.`
            : `${materialLabel(m)} was never issued to ${project.code}.`,
          { [`lines.${i}.quantity`]: [`At most ${holding.quantity.toString()}`] },
        );
      }
      return { material: m, quantity: l.quantity, value: valueOut(holding, l.quantity) };
    });
    const total = planned.reduce((t, p) => t.plus(p.value), ZERO);
    // The cost can only come back while it is still in the project's work in progress.
    const { wip } = await projectCostSummary(tx, companyId, project.id);
    if (wip.lt(total)) {
      throw new AppError(
        "CONFLICT",
        `${project.code} has already moved most of its cost into finished stock, so these materials can no longer come back at cost. Ask Accounts to bring them in as opening stock instead.`,
      );
    }
    const note = await tx.materialIssue.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "MATERIAL_RETURN"),
        kind: "RETURN",
        projectId: project.id,
        warehouseId: store.id,
        date,
        receivedBy: input.receivedBy ?? null,
        note: input.note ?? null,
        createdById: ctx.user.id,
      },
    });
    const movementIds: string[] = [];
    for (const p of planned) {
      const { movement } = await stockIn(tx, state, {
        companyId,
        createdById: ctx.user.id,
        materialId: p.material.id,
        warehouseId: store.id,
        type: "RETURN_FROM_PRODUCTION",
        quantity: p.quantity,
        value: p.value,
        date,
        note: input.note,
        links: { productionProjectId: project.id, issueId: note.id },
      });
      movementIds.push(movement.id);
    }
    let journalEntryId: string | null = null;
    if (total.gt(0)) {
      const acc = await ensureControlAccounts(companyId, tx);
      const entry = await postJournalEntry(tx, {
        companyId,
        date,
        description: `Materials returned ${note.number} from ${project.code}${
          input.receivedBy ? ` (brought back by ${input.receivedBy})` : ""
        }`,
        sourceType: "MATERIAL_ISSUE",
        sourceId: note.id,
        postedById: ctx.user.id,
        lines: [
          ...planned.map((p) => ({
            accountId: acc.RAW_MATERIALS,
            debit: p.value,
            memo: lineMemo(p.material, p.quantity),
          })),
          { accountId: acc.WORK_IN_PROGRESS, credit: total, memo: `${project.code} · materials` },
        ],
      });
      journalEntryId = entry.id;
      await linkMovementsToEntry(tx, movementIds, entry.id);
    }
    await tx.materialIssue.update({
      where: { id: note.id },
      data: { totalValue: total, journalEntryId },
    });
    await refreshProjectCosts(tx, companyId, [project.id]);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "MaterialIssue",
        entityId: note.id,
        summary: `Took back ${note.number} from ${project.code} into ${store.name}: ${describeLines(planned)}`,
      },
      tx,
    );
    return note.id;
  }, TX_OPTIONS);
  return getIssue(ctx, issueId);
}

export async function getIssue(ctx: CompanyContext, issueId: string) {
  const cost = costMask(ctx);
  const issue = await ctx.db.materialIssue.findUnique({
    where: { id: issueId },
    include: {
      project: { select: { id: true, code: true, name: true, status: true } },
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      movements: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          rawMaterial: { select: { id: true, code: true, name: true, kind: true, unit: true } },
        },
      },
    },
  });
  if (!issue) throw new AppError("NOT_FOUND", "Material issue not found.");
  return {
    id: issue.id,
    number: issue.number,
    kind: issue.kind,
    date: issue.date,
    project: issue.project,
    warehouse: issue.warehouse,
    receivedBy: issue.receivedBy,
    note: issue.note,
    totalValue: cost(issue.totalValue),
    createdBy: issue.createdBy,
    createdAt: issue.createdAt,
    lines: issue.movements.map((mv) => ({
      material: mv.rawMaterial,
      quantity: mv.quantity.abs(),
      unitCost: cost(mv.unitCost),
      value: cost(mv.value.abs()),
    })),
  };
}

export async function listIssues(ctx: CompanyContext, raw: unknown = {}) {
  const q = listIssuesSchema.parse(raw);
  const cost = costMask(ctx);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const where: Prisma.MaterialIssueWhereInput = {
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
    ...(q.materialId ? { movements: { some: { rawMaterialId: q.materialId } } } : {}),
    ...(start || end
      ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
      : {}),
  };
  const rows = await ctx.db.materialIssue.findMany({
    where,
    include: {
      project: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      _count: { select: { movements: true } },
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    items: page.map((n) => ({
      id: n.id,
      number: n.number,
      kind: n.kind,
      date: n.date,
      project: n.project,
      warehouse: n.warehouse,
      receivedBy: n.receivedBy,
      note: n.note,
      totalValue: cost(n.totalValue),
      lineCount: n._count.movements,
      createdAt: n.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}

/**
 * Materials on a production project: what it received from the store, what
 * came back, what it still holds (and its cost), its issue and return notes,
 * and purchase orders still due for it.
 */
export async function getProjectMaterials(ctx: CompanyContext, projectId: string) {
  const cost = costMask(ctx);
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, name: true, status: true },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  const usage = await projectMaterialUsage(prisma, ctx.company.id, project.id);
  const notes = await ctx.db.materialIssue.findMany({
    where: { projectId: project.id },
    include: { warehouse: { select: { id: true, name: true } } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const orders = await ctx.db.purchaseOrder.findMany({
    where: { projectId: project.id, status: { in: OPEN_ORDER } },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      lines: {
        orderBy: { id: "asc" },
        include: { rawMaterial: { select: { id: true, code: true, name: true, unit: true } } },
      },
    },
    orderBy: [{ orderDate: "asc" }, { id: "asc" }],
  });
  return {
    project,
    materials: usage.map((u) => ({
      material: u.material,
      issuedQuantity: u.issuedQuantity,
      returnedQuantity: u.returnedQuantity,
      netQuantity: u.netQuantity,
      issuedValue: cost(u.issuedValue),
      returnedValue: cost(u.returnedValue),
      netValue: cost(u.netValue),
    })),
    /** Charged to the project's work in progress for materials. */
    materialCost: cost(usage.reduce((t, u) => t.plus(u.netValue), ZERO)),
    notes: notes.map((n) => ({
      id: n.id,
      number: n.number,
      kind: n.kind,
      date: n.date,
      warehouse: n.warehouse,
      receivedBy: n.receivedBy,
      totalValue: cost(n.totalValue),
    })),
    purchaseOrders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      supplier: o.supplier,
      expectedDate: dateOnly(o.expectedDate),
      lines: o.lines.map((l) => ({
        material: l.rawMaterial,
        quantity: l.quantity,
        receivedQty: l.receivedQty,
        pending: pendingQuantity(l),
      })),
    })),
  };
}
