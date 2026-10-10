/*
 * Small sums behind the catalogue dialogs, kept apart from the components so the
 * tests can check them directly.
 */

/**
 * What saving these colours and sizes does to a style's SKUs (`cells`): one is
 * made, or brought back, for each ticked pair it lacks, and those of unticked
 * colours or sizes leave the matrix.
 */
export function matrixChange(
  cells: ReadonlyArray<{ colorId: string; sizeId: string }>,
  colors: ReadonlySet<string>,
  sizes: ReadonlySet<string>,
): { adding: number; removing: number } {
  const kept = cells.filter((c) => colors.has(c.colorId) && sizes.has(c.sizeId)).length;
  return { adding: colors.size * sizes.size - kept, removing: cells.length - kept };
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
