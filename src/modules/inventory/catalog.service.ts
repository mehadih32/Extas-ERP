import { type Category, Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { slugify } from "@/lib/slug";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  createBrandSchema,
  createCategorySchema,
  createColorSchema,
  createSizeSchema,
  reorderSizesSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateColorSchema,
  updateSizeSchema,
} from "@/modules/inventory/schemas";
import { refuseTakenName, sameName } from "@/modules/inventory/names";
import {
  canDeleteBrand,
  canDeleteCategory,
  canDeleteColor,
  canDeleteSize,
} from "@/modules/inventory/rules";

/** A create or rename that clashes with a name already taken: CONFLICT, shown on the name. */
async function namedUniquely<T>(work: Promise<T>, taken: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", taken, { name: [taken] });
    }
    throw error;
  }
}

/** Blueprint's default size run for the matrix columns. */
export const DEFAULT_SIZES = ["S", "M", "L", "XL", "XXL", "3XL"] as const;

// =============================================================================
// Categories (self-nesting tree)
// =============================================================================

export type CategoryNode = Category & { styleCount: number; children: CategoryNode[] };

export async function listCategoryTree(ctx: CompanyContext): Promise<CategoryNode[]> {
  const rows = await ctx.db.category.findMany({
    include: { _count: { select: { styles: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const nodes = new Map<string, CategoryNode>(
    rows.map(({ _count, ...c }) => [c.id, { ...c, styleCount: _count.styles, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** A category id plus all of its descendants (for "show styles in Tops & sub-categories"). */
export async function categoryWithDescendants(ctx: CompanyContext, categoryId: string) {
  const rows = await ctx.db.category.findMany({ select: { id: true, parentId: true } });
  const byParent = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parentId) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r.id]);
  }
  const result: string[] = [];
  const stack = [categoryId];
  while (stack.length) {
    const current = stack.pop()!;
    result.push(current);
    stack.push(...(byParent.get(current) ?? []));
  }
  return result;
}

async function uniqueCategorySlug(ctx: CompanyContext, name: string, excludeId?: string) {
  const base = slugify(name, "category");
  let slug = base;
  for (let i = 2; ; i++) {
    const clash = await ctx.db.category.findFirst({
      where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return slug;
    slug = `${base}-${i}`;
  }
}

async function assertCategoryExists(ctx: CompanyContext, categoryId: string) {
  const category = await ctx.db.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new AppError("NOT_FOUND", "Category not found.");
  return category;
}

export async function createCategory(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createCategorySchema.parse(raw);
  if (input.parentId) await assertCategoryExists(ctx, input.parentId);
  const category = await ctx.db.category.create({
    data: {
      companyId: ctx.company.id,
      name: input.name,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder ?? 0,
      slug: await uniqueCategorySlug(ctx, input.name),
    },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "Category",
    entityId: category.id,
    summary: `Created category "${category.name}"`,
  });
  return category;
}

export async function updateCategory(
  ctx: CompanyContext,
  categoryId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateCategorySchema.parse(raw);
  const category = await assertCategoryExists(ctx, categoryId);

  if (input.parentId) {
    // Walk up from the new parent; reaching this category would create a loop.
    let cursor: string | null = input.parentId;
    while (cursor) {
      if (cursor === category.id) {
        throw new AppError("VALIDATION", "A category cannot be moved inside itself.");
      }
      cursor = (await assertCategoryExists(ctx, cursor)).parentId;
    }
  }

  const updated = await ctx.db.category.update({
    where: { id: category.id },
    data: {
      name: input.name,
      parentId: input.parentId === undefined ? undefined : input.parentId,
      sortOrder: input.sortOrder,
      ...(input.name && input.name !== category.name
        ? { slug: await uniqueCategorySlug(ctx, input.name, category.id) }
        : {}),
    },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Category",
    entityId: category.id,
    summary: `Updated category "${updated.name}"`,
    before: { name: category.name, parentId: category.parentId },
    after: { name: updated.name, parentId: updated.parentId },
  });
  return updated;
}

export async function deleteCategory(ctx: CompanyContext, categoryId: string, meta?: RequestMeta) {
  const category = await ctx.db.category.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { styles: true, children: true } } },
  });
  if (!category) throw new AppError("NOT_FOUND", "Category not found.");
  assertAllowed(
    canDeleteCategory({
      childCount: category._count.children,
      styleCount: category._count.styles,
    }),
  );
  await ctx.db.category.delete({ where: { id: category.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "Category",
    entityId: category.id,
    summary: `Deleted category "${category.name}"`,
  });
}

// =============================================================================
// Brands
// =============================================================================

export async function listBrands(ctx: CompanyContext) {
  const brands = await ctx.db.brand.findMany({
    include: { _count: { select: { styles: true } } },
    orderBy: { name: "asc" },
  });
  return brands.map(({ _count, ...b }) => ({ ...b, styleCount: _count.styles }));
}

export async function createBrand(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createBrandSchema.parse(raw);
  await refuseTakenName(
    ctx.db.brand.findFirst({ where: sameName(input.name), select: { id: true } }),
    `There is already a brand called ${input.name}.`,
  );
  const brand = await namedUniquely(
    ctx.db.brand.create({
      data: { companyId: ctx.company.id, name: input.name, logoUrl: input.logoUrl ?? null },
    }),
    `There is already a brand called ${input.name}.`,
  );
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "Brand",
    entityId: brand.id,
    summary: `Created brand "${brand.name}"`,
  });
  return brand;
}

export async function updateBrand(
  ctx: CompanyContext,
  brandId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateBrandSchema.parse(raw);
  const brand = await ctx.db.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new AppError("NOT_FOUND", "Brand not found.");
  if (input.name) {
    await refuseTakenName(
      ctx.db.brand.findFirst({ where: sameName(input.name, brand.id), select: { id: true } }),
      `There is already a brand called ${input.name}.`,
    );
  }
  const updated = await namedUniquely(
    ctx.db.brand.update({ where: { id: brand.id }, data: input }),
    `There is already a brand called ${input.name ?? brand.name}.`,
  );
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Brand",
    entityId: brand.id,
    summary: `Updated brand "${updated.name}"`,
  });
  return updated;
}

export async function deleteBrand(ctx: CompanyContext, brandId: string, meta?: RequestMeta) {
  const brand = await ctx.db.brand.findUnique({
    where: { id: brandId },
    include: { _count: { select: { styles: true } } },
  });
  if (!brand) throw new AppError("NOT_FOUND", "Brand not found.");
  assertAllowed(canDeleteBrand({ styleCount: brand._count.styles }));
  await ctx.db.brand.delete({ where: { id: brand.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "Brand",
    entityId: brand.id,
    summary: `Deleted brand "${brand.name}"`,
  });
}

// =============================================================================
// Colors (matrix rows) and sizes (matrix columns)
// =============================================================================

export async function listColors(ctx: CompanyContext) {
  return ctx.db.color.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createColor(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createColorSchema.parse(raw);
  await refuseTakenName(
    ctx.db.color.findFirst({ where: sameName(input.name), select: { id: true } }),
    `There is already a colour called ${input.name}.`,
  );
  const color = await namedUniquely(
    ctx.db.color.create({
      data: {
        companyId: ctx.company.id,
        name: input.name,
        hexCode: input.hexCode,
        sortOrder: input.sortOrder ?? 0,
      },
    }),
    `There is already a colour called ${input.name}.`,
  );
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "Color",
    entityId: color.id,
    summary: `Created color "${color.name}" ${color.hexCode}`,
  });
  return color;
}

export async function updateColor(
  ctx: CompanyContext,
  colorId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateColorSchema.parse(raw);
  const color = await ctx.db.color.findUnique({ where: { id: colorId } });
  if (!color) throw new AppError("NOT_FOUND", "Color not found.");
  if (input.name) {
    await refuseTakenName(
      ctx.db.color.findFirst({ where: sameName(input.name, color.id), select: { id: true } }),
      `There is already a colour called ${input.name}.`,
    );
  }
  const updated = await namedUniquely(
    ctx.db.color.update({ where: { id: color.id }, data: input }),
    `There is already a colour called ${input.name ?? color.name}.`,
  );
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Color",
    entityId: color.id,
    summary: `Updated color "${updated.name}"`,
  });
  return updated;
}

