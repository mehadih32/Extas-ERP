import type { AssetReturn, Prisma } from "@prisma/client";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { money } from "@/modules/accounts/balances";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr, requireLinkedEmployee } from "@/modules/hr/access";
import { hrKeys } from "@/modules/hr/rules";
import { issueAssetSchema, listAssetsSchema, returnAssetSchema } from "@/modules/hr/schemas";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * Company items in staff hands: a laptop, phone, SIM, ID card, keys, a
 * uniform, tools. HR gives an item on a day and takes it back (good, damaged
 * or lost, the last two with a note). Items still out hold up someone's
 * clearance when they leave (exit.service.ts). The employee sees what they
 * hold in My HR > My details.
 */

const assetInclude = {
  employee: { select: { id: true, code: true, name: true, exitDate: true, userId: true } },
  issuedBy: { select: { name: true } },
  returnedTo: { select: { name: true } },
} satisfies Prisma.EmployeeAssetInclude;

type AssetRow = Prisma.EmployeeAssetGetPayload<{ include: typeof assetInclude }>;

function present(a: AssetRow) {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    tag: a.tag,
    value: a.value?.toFixed(2) ?? null,
    employee: {
      id: a.employee.id,
      code: a.employee.code,
      name: a.employee.name,
      exitDate: a.employee.exitDate ? dateOnly(a.employee.exitDate) : null,
    },
    issuedOn: dateOnly(a.issuedOn),
    issueNote: a.issueNote,
    issuedBy: a.issuedBy?.name ?? null,
    returnedOn: a.returnedOn ? dateOnly(a.returnedOn) : null,
    returnCondition: a.returnCondition,
    returnNote: a.returnNote,
    returnedTo: a.returnedTo?.name ?? null,
    /** Still with the employee. */
    out: a.returnedOn === null,
  };
}

export type AssetView = ReturnType<typeof present>;

/** "Laptop (LT-0042)". */
export const assetText = (a: { name: string; tag: string | null }) =>
  a.tag ? `${a.name} (${a.tag})` : a.name;

function assertCanSeeAssets(ctx: CompanyContext) {
  if (!hrKeys(ctx).view) {
    throw new AppError("FORBIDDEN", "Only HR can see the company items staff hold.");
  }
}

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

