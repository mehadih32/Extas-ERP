/*
 * Which screens a Help guide covers: its own route and the pages under it, so a
 * list's guide ("/sales/orders") covers its records ("/sales/orders/[orderId]")
 * and their pages. The Help Center's tests and Bug Guard's "Screens without a
 * guide" use this one rule. No database: plain strings.
 */

const segments = (route: string) => route.split("/").filter(Boolean);

/**
 * Whether a guide's route covers a page: the page itself or a page above it. A
 * page's dynamic part ("[orderId]", or "[id]" as Bug Guard counts screens)
 * matches any part of the guide's route.
 */
export function guideCovers(route: string, page: string | readonly string[]): boolean {
  const parts = segments(route);
  const pageParts = typeof page === "string" ? segments(page) : page;
  if (parts.length === 0) return pageParts.length === 0;
  return (
    parts.length <= pageParts.length &&
    parts.every((part, i) => pageParts[i]!.startsWith("[") || pageParts[i] === part)
  );
}
