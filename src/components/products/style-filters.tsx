"use client";

import { ChevronDownIcon, ChevronRightIcon, FolderTreeIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/modules/inventory/screens.service";

import { type StyleListView, styleListSearch } from "./style-list-view";

type TreeProps = {
  categories: CategoryOption[];
  /** This tab's styles per category, counting the categories under it. */
  counts: Record<string, number>;
  selected?: string;
  hrefFor: (categoryId: string | undefined) => string;
  onSelect: (categoryId: string | undefined) => void;
};

/** The category's parents, so the tree opens down to it. */
function ancestors(categories: CategoryOption[], id?: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out: string[] = [];
  for (let c = id ? byId.get(id) : undefined; c?.parentId; c = byId.get(c.parentId)) {
    out.push(c.parentId);
  }
  return out;
}

/**
 * The categories as a tree that folds open: tap a name to show its styles (and
 * those under it), tap the arrow to see its subcategories. Each shows how many
 * styles it holds.
 */
function CategoryTree({ categories, counts, selected, hrefFor, onSelect }: TreeProps) {
  const [open, setOpen] = useState(() => new Set(ancestors(categories, selected)));
  const total = categories.reduce((sum, c) => sum + (c.parentId ? 0 : (counts[c.id] ?? 0)), 0);

  function toggle(id: string) {
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function row(id: string | undefined, name: string, count: number) {
    const active = selected === id;
    return (
      <Link
        href={hrefFor(id)}
        scroll={false}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          onSelect(id);
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-2 pr-2 pl-2 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 lg:py-1.5",
          active
            ? "bg-secondary font-medium text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <span className="min-w-0 break-words">{name}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      </Link>
    );
  }

  function branch(parentId: string | null): React.ReactNode {
    return categories
      .filter((c) => c.parentId === parentId)
      .map((c) => {
        const expanded = open.has(c.id);
        return (
          <li key={c.id}>
            <div className="flex items-center">
              {c.childCount > 0 ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Hide" : "Show"} the categories in ${c.name}`}
                  onClick={() => toggle(c.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25"
                >
                  <ChevronRightIcon
                    aria-hidden
                    className={cn("size-4 transition-transform", expanded && "rotate-90")}
                  />
                </button>
              ) : (
                <span aria-hidden className="size-8 shrink-0" />
              )}
              {row(c.id, c.name, counts[c.id] ?? 0)}
            </div>
            {expanded && <ul className="ml-4 grid gap-0.5 border-l pl-1">{branch(c.id)}</ul>}
          </li>
        );
      });
  }

  return (
    <ul className="grid gap-0.5 text-sm">
      <li className="flex items-center">
        <span aria-hidden className="size-8 shrink-0" />
        {row(undefined, "All categories", total)}
      </li>
      {branch(null)}
    </ul>
  );
}

export function StyleFilters({
  view,
  categories,
  counts,
  brands,
  children,
}: {
  view: StyleListView;
  categories: CategoryOption[];
  counts: Record<string, number>;
  brands: Array<{ id: string; name: string }>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [treeOpen, setTreeOpen] = useState(false);
  // The choice made, until the list for it arrives (a select bound to the
  // address alone would spring back while it loads).
  const [shown, setShown] = useOptimistic(view);
  const filtered = Boolean(shown.q || shown.category || shown.brand);

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

  const tree: TreeProps = {
    categories,
    counts,
    selected: shown.category,
    hrefFor: (category) => `${pathname}${styleListSearch({ ...shown, category })}`,
    onSelect: (category) => {
      setTreeOpen(false);
      show({ category });
    },
  };
  const categoryName = categories.find((c) => c.id === shown.category)?.name;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      {categories.length > 0 && (
        <nav aria-label="Categories" className="hidden lg:block">
          <p className="eyebrow">Categories</p>
          <div className="mt-3">
            <CategoryTree {...tree} />
          </div>
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
          {brands.length > 0 && (
            <div className="md:w-48">
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
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start md:ml-auto"
              onClick={() => show({ q: "", category: undefined, brand: undefined })}
            >
              <XIcon aria-hidden />
              Clear filters
            </Button>
          )}
        </div>
        {categories.length > 0 && (
          <details
            open={treeOpen}
            onToggle={(e) => setTreeOpen(e.currentTarget.open)}
            className="group rounded-lg border bg-card shadow-sm lg:hidden"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 [&::-webkit-details-marker]:hidden">
              <FolderTreeIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Category</span>
              <span className="min-w-0 flex-1 font-medium break-words">
                {categoryName ?? "All categories"}
              </span>
              <ChevronDownIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <nav aria-label="Categories" className="border-t p-2">
              <CategoryTree {...tree} />
            </nav>
          </details>
        )}
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
