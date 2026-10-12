import { addDays, localDay } from "@/lib/dates";
import type { CompanyContext } from "@/modules/auth/context";
import { type BatchSummary, getBatch, listBatches } from "@/modules/production/batch.service";
import { DEFAULT_PRODUCTION_LEAD_DAYS, listProjects } from "@/modules/production/project.service";
import { presentCard, productionAccess } from "@/modules/production/screens.service";

/*
 * What the master batch screens show, as plain values (amounts as "12500.00",
 * days as "2026-10-08" in company time): the Batches tab's cards, one batch with
 * a card per style, and the batch form. Read with production.view, changed with
 * production.manage; money figures (cost so far, cost per piece, the cost guard)
 * go to Production Managers and Accounts only, as on the projects.
 */

const fixed = (value: { toFixed: (dp: number) => string }) => value.toFixed(2);

function presentBatch(b: BatchSummary, tz: string) {
  const t = b.timeline;
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    kind: b.kind,
    state: b.state,
    factory: b.factory ? { id: b.factory.id, name: b.factory.name } : null,
    targetOn: b.targetDate ? localDay(b.targetDate, tz) : null,
    notes: b.notes,
    createdOn: localDay(b.createdAt, tz),
    createdBy: b.createdBy?.name ?? null,
    styleCount: b.styleCount,
    openStyles: b.openStyles,
    lateStyles: b.lateStyles,
    timeline: t
      ? {
          startOn: t.startDay,
          dueOn: t.targetDay,
          totalDays: t.totalDays,
          elapsedDays: t.elapsedDays,
          remainingDays: t.remainingDays,
          isOverdue: t.isOverdue,
          overdueDays: t.overdueDays,
          dueSoon: t.dueSoon,
          health: t.health,
          timeElapsedPercent: t.timeElapsedPercent,
        }
      : null,
    quantities: b.quantities,
    /** Production Managers and Accounts only. */
    costs: b.costs
      ? {
          totalCost: fixed(b.costs.totalCost),
          perPiece: b.costs.perPiece ? fixed(b.costs.perPiece) : null,
          guard: b.costs.guard
            ? {
                level: b.costs.guard.level,
                percent: b.costs.guard.percent,
                budget: fixed(b.costs.guard.budget),
                spent: fixed(b.costs.guard.spent),
                left: fixed(b.costs.guard.left),
                styles: b.costs.guard.styles,
              }
            : null,
        }
      : null,
  };
}

export type BatchCardData = ReturnType<typeof presentBatch>;

export async function listBatchRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listBatches(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((b) => presentBatch(b, tz)), nextCursor: page.nextCursor };
}

/** The Batches tab: the first page, and whether this person may start a batch. */
export async function getBatchList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listBatchRows(ctx, raw)), canCreate: productionAccess(ctx).manage };
}

export type BatchList = Awaited<ReturnType<typeof getBatchList>>;

/**
 * One batch: what it adds up to (live costs) and a card per style, each with its
 * own days, pieces and cost guard. A Production Manager adds styles, edits it,
 * and deletes it while it has no styles.
 */
export async function getBatchScreen(ctx: CompanyContext, batchId: string) {
  const tz = ctx.company.timezone;
  const page = await listProjects(ctx, { batchId, take: 200 });
  const live = new Map(page.items.flatMap((c) => (c.costs ? [[c.id, c.costs.totalCost]] : [])));
  const batch = await getBatch(ctx, batchId, live);
  const manage = productionAccess(ctx).manage;
  return {
    batch: presentBatch(batch, tz),
    styles: page.items
      .map((card) => presentCard(card, tz))
      .sort((a, b) => a.code.localeCompare(b.code)),
    can: {
      edit: manage,
      addStyle: manage && batch.state !== "DONE",
      delete: manage && batch.styleCount === 0,
    },
  };
}

export type BatchScreen = Awaited<ReturnType<typeof getBatchScreen>>;

/** The batch form: today and the usual target day for a new batch, or a batch's values. */
export async function getBatchForm(ctx: CompanyContext, batchId?: string) {
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const base = { today, defaultTargetOn: addDays(today, DEFAULT_PRODUCTION_LEAD_DAYS) };
  if (!batchId) return { ...base, batch: null };
  const b = await getBatch(ctx, batchId);
  return {
    ...base,
    batch: {
      id: b.id,
      code: b.code,
      name: b.name,
      kind: b.kind,
      factory: b.factory,
      targetOn: b.targetDate ? localDay(b.targetDate, tz) : null,
      notes: b.notes,
    },
  };
}

export type BatchForm = Awaited<ReturnType<typeof getBatchForm>>;
