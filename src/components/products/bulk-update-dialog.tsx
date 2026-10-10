"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { StyleScreen } from "@/modules/inventory/screens.service";
import { getStyleMatrixAction, recordStockCountAction } from "@/server/actions/inventory.actions";

import { Swatch } from "./bits";
import { type GridCell, gridChanges, gridKey } from "./count-sheet";
import { pieces } from "./labels";

type Matrix = StyleScreen["matrix"];

/** Enter moves to the next box, as Tab does, instead of saving half-way. */
function nextOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const boxes = [
    ...(event.currentTarget.form?.querySelectorAll<HTMLInputElement>("input[data-box]") ?? []),
  ];
  boxes[boxes.indexOf(event.currentTarget) + 1]?.focus();
}

const GRADES = [
  { grade: "A_GRADE", label: "Good" },
  { grade: "B_GRADE", label: "B-grade" },
] as const;

/**
 * The Bulk update grid: every colour and size of a style at one warehouse, with
 * a box for its good (A-grade) and its B-grade pieces, filled with what is on
 * the shelf. Change any box (Tab moves along), then save once: each change is a
 * stock count correction, and nothing is saved if the stock moved meanwhile.
 */
export function BulkUpdateDialog({
  screen,
  currency,
  onClose,
  onSaved,
}: {
  screen: StyleScreen;
  currency: string;
  onClose: () => void;
  onSaved: (notice: string) => void;
}) {
  const { warehouses } = screen;
  const first =
    screen.warehouseId ?? warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";
  const [warehouseId, setWarehouseId] = useState(first);
  // The screen's matrix already shows this warehouse (or the only one there is).
  const [loaded, setLoaded] = useState<{ key: string; matrix: Matrix } | null>(
    screen.warehouseId === first || warehouses.length <= 1
      ? { key: `${first}:0`, matrix: screen.matrix }
      : null,
  );
  const [version, setVersion] = useState(0);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const want = `${warehouseId}:${version}`;
  const matrix = loaded?.key === want ? loaded.matrix : null;

  useEffect(() => {
    if (loaded?.key === want) return;
    let live = true;
    void getStyleMatrixAction(screen.style.id, warehouseId || undefined).then((result) => {
      if (!live) return;
      if (result.ok) setLoaded({ key: want, matrix: result.data });
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [want, loaded?.key, screen.style.id, warehouseId]);

  const cells: GridCell[] = (matrix?.rows ?? []).flatMap((row) =>
    row.cells.flatMap((c) =>
      c
        ? GRADES.map(({ grade }) => ({
            variantId: c.variantId,
            sku: c.sku,
            grade,
            onShelf: grade === "A_GRADE" ? c.aGrade : c.bGrade,
          }))
        : [],
    ),
  );
  const shelf = new Map(cells.map((c) => [gridKey(c), c.onShelf]));
  const changes = gridChanges(cells, typed);
  const name = warehouses.find((w) => w.id === warehouseId)?.name;

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    startTransition(async () => {
      const result = await recordStockCountAction({
        mode: "COUNT",
        warehouseId: warehouseId || undefined,
        note: note || undefined,
        lines: changes.lines.map((l) => ({
          variantId: l.variantId,
          grade: l.grade,
          counted: l.counted,
          expected: l.onShelf,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        // Someone changed the stock meanwhile: load the shelves again, keeping what was typed.
        if (result.error.code === "CONFLICT") setVersion((v) => v + 1);
        return;
      }
      onSaved(
        `Stock updated${name ? ` at ${name}` : ""}: ${changes.changed} ${
          changes.changed === 1 ? "box" : "boxes"
        } changed, +${changes.added} / −${changes.removed} pieces.`,
      );
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk update</DialogTitle>
          <DialogDescription>
            Each box shows the pieces on the shelf now. Change the ones that differ (Tab moves to
            the next box) and save once.
          </DialogDescription>
        </DialogHeader>
        <form
          id="bulk-update"
          onSubmit={save}
          className="-mx-2 grid min-h-0 content-start gap-4 overflow-y-auto overscroll-contain px-2 py-1"
          noValidate
        >
          {warehouses.length > 1 && (
            <div className="grid gap-1.5 sm:w-64">
              <Label htmlFor="bulk-warehouse">Warehouse</Label>
              <NativeSelect
                id="bulk-warehouse"
                value={warehouseId}
                disabled={pending}
                onChange={(e) => {
                  setTyped({});
                  setWarehouseId(e.target.value);
                }}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {!matrix ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
                <caption className="sr-only">
                  Pieces on the shelf by colour, grade and size{name ? ` at ${name}` : ""}
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 h-10 min-w-[6.5rem] border-r border-b bg-card px-3 text-left text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase sm:min-w-[8rem]"
                    >
                      Colour
                    </th>
                    {matrix.sizes.map((size) => (
                      <th
                        key={size.id}
                        scope="col"
                        className="h-10 min-w-[4.5rem] border-b px-1.5 text-center text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase"
                      >
                        {size.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.flatMap((row, r) =>
                    GRADES.map(({ grade, label }) => (
                      <tr key={`${row.color.id}:${grade}`}>
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-0 z-10 border-r bg-card px-3 py-1.5 text-left font-normal",
                            grade === "A_GRADE" && r > 0 && "border-t",
                          )}
                        >
                          {grade === "A_GRADE" ? (
                            <span className="flex items-center gap-2">
                              <Swatch hex={row.color.hexCode} />
                              <span className="min-w-0 break-words">{row.color.name}</span>
                            </span>
                          ) : (
                            <span className="sr-only">{row.color.name} </span>
                          )}
                          <span className="block pl-5.5 text-xs text-muted-foreground">
                            {label}
                          </span>
                        </th>
                        {row.cells.map((cell, i) => {
                          const size = matrix.sizes[i]!;
                          if (!cell) {
                            return (
                              <td
                                key={size.id}
                                className={cn(
                                  "px-1.5 py-1.5 text-center text-muted-foreground",
                                  grade === "A_GRADE" && r > 0 && "border-t",
                                )}
                              >
                                —
                              </td>
                            );
                          }
                          const key = gridKey({ variantId: cell.variantId, grade });
                          const value = typed[key] ?? String(shelf.get(key) ?? 0);
                          const changed = changes.lines.some((l) => gridKey(l) === key);
                          const invalid = value.trim() !== "" && !/^\d{1,7}$/.test(value.trim());
                          return (
                            <td
                              key={size.id}
                              className={cn(
                                "px-1.5 py-1.5",
                                grade === "A_GRADE" && r > 0 && "border-t",
                              )}
                            >
                              <Input
                                inputMode="numeric"
                                autoComplete="off"
                                value={value}
                                aria-label={`${row.color.name}, ${size.name}, ${label}`}
                                aria-invalid={invalid || undefined}
                                data-box
                                onFocus={(e) => e.currentTarget.select()}
                                onKeyDown={nextOnEnter}
                                onChange={(e) =>
                                  setTyped((was) => ({ ...was, [key]: e.target.value }))
                                }
                                className={cn(
                                  "h-9 min-w-[3.75rem] px-2 text-right tabular-nums md:h-8",
                                  changed && "border-primary bg-secondary font-medium text-primary",
                                )}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="bulk-note">Note (optional)</Label>
            <Input
              id="bulk-note"
              name="note"
              maxLength={500}
              placeholder="Like: October count"
              className="sm:max-w-sm"
            />
          </div>
        </form>
        <div className="grid gap-4 border-t pt-4">
          <p className="text-sm" role="status">
            {changes.invalid.length > 0
              ? "Use whole numbers, 0 or more, in every box."
              : changes.changed === 0
                ? "Change a box to update the stock."
                : `${changes.changed} ${changes.changed === 1 ? "box" : "boxes"} changed: ${
                    changes.added > 0 ? `${pieces(changes.added, currency)} found` : ""
                  }${changes.added > 0 && changes.removed > 0 ? ", " : ""}${
                    changes.removed > 0
                      ? `${pieces(changes.removed, currency)} missing (booked to Inventory Loss)`
                      : ""
                  }.`}
          </p>
          {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="bulk-update"
              disabled={pending || !matrix || changes.changed === 0 || changes.invalid.length > 0}
            >
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : "Save changes"}
            </Button>
          </DialogFooter>
        </div>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not update the stock"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
