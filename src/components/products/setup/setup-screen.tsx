"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisVerticalIcon,
  FolderInputIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormAlert } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { CatalogSetup } from "@/modules/inventory/screens.service";
import {
  createBrandAction,
  createCategoryAction,
  createColorAction,
  createSizeAction,
  createWarehouseAction,
  deleteBrandAction,
  deleteCategoryAction,
  deleteColorAction,
  deleteSizeAction,
  reorderSizesAction,
  updateBrandAction,
  updateCategoryAction,
  updateColorAction,
  updateSizeAction,
} from "@/server/actions/inventory.actions";

import { Swatch } from "../bits";
import { CategoryDialog, ColorDialog, NameDialog, WarehouseDialog } from "./setup-dialogs";

type Color = CatalogSetup["colors"][number];
type Size = CatalogSetup["sizes"][number];
type Category = CatalogSetup["categories"][number];
type Brand = CatalogSetup["brands"][number];

type Open =
  | { kind: "color"; color?: Color }
  | { kind: "size"; size?: Size }
  | { kind: "category"; category?: Category; parentId: string | null }
  | { kind: "brand"; brand?: Brand }
  | { kind: "warehouse" }
  | {
      kind: "delete";
      what: string;
      name: string;
      run: () => Promise<{ ok: boolean; error?: ActionError }>;
    }
  | null;

const SECTIONS = [
  ["colours", "Colours"],
  ["sizes", "Sizes"],
  ["categories", "Categories"],
  ["brands", "Brands"],
  ["warehouses", "Warehouses"],
] as const;

/** "Used by 4 SKUs", "No styles yet". */
function usage(count: number, one: string, many: string) {
  return count === 0 ? `No ${many} yet` : `Used by ${count} ${count === 1 ? one : many}`;
}

