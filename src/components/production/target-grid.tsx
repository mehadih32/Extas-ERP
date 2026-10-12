"use client";

import { LoaderCircleIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { ColorName } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatCount } from "@/lib/display";
import { fillByTotal, type RatioEntry } from "@/modules/inventory/ratio";
import type { IntakeMatrix } from "@/modules/production/screens.service";

import { piecesIn, sumOf } from "./pieces";

/** One style on a project's grid: its colours by sizes and the pieces to make of each SKU. */
export type TargetBlock = {
  key: string;
  styleId: string;
  matrix: IntakeMatrix | null;
  loadError?: string;
  quantities: Record<string, string>;
};

/** The SKUs and pieces typed on the grid; `bad` when a box is not a whole number. */
export function readTargets(blocks: readonly TargetBlock[]) {
  const lines: Array<{ variantId: string; quantity: number }> = [];
  let bad = false;
  for (const block of blocks) {
    for (const [variantId, text] of Object.entries(block.quantities)) {
      const quantity = piecesIn(text);
      if (Number.isNaN(quantity)) bad = true;
      else if (quantity > 0) lines.push({ variantId, quantity });
    }
  }
  return { lines, bad };
}

/** A saved size ratio ("S 1, M 2, L 2, XL 1"), from Products' ratio presets. */
export type RatioPreset = {
  id: string;
  name: string;
  entries: Array<{ sizeId: string; sizeName: string; ratio: number }>;
};

const TYPED = "typed";