/** HR's list: items with staff now (default), back, or all; for one person or by name or tag. */
export async function listAssets(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeAssets(ctx);
  const q = listAssetsSchema.parse(raw);
  const base: Prisma.EmployeeAssetWhereInput = {
    ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: "insensitive" } },
            { tag: { contains: q.q, mode: "insensitive" } },
            { employee: { name: { contains: q.q, mode: "insensitive" } } },
            { employee: { code: { contains: q.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, out, back] = await Promise.all([
    ctx.db.employeeAsset.findMany({
      where: {
        ...base,
        ...(q.show === "out" ? { returnedOn: null } : {}),
        ...(q.show === "returned" ? { returnedOn: { not: null } } : {}),
      },
      include: assetInclude,
      orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
    ctx.db.employeeAsset.count({ where: { ...base, returnedOn: null } }),
    ctx.db.employeeAsset.count({ where: { ...base, returnedOn: { not: null } } }),
  ]);
  return {
    show: q.show,
    q: q.q ?? "",
    counts: { out, returned: back },
    items: rows.map(present),
    /** Items with people who have already left. */
    withLeavers: rows.filter(
      (r) =>
        r.returnedOn === null && r.employee.exitDate && dateOnly(r.employee.exitDate) < today(ctx),
    ).length,
  };
}

export type AssetList = Awaited<ReturnType<typeof listAssets>>;

/** One employee's items, those still out first. */
export async function employeeAssets(ctx: CompanyContext, employeeId: string) {
  assertCanSeeAssets(ctx);
  const rows = await ctx.db.employeeAsset.findMany({
    where: { employeeId },
    include: assetInclude,
    orderBy: [{ returnedOn: { sort: "desc", nulls: "first" } }, { issuedOn: "desc" }],
  });
  return rows.map(present);
}

/** The items the signed-in employee holds now, and what they gave back. */
export async function myAssets(ctx: CompanyContext) {
  const employee = await requireLinkedEmployee(ctx);
  const rows = await ctx.db.employeeAsset.findMany({
    where: { employeeId: employee.id },
    include: assetInclude,
    orderBy: [{ returnedOn: { sort: "desc", nulls: "first" } }, { issuedOn: "desc" }],
    take: 100,
  });
  const items = rows.map(present);
  return { out: items.filter((i) => i.out), back: items.filter((i) => !i.out) };
}

/** HR gives an item to someone still on staff (not before they joined, not after they left). */
export async function issueAsset(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can give out company items.");
  const input = issueAssetSchema.parse(raw);
  const employee = await ctx.db.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const day = today(ctx);
  if (input.issuedOn > day) {
    throw new AppError("VALIDATION", "Give the day it was handed over.", {
      issuedOn: ["Pick today or an earlier day"],
    });
  }
  if (input.issuedOn < dateOnly(employee.joinDate)) {
    throw new AppError("VALIDATION", "That is before they joined.", {
      issuedOn: [`They joined on ${dateOnly(employee.joinDate)}`],
    });
  }
  const exit = employee.exitDate ? dateOnly(employee.exitDate) : null;
  if (exit && exit < input.issuedOn) {
    throw new AppError("CONFLICT", `${employee.name} left on ${exit}.`);
  }
  const asset = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeAsset.create({
      data: {
        companyId: ctx.company.id,
        employeeId: employee.id,
        name: input.name,
        kind: input.kind,
        tag: input.tag ?? null,
        value: input.value != null ? money(input.value) : null,
        issuedOn: dateColumn(input.issuedOn),
        issueNote: input.note ?? null,
        issuedById: ctx.user.id,
      },
      include: assetInclude,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Gave ${employee.code} ${employee.name} a company item: ${assetText(created)} on ${input.issuedOn}`,
      },
      tx,
    );
    if (employee.userId && employee.userId !== ctx.user.id) {
      await sendInApp(tx, ctx.company.id, [{ userId: employee.userId, employeeId: employee.id }], {
        subject: `Company item: ${assetText(created)}`,
        body: `HR recorded that you have ${assetText(created)} from ${input.issuedOn}. Give it back to HR when you leave.`,
        entityType: "MyItems",
        entityId: created.id,
      });
    }
    return created;
  });
  return present(asset);
}

const RETURN_WORDS: Record<AssetReturn, string> = {
  GOOD: "returned",
  DAMAGED: "returned damaged",
  LOST: "lost",
};

async function loadAsset(ctx: CompanyContext, assetId: string) {
  const asset = await ctx.db.employeeAsset.findUnique({
    where: { id: assetId },
    include: assetInclude,
  });
  if (!asset) throw new AppError("NOT_FOUND", "Company item not found.");
  return asset;
}

/** The item came back (or was lost): from the day it was given, up to today. */
export async function returnAsset(
  ctx: CompanyContext,
  assetId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can take company items back.");
  const input = returnAssetSchema.parse(raw);
  const asset = await loadAsset(ctx, assetId);
  if (!present(asset).out) {
    throw new AppError("CONFLICT", `${assetText(asset)} is already back.`);
  }
  const issuedOn = dateOnly(asset.issuedOn);
  if (input.returnedOn < issuedOn || input.returnedOn > today(ctx)) {
    throw new AppError("VALIDATION", "Pick a day from when it was given up to today.", {
      returnedOn: [`Between ${issuedOn} and today`],
    });
  }
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeAsset.updateMany({
      where: { id: asset.id, returnedOn: null },
      data: {
        returnedOn: dateColumn(input.returnedOn),
        returnCondition: input.condition,
        returnNote: input.note ?? null,
        returnedToId: ctx.user.id,
      },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", `${assetText(asset)} is already back.`);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Employee",
        entityId: asset.employee.id,
        summary: `${asset.employee.code} ${asset.employee.name}'s ${assetText(asset)} ${
          RETURN_WORDS[input.condition]
        } on ${input.returnedOn}${input.note ? ` — ${input.note}` : ""}`,
      },
      tx,
    );
    return tx.employeeAsset.findUniqueOrThrow({ where: { id: asset.id }, include: assetInclude });
  });
  return present(saved);
}

/** Puts an item back with the employee (it was marked as back by mistake). */
export async function undoAssetReturn(ctx: CompanyContext, assetId: string, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can change company items.");
  const asset = await loadAsset(ctx, assetId);
  if (present(asset).out) throw new AppError("CONFLICT", `${assetText(asset)} is not back yet.`);
  const saved = await prisma.$transaction(async (tx) => {
    await tx.employeeAsset.update({
      where: { id: asset.id },
      data: { returnedOn: null, returnCondition: null, returnNote: null, returnedToId: null },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Employee",
        entityId: asset.employee.id,
        summary: `${assetText(asset)} is with ${asset.employee.code} ${asset.employee.name} again (it was marked as ${
          RETURN_WORDS[asset.returnCondition ?? "GOOD"]
        } by mistake)`,
      },
      tx,
    );
    return tx.employeeAsset.findUniqueOrThrow({ where: { id: asset.id }, include: assetInclude });
  });
  return present(saved);
}

/** Removes an item recorded by mistake (one that was never really given). */
export async function removeAsset(ctx: CompanyContext, assetId: string, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can change company items.");
  const asset = await loadAsset(ctx, assetId);
  await prisma.$transaction(async (tx) => {
    await tx.employeeAsset.delete({ where: { id: asset.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Employee",
        entityId: asset.employee.id,
        summary: `Removed ${assetText(asset)} from ${asset.employee.code} ${asset.employee.name}'s items (recorded by mistake)`,
      },
      tx,
    );
  });
  return { removed: true };
}

/** Items an employee still holds, for the clearance check. */
export async function assetsOut(db: Prisma.TransactionClient | typeof prisma, employeeId: string) {
  const rows = await db.employeeAsset.findMany({
    where: { employeeId, returnedOn: null },
    include: assetInclude,
    orderBy: { issuedOn: "asc" },
  });
  return rows.map(present);
}
