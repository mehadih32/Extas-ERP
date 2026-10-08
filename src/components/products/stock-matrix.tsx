"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { StyleScreen } from "@/modules/inventory/screens.service";

import { EmptyState, Swatch } from "./bits";
import { SkuDialog } from "./sku-dialog";

type Matrix = StyleScreen["matrix"];
type Cell = NonNullable<Matrix["rows"][number]["cells"][number]>;

function CellButton({
  cell,
  label,
  currency,
  onOpen,
}: {
  cell: Cell;
  label: string;
  currency: string;
  onOpen: () => void;
}) {
  const count = (n: number) => formatCount(n, currency);
  const extras = [
    cell.reserved > 0 ? `${count(cell.reserved)} set aside` : null,
    cell.bGrade > 0 ? `B ${count(cell.bGrade)}` : null,
  ].filter(Boolean);
  const described = [
    `${count(cell.available)} available`,
    cell.reserved > 0 ? `${count(cell.reserved)} set aside for orders` : null,
    cell.bGrade > 0 ? `${count(cell.bGrade)} B-grade` : null,
    cell.isActive ? null : "not offered for sale",
    cell.lowStock ? "low stock" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label} (${cell.sku}): ${described}`}
      className={cn(
        "flex h-full min-h-14 w-full cursor-pointer flex-col items-end justify-center rounded-sm px-2.5 py-2 text-right transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/25",
        cell.lowStock && "bg-destructive/5 text-destructive hover:bg-destructive/10",
        !cell.isActive && "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "font-serif text-lg leading-none lining-nums tabular-nums",
          !cell.isActive && "line-through decoration-1",
        )}
      >
        {count(cell.available)}
      </span>
      {extras.length > 0 && (
        <span className="mt-1 text-[0.6875rem] leading-none whitespace-nowrap text-muted-foreground tabular-nums">
          {extras.join(" · ")}
        </span>
      )}
      {!cell.isActive && (
        <span className="mt-1 text-[0.6875rem] leading-none text-muted-foreground">Off</span>
      )}
    </button>
  );
}

/**
 * A style's stock matrix (blueprint: rows are colours with their swatch, columns
 * are sizes): the pieces ready to sell in each SKU, A-grade less those set aside
 * for orders, in one warehouse or all of them. Cells below the company's low
 * stock level are red. A cell opens its SKU. On phones the colour column stays
 * put while the sizes scroll sideways.
 */
export function StockMatrix({
  screen,
  currency,
  openSku,
}: {
  screen: StyleScreen;
  currency: string;
  /** A SKU to open straight away (from a SKU or barcode search). */
  openSku?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const { matrix, warehouses, warehouseId } = screen;
  // The warehouse chosen, until its numbers arrive.
  const [shownWarehouse, setShownWarehouse] = useOptimistic(warehouseId ?? "");
  const known = matrix.rows.some((r) => r.cells.some((c) => c?.variantId === openSku));
  const [selected, setSelected] = useState<string | null>(known ? openSku! : null);
  const count = (n: number) => formatCount(n, currency);
  const sizeName = new Map(matrix.sizes.map((s) => [s.id, s.name]));

  function showWarehouse(id: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("sku");
    if (id) next.set("warehouse", id);
    else next.delete("warehouse");
    const query = next.toString();
    startTransition(() => {
      setShownWarehouse(id);
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    });
  }

  function close() {
    setSelected(null);
    if (params.has("sku")) {
      const next = new URLSearchParams(params.toString());
      next.delete("sku");
      const query = next.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    }
  }

  return (
    <section aria-labelledby="matrix-heading" className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="matrix-heading" className="font-serif text-xl text-primary">
            Stock matrix
          </h3>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Pieces ready to sell: A-grade less those set aside for orders. Red cells are below{" "}
            {count(matrix.lowStockThreshold)}. Tap a cell for its SKU.
          </p>
        </div>
        {warehouses.length > 1 && (
          <div className="grid gap-1.5 sm:w-56">
            <Label htmlFor="matrix-warehouse" className="eyebrow">
              Warehouse
            </Label>
            <NativeSelect
              id="matrix-warehouse"
              value={shownWarehouse}
              onChange={(e) => showWarehouse(e.target.value)}
              containerClassName="sm:w-full"
            >
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {matrix.rows.length === 0 ? (
        <EmptyState title="No colours or sizes yet">
          {screen.can.manage
            ? "Add this style's colours and sizes to make its SKUs, then bring in its stock."
            : "This style's SKUs show here once its colours and sizes are added."}
        </EmptyState>
      ) : (
        <div
          aria-busy={pending}
          className={cn(
            "overflow-x-auto rounded-lg border bg-card transition-opacity",
            pending && "pointer-events-none opacity-50",
          )}
        >
          <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
            <caption className="sr-only">
              Pieces ready to sell by colour and size
              {warehouseId
                ? ` at ${warehouses.find((w) => w.id === warehouseId)?.name ?? "this warehouse"}`
                : ", all warehouses"}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 h-10 min-w-[8.5rem] border-r border-b bg-card px-4 text-left text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase"
                >
                  Colour
                </th>
                {matrix.sizes.map((size) => (
                  <th
                    key={size.id}
                    scope="col"
                    className="h-10 min-w-[4.75rem] border-b px-2.5 text-right text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase"
                  >
                    {size.name}
                  </th>
                ))}
                <th
                  scope="col"
                  className="h-10 min-w-[5rem] border-b border-l bg-muted/40 px-4 text-right text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase"
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.color.id} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-b bg-card px-4 text-left font-normal group-last:border-b-0"
                  >
                    <span className="flex items-center gap-2">
                      <Swatch hex={row.color.hexCode} />
                      <span className="truncate">{row.color.name}</span>
                    </span>
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={matrix.sizes[i]!.id} className="border-b p-0.5 group-last:border-b-0">
                      {cell ? (
                        <CellButton
                          cell={cell}
                          label={`${row.color.name} / ${sizeName.get(cell.sizeId) ?? ""}`}
                          currency={currency}
                          onOpen={() => setSelected(cell.variantId)}
                        />
                      ) : (
                        <span
                          className="flex min-h-14 items-center justify-end px-2.5 text-muted-foreground/60"
                          title="Not made in this colour and size"
                        >
                          –
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="border-b border-l bg-muted/40 px-4 text-right font-medium group-last:border-b-0">
                    {count(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-t border-r bg-muted px-4 py-3 text-left text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase"
                >
                  Total
                </th>
                {matrix.sizes.map((size) => (
                  <td
                    key={size.id}
                    className="border-t bg-muted/40 px-2.5 py-3 text-right font-medium"
                  >
                    {count(size.total)}
                  </td>
                ))}
                <td className="border-t border-l bg-muted px-4 py-3 text-right font-serif text-lg leading-none lining-nums">
                  {count(matrix.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {selected && (
        <SkuDialog
          variantId={selected}
          warehouseId={warehouseId}
          currency={currency}
          onClose={close}
        />
      )}
    </section>
  );
}
