"use client";

import { LoaderCircleIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

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
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { SkuHold } from "@/modules/inventory/matrix.service";
import type { StyleScreen } from "@/modules/inventory/screens.service";
import { setMatrixAction } from "@/server/actions/inventory.actions";

import { Swatch } from "./bits";
import { matrixChange } from "./catalog-helpers";

/** Why a colour or size cannot be unticked, short ("12 pcs", "On order") and in full. */
function lockNote(hold: SkuHold, currency: string) {
  return hold.pieces > 0
    ? {
        short: `${formatCount(hold.pieces, currency)} pcs`,
        full: `${formatCount(hold.pieces, currency)} pieces in stock`,
      }
    : { short: "On order", full: "On an open order or delivery" };
}

function Choice({
  checked,
  hold,
  currency,
  onChange,
  children,
}: {
  checked: boolean;
  /** Set when the box is ticked and holds stock: it cannot be unticked. */
  hold?: SkuHold;
  currency: string;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  const locked = Boolean(hold);
  return (
    <label
      title={hold ? `${lockNote(hold, currency).full}: it cannot be removed` : undefined}
      className={cn(
        "flex min-h-11 min-w-0 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm leading-snug transition-colors md:min-h-9 md:py-2",
        checked ? "border-primary/40 bg-secondary" : "hover:bg-muted",
        locked && "cursor-default",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-px size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-default"
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-start gap-2">{children}</span>
        {hold && (
          <span className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
            <LockIcon aria-hidden className="size-3 shrink-0" />
            <span className="sr-only">Locked: </span>
            {lockNote(hold, currency).short}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * A style's colours and sizes: each colour ticked is made in each size ticked.
 * Unticking one takes its SKUs off the matrix, but a colour or size with stock
 * in any warehouse (or on an open order or delivery) is locked ticked.
 */
export function ColorsSizesDialog({
  screen,
  currency,
  onClose,
  onSaved,
}: {
  screen: StyleScreen;
  currency: string;
  onClose: () => void;
  onSaved: (change: { created: number; restored: number; removed: number }) => void;
}) {
  const { matrix, locks } = screen;
  const cells = matrix.rows.flatMap((r) =>
    r.cells.flatMap((c) => (c ? [{ colorId: r.color.id, sizeId: c.sizeId }] : [])),
  );
  const [colors, setColors] = useState(() => new Set(matrix.rows.map((r) => r.color.id)));
  const [sizes, setSizes] = useState(() => new Set(matrix.sizes.map((s) => s.id)));
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const { adding, removing } = matrixChange(cells, colors, sizes);
  const allSizes = sizes.size === screen.sizes.length;
  const empty = colors.size === 0 || sizes.size === 0;

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  function save() {
    startTransition(async () => {
      const result = await setMatrixAction(screen.style.id, {
        colorIds: [...colors],
        sizeIds: [...sizes],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data);
    });
  }

  const missing = screen.colors.length === 0 || screen.sizes.length === 0;
  const skus = (n: number) => `${n} ${n === 1 ? "SKU" : "SKUs"}`;
  const summary = empty
    ? "Tick at least one colour and one size."
    : adding === 0 && removing === 0
      ? "No changes yet."
      : [
          adding > 0 && `This adds ${skus(adding)}`,
          removing > 0 && `${adding > 0 ? "and removes" : "This removes"} ${skus(removing)}`,
        ]
          .filter(Boolean)
          .join(" ") + ".";

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Colours and sizes</DialogTitle>
          <DialogDescription>
            Each colour ticked is made in each size ticked, as a SKU of {screen.style.code}. Untick
            one to take it off.
          </DialogDescription>
        </DialogHeader>
        {missing ? (
          <FormAlert tone="note">
            Colours and sizes are set up on the{" "}
            <Link href="/products/setup" className="font-medium underline underline-offset-4">
              Setup tab
            </Link>
            . Add them there first.
          </FormAlert>
        ) : (
          <div className="-mx-2 grid min-h-0 content-start gap-6 overflow-y-auto overscroll-contain px-2 py-1">
            {(Object.keys(locks.colors).length > 0 || Object.keys(locks.sizes).length > 0) && (
              <p className="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
                <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Colours and sizes with stock stay ticked. Sell, count or move their pieces out
                first.
              </p>
            )}
            <fieldset className="grid gap-3">
              <legend className="eyebrow mb-3">Colours</legend>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                {screen.colors.map((c) => (
                  <Choice
                    key={c.id}
                    checked={colors.has(c.id)}
                    hold={colors.has(c.id) ? locks.colors[c.id] : undefined}
                    currency={currency}
                    onChange={(on) => setColors((set) => toggle(set, c.id, on))}
                  >
                    <Swatch hex={c.hexCode} className="mt-0.5" />
                    <span className="min-w-0 break-words">{c.name}</span>
                  </Choice>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="mb-3 flex w-full items-center justify-between gap-3">
                <span className="eyebrow">Sizes</span>
                {!allSizes && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setSizes(new Set(screen.sizes.map((s) => s.id)))}
                  >
                    Tick all sizes
                  </Button>
                )}
              </legend>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
                {screen.sizes.map((s) => (
                  <Choice
                    key={s.id}
                    checked={sizes.has(s.id)}
                    hold={sizes.has(s.id) ? locks.sizes[s.id] : undefined}
                    currency={currency}
                    onChange={(on) => setSizes((set) => toggle(set, s.id, on))}
                  >
                    <span className="min-w-0 break-words">{s.name}</span>
                  </Choice>
                ))}
              </div>
            </fieldset>
          </div>
        )}
        <div className="grid gap-4 border-t pt-4">
          {!missing && (
            <p className="text-sm" role="status">
              {summary}
            </p>
          )}
          {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            {!missing && (
              <Button
                type="button"
                onClick={save}
                disabled={pending || empty || (adding === 0 && removing === 0)}
              >
                {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
                {pending ? "Saving" : "Save"}
              </Button>
            )}
          </DialogFooter>
        </div>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not change the colours and sizes"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