export async function deleteColor(ctx: CompanyContext, colorId: string, meta?: RequestMeta) {
  const color = await ctx.db.color.findUnique({
    where: { id: colorId },
    include: { _count: { select: { variants: true } } },
  });
  if (!color) throw new AppError("NOT_FOUND", "Color not found.");
  assertAllowed(canDeleteColor({ variantCount: color._count.variants }));
  await ctx.db.color.delete({ where: { id: color.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "Color",
    entityId: color.id,
    summary: `Deleted color "${color.name}"`,
  });
}

export async function listSizes(ctx: CompanyContext) {
  return ctx.db.size.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createSize(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createSizeSchema.parse(raw);
  const last = await ctx.db.size.findFirst({ orderBy: { sortOrder: "desc" } });
  const name = input.name.toUpperCase();
  const size = await namedUniquely(
    ctx.db.size.create({
      data: {
        companyId: ctx.company.id,
        name,
        sortOrder: input.sortOrder ?? (last ? last.sortOrder + 1 : 0),
      },
    }),
    `There is already a size called ${name}.`,
  );
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "Size",
    entityId: size.id,
    summary: `Created size "${size.name}"`,
  });
  return size;
}

export async function updateSize(
  ctx: CompanyContext,
  sizeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateSizeSchema.parse(raw);
  const size = await ctx.db.size.findUnique({ where: { id: sizeId } });
  if (!size) throw new AppError("NOT_FOUND", "Size not found.");
  const name = input.name?.toUpperCase();
  const updated = await namedUniquely(
    ctx.db.size.update({ where: { id: size.id }, data: { ...input, name } }),
    `There is already a size called ${name ?? size.name}.`,
  );
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Size",
    entityId: size.id,
    summary: `Updated size "${updated.name}"`,
  });
  return updated;
}

/** Sets the column order of the matrix (e.g. S, M, L, XL, XXL, 3XL). */
export async function reorderSizes(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const { sizeIds } = reorderSizesSchema.parse(raw);
  const found = await ctx.db.size.count({ where: { id: { in: sizeIds } } });
  if (found !== new Set(sizeIds).size) throw new AppError("NOT_FOUND", "Size not found.");
  await ctx.db.$transaction(
    sizeIds.map((sizeId, index) =>
      ctx.db.size.update({ where: { id: sizeId }, data: { sortOrder: index } }),
    ),
  );
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Size",
    summary: "Reordered sizes",
  });
  return listSizes(ctx);
}

export async function deleteSize(ctx: CompanyContext, sizeId: string, meta?: RequestMeta) {
  const size = await ctx.db.size.findUnique({
    where: { id: sizeId },
    include: { _count: { select: { variants: true } } },
  });
  if (!size) throw new AppError("NOT_FOUND", "Size not found.");
  assertAllowed(canDeleteSize({ variantCount: size._count.variants }));
  await ctx.db.size.delete({ where: { id: size.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "Size",
    entityId: size.id,
    summary: `Deleted size "${size.name}"`,
  });
}
