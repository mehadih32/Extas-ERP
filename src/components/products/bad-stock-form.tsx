"use client";

import type { StockGrade } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { VariantDetails } from "@/modules/inventory/screens.service";
import { moveToBadStockAction } from "@/server/actions/inventory.actions";

import { readPieces } from "./count-sheet";
import { BAD_STOCK_SOURCE_CHOICES, money, pieces } from "./labels";
import { GradeToggle, onShelf, shelfKey, WarehousePicker } from "./stock-pickers";

export type MovedToBadStock = { sku: string; quantity: number; lossValue: string | null };

type Source = (typeof BAD_STOCK_SOURCE_CHOICES)[number]["value"];

/** The warehouse to start from: the one the screen shows, else the first with pieces. */
function startingShelf(details: VariantDetails, warehouseId: string | null | undefined) {
  const shelves = details.warehouses;
  return (
    shelves.find((s) => warehouseId && s.id === warehouseId) ??
    shelves.find((s) => s.aGrade > 0 || s.bGrade > 0) ??
    shelves[0]!
  );
}

/**
 * Moves pieces of one SKU to bad stock: they leave the sellable stock and what
 * they cost is booked as a loss (inventory.manage, like moveToBadStockAction).
 * The loss in money shows only to people who see the financials.
 */
export function BadStockForm({
  details,
  warehouseId,
  currency,
  onDone,
  onCancel,
}: {
  details: VariantDetails;
  /** The warehouse the screen was showing, if any. */
  warehouseId?: string | null;
  currency: string;
  onDone: (moved: MovedToBadStock) => void;
  onCancel: () => void;
}) {
  const start = startingShelf(details, warehouseId);
  const [shelfId, setShelfId] = useState(shelfKey(start));
  const [grade, setGrade] = useState<StockGrade>(
    start.aGrade === 0 && start.bGrade > 0 ? "B_GRADE" : "A_GRADE",
  );
  const [quantity, setQuantity] = useState("");
  const [source, setSource] = useState<Source>("WAREHOUSE_DAMAGE");
  const [problem, setProblem] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  const shelf = details.warehouses.find((s) => shelfKey(s) === shelfId) ?? start;
  const there = onShelf(shelf, grade);
  const typed = readPieces(quantity);
  const cost = grade === "A_GRADE" ? details.averageCost.aGrade : details.averageCost.bGrade;
  const loss =
    cost !== null && typed.kind === "pieces" && typed.value > 0
      ? (Number(cost) * typed.value).toFixed(2)
      : null;
  const intoReserved =
    grade === "A_GRADE" &&
    shelf.reserved > 0 &&
    typed.kind === "pieces" &&
    typed.value > shelf.aGrade - shelf.reserved;
  const fieldError = problem ?? error?.fieldErrors?.quantity?.[0];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (typed.kind !== "pieces" || typed.value < 1) {
      setProblem("Enter how many pieces, 1 or more.");
      return;
    }
    if (typed.value > there) {
      setProblem(`There ${there === 1 ? "is" : "are"} only ${pieces(there, currency)} here.`);
      return;
    }
    setProblem(undefined);
    startTransition(async () => {
      const result = await moveToBadStockAction({
        variantId: details.id,
        warehouseId: shelf.id ?? undefined,
        grade,
        quantity: typed.value,
        source,
        reason: reason || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone({ sku: details.sku, quantity: typed.value, lossValue: result.data.lossValue });
    });
  }

  if (details.stock.aGrade + details.stock.bGrade <= 0) {
    return (
      <div className="grid gap-5">
        <FormAlert tone="note">
          {details.sku} has nothing on the shelf, so there is nothing to move to bad stock.
        </FormAlert>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="bad-warehouse" id="bad-warehouse-label">
          From
        </Label>
        <WarehousePicker
          id="bad-warehouse"
          shelves={details.warehouses}
          value={shelfId}
          onChange={setShelfId}
        />
      </div>
      <div className="grid gap-2">
        <span id="bad-grade-label" className="text-sm leading-none font-medium">
          Grade
        </span>
        <GradeToggle
          shelf={shelf}
          value={grade}
          onChange={setGrade}
          currency={currency}
          labelledBy="bad-grade-label"
        />
      </div>
      <Field
        id="bad-quantity"
        label="Pieces"
        hint={`${pieces(there, currency)} on the shelf${
          grade === "A_GRADE" && shelf.reserved > 0
            ? `, ${formatCount(shelf.reserved, currency)} of them set aside for orders`
            : ""
        }.`}
        error={fieldError}
      >
        <Input
          id="bad-quantity"
          inputMode="numeric"
          autoComplete="off"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? "bad-quantity-error" : "bad-quantity-hint"}
          className="sm:max-w-40"
          autoFocus
        />
      </Field>
      <Field id="bad-source" label="Why">
        <NativeSelect
          id="bad-source"
          value={source}
          onChange={(e) => setSource(e.target.value as Source)}
          containerClassName="sm:w-full"
          className="md:h-10"
        >
          {BAD_STOCK_SOURCE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id="bad-reason"
        label="What happened (optional)"
        error={error?.fieldErrors?.reason?.[0]}
      >
        <Textarea
          id="bad-reason"
          name="reason"
          rows={2}
          maxLength={500}
          placeholder="Like: stained in the wash"
          className="min-h-16"
        />
      </Field>

      {intoReserved && (
        <FormAlert tone="note">
          This takes pieces that are set aside for orders, so those orders will be short.
        </FormAlert>
      )}
      <p className="text-sm text-muted-foreground">
        The pieces leave the sellable stock and what they cost is booked as a loss
        {loss ? `: ${money(loss, currency)}.` : "."}
      </p>
      {error && error.code !== "INTERNAL" && !error.fieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Moving" : "Move to bad stock"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not move the pieces to bad stock"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
