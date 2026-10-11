import { localDay, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRows } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canCancelChallan, canSendMaterial } from "@/modules/production/rules";
import {
  challanItemsSchema,
  createMaterialChallanSchema,
  voidSchema,
} from "@/modules/production/schemas";
import { materialLine } from "@/components/production/labels";

/*
 * "Materials sent": a plain record on a production project of what went to the
 * factory (fabric, trims, cartons... as written, with a quantity and unit), each
 * under its own challan number (MC-) with a Material Challan to print. It moves
 * no stock and no money: materials from the store's stock are issued on an issue
 * note (MI-), and what things cost goes on the project as costs and bills.
 */

const challanSelect = {
  id: true,
  number: true,
  projectId: true,
  sentAt: true,
  sentTo: true,
  items: true,
  carrier: true,
  notes: true,
  createdAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdBy: { select: { name: true } },
} as const;

type ChallanRow = {
  id: string;
  number: string;
  projectId: string;
  sentAt: Date;
  sentTo: string;
  items: unknown;
  carrier: string | null;
  notes: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdBy: { name: string } | null;
};

/** A challan as screens and the API show it, its lines read back from storage. */
function presentChallan(row: ChallanRow, timeZone: string) {
  const items = challanItemsSchema.safeParse(row.items);
  return {
    id: row.id,
    number: row.number,
    projectId: row.projectId,
    sentOn: localDay(row.sentAt, timeZone),
    sentTo: row.sentTo,
    items: items.success ? items.data : [],
    carrier: row.carrier,
    notes: row.notes,
    sentBy: row.createdBy?.name ?? null,
    cancelled: row.cancelledAt
      ? { on: localDay(row.cancelledAt, timeZone), reason: row.cancelReason ?? "" }
      : null,
  };
}

export type MaterialChallanView = ReturnType<typeof presentChallan>;

/** A project's challans, newest first (cancelled ones stay, marked), for a project already found. */
export async function projectChallans(ctx: CompanyContext, projectId: string) {
  const rows = await ctx.db.materialChallan.findMany({
    where: { projectId },
    select: challanSelect,
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return rows.map((r) => presentChallan(r, ctx.company.timezone));
}

/** The project's challans, newest first (cancelled ones stay, marked). */
export async function listMaterialChallans(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return projectChallans(ctx, project.id);
}

/** One challan, with its project and the factory it went to (for the printed challan). */
export async function getMaterialChallan(ctx: CompanyContext, challanId: string) {
  const row = await ctx.db.materialChallan.findUnique({
    where: { id: challanId },
    select: {
      ...challanSelect,
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          factory: {
            select: { id: true, name: true, phone: true, address: true, city: true },
          },
          buyer: { select: { name: true } },
        },
      },
    },
  });
  if (!row) throw new AppError("NOT_FOUND", "Materials challan not found.");
  return { ...presentChallan(row, ctx.company.timezone), project: row.project };
}

/**
 * "Send material": records what went to the factory under the next MC- number.
 * Where it went defaults to the project's factory; the day may not be after
 * today. Nothing changes in stock or the books.
 */
export async function createMaterialChallan(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = createMaterialChallanSchema.parse(raw);
  const tz = ctx.company.timezone;
  const sentAt = input.sentOn ? toInstant(input.sentOn, tz) : new Date();
  if (localDay(sentAt, tz) > localDay(new Date(), tz)) {
    throw new AppError("VALIDATION", "It cannot be sent after today.", {
      sentOn: ["Choose today or an earlier day"],
    });
  }
  const companyId = ctx.company.id;
  const id = await prisma.$transaction(async (tx) => {
    // The project stays open while its challan is written.
    await lockRows(tx, "ProductionProject", [projectId]);
    const project = await tx.productionProject.findFirst({
      where: { id: projectId, companyId },
      select: {
        id: true,
        code: true,
        status: true,
        factoryName: true,
        factory: { select: { name: true } },
      },
    });
    if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
    assertAllowed(canSendMaterial(project));
    const sentTo = input.sentTo ?? project.factory?.name ?? project.factoryName;
    if (!sentTo) {
      throw new AppError("VALIDATION", "Say where the materials went.", {
        sentTo: ["Enter the factory or person it went to"],
      });
    }
    const challan = await tx.materialChallan.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "MATERIAL_CHALLAN"),
        projectId: project.id,
        sentAt,
        sentTo,
        items: input.items,
        carrier: input.carrier ?? null,
        notes: input.notes ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "MaterialChallan",
        entityId: challan.id,
        summary: `${challan.number} for ${project.code} to ${sentTo}: ${input.items
          .map((item) => materialLine(item, ctx.company.currency))
          .join(", ")}`.slice(0, 500),
      },
      tx,
    );
    return challan.id;
  });
  return (await getMaterialChallan(ctx, id)) satisfies MaterialChallanView;
}

/** Cancels a challan entered by mistake, with a reason; it stays listed, marked cancelled. */
export async function cancelMaterialChallan(
  ctx: CompanyContext,
  challanId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidSchema.parse(raw);
  const challan = await ctx.db.materialChallan.findUnique({
    where: { id: challanId },
    select: { id: true, number: true, cancelledAt: true },
  });
  if (!challan) throw new AppError("NOT_FOUND", "Materials challan not found.");
  assertAllowed(canCancelChallan(challan));
  await prisma.$transaction(async (tx) => {
    // Only one cancel wins when two people press it at once.
    const { count } = await tx.materialChallan.updateMany({
      where: { id: challan.id, cancelledAt: null },
      data: { cancelledAt: new Date(), cancelledById: ctx.user.id, cancelReason: reason },
    });
    if (count === 0) {
      throw new AppError("CONFLICT", `${challan.number} is already cancelled.`);
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "MaterialChallan",
        entityId: challan.id,
        summary: `Cancelled ${challan.number}: ${reason}`,
      },
      tx,
    );
  });
  return getMaterialChallan(ctx, challan.id);
}
