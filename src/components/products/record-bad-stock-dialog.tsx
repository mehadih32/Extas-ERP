"use client";

import { LoaderCircleIcon, ScanBarcodeIcon } from "lucide-react";
import { useState, useTransition } from "react";

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
import type { ActionError } from "@/lib/result";
import type { VariantDetails } from "@/modules/inventory/screens.service";
import { getVariantDetailsAction, lookupVariantAction } from "@/server/actions/inventory.actions";

import { BadStockForm, type MovedToBadStock } from "./bad-stock-form";
import { Swatch } from "./bits";

/**
 * Records bad stock from the Bad stock tab: find the SKU by its code or barcode
 * (a scanner types it in), then say how many pieces, from where and why.
 */
export function RecordBadStockDialog({
  currency,
  onClose,
  onDone,
}: {
  currency: string;
  onClose: () => void;
  onDone: (moved: MovedToBadStock) => void;
}) {
  const [details, setDetails] = useState<VariantDetails>();
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  function find(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    startTransition(async () => {
      const found = await lookupVariantAction(code);
      if (!found.ok) {
        setError(found.error);
        return;
      }
      const loaded = await getVariantDetailsAction(found.data.id);
      if (!loaded.ok) {
        setError(loaded.error);
        return;
      }
      setError(undefined);
      setDetails(loaded.data);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record bad stock</DialogTitle>
          <DialogDescription>
            {details ? (
              <span className="flex items-center gap-2">
                <Swatch hex={details.color.hexCode} />
                {details.sku} · {details.style.name}, {details.color.name} / {details.size.name}
              </span>
            ) : (
              "Find the SKU by its code or barcode. You can also open its style and tap the SKU in the matrix."
            )}
          </DialogDescription>
        </DialogHeader>
        {details ? (
          <BadStockForm
            details={details}
            currency={currency}
            onCancel={() => setDetails(undefined)}
            onDone={onDone}
          />
        ) : (
          <form onSubmit={find} className="grid gap-5" noValidate>
            <Field
              id="bad-code"
              label="SKU or barcode"
              error={error && error.code !== "INTERNAL" ? error.message : undefined}
            >
              <div className="relative">
                <ScanBarcodeIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="bad-code"
                  name="code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="search"
                  placeholder="Like EX-PL-001-NAVY-XL"
                  className="pl-9"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "bad-code-error" : undefined}
                  autoFocus
                  required
                />
              </div>
            </Field>
            {error?.code === "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
                {pending ? "Finding" : "Find the SKU"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
