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

/** What still ties a warehouse down: stock in it and open work bound for it. */
export type WarehouseHold = {
  /** Finished pieces on its shelves (any grade, set aside or not). */
  pieces: number;
  /** Raw materials with stock in it. */
  materials: number;
  /** Open sales orders shipping from it. */
  orders: number;
  /** Deliveries from production waiting to come in to it. */
  deliveries: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * An empty warehouse (no finished pieces, no raw materials) that no open order
 * or delivery is waiting on, and not the company's last one. Only a Super Admin
 * may delete it, after typing their password (checked before this).
 */
export function canDeleteWarehouse(warehouse: { hold: WarehouseHold; others: number }): Verdict {
  const { hold } = warehouse;
  if (warehouse.others === 0) {
    return refuse("CONFLICT", "This is the only warehouse. Add another one before deleting it.");
  }
  const stock = [
    hold.pieces > 0 && plural(hold.pieces, "piece", "pieces"),
    hold.materials > 0 && plural(hold.materials, "raw material", "raw materials"),
  ].filter(Boolean);
  if (stock.length > 0) {
    return refuse(
      "CONFLICT",
      `It still holds stock (${stock.join(" and ")}). Sell, issue or count it down to 0 first.`,
    );
  }
  const open = hold.orders + hold.deliveries;
  if (open > 0) {
    const work = [
      hold.orders > 0 && plural(hold.orders, "open order", "open orders"),
      hold.deliveries > 0 &&
        plural(hold.deliveries, "delivery from production", "deliveries from production"),
    ].filter(Boolean);
    return refuse(
      "CONFLICT",
      `${work.join(" and ")} still ${open === 1 ? "uses" : "use"} it. Finish or cancel ${
        open === 1 ? "it" : "them"
      } first.`,
    );
  }
  return ALLOWED;
}
