"use client";

import { LoaderCircleIcon, Trash2Icon } from "lucide-react";

import { FormAlert } from "@/components/forms/field";
import { ColorName } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/display";
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

/** A style's colours by sizes with a box for the pieces to make of each. */
export function TargetBlockInput({
  block,
  currency,
  onChange,
  onRemove,
}: {
  block: TargetBlock;
  currency: string;
  onChange: (quantities: Record<string, string>) => void;
  onRemove: () => void;
}) {
  const m = block.matrix;
  const title = m ? `${m.style.code} · ${m.style.name}` : "Loading the style";

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
