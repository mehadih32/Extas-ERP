import { Prisma, type QuotationStatus } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import { labelledCustomFields, validateCustomFields } from "@/modules/sales/custom-fields.service";
import { canDeleteQuotation, canEditQuotation, canMarkQuotation } from "@/modules/sales/rules";
import {
  createQuotationSchema,
  listQuotationsSchema,
  quotationStatusSchema,
  updateQuotationSchema,
} from "@/modules/sales/schemas";
import { quotationLineQuantity, quotationTotals } from "@/modules/sales/totals";

/*
 * Quotation builder: buyer, items (category / style, fabric, quantity or a size
 * breakdown, price), free-text styling rules ("placket should not have a black
 * border") and the company's custom fields. The data feeds the letterhead PDF.
 */

type QuotationItemInput = NonNullable<ReturnType<typeof createQuotationSchema.parse>["items"]>;

/** Category, style and template ids must belong to this company. */
async function assertReferences(
  ctx: CompanyContext,
  items: QuotationItemInput,
  templateId?: string | null,
) {
  const categoryIds = [...new Set(items.map((i) => i.categoryId).filter(Boolean))] as string[];
  const styleIds = [...new Set(items.map((i) => i.styleId).filter(Boolean))] as string[];
  const [categories, styles] = await Promise.all([
    ctx.db.category.count({ where: { id: { in: categoryIds } } }),
    ctx.db.style.count({ where: { id: { in: styleIds } } }),
  ]);
  if (categories !== categoryIds.length) throw new AppError("VALIDATION", "Unknown category.");
  if (styles !== styleIds.length) throw new AppError("VALIDATION", "Unknown style.");
  if (templateId) {
    const template = await ctx.db.documentTemplate.findFirst({
      where: { id: templateId, documentType: "QUOTATION", isActive: true },
    });
    if (!template) throw new AppError("VALIDATION", "Unknown quotation template.");
  }
}

function itemRows(items: QuotationItemInput) {
  const quantities = items.map((i) => quotationLineQuantity(i));
  return {
    quantities,
    priced: items.map((i, idx) => ({ quantity: quantities[idx]!, unitPrice: i.unitPrice })),
  };
}

function itemCreates(
  items: QuotationItemInput,
  quantities: number[],
  lineTotals: Prisma.Decimal[],
) {
  return items.map((i, idx) => ({
    categoryId: i.categoryId ?? null,
    styleId: i.styleId ?? null,
    description: i.description,
    fabric: i.fabric ?? null,
    colorNote: i.colorNote ?? null,
    sizeBreakdown: (i.sizeBreakdown ?? undefined) as Prisma.InputJsonValue | undefined,
    quantity: quantities[idx]!,
    unitPrice: new Prisma.Decimal(i.unitPrice),
    lineTotal: lineTotals[idx]!,
    sortOrder: idx,
  }));
}

async function getQuotationOrThrow(ctx: CompanyContext, quotationId: string) {
  const quotation = await ctx.db.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new AppError("NOT_FOUND", "Quotation not found.");
  return quotation;
}

export async function createQuotation(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createQuotationSchema.parse(raw);
  const party = await assertPartyCanTransact(ctx, input.partyId, "SALE");
  await assertReferences(ctx, input.items, input.templateId);
  const customFields = await validateCustomFields(ctx, "QUOTATION", input.customFields);
  const { quantities, priced } = itemRows(input.items);
  const totals = quotationTotals(priced, input.discount, input.tax);

  const quotation = await prisma.$transaction(async (tx) => {
    const created = await tx.quotation.create({
      data: {
        companyId: ctx.company.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "QUOTATION"),
        partyId: party.id,
        issueDate: input.issueDate ?? new Date(),
        validUntil: input.validUntil ?? null,
        currency: input.currency ?? ctx.company.currency,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
        terms: input.terms ?? null,
        notes: input.notes ?? null,
        customFields,
        templateId: input.templateId ?? null,
        items: { create: itemCreates(input.items, quantities, totals.lineTotals) },
        stylingRules: {
          create: (input.stylingRules ?? []).map((r, idx) => ({
            area: r.area ?? null,
            instruction: r.instruction,
            sortOrder: idx,
          })),
        },
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Quotation",
        entityId: created.id,
        summary: `Created quotation ${created.number} for ${party.name} (${created.total.toFixed(2)})`,
      },
      tx,
    );
    return created;
  });
  return getQuotation(ctx, quotation.id);
}