/** "1:2:2:1" (or "1 2 2 1") against the style's sizes in order; null when it does not fit. */
export function typedRatio(text: string, sizeIds: readonly string[]): RatioEntry[] | null {
  const parts = text
    .trim()
    .split(/[\s:,/-]+/)
    .filter(Boolean);
  if (parts.length === 0 || parts.length > sizeIds.length) return null;
  if (!parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const entries = parts.map((p, i) => ({ sizeId: sizeIds[i]!, ratio: Number(p) }));
  return entries.some((e) => e.ratio > 0) ? entries : null;
}

/**
 * "Fill by size ratio": pieces per colour split over the sizes by a saved ratio
 * or one typed in ("1:2:2:1"), always adding up to the pieces given.
 */
function RatioFill({
  block,
  matrix,
  presets,
  onFill,
}: {
  block: TargetBlock;
  matrix: IntakeMatrix;
  presets: readonly RatioPreset[];
  onFill: (quantities: Record<string, string>) => void;
}) {
  const sizeIds = matrix.sizes.map((s) => s.id);
  // Presets that name at least one of the style's sizes.
  const usable = presets.filter((p) => p.entries.some((e) => sizeIds.includes(e.sizeId)));
  const [ratio, setRatio] = useState(usable[0]?.id ?? TYPED);
  const [typed, setTyped] = useState("");
  const [pieces, setPieces] = useState("");
  const [colour, setColour] = useState("ALL");
  const [problem, setProblem] = useState<string>();
  const id = (name: string) => `${block.key}-ratio-${name}`;

  function fill() {
    const entries =
      ratio === TYPED
        ? typedRatio(typed, sizeIds)
        : (usable.find((p) => p.id === ratio)?.entries ?? []).filter((e) =>
            sizeIds.includes(e.sizeId),
          );
    const total = piecesIn(pieces);
    if (!entries || entries.length === 0) {
      setProblem(
        `Type a number for each size, like 1:2:2:1 for ${matrix.sizes.map((s) => s.name).join(", ")}.`,
      );
      return;
    }
    if (!(total > 0)) {
      setProblem("Enter the pieces for each colour, like 600.");
      return;
    }
    setProblem(undefined);
    const split = fillByTotal(entries, total);
    const next = { ...block.quantities };
    for (const row of matrix.rows) {
      if (colour !== "ALL" && row.color.id !== colour) continue;
      row.cells.forEach((cell, index) => {
        if (!cell || !cell.isActive) return;
        next[cell.variantId] = String(split.get(matrix.sizes[index]!.id) ?? 0);
      });
    }
    onFill(next);
  }

  return (
    <div className="grid gap-3 rounded-md border border-dashed bg-muted/30 p-3 sm:grid-cols-2">
      <Field id={id("preset")} label="Size ratio">
        <NativeSelect
          id={id("preset")}
          value={ratio}
          onChange={(e) => setRatio(e.target.value)}
          containerClassName="sm:w-full"
        >
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.entries.map((e) => `${e.sizeName} ${e.ratio}`).join(", ")})
            </option>
          ))}
          <option value={TYPED}>Type a ratio</option>
        </NativeSelect>
      </Field>
      {ratio === TYPED && (
        <Field
          id={id("typed")}
          label="Ratio"
          hint={`One number per size: ${matrix.sizes.map((s) => s.name).join(" : ")}`}
        >
          <Input
            id={id("typed")}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={matrix.sizes
              .map((_, i) => (i === 0 || i === matrix.sizes.length - 1 ? 1 : 2))
              .join(":")}
            autoComplete="off"
          />
        </Field>
      )}
      <Field id={id("pieces")} label="Pieces per colour">
        <Input
          id={id("pieces")}
          inputMode="numeric"
          value={pieces}
          onChange={(e) => setPieces(e.target.value)}
          placeholder="600"
          autoComplete="off"
          className="tabular-nums"
        />
      </Field>
      <Field id={id("colour")} label="Colour">
        <NativeSelect
          id={id("colour")}
          value={colour}
          onChange={(e) => setColour(e.target.value)}
          containerClassName="sm:w-full"
        >
          <option value="ALL">Every colour</option>
          {matrix.rows.map((row) => (
            <option key={row.color.id} value={row.color.id}>
              {row.color.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {problem && (
        <div className="sm:col-span-2">
          <FormAlert>{problem}</FormAlert>
        </div>
      )}
      <Button
        type="button"
        variant="secondary"
        className="sm:col-span-2 sm:justify-self-start"
        onClick={fill}
      >
        Fill the boxes
      </Button>
    </div>
  );
}

/** A style's colours by sizes with a box for the pieces to make of each. */
export function TargetBlockInput({
  block,
  currency,
  onChange,
  onRemove,
  ratioPresets = [],
}: {
  block: TargetBlock;
  currency: string;
  onChange: (quantities: Record<string, string>) => void;
  onRemove: () => void;
  /** Saved size ratios for "Fill by size ratio". */
  ratioPresets?: readonly RatioPreset[];
}) {
  const m = block.matrix;
  const title = m ? `${m.style.code} · ${m.style.name}` : "Loading the style";
  const [ratioOpen, setRatioOpen] = useState(false);

  return (
    <li className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">{title}</p>
          {m && (
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {formatCount(sumOf(block.quantities), currency)} pcs
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {m && m.rows.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={ratioOpen}
              onClick={() => setRatioOpen((open) => !open)}
            >
              <SlidersHorizontalIcon aria-hidden />
              Fill by size ratio
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${m ? m.style.code : "this style"}`}
          >
            <Trash2Icon aria-hidden />
            Remove
          </Button>
        </div>
      </div>
      {m && ratioOpen && m.rows.length > 0 && (
        <RatioFill block={block} matrix={m} presets={ratioPresets} onFill={onChange} />
      )}
      {block.loadError ? (
        <FormAlert>{block.loadError}</FormAlert>
      ) : !m ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          Loading colours and sizes
        </p>
      ) : m.rows.length === 0 ? (
        <FormAlert tone="note">
          This style has no SKUs yet. Add its colours and sizes in Products first.
        </FormAlert>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {m.rows.map((row) => (
            <fieldset key={row.color.id} className="grid min-w-0 gap-2">
              <legend className="mb-1 text-sm font-medium">
                <ColorName name={row.color.name} hexCode={row.color.hexCode} />
              </legend>
              <div className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 sm:grid-cols-6">
                {row.cells.map((cell, index) => {
                  if (!cell) return null;
                  const size = m.sizes[index]!;
                  const inputId = `${block.key}-${cell.variantId}`;
                  const value = block.quantities[cell.variantId] ?? "";
                  return (
                    <div key={cell.variantId} className="grid min-w-0 gap-1">
                      <label htmlFor={inputId} className="text-[0.8125rem] font-medium">
                        {size.name}
                      </label>
                      <Input
                        id={inputId}
                        inputMode="numeric"
                        value={value}
                        onChange={(e) =>
                          onChange({ ...block.quantities, [cell.variantId]: e.target.value })
                        }
                        disabled={!cell.isActive && !value}
                        placeholder="0"
                        aria-label={`${row.color.name} ${size.name}, pieces to make`}
                        aria-invalid={Number.isNaN(piecesIn(value))}
                        className="text-right tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </li>
  );
}
