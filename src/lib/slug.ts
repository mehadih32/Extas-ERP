/** URL-safe lowercase slug, e.g. "Polo Shirts & Tees" -> "polo-shirts-tees". */
export function slugify(name: string, fallback = "item"): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}
