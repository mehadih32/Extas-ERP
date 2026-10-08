/*
 * The Styles tab's filters, kept in the address bar so a refresh or a shared
 * link shows the same list: "/products?q=polo&category=…&brand=…&archived=1".
 * Empty filters stay out of the address.
 */

export type StyleListView = {
  /** Style name or code; an exact SKU or barcode also finds that SKU. */
  q: string;
  category?: string;
  brand?: string;
  /** Show archived styles too. */
  archived: boolean;
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Styles shown at first and per "Show more". */
export const STYLE_PAGE_SIZE = 24;

const one = (params: SearchParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
};

/** Reads the filters from the address bar; anything malformed is ignored. */
export function styleListViewFrom(params: SearchParams): StyleListView {
  const id = (key: string) => {
    const value = one(params, key);
    return /^[a-z0-9]{1,64}$/i.test(value) ? value : undefined;
  };
  return {
    q: one(params, "q").slice(0, 100),
    category: id("category"),
    brand: id("brand"),
    archived: one(params, "archived") === "1",
  };
}

/** The address-bar query for these filters: "?q=polo&archived=1", or "" when none are set. */
export function styleListSearch(view: StyleListView): string {
  const params = new URLSearchParams();
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.category) params.set("category", view.category);
  if (view.brand) params.set("brand", view.brand);
  if (view.archived) params.set("archived", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The style list query (listStylesSchema) for these filters. */
export function styleListQuery(view: StyleListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    categoryId: view.category,
    brandId: view.brand,
    includeInactive: view.archived || undefined,
    cursor,
    take: STYLE_PAGE_SIZE,
  };
}

/**
 * Whether the search could be a SKU or barcode worth looking up exactly: one
 * word of letters, digits and dashes, like "EX-PL-001-NAVY-XL" or "8801234567890".
 */
export function looksLikeCode(q: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(q.trim());
}