export async function updateQuotation(
  ctx: CompanyContext,
  quotationId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateQuotationSchema.parse(raw);
  const before = await getQuotationOrThrow(ctx, quotationId);
  assertAllowed(canEditQuotation(before));
  if (input.partyId && input.partyId !== before.partyId) {
    await assertPartyCanTransact(ctx, input.partyId, "SALE");
  }
  if (input.items || input.templateId)
    await assertReferences(ctx, input.items ?? [], input.templateId);
  const customFields =
    input.customFields !== undefined
      ? await validateCustomFields(ctx, "QUOTATION", input.customFields)
      : undefined;

  const currentItems = input.items
    ? undefined
    : await prisma.quotationItem.findMany({ where: { quotationId: before.id } });
  const priced = input.items
    ? itemRows(input.items).priced
    : currentItems!.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice }));
  const totals = quotationTotals(
    priced,
    input.discount ?? before.discount,
    input.tax ?? before.tax,
  );

  await prisma.$transaction(async (tx) => {
    if (input.items) {
      const { quantities } = itemRows(input.items);
      await tx.quotationItem.deleteMany({ where: { quotationId: before.id } });
      await tx.quotationItem.createMany({
        data: itemCreates(input.items, quantities, totals.lineTotals).map((i) => ({
          ...i,
          quotationId: before.id,
          sizeBreakdown: i.sizeBreakdown ?? Prisma.JsonNull,
        })),
      });
    }
    if (input.stylingRules) {
      await tx.quotationStylingRule.deleteMany({ where: { quotationId: before.id } });
      await tx.quotationStylingRule.createMany({
        data: input.stylingRules.map((r, idx) => ({
          quotationId: before.id,
          area: r.area ?? null,
          instruction: r.instruction,
          sortOrder: idx,
        })),
      });
    }
    await tx.quotation.update({
      where: { id: before.id },
      data: {
        ...(input.partyId ? { partyId: input.partyId } : {}),
        ...(input.issueDate ? { issueDate: input.issueDate } : {}),
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.terms !== undefined ? { terms: input.terms } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
        ...(input.customFields !== undefined
          ? { customFields: customFields ?? Prisma.JsonNull }
          : {}),
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Quotation",
        entityId: before.id,
        summary: `Updated quotation ${before.number}: ${Object.keys(input).join(", ")}`,
        before: { total: before.total.toFixed(2) },
        after: { total: totals.total.toFixed(2) },
      },
      tx,
    );
  });
  return getQuotation(ctx, before.id);
}

/** Sent → Accepted / Rejected. Converted quotations are final. */
export async function setQuotationStatus(
  ctx: CompanyContext,
  quotationId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { status } = quotationStatusSchema.parse(raw);
  const quotation = await getQuotationOrThrow(ctx, quotationId);
  assertAllowed(canMarkQuotation(quotation, status));
  const updated = await ctx.db.quotation.update({ where: { id: quotation.id }, data: { status } });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "Quotation",
    entityId: quotation.id,
    summary: `Quotation ${quotation.number}: ${quotation.status} → ${status}`,
  });
  return updated;
}

export async function deleteQuotation(
  ctx: CompanyContext,
  quotationId: string,
  meta?: RequestMeta,
) {
  const quotation = await getQuotationOrThrow(ctx, quotationId);
  assertAllowed(canDeleteQuotation(quotation));
  await ctx.db.quotation.delete({ where: { id: quotation.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "Quotation",
    entityId: quotation.id,
    summary: `Deleted draft quotation ${quotation.number}`,
  });
}

const isExpired = (q: { status: QuotationStatus; validUntil: Date | null }) =>
  Boolean(
    q.validUntil && q.validUntil < new Date() && (q.status === "DRAFT" || q.status === "SENT"),
  );

/** Full quotation with letterhead details — the data behind the quotation PDF. */
export async function getQuotation(ctx: CompanyContext, quotationId: string) {
  const quotation = await ctx.db.quotation.findUnique({
    where: { id: quotationId },
    include: {
      party: {
        select: {
          id: true,
          code: true,
          name: true,
          contactPerson: true,
          phone: true,
          email: true,
          address: true,
          taxId: true,
          grade: true,
          isVerified: true,
        },
      },
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          category: { select: { id: true, name: true } },
          style: { select: { id: true, code: true, name: true } },
        },
      },
      stylingRules: { orderBy: { sortOrder: "asc" } },
      proforma: { select: { id: true, number: true, status: true } },
    },
  });
  if (!quotation) throw new AppError("NOT_FOUND", "Quotation not found.");
  const defs = await ctx.db.customFieldDefinition.findMany({
    where: { entity: "QUOTATION" },
    orderBy: { sortOrder: "asc" },
  });
  return {
    ...quotation,
    isExpired: isExpired(quotation),
    customFieldValues: labelledCustomFields(defs, quotation.customFields),
    letterhead: await letterhead(ctx),
  };
}

export async function listQuotations(ctx: CompanyContext, raw: unknown = {}) {
  const q = listQuotationsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.quotation.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(start || end
        ? { issueDate: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: "insensitive" } },
              { party: { name: { contains: q.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      party: { select: { id: true, code: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = (hasMore ? rows.slice(0, take) : rows).map((r) => ({
    ...r,
    isExpired: isExpired(r),
  }));
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}