function Section({
  id,
  title,
  description,
  addLabel,
  onAdd,
  children,
}: {
  id: string;
  title: string;
  description: string;
  /** The add button, for people who may change the catalogue. */
  addLabel?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="grid scroll-mt-24 content-start gap-4 rounded-lg border bg-card p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id={`${id}-heading`} className="font-serif text-xl text-primary">
            {title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {addLabel && onAdd && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd} className="h-10 md:h-8">
            <PlusIcon aria-hidden />
            {addLabel}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function Rows({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul aria-label={label} className="divide-y border-t">
      {children}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border-t pt-4 text-sm text-muted-foreground">{children}</p>;
}

function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${label}`}
          className="size-10 shrink-0 md:size-8"
        >
          <EllipsisVerticalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Saves through an action and reports its error to the dialog, or moves on. */
async function saved(
  work: Promise<{ ok: true } | { ok: false; error: ActionError }>,
  onDone: () => void,
): Promise<ActionError | undefined> {
  const result = await work;
  if (!result.ok) return result.error;
  onDone();
  return undefined;
}

/**
 * The Setup tab: the colours, sizes, categories and brands styles are built
 * from, and the warehouses that hold the stock. Everyone with inventory.view may
 * read them; inventory.manage may change them. Deleting is offered only where
 * inventory/rules.ts allows it (the item's `can.delete`).
 */
export function SetupScreen({ setup }: { setup: CatalogSetup }) {
  const { canManage } = setup;
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string>();
  const [sizeOrder, setSizeOrder] = useState<string[] | null>(null);
  const [orderError, setOrderError] = useState<ActionError>();
  const [reordering, startReordering] = useTransition();
  const close = () => setOpen(null);
  const done = (message: string) => () => {
    setNotice(message);
    setOpen(null);
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  const sizesById = new Map(setup.sizes.map((s) => [s.id, s]));
  const sizes = (sizeOrder ?? setup.sizes.map((s) => s.id)).flatMap(
    (id) => sizesById.get(id) ?? [],
  );

  function move(index: number, by: -1 | 1) {
    const ids = sizes.map((s) => s.id);
    const [taken] = ids.splice(index, 1);
    ids.splice(index + by, 0, taken!);
    setSizeOrder(ids);
    startReordering(async () => {
      const result = await reorderSizesAction({ sizeIds: ids });
      if (!result.ok) setOrderError(result.error);
      setSizeOrder(null);
    });
  }

  const remove = (what: string, name: string, run: () => Promise<unknown>) =>
    setOpen({
      kind: "delete",
      what,
      name,
      run: run as () => Promise<{ ok: boolean; error?: ActionError }>,
    });

  return (
    <div className="grid gap-6">
      <nav aria-label="Setup sections" className="flex flex-wrap gap-2 lg:hidden">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      {!canManage && (
        <FormAlert tone="note">
          You can see how the catalogue is set up. Changing it needs the permission to manage the
          catalogue and stock.
        </FormAlert>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section
          id="colours"
          title="Colours"
          description="The rows of each style's matrix, with the swatch buyers see."
          addLabel={canManage ? "Add" : undefined}
          onAdd={() => setOpen({ kind: "color" })}
        >
          {setup.colors.length === 0 ? (
            <Empty>No colours yet.</Empty>
          ) : (
            <Rows label="Colours">
              {setup.colors.map((color) => (
                <li key={color.id} className="flex min-h-14 items-center gap-3 py-2">
                  <Swatch hex={color.hexCode} className="size-6" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{color.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {color.hexCode} · {usage(color.variantCount, "SKU", "SKUs")}
                    </p>
                  </div>
                  {canManage && (
                    <RowMenu label={color.name}>
                      <DropdownMenuItem onSelect={() => setOpen({ kind: "color", color })}>
                        <PencilIcon aria-hidden />
                        Edit
                      </DropdownMenuItem>
                      {color.can.delete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              remove("colour", color.name, () => deleteColorAction(color.id))
                            }
                          >
                            <Trash2Icon aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowMenu>
                  )}
                </li>
              ))}
            </Rows>
          )}
        </Section>

        <Section
          id="sizes"
          title="Sizes"
          description="The columns of each style's matrix, in this order."
          addLabel={canManage ? "Add" : undefined}
          onAdd={() => setOpen({ kind: "size" })}
        >
          {sizes.length === 0 ? (
            <Empty>No sizes yet.</Empty>
          ) : (
            <Rows label="Sizes">
              {sizes.map((size, index) => (
                <li
                  key={size.id}
                  className={cn(
                    "flex min-h-14 items-center gap-3 py-2",
                    reordering && "opacity-70",
                  )}
                >
                  <span className="w-12 font-medium">{size.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {usage(size.variantCount, "SKU", "SKUs")}
                  </span>
                  {canManage && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-10 md:size-8"
                        aria-label={`Move ${size.name} up`}
                        disabled={index === 0 || reordering}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUpIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-10 md:size-8"
                        aria-label={`Move ${size.name} down`}
                        disabled={index === sizes.length - 1 || reordering}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDownIcon aria-hidden />
                      </Button>
                      <RowMenu label={size.name}>
                        <DropdownMenuItem onSelect={() => setOpen({ kind: "size", size })}>
                          <PencilIcon aria-hidden />
                          Rename
                        </DropdownMenuItem>
                        {size.can.delete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                remove("size", size.name, () => deleteSizeAction(size.id))
                              }
                            >
                              <Trash2Icon aria-hidden />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </RowMenu>
                    </>
                  )}
                </li>
              ))}
            </Rows>
          )}
        </Section>

        <Section
          id="categories"
          title="Categories"
          description="Where styles are filed: Tops, then Polos inside it."
          addLabel={canManage ? "Add" : undefined}
          onAdd={() => setOpen({ kind: "category", parentId: null })}
        >
          {setup.categories.length === 0 ? (
            <Empty>No categories yet. A style needs one.</Empty>
          ) : (
            <Rows label="Categories">
              {setup.categories.map((category) => (
                <li
                  key={category.id}
                  className="flex min-h-14 items-center gap-3 py-2"
                  style={{ paddingLeft: `${category.depth * 1.25}rem` }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {category.depth > 0 && (
                        <span aria-hidden className="mr-1.5 text-muted-foreground">
                          └
                        </span>
                      )}
                      {category.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {category.styleCount === 0
                        ? "No styles of its own"
                        : `${category.styleCount} ${category.styleCount === 1 ? "style" : "styles"}`}
                      {category.childCount > 0 ? ` · ${category.childCount} inside` : ""}
                    </p>
                  </div>
                  {canManage && (
                    <RowMenu label={category.name}>
                      <DropdownMenuItem
                        onSelect={() =>
                          setOpen({ kind: "category", category, parentId: category.parentId })
                        }
                      >
                        <FolderInputIcon aria-hidden />
                        Rename or move
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setOpen({ kind: "category", parentId: category.id })}
                      >
                        <FolderPlusIcon aria-hidden />
                        Add a category inside
                      </DropdownMenuItem>
                      {category.can.delete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              remove("category", category.name, () =>
                                deleteCategoryAction(category.id),
                              )
                            }
                          >
                            <Trash2Icon aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowMenu>
                  )}
                </li>
              ))}
            </Rows>
          )}
        </Section>

        <Section
          id="brands"
          title="Brands"
          description="The labels styles are sold under. A brand's stock sheet lists all its styles."
          addLabel={canManage ? "Add" : undefined}
          onAdd={() => setOpen({ kind: "brand" })}
        >
          {setup.brands.length === 0 ? (
            <Empty>No brands yet. Styles can do without one.</Empty>
          ) : (
            <Rows label="Brands">
              {setup.brands.map((brand) => (
                <li key={brand.id} className="flex min-h-14 items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{brand.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {brand.styleCount === 0
                        ? "No styles yet"
                        : `${brand.styleCount} ${brand.styleCount === 1 ? "style" : "styles"}`}
                    </p>
                  </div>
                  {canManage && (
                    <RowMenu label={brand.name}>
                      <DropdownMenuItem onSelect={() => setOpen({ kind: "brand", brand })}>
                        <PencilIcon aria-hidden />
                        Rename
                      </DropdownMenuItem>
                      {brand.can.delete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              remove("brand", brand.name, () => deleteBrandAction(brand.id))
                            }
                          >
                            <Trash2Icon aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowMenu>
                  )}
                </li>
              ))}
            </Rows>
          )}
        </Section>

        <Section
          id="warehouses"
          title="Warehouses"
          description="Where the stock is kept. Stock goes to the default one unless another is chosen."
          addLabel={canManage ? "Add" : undefined}
          onAdd={() => setOpen({ kind: "warehouse" })}
        >
          {setup.warehouses.length === 0 ? (
            <Empty>No warehouses yet. The first stock brought in sets up the Main Warehouse.</Empty>
          ) : (
            <Rows label="Warehouses">
              {setup.warehouses.map((w) => (
                <li key={w.id} className="flex min-h-14 items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{w.name}</span>
                      {w.isDefault && <Badge variant="secondary">Default</Badge>}
                    </p>
                    {w.address && (
                      <p className="truncate text-xs text-muted-foreground">{w.address}</p>
                    )}
                  </div>
                </li>
              ))}
            </Rows>
          )}
        </Section>
      </div>

      {open?.kind === "color" && (
        <ColorDialog
          color={open.color}
          onClose={close}
          onSave={(value) =>
            saved(
              open.color ? updateColorAction(open.color.id, value) : createColorAction(value),
              done(open.color ? `${value.name} was saved.` : `${value.name} was added.`),
            )
          }
        />
      )}
      {open?.kind === "size" && (
        <NameDialog
          title={open.size ? `Rename ${open.size.name}` : "Add a size"}
          description={
            open.size
              ? "SKUs already made keep their codes, so printed tags stay valid."
              : "New sizes go at the end of the matrix; move them into place after."
          }
          label="Size"
          initial={open.size?.name}
          hint="Like XL or 32. Written in capitals."
          maxLength={20}
          saveLabel={open.size ? "Save" : "Add size"}
          onClose={close}
          onSave={(name) =>
            saved(
              open.size ? updateSizeAction(open.size.id, { name }) : createSizeAction({ name }),
              done(open.size ? "The size was renamed." : `${name.toUpperCase()} was added.`),
            )
          }
        />
      )}
      {open?.kind === "category" && (
        <CategoryDialog
          category={open.category}
          parentId={open.parentId}
          categories={setup.categories}
          onClose={close}
          onSave={(value) =>
            saved(
              open.category
                ? updateCategoryAction(open.category.id, value)
                : createCategoryAction(value),
              done(open.category ? `${value.name} was saved.` : `${value.name} was added.`),
            )
          }
        />
      )}
      {open?.kind === "brand" && (
        <NameDialog
          title={open.brand ? `Rename ${open.brand.name}` : "Add a brand"}
          label="Name"
          initial={open.brand?.name}
          maxLength={120}
          saveLabel={open.brand ? "Save" : "Add brand"}
          onClose={close}
          onSave={(name) =>
            saved(
              open.brand ? updateBrandAction(open.brand.id, { name }) : createBrandAction({ name }),
              done(open.brand ? `${name} was saved.` : `${name} was added.`),
            )
          }
        />
      )}
      {open?.kind === "warehouse" && (
        <WarehouseDialog
          onClose={close}
          onSave={(value) => saved(createWarehouseAction(value), done(`${value.name} was added.`))}
        />
      )}
      {open?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${open.name}?`}
          description={`The ${open.what} is removed for good. Nothing uses it yet.`}
          confirmLabel="Delete"
          pendingLabel="Deleting"
          destructive
          errorTitle={`We could not delete the ${open.what}`}
          onClose={close}
          onConfirm={async () => {
            const result = await open.run();
            if (!result.ok) return result.error;
            setNotice(`${open.name} was deleted.`);
            close();
          }}
        />
      )}
      <ActionErrorDialog
        error={orderError}
        title="We could not change the size order"
        onClose={() => setOrderError(undefined)}
      />
    </div>
  );
}
