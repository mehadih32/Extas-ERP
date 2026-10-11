import type { ProductionStage } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { projectTimeline, STAGE_ORDER, WORKING_STAGE_COUNT } from "@/modules/production/timeline";

/*
 * The Home screen's production pipeline: every active production project as a
 * progress bar, the most pressing first (by target date). Each stage moves the
 * bar on: a project in a stage is half way through it, so Fabric sourcing is
 * 10%, Cutting 30%, Sewing 50%, Wash and QC 70% and Finishing 90%. Once pieces
 * arrive from the factory, the bar shows the share of pieces received instead
 * when that is further along. Pieces and days only, no money.
 */

/** Projects the pipeline lists; the rest are on the Production screen. */
const PIPELINE_ROWS = 6;

/** How far a project in `stage` is: stages behind it, and half of the one it is in. */
export function stagePercent(stage: ProductionStage): number {
  if (stage === "COMPLETED") return 100;
  const index = STAGE_ORDER.indexOf(stage);
  return Math.round(((index + 0.5) / WORKING_STAGE_COUNT) * 100);
}

/** The bar: the stage's share, or the share of pieces received when that is further along. */
export function projectProgress(project: {
  stage: ProductionStage;
  targetQuantity: number;
  received: number;
}) {
  const byStage = stagePercent(project.stage);
  const byPieces =
    project.targetQuantity > 0
      ? Math.min(Math.floor((project.received * 100) / project.targetQuantity), 100)
      : 0;
  return byPieces > byStage
    ? { percent: byPieces, basis: "RECEIVED" as const }
    : { percent: byStage, basis: "STAGE" as const };
}

/** Who sees the pipeline: the same people as The Pulse's production card. */
export const canSeePipeline = (ctx: Pick<CompanyContext, "can">) =>
  ctx.can("production.view") || canSeeFinancials(ctx);

export async function getProductionPipeline(ctx: CompanyContext, now = new Date()) {
  if (!canSeePipeline(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to see production.");
  }
  const tz = ctx.company.timezone;
  const [projects, active, onHold] = await Promise.all([
    ctx.db.productionProject.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ targetDate: "asc" }, { code: "asc" }],
      take: PIPELINE_ROWS,
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        status: true,
        startDate: true,
        targetDate: true,
        completedAt: true,
        targetQuantity: true,
        producedQtyA: true,
        producedQtyB: true,
        isInHouse: true,
        buyer: { select: { name: true } },
      },
    }),
    ctx.db.productionProject.count({ where: { status: "ACTIVE" } }),
    ctx.db.productionProject.count({ where: { status: "ON_HOLD" } }),
  ]);
  return {
    today: localDay(now, tz),
    active,
    onHold,
    items: projects.map((p) => {
      const received = p.producedQtyA + p.producedQtyB;
      const timeline = projectTimeline(p, now, tz);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        stage: p.stage,
        /** Who it is for: the buyer, or null for in-house stock. */
        buyer: p.isInHouse ? null : (p.buyer?.name ?? null),
        target: p.targetQuantity,
        received,
        ...projectProgress({ stage: p.stage, targetQuantity: p.targetQuantity, received }),
        targetOn: localDay(p.targetDate, tz),
        remainingDays: timeline.remainingDays,
        overdueDays: timeline.overdueDays,
        isOverdue: timeline.isOverdue,
        dueSoon: timeline.dueSoon,
      };
    }),
    /** Whether the rows may link to the projects. */
    open: ctx.can("production.view"),
  };
}

export type ProductionPipeline = Awaited<ReturnType<typeof getProductionPipeline>>;
