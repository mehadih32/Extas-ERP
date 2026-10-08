"use client";

import { LoaderCircleIcon } from "lucide-react";
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
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { StyleScreen } from "@/modules/inventory/screens.service";
import { generateMatrixAction } from "@/server/actions/inventory.actions";

import { Swatch } from "./bits";
import { newSkuCount } from "./catalog-helpers";

function Choice({
  checked,
  locked,
  onChange,
  children,
}: {
  checked: boolean;
  locked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 text-sm transition-colors md:min-h-9",
        checked ? "border-primary/40 bg-secondary" : "hover:bg-muted",
        locked && "cursor-default opacity-70",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 cursor-pointer accent-primary disabled:cursor-default"
      />
      {children}
    </label>
  );
}

/**
 * Adds colours and sizes to a style: each colour chosen is made in each size
 * chosen. The style's own colours and sizes stay ticked (SKUs are never removed
 * here); a size added to the style comes in every colour it has.
 */
export function AddSkusDialog({
  screen,
  onClose,
  onAdded,
}: {
  screen: StyleScreen;
  onClose: () => void;
  onAdded: (created: number) => void;
}) {
  const { matrix } = screen;
  const ownColors = new Set(matrix.rows.map((r) => r.color.id));
  const ownSizes = new Set(matrix.sizes.map((s) => s.id));
  const existing = matrix.rows.reduce((n, r) => n + r.cells.filter(Boolean).length, 0);
  const [colors, setColors] = useState(() => new Set(ownColors));
  const [sizes, setSizes] = useState(() => new Set(ownSizes));
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const adding = newSkuCount(colors.size, sizes.size, existing);

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  function save() {
    startTransition(async () => {
      const result = await generateMatrixAction(screen.style.id, {
        colorIds: [...colors],
        sizeIds: [...sizes],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAdded(result.data.created);
    });
  }

  const missing = screen.colors.length === 0 || screen.sizes.length === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add colours or sizes</DialogTitle>
          <DialogDescription>
            Each colour ticked is made in each size ticked, as a SKU of {screen.style.code}.
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
          <div className="grid gap-6">
            <fieldset className="grid gap-3">
              <legend className="eyebrow mb-3">Colours</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {screen.colors.map((c) => (
                  <Choice
                    key={c.id}
                    checked={colors.has(c.id)}
                    locked={ownColors.has(c.id)}
                    onChange={(on) => setColors((set) => toggle(set, c.id, on))}
                  >
                    <Swatch hex={c.hexCode} />
                    <span className="truncate">{c.name}</span>
                  </Choice>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="eyebrow mb-3">Sizes</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {screen.sizes.map((s) => (
                  <Choice
                    key={s.id}
                    checked={sizes.has(s.id)}
                    locked={ownSizes.has(s.id)}
                    onChange={(on) => setSizes((set) => toggle(set, s.id, on))}
                  >
                    {s.name}
                  </Choice>
                ))}
              </div>
            </fieldset>
            <p className="text-sm" role="status">
              {adding === 0
                ? "Tick a colour and a size to add."
                : `This adds ${adding} ${adding === 1 ? "SKU" : "SKUs"}.`}
            </p>
          </div>
        )}
        {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {!missing && (
            <Button type="button" onClick={save} disabled={pending || adding === 0}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending
                ? "Adding"
                : adding > 0
                  ? `Add ${adding} ${adding === 1 ? "SKU" : "SKUs"}`
                  : "Add"}
            </Button>
          )}
        </DialogFooter>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not add the SKUs"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
