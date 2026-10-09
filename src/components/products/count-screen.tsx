"use client";

import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
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
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { StockCountSheet } from "@/modules/inventory/screens.service";
import { recordStockCountAction } from "@/server/actions/inventory.actions";

import { EmptyState, Swatch } from "./bits";
import {
  type CountLine,
  countLines,
  type CountMode,
  countSearch,
  countTotals,
  type CountView,
  type OpeningLine,
  openingLines,
  readPieces,
  type SheetCell,
  shelfNumbers,
} from "./count-sheet";
import { AMOUNT_HINT, readAmount } from "./form-values";
import { GRADE_LABELS, money, pieces, signed } from "./labels";

type Cell = SheetCell & { label: string; isActive: boolean; reserved: number };

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 rounded-md border bg-card p-1 text-sm"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => value !== option.value && onChange(option.value)}
          className={cn(
            "h-9 cursor-pointer rounded-sm px-3 whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 md:h-8",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const MODES = [
  { value: "COUNT", label: "Count" },
  { value: "OPENING", label: "Opening stock" },
] as const;
const GRADES = [
  { value: "A_GRADE", label: "A-grade" },
  { value: "B_GRADE", label: "B-grade" },
] as const;

type Saved = { changed: number; added: number; removed: number };

/** Confirms what the count or the opening stock changes, then saves it. */
function ReviewDialog({
  sheet,
  view,
  count,
  opening,
  currency,
  onClose,
  onSaved,
  onStale,
}: {
  sheet: StockCountSheet;
  view: CountView;
  count: CountLine[];
  opening: OpeningLine[];
  currency: string;
  onClose: () => void;
  onSaved: (saved: Saved) => void;
  onStale: () => void;
}) {
  const [cost, setCost] = useState("");
  const [costProblem, setCostProblem] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const counting = view.mode === "COUNT";
  const differing = count.filter((l) => l.difference !== 0);
  const totals = countTotals(count);
  const openingPieces = opening.reduce((sum, l) => sum + l.quantity, 0);
  const unitCost = readAmount(cost);
  const where = `${sheet.sheet!.style.name} at ${sheet.warehouse.name}, ${GRADE_LABELS[view.grade]}`;
  const nothing = counting ? differing.length === 0 : opening.length === 0;

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim() || undefined;
    if (unitCost === "invalid") {
      setCostProblem(AMOUNT_HINT);
      return;
    }
    setCostProblem(undefined);
    const base = { warehouseId: sheet.warehouse.id ?? undefined, grade: view.grade, note };
    const input = counting
      ? {
          ...base,
          mode: "COUNT" as const,
          lines: count.map((l) => ({
            variantId: l.variantId,
            counted: l.counted,
            expected: l.onShelf,
          })),
        }
      : {
          ...base,
          mode: "OPENING" as const,
          unitCost: unitCost ?? undefined,
          lines: opening.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        };
    startTransition(async () => {
      const result = await recordStockCountAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data);
    });
  }

  const stale = error?.code === "CONFLICT";

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {counting
              ? nothing
                ? "Everything matches"
                : "Save the count?"
              : `Add ${pieces(openingPieces, currency)}?`}
          </DialogTitle>
          <DialogDescription>
            {counting
              ? nothing
                ? `The ${count.length === 1 ? "SKU" : `${count.length} SKUs`} counted match the stock of ${where}. There is nothing to change.`
                : `${where}: ${differing.length} ${differing.length === 1 ? "SKU differs" : "SKUs differ"} from the stock (${signed(totals.added, currency)} / ${signed(-totals.removed, currency)}). Missing pieces are booked as a loss; pieces found are added.`
              : `Opening stock for ${where}: stock you held before starting with Extas ERP.`}
          </DialogDescription>
        </DialogHeader>
        {!nothing && (
          <form id="review-count" onSubmit={save} className="grid gap-5" noValidate>
            <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-md border p-2 text-sm tabular-nums">
              {(counting ? differing : opening).map((line) => (
                <li
                  key={line.variantId}
                  className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 odd:bg-muted/50"
                >
                  <span className="min-w-0 truncate">
                    {line.sku}
                    {"counted" in line && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {line.onShelf} → {line.counted}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-medium",
                      "difference" in line && line.difference < 0 && "text-destructive",
                    )}
                  >
                    {signed("difference" in line ? line.difference : line.quantity, currency)}
                  </span>
                </li>
              ))}
            </ul>
            {!counting && (
              <Field
                id="opening-cost"
                label="Cost per piece (optional)"
                hint="What each piece cost. Leave it empty to use each SKU's average cost so far."
                error={costProblem ?? error?.fieldErrors?.unitCost?.[0]}
              >
                <Input
                  id="opening-cost"
                  inputMode="decimal"
                  autoComplete="off"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                  className="sm:max-w-48"
                  aria-invalid={Boolean(costProblem)}
                  aria-describedby={costProblem ? "opening-cost-error" : "opening-cost-hint"}
                />
              </Field>
            )}
            {!counting && typeof unitCost === "number" && (
              <p className="text-sm text-muted-foreground">
                Stock value added: {money((unitCost * openingPieces).toFixed(2), currency)}.
              </p>
            )}
            <Field id="count-note" label="Note (optional)">
              <Input
                id="count-note"
                name="note"
                maxLength={500}
                placeholder={counting ? "Like: October count" : "Like: stock at the start"}
              />
            </Field>
            {error && error.code !== "INTERNAL" && (
              <FormAlert>
                {error.message}
                {stale && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 py-1"
                    onClick={onStale}
                  >
                    Load the new shelf numbers, keeping what you typed
                  </Button>
                )}
              </FormAlert>
            )}
          </form>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {nothing ? "Close" : "Back"}
          </Button>
          {!nothing && (
            <Button type="submit" form="review-count" disabled={pending || stale}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : counting ? "Save the count" : "Add opening stock"}
            </Button>
          )}
        </DialogFooter>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not save the stock"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Stock count tab (inventory.manage, as recordStockCountAction checks): pick
 * a style, warehouse and grade, type the pieces on the shelf for each SKU and
 * save only the differences, or enter opening stock. The page gives it a new key
 * when the choices change, which starts a fresh sheet.
 */
