/*
 * Small sums behind the catalogue dialogs, kept apart from the components so the
 * tests can check them directly.
 */

/**
 * How many SKUs ticking these colours and sizes makes: every colour in every
 * size, less the SKUs the style already has.
 */
export function newSkuCount(colors: number, sizes: number, existing: number): number {
  return Math.max(colors * sizes - existing, 0);
}

/**
 * The categories a category may move under: any but itself and the ones inside
 * it. `categories` are in tree order (a parent, then everything inside it, deeper).
 */
export function parentChoices<T extends { id: string; depth: number }>(
  categories: T[],
  moving?: string,
): T[] {
  if (!moving) return categories;
  const start = categories.findIndex((c) => c.id === moving);
  if (start < 0) return categories;
  const depth = categories[start]!.depth;
  let end = start + 1;
  while (end < categories.length && categories[end]!.depth > depth) end += 1;
  return [...categories.slice(0, start), ...categories.slice(end)];
}
