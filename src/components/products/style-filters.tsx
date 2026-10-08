"use client";

import { SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/modules/inventory/screens.service";

import { type StyleListView, styleListSearch } from "./style-list-view";

/** "    Polos": a category in a list, indented under its parent. */
const indented = (c: CategoryOption) => `${"   ".repeat(c.depth)}${c.name}`;

/**
 * The Styles tab's filters: search (a style's name or code, or an exact SKU or
 * barcode), category, brand and archived styles. On computers the categories are
 * a tree beside the list (Category, then Brand, then Style, then its matrix); on
 * phones they are a picker. A change reloads the list from the server; the old
 * list stays, dimmed, until the new one arrives, while the filters already show
 * the choice made.
 */
export function StyleFilters({
  view,
  categories,
  brands,
  children,
}: {
  view: StyleListView;
  categories: CategoryOption[];
  brands: Array<{ id: string; name: string }>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The choice made, until the list for it arrives (a select or checkbox bound to
  // the address alone would spring back while it loads).
  const [shown, setShown] = useOptimistic(view);
  const filtered = Boolean(shown.q || shown.category || shown.brand || shown.archived);

  function show(change: Partial<StyleListView>) {
    const next = { ...shown, ...change };
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${styleListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    show({ q: typeof value === "string" ? value : "" });
  }

  const treeLink = (categoryId: string | undefined) =>
    `${pathname}${styleListSearch({ ...shown, category: categoryId })}`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      {categories.length > 0 && (
        <nav aria-label="Categories" className="hidden lg:block">
          <p className="eyebrow">Categories</p>
          <ul className="mt-3 grid gap-0.5 text-sm">
            {[{ id: undefined, name: "All categories", depth: 0 }, ...categories].map((c) => {
              const active = shown.category === c.id;
              return (
                <li key={c.id ?? "all"}>
                  <Link
                    href={treeLink(c.id)}
                    scroll={false}
                    aria-current={active ? "page" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      show({ category: c.id });
                    }}
                    style={{ paddingLeft: `${0.75 + c.depth * 0.875}rem` }}
                    className={cn(
                      "block truncate rounded-sm py-1.5 pr-2 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
                      active
                        ? "bg-secondary font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {c.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <div className="grid min-w-0 grid-cols-1 content-start gap-5">
        <div className="grid gap-3 md:flex md:flex-wrap md:items-center">
          <form role="search" onSubmit={search} className="relative w-full md:max-w-xs">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              key={shown.q}
              type="search"
              name="q"
              defaultValue={shown.q}
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Style, code, SKU or barcode"
              aria-label="Search styles"
              className="pl-9"
            />
          </form>
          <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
            {categories.length > 0 && (
              <div className="lg:hidden">
                <label className="sr-only" htmlFor="style-category">
                  Category
                </label>
                <NativeSelect
                  id="style-category"
                  value={shown.category ?? ""}
                  onChange={(e) => show({ category: e.target.value || undefined })}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {indented(c)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {brands.length > 0 && (
              <div>
                <label className="sr-only" htmlFor="style-brand">
                  Brand
                </label>
                <NativeSelect
                  id="style-brand"
                  value={shown.brand ?? ""}
                  onChange={(e) => show({ brand: e.target.value || undefined })}
                >
                  <option value="">All brands</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>
          <label className="flex h-11 cursor-pointer items-center gap-2 text-sm md:h-9">
            <input
              type="checkbox"
              checked={shown.archived}
              onChange={(e) => show({ archived: e.target.checked })}
              className="size-4 cursor-pointer accent-primary"
            />
            Show archived styles
          </label>
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start md:ml-auto"
              onClick={() =>
                show({ q: "", category: undefined, brand: undefined, archived: false })
              }
            >
              <XIcon aria-hidden />
              Clear filters
            </Button>
          )}
        </div>
        <div
          aria-busy={pending}
          className={cn(
            "grid gap-5 transition-opacity",
            pending && "pointer-events-none opacity-50",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
