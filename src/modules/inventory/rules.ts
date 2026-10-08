import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";

/*
 * When catalog entries may be deleted. The catalog services refuse with these
 * answers and the Products screens read the same answers to decide where to
 * offer Delete. Holding inventory.manage is checked before these.
 */

/** A category with no sub-categories and no styles. */
export function canDeleteCategory(category: { childCount: number; styleCount: number }): Verdict {
  if (category.childCount > 0) {
    return refuse("CONFLICT", "Move or delete its sub-categories first.");
  }
  if (category.styleCount > 0) {
    return refuse("CONFLICT", "Move its styles to another category first.");
  }
  return ALLOWED;
}

/** A brand no style uses. */
export function canDeleteBrand(brand: { styleCount: number }): Verdict {
  if (brand.styleCount > 0) {
    return refuse("CONFLICT", "This brand still has styles. Move them to another brand first.");
  }
  return ALLOWED;
}

/** A colour no SKU uses. */
export function canDeleteColor(color: { variantCount: number }): Verdict {
  if (color.variantCount > 0) {
    return refuse("CONFLICT", "This colour is used by products. Deactivate those SKUs instead.");
  }
  return ALLOWED;
}

/** A size no SKU uses. */
export function canDeleteSize(size: { variantCount: number }): Verdict {
  if (size.variantCount > 0) {
    return refuse("CONFLICT", "This size is used by products. Deactivate those SKUs instead.");
  }
  return ALLOWED;
}

/**
 * A style none of whose SKUs has history (stock, orders, deliveries from
 * production, quotations); one with history is archived instead, so past
 * documents stay intact.
 */
export function canDeleteStyle(style: { historyCount: number }): Verdict {
  if (style.historyCount > 0) {
    return refuse("CONFLICT", "This style has history. Archive it instead of deleting.");
  }
  return ALLOWED;
}
