import { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { categoryWithDescendants, listCategoryTree } from "@/modules/inventory/catalog.service";
import {
  createStyleSchema,
  listStylesSchema,
  updateStyleSchema,
} from "@/modules/inventory/schemas";
import { stockTotalsByStyle } from "@/modules/inventory/stock.service";

const styleInclude = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  _count: { select: { variants: true } },
} as const;

async function assertRefs(ctx: CompanyContext, categoryId?: string, brandId?: string | null) {
  if (categoryId && !(await ctx.db.category.findUnique({ where: { id: categoryId } }))) {
    throw new AppError("NOT_FOUND", "Category not found.");
  }
  if (brandId && !(await ctx.db.brand.findUnique({ where: { id: brandId } }))) {
    throw new AppError("NOT_FOUND", "Brand not found.");
  }
}

export async function getStyle(ctx: CompanyContext, styleId: string) {
  const style = await ctx.db.style.findUnique({ where: { id: styleId }, include: styleInclude });
  if (!style) throw new AppError("NOT_FOUND", "Style not found.");
  return style;
}

/** Styles with stock totals; filter by category (incl. sub-categories), brand or search text. */
export async function listStyles(ctx: CompanyContext, raw: unknown = {}) {
  const query = listStylesSchema.parse(raw);
  const take = query.take ?? 50;
  const where: Prisma.StyleWhereInput = {
    ...(query.includeInactive ? {} : { isActive: true }),
    ...(query.brandId ? { brandId: query.brandId } : {}),
    ...(query.categoryId
      ? { categoryId: { in: await categoryWithDescendants(ctx, query.categoryId) } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { code: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const rows = await ctx.db.style.findMany({
    where,
    include: styleInclude,
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const totals = await stockTotalsByStyle(
    ctx,
    page.map((s) => s.id),
  );
  return {
    items: page.map(({ _count, ...s }) => ({
      ...s,
      variantCount: _count.variants,
      stock: totals.get(s.id) ?? { aGrade: 0, bGrade: 0, reserved: 0, available: 0 },
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}

export async function createStyle(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createStyleSchema.parse(raw);
  await assertRefs(ctx, input.categoryId, input.brandId);
  if (await ctx.db.style.findFirst({ where: { code: input.code } })) {
    throw new AppError("CONFLICT", `Style code ${input.code} already exists.`);
  }
  const style = await ctx.db.style.create({
    data: { ...input, brandId: input.brandId ?? null, companyId: ctx.company.id },
    include: styleInclude,
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "Style",
    entityId: style.id,
    summary: `Created style ${style.code} "${style.name}"`,
  });
  return style;
}

/** Note: changing the style code does not rename existing SKUs (printed tags stay valid). */
export async function updateStyle(
  ctx: CompanyContext,
  styleId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateStyleSchema.parse(raw);
  const before = await getStyle(ctx, styleId);
  await assertRefs(ctx, input.categoryId, input.brandId);
  if (input.code && input.code !== before.code) {
    if (await ctx.db.style.findFirst({ where: { code: input.code } })) {
      throw new AppError("CONFLICT", `Style code ${input.code} already exists.`);
    }
  }
  const style = await ctx.db.style.update({
    where: { id: before.id },
    data: input,
    include: styleInclude,
  });
  const changed = Object.keys(input) as Array<keyof typeof input>;
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Style",
    entityId: style.id,
    summary: `Updated style ${style.code}: ${changed.join(", ")}`,
    before: Object.fromEntries(changed.map((k) => [k, String(before[k] ?? "")])),
    after: Object.fromEntries(changed.map((k) => [k, String(style[k] ?? "")])),
  });
  return style;
}

/**
 * Deletes a style only if none of its SKUs has history (stock, sales, production).
 * Otherwise archive it with `isActive: false` so past documents stay intact.
 */
export async function deleteStyle(ctx: CompanyContext, styleId: string, meta?: RequestMeta) {
  const style = await getStyle(ctx, styleId);
  const variantFilter = { variant: { styleId: style.id } };
  const [movements, orderItems, intakeLines, quotationItems] = await Promise.all([
    ctx.db.stockMovement.count({ where: variantFilter }),
    ctx.db.salesOrder.count({ where: { items: { some: variantFilter } } }),
    ctx.db.stockIntake.count({ where: { lines: { some: variantFilter } } }),
    ctx.db.quotation.count({ where: { items: { some: { styleId: style.id } } } }),
  ]);
  if (movements + orderItems + intakeLines + quotationItems > 0) {
    throw new AppError("CONFLICT", "This style has history. Archive it instead of deleting.");
  }
  await ctx.db.style.delete({ where: { id: style.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "Style",
    entityId: style.id,
    summary: `Deleted style ${style.code}`,
  });
}

/**
 * Tree navigation: Category -> Brand -> Style. Each category node lists its own
 * styles grouped by brand ("No brand" when unset).
 */
export async function getInventoryTree(ctx: CompanyContext) {
  const [categories, styles] = await Promise.all([
    listCategoryTree(ctx),
    ctx.db.style.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        categoryId: true,
        brand: { select: { id: true, name: true } },
      },
      orderBy: { code: "asc" },
    }),
  ]);
  type BrandGroup = {
    brandId: string | null;
    brandName: string;
    styles: { id: string; code: string; name: string }[];
  };
  const groups = new Map<string, Map<string, BrandGroup>>();
  for (const s of styles) {
    const byBrand = groups.get(s.categoryId) ?? new Map<string, BrandGroup>();
    const key = s.brand?.id ?? "none";
    const group = byBrand.get(key) ?? {
      brandId: s.brand?.id ?? null,
      brandName: s.brand?.name ?? "No brand",
      styles: [],
    };
    group.styles.push({ id: s.id, code: s.code, name: s.name });
    byBrand.set(key, group);
    groups.set(s.categoryId, byBrand);
  }
  type TreeNode = (typeof categories)[number];
  type Out = Omit<TreeNode, "children"> & { brands: BrandGroup[]; children: Out[] };
  const attach = (node: TreeNode): Out => ({
    ...node,
    brands: [...(groups.get(node.id)?.values() ?? [])].sort((a, b) =>
      a.brandName.localeCompare(b.brandName),
    ),
    children: node.children.map(attach),
  });
  return categories.map(attach);
}
