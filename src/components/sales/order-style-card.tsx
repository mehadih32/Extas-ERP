"use client";

import { ChevronDownIcon, LoaderCircleIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { OrderForm as OrderFormData, SaleMatrix } from "@/modules/sales/screens.service";

import { ColorName } from "./detail-bits";
import { money } from "./labels";
import { parseRatio, presetRatio, ratioPieces, ratioText } from "./magic-ratio";

/** One style on the order: its matrix, a price for every piece of it, and pieces per SKU. */
export type Block = {
  key: string;
  styleId: string;
  matrix: SaleMatrix | null;
  loadError?: string;
  unitPrice: string;
  quantities: Record<string, string>;
  /** Editing: its SKUs had different prices or line discounts before. */
  mixedPrices: boolean;
};

export const wholeNumber = (text: string | undefined) =>
  text !== undefined && /^\d{1,7}$/.test(text.trim()) ? Number(text) : null;

export const blockPieces = (block: Block) =>
  Object.values(block.quantities).reduce((sum, q) => sum + (wholeNumber(q) ?? 0), 0);

/** "4,500.00" for the totals preview. */
export const fixed2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * The sizes of a style that can be sold (or that the order already holds), in
 * the matrix's order, with their column.
 */
function usedSizes(m: SaleMatrix, quantities: Record<string, string> = {}) {
  return m.sizes
    .map((size, column) => ({ ...size, column }))
    .filter(({ column }) =>
      m.rows.some((row) => {
        const cell = row.cells[column];
        return cell && (cell.isActive || Boolean(quantities[cell.variantId]));
      }),
    );
}

/**
 * A style as a card that folds away: the heading shows its pieces and amount;
 * open, it has the price, Magic Ratio and the colour × size grid with the
 * pieces ready under each box (0 in bold red, too few in amber).
 */
export function StyleCard({
  block,
  open,
  onToggle,
  wholesale,
  currency,
  own,
  short,
  fieldError,
  amount,
  presets,
  onChange,
  onRemove,
}: {
  block: Block;
  open: boolean;
  onToggle: () => void;
  wholesale: boolean;
  currency: string;
  own: Record<string, number>;
  short: Record<string, string>;
  fieldError: (name: string) => string | undefined;
  amount: number;
  presets: OrderFormData["ratioPresets"];
  onChange: (change: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const m = block.matrix;
  const title = m ? `${m.style.code} · ${m.style.name}` : "Loading the style";
  const listPrice = m ? (wholesale ? m.style.wholesalePrice : m.style.retailPrice) : "";
  const priceId = `${block.key}-price`;
  const pieces = blockPieces(block);
  const bodyId = `${block.key}-body`;
  const shortHere = m
    ? m.rows.some((row) => row.cells.some((cell) => cell && short[cell.sku]))
    : false;
  const hasError =
    Boolean(fieldError(`price.${block.key}`)) ||
    Object.keys(block.quantities).some((id) => fieldError(`qty.${id}`));

  return (
    <li className="min-w-0 rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-3 sm:p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          <ChevronDownIcon
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span className="grid min-w-0 gap-0.5">
            <span className="font-medium break-words">{title}</span>
            {m && (
              <span
                className={cn(
                  "text-[0.8125rem] tabular-nums",
                  shortHere || hasError ? "text-amber-700" : "text-muted-foreground",
                )}
              >
                {formatCount(pieces, currency)} pcs · {money(fixed2(amount), currency)}
                {shortHere ? " · short of stock" : ""}
              </span>
            )}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${m ? m.style.code : "this style"}`}
        >
          <Trash2Icon aria-hidden />
          <span className="max-sm:sr-only">Remove</span>
        </Button>
      </div>

      <div id={bodyId} hidden={!open} className="grid min-w-0 gap-4 border-t p-3 sm:p-4">
        {block.loadError ? (
          <FormAlert>{block.loadError}</FormAlert>
        ) : !m ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Loading colours and sizes
          </p>
        ) : (
          <>
            <Field
              id={priceId}
              label={`Price per piece (${currency})`}
              hint={
                block.mixedPrices
                  ? "Its pieces had different prices or discounts; saving gives them this one price (empty: the list price)."
                  : `Empty uses the ${wholesale ? "wholesale" : "retail"} list price, ${listPrice}.`
              }
              error={fieldError(`price.${block.key}`)}
            >
              <Input
                id={priceId}
                inputMode="decimal"
                value={block.unitPrice}
                onChange={(e) => onChange({ unitPrice: e.target.value })}
                placeholder={listPrice}
                autoComplete="off"
                className="sm:w-40"
                aria-invalid={Boolean(fieldError(`price.${block.key}`))}
                aria-describedby={
                  fieldError(`price.${block.key}`) ? `${priceId}-error` : `${priceId}-hint`
                }
              />
            </Field>
            {!m.style.isActive && (
              <FormAlert tone="note">
                This style is archived; it can be sold only from stock left.
              </FormAlert>
            )}
            <MagicRatio block={block} matrix={m} presets={presets} onChange={onChange} />
            <MatrixGrid
              block={block}
              matrix={m}
              own={own}
              short={short}
              fieldError={fieldError}
              currency={currency}
              onChange={onChange}
            />
          </>
        )}
      </div>
    </li>
  );
}

/** Ratio × sets fills the chosen colours in one go. */
function MagicRatio({
  block,
  matrix: m,
  presets,
  onChange,
}: {
  block: Block;
  matrix: SaleMatrix;
  presets: OrderFormData["ratioPresets"];
  onChange: (change: Partial<Block>) => void;
}) {
  const sizes = usedSizes(m);
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(() => ratioText(sizes.map(() => 1)));
  const [sets, setSets] = useState("");
  const [colors, setColors] = useState<Set<string>>(() => new Set(m.rows.map((r) => r.color.id)));
  const [problem, setProblem] = useState<string>();
  const id = `${block.key}-ratio`;
  const fitting = presets
    .map((p) => ({ name: p.name, ratio: presetRatio(sizes, p.entries) }))
    .filter((p): p is { name: string; ratio: number[] } => p.ratio !== null);
  const parsed = parseRatio(ratio);
  const perSet = ratioPieces(sizes, parsed, 1);
  const setPieces = "pieces" in perSet ? [...perSet.pieces.values()].reduce((a, b) => a + b, 0) : 0;
  const setCount = wholeNumber(sets) ?? 0;

  function fill() {
    const result = ratioPieces(sizes, parsed, wholeNumber(sets) ?? 0);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    if (colors.size === 0) {
      setProblem("Choose at least one colour.");
      return;
    }
    const quantities = { ...block.quantities };
    for (const row of m.rows) {
      if (!colors.has(row.color.id)) continue;
      for (const size of sizes) {
        const cell = row.cells[size.column];
        if (!cell?.isActive) continue;
        const pieces = result.pieces.get(size.id) ?? 0;
        if (pieces > 0) quantities[cell.variantId] = String(pieces);
        else delete quantities[cell.variantId];
      }
    }
    setProblem(undefined);
    onChange({ quantities });
    setOpen(false);
  }

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <SparklesIcon aria-hidden />
          Magic Ratio
        </Button>
      </div>
    );
  }
  return (
    <fieldset className="grid min-w-0 gap-4 rounded-md border border-primary/25 bg-secondary/40 p-3 sm:p-4">
      <legend className="sr-only">Magic Ratio</legend>
      <p className="flex items-center gap-2 text-sm font-medium text-primary">
        <SparklesIcon className="size-4" aria-hidden />
        Magic Ratio: fill every colour at once
      </p>
      {fitting.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Saved ratios">
          {fitting.map((p) => (
            <Button
              key={p.name}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRatio(ratioText(p.ratio))}
            >
              {p.name} ({ratioText(p.ratio)})
            </Button>
          ))}
        </div>
      )}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id={`${id}-ratio`}
          label={`Ratio for ${sizes.map((s) => s.name).join(" : ")}`}
          hint="One number per size. Use 0 to skip a size."
        >
          <Input
            id={`${id}-ratio`}
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="1:2:2:1"
            aria-describedby={`${id}-ratio-hint`}
          />
        </Field>
        <Field
          id={`${id}-sets`}
          label="Sets for each colour"
          hint={
            "pieces" in perSet
              ? `1 set = ${sizes.map((s) => `${s.name} ${perSet.pieces.get(s.id) ?? 0}`).join(" · ")}${
                  setCount > 0
                    ? `; ${setCount} sets = ${setCount * setPieces} pcs a colour`
                    : ` (${setPieces} pcs)`
                }`
              : undefined
          }
        >
          <Input
            id={`${id}-sets`}
            value={sets}
            onChange={(e) => setSets(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="10"
            className="sm:w-32"
          />
        </Field>
      </div>
      {m.rows.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Colours to fill">
          {m.rows.map((row) => {
            const on = colors.has(row.color.id);
            return (
              <button
                key={row.color.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setColors((all) => {
                    const next = new Set(all);
                    if (on) next.delete(row.color.id);
                    else next.add(row.color.id);
                    return next;
                  })
                }
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-[0.8125rem] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  on ? "border-primary/50 bg-card text-primary" : "text-muted-foreground",
                )}
              >
                <ColorName name={row.color.name} hexCode={row.color.hexCode} />
              </button>
            );
          })}
        </div>
      )}
      {problem && <FormAlert>{problem}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
        <Button type="button" size="sm" onClick={fill}>
          Fill the grid
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * The colour × size grid: one row per colour, one small box per size with the
 * pieces ready under it, and totals per colour and per size. Wide grids scroll
 * sideways inside the card, never the page.
 */
function MatrixGrid({
  block,
  matrix: m,
  own,
  short,
  fieldError,
  currency,
  onChange,
}: {
  block: Block;
  matrix: SaleMatrix;
  own: Record<string, number>;
  short: Record<string, string>;
  fieldError: (name: string) => string | undefined;
  currency: string;
  onChange: (change: Partial<Block>) => void;
}) {
  const sizes = usedSizes(m, block.quantities);
  const qty = (variantId: string) => wholeNumber(block.quantities[variantId]) ?? 0;
  const sizeTotal = (column: number) =>
    m.rows.reduce(
      (sum, row) => sum + (row.cells[column] ? qty(row.cells[column].variantId) : 0),
      0,
    );

  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Pieces by colour and size, with the pieces ready</caption>
        <thead>
          <tr className="text-[0.8125rem] text-muted-foreground">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-card py-2 pr-2 text-left font-medium sm:pr-3"
            >
              Colour
            </th>
            {sizes.map((s) => (
              <th key={s.id} scope="col" className="px-0.5 py-2 text-center font-medium sm:px-1">
                {s.name}
              </th>
            ))}
            <th scope="col" className="hidden py-2 pl-2 text-right font-medium sm:table-cell">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((row) => {
            const rowTotal = sizes.reduce(
              (sum, s) => sum + (row.cells[s.column] ? qty(row.cells[s.column]!.variantId) : 0),
              0,
            );
            return (
              <tr key={row.color.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-24 bg-card py-1.5 pr-2 text-left font-normal break-words sm:max-w-36 sm:pr-3"
                >
                  <ColorName name={row.color.name} hexCode={row.color.hexCode} />
                </th>
                {sizes.map((size) => {
                  const cell = row.cells[size.column];
                  if (!cell) return <td key={size.id} className="px-0.5 py-1.5 sm:px-1" />;
                  const ready = Math.max(cell.available, 0) + (own[cell.variantId] ?? 0);
                  const isShort = Boolean(short[cell.sku]);
                  const bad = Boolean(fieldError(`qty.${cell.variantId}`));
                  return (
                    <td key={size.id} className="px-0.5 py-1.5 align-top sm:px-1">
                      <Input
                        inputMode="numeric"
                        value={block.quantities[cell.variantId] ?? ""}
                        onChange={(e) =>
                          onChange({
                            quantities: { ...block.quantities, [cell.variantId]: e.target.value },
                          })
                        }
                        disabled={!cell.isActive && !block.quantities[cell.variantId]}
                        placeholder="0"
                        aria-label={`${row.color.name} ${size.name}, pieces (${ready} ready)`}
                        aria-invalid={bad || isShort}
                        className={cn(
                          "h-9 w-[3.25rem] px-1 text-right tabular-nums sm:w-16 sm:px-2",
                          isShort && "border-amber-500 focus-visible:border-amber-500",
                        )}
                      />
                      <span
                        className={cn(
                          "mt-0.5 block text-center text-xs tabular-nums",
                          ready === 0
                            ? "font-bold text-destructive"
                            : isShort
                              ? "text-amber-700"
                              : "text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        {ready === 0 ? "0" : formatCount(ready, currency)}
                      </span>
                    </td>
                  );
                })}
                <td className="hidden py-1.5 pl-2 text-right align-top font-medium tabular-nums sm:table-cell">
                  <span className="inline-block pt-2">{formatCount(rowTotal, currency)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
        {m.rows.length > 1 && (
          <tfoot>
            <tr className="text-[0.8125rem] text-muted-foreground">
              <th
                scope="row"
                className="sticky left-0 z-10 border-t bg-card py-2 pr-2 text-left font-medium sm:pr-3"
              >
                Total
              </th>
              {sizes.map((s) => (
                <td key={s.id} className="border-t px-0.5 py-2 text-center tabular-nums sm:px-1">
                  {formatCount(sizeTotal(s.column), currency)}
                </td>
              ))}
              <td className="hidden border-t py-2 pl-2 text-right font-medium text-foreground tabular-nums sm:table-cell">
                {formatCount(blockPieces(block), currency)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="mt-2 text-[0.75rem] text-muted-foreground">
        The small number under each box is the pieces ready.{" "}
        <span className="font-bold text-destructive">0</span> means none in stock.
      </p>
    </div>
  );
}