export function CountScreen({
  sheet,
  view,
  currency,
}: {
  sheet: StockCountSheet;
  view: CountView;
  currency: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigating] = useTransition();
  // The choices made, until the sheet for them arrives.
  const [chosen, setChosen] = useOptimistic(view);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState<CountView | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "note"; text: string }>();
  /** The shelf numbers before reloading them, to point out the ones that moved. */
  const [before, setBefore] = useState<Record<string, number>>({});

  const counting = view.mode === "COUNT";
  const rows = sheet.sheet?.rows ?? [];
  const sizes = sheet.sheet?.sizes ?? [];
  const cells: Cell[] = rows.flatMap((row) =>
    row.cells.flatMap((cell, i) =>
      cell
        ? [
            {
              variantId: cell.variantId,
              sku: cell.sku,
              onShelf: cell.onShelf,
              reserved: cell.reserved,
              isActive: cell.isActive,
              label: `${row.color.name} / ${sizes[i]!.name}`,
            },
          ]
        : [],
    ),
  );
  const count = countLines(cells, typed);
  const opening = openingLines(cells, typed);
  const totals = countTotals(count.lines);
  const invalid = counting ? count.invalid : opening.invalid;
  const dirty = Object.values(typed).some((v) => v.trim() !== "");
  const openingPieces = opening.lines.reduce((sum, l) => sum + l.quantity, 0);
  const ready =
    invalid.length === 0 && (counting ? count.lines.length > 0 : opening.lines.length > 0);

  function go(next: CountView) {
    setLeaving(null);
    startNavigating(() => {
      setChosen(next);
      router.replace(`${pathname}${countSearch(next)}`, { scroll: false });
    });
  }
  function choose(change: Partial<CountView>) {
    const next = { ...chosen, ...change };
    if (dirty) setLeaving(next);
    else go(next);
  }
  function type(variantId: string, value: string) {
    setNotice(undefined);
    setTyped((now) => ({ ...now, [variantId]: value }));
  }
  function fillFromShelf() {
    setTyped((now) => ({
      ...shelfNumbers(cells),
      ...Object.fromEntries(Object.entries(now).filter(([, v]) => v.trim() !== "")),
    }));
  }
  function reloadShelf() {
    setBefore(Object.fromEntries(cells.map((c) => [c.variantId, c.onShelf])));
    setReviewing(false);
    setNotice({
      tone: "note",
      text: "Stock changed while you were counting. The shelf numbers are updated and the SKUs that moved are marked: check them and save again.",
    });
    startNavigating(() => router.refresh());
  }

  // What the pickers show: a choice on its way, or what the sheet is for.
  const styleValue =
    chosen.style !== view.style
      ? (chosen.style ?? "")
      : view.style && sheet.sheet
        ? view.style
        : "";
  const warehouseValue =
    chosen.warehouse !== view.warehouse ? (chosen.warehouse ?? "") : (sheet.warehouse.id ?? "");

  const summary = counting
    ? count.lines.length === 0
      ? "Type the pieces you find on the shelf."
      : `${count.lines.length} of ${cells.length} SKUs counted · ${
          totals.changed === 0
            ? "all match"
            : `${totals.changed} differ (${signed(totals.added, currency)} / ${signed(-totals.removed, currency)})`
        }`
    : opening.lines.length === 0
      ? "Type the pieces to add for each SKU."
      : `${pieces(openingPieces, currency)} to add in ${opening.lines.length} ${opening.lines.length === 1 ? "SKU" : "SKUs"}`;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,14rem)_auto]">
        <div className="grid gap-2">
          <span className="eyebrow">What to do</span>
          <Segmented
            label="What to do"
            value={chosen.mode}
            options={MODES}
            onChange={(mode: CountMode) => choose({ mode })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="count-style" className="eyebrow">
            Style
          </Label>
          <NativeSelect
            id="count-style"
            value={styleValue}
            onChange={(e) => choose({ style: e.target.value || undefined })}
            containerClassName="sm:w-full"
          >
            <option value="">Choose a style</option>
            {sheet.styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
                {s.isActive ? "" : " (archived)"}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="count-warehouse" className="eyebrow">
            Warehouse
          </Label>
          {sheet.warehouses.length > 1 ? (
            <NativeSelect
              id="count-warehouse"
              value={warehouseValue}
              onChange={(e) => choose({ warehouse: e.target.value })}
              containerClassName="sm:w-full"
            >
              {sheet.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p id="count-warehouse" className="flex h-9 items-center text-sm">
              {sheet.warehouse.name}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <span className="eyebrow">Grade</span>
          <Segmented
            label="Grade"
            value={chosen.grade}
            options={GRADES}
            onChange={(grade) => choose({ grade })}
          />
        </div>
      </div>

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}

      <div
        aria-busy={navigating}
        className={cn(
          "grid gap-6 transition-opacity",
          navigating && "pointer-events-none opacity-50",
        )}
      >
        {sheet.styles.length === 0 ? (
          <EmptyState
            title="Nothing to count yet"
            action={
              <Button asChild variant="outline">
                <Link href="/products">Go to the styles</Link>
              </Button>
            }
          >
            A style can be counted once it has colours and sizes.
          </EmptyState>
        ) : !sheet.sheet ? (
          <EmptyState title="Choose a style to count">
            {counting
              ? "Its SKUs show with the pieces the stock says are on the shelf. Type what you count; only differences are saved."
              : "Its SKUs show, ready for the pieces you held before starting with Extas ERP."}
          </EmptyState>
        ) : (
          <>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {counting
                ? `Type the ${GRADE_LABELS[view.grade]} pieces you find for each SKU at ${sheet.warehouse.name}. Leave a box empty to skip it; only the SKUs that differ change.`
                : `Type the ${GRADE_LABELS[view.grade]} pieces to add for each SKU at ${sheet.warehouse.name}. For stock held before starting with Extas ERP; deliveries from production come in through Production.`}
            </p>
            {rows.map((row) => (
              <fieldset key={row.color.id} className="rounded-lg border bg-card p-4 sm:p-5">
                <legend className="flex items-center gap-2 px-1 font-medium">
                  <Swatch hex={row.color.hexCode} />
                  {row.color.name}
                </legend>
                <div className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] sm:gap-3">
                  {row.cells.map((cell, i) => {
                    if (!cell) return null;
                    const size = sizes[i]!.name;
                    const read = readPieces(typed[cell.variantId]);
                    const difference = read.kind === "pieces" ? read.value - cell.onShelf : null;
                    const moved =
                      before[cell.variantId] !== undefined &&
                      before[cell.variantId] !== cell.onShelf;
                    return (
                      <div
                        key={cell.variantId}
                        className={cn(
                          "grid grid-cols-[3.25rem_minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 sm:grid-cols-1 sm:grid-rows-[auto_1fr_auto_auto] sm:py-3",
                          read.kind === "invalid" && "border-destructive/50 bg-destructive/5",
                          counting &&
                            difference !== null &&
                            difference !== 0 &&
                            "border-primary/30 bg-secondary/60",
                          moved && "border-amber-500/60",
                        )}
                      >
                        <span className="font-medium">
                          {size}
                          {!cell.isActive && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              Off
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums sm:self-start">
                          <span className="block">Stock {cell.onShelf}</span>
                          {cell.reserved > 0 && (
                            <span className="block">{cell.reserved} set aside</span>
                          )}
                        </span>
                        <Input
                          inputMode="numeric"
                          autoComplete="off"
                          value={typed[cell.variantId] ?? ""}
                          onChange={(e) => type(cell.variantId, e.target.value)}
                          aria-label={`${row.color.name} / ${size}: pieces ${counting ? "counted" : "to add"}`}
                          aria-invalid={read.kind === "invalid"}
                          placeholder={counting ? String(cell.onShelf) : "0"}
                          className="h-10 text-right tabular-nums placeholder:text-muted-foreground/40 md:h-9"
                        />
                        <span
                          className={cn(
                            // Kept on computers, so the boxes of a row line up.
                            "col-span-3 text-xs tabular-nums empty:hidden sm:col-span-1 sm:min-h-4 sm:empty:block",
                            read.kind === "invalid" && "text-destructive",
                            difference !== null && difference < 0 && "text-destructive",
                            moved && "text-amber-700",
                          )}
                        >
                          {read.kind === "invalid"
                            ? "Whole pieces only"
                            : moved
                              ? `Stock moved: was ${before[cell.variantId]}`
                              : counting && difference !== null
                                ? difference === 0
                                  ? "Matches"
                                  : signed(difference, currency)
                                : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </>
        )}
      </div>

      {sheet.sheet && (
        // Outside the sheet, so it stays in view from the choices above down to the last colour.
        <div
          className={cn(
            "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex flex-col gap-3 border-t bg-card/95 px-4 py-3 backdrop-blur transition-opacity supports-[backdrop-filter]:bg-card/85 sm:-mx-6 sm:px-6 md:bottom-4 md:mx-0 md:flex-row md:items-center md:justify-between md:rounded-lg md:border md:px-5 md:shadow-[0_12px_32px_-16px_rgb(11_61_46/0.35)]",
            navigating && "pointer-events-none opacity-50",
          )}
        >
          <p className="text-sm tabular-nums" role="status">
            {invalid.length > 0 ? (
              <span className="text-destructive">
                Use whole pieces in{" "}
                {invalid.length === 1 ? "the box" : `the ${invalid.length} boxes`} marked in red.
              </span>
            ) : (
              summary
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 md:flex">
            {counting && (
              <Button type="button" variant="outline" onClick={fillFromShelf}>
                Fill the rest
              </Button>
            )}
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setTyped({});
                  setBefore({});
                }}
              >
                Clear
              </Button>
            )}
            <Button
              type="button"
              className={cn("col-span-2 md:col-span-1", !counting && !dirty && "col-span-2")}
              disabled={!ready}
              onClick={() => setReviewing(true)}
            >
              Review and save
            </Button>
          </div>
        </div>
      )}

      {reviewing && sheet.sheet && (
        <ReviewDialog
          sheet={sheet}
          view={view}
          count={count.lines}
          opening={opening.lines}
          currency={currency}
          onClose={() => setReviewing(false)}
          onStale={reloadShelf}
          onSaved={(saved) => {
            setReviewing(false);
            setTyped({});
            setBefore({});
            setNotice({
              tone: "success",
              text: counting
                ? saved.changed === 0
                  ? "Nothing changed: the count matched the stock."
                  : `Count saved: ${saved.changed} ${saved.changed === 1 ? "SKU" : "SKUs"} corrected (${signed(saved.added, currency)} / ${signed(-saved.removed, currency)}).`
                : `Opening stock added: ${pieces(saved.added, currency)} in ${saved.changed} ${saved.changed === 1 ? "SKU" : "SKUs"}.`,
            });
          }}
        />
      )}

      {leaving && (
        <Dialog open onOpenChange={(open) => !open && setLeaving(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Leave this sheet?</DialogTitle>
              <DialogDescription>
                The pieces typed for {sheet.sheet?.style.name ?? "this style"} are not saved yet.
                They are cleared if you switch.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLeaving(null)}>
                Stay
              </Button>
              <Button type="button" variant="destructive" onClick={() => go(leaving)}>
                Switch and clear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
