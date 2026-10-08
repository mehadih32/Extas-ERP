"use client";

import type { StockGrade } from "@prisma/client";
import { ClipboardCheckIcon, LoaderCircleIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { VariantDetails } from "@/modules/inventory/screens.service";
import {
  getVariantDetailsAction,
  recordStockCountAction,
  updateVariantAction,
} from "@/server/actions/inventory.actions";

import { BadStockForm } from "./bad-stock-form";
import { Swatch } from "./bits";
import { readPieces } from "./count-sheet";
import { AMOUNT_HINT, readAmount } from "./form-values";
import { GRADE_LABELS, money, pieces, signed } from "./labels";
import { GradeToggle, onShelf, shelfKey, WarehousePicker } from "./stock-pickers";

type View = "details" | "edit" | "correct" | "bad";

const TITLES: Record<Exclude<View, "details">, string> = {
  edit: "Edit the SKU",
  correct: "Correct the stock",
  bad: "Move to bad stock",
};

function Prices({ details, currency }: { details: VariantDetails; currency: string }) {
  const rows: Array<[string, string, string | null]> = [
    ["Wholesale", details.wholesalePrice, details.ownWholesalePrice],
    ["Retail", details.retailPrice, details.ownRetailPrice],
  ];
  return (
    <dl className="grid grid-cols-2 gap-4">
      {rows.map(([label, price, own]) => (
        <div key={label}>
          <dt className="eyebrow">{label}</dt>
          <dd className="mt-1 font-serif text-lg lining-nums tabular-nums">
            {money(price, currency)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            {own === null ? "The style's price" : "This SKU's own price"}
          </dd>
        </div>
      ))}
      {details.showsCosts && details.averageCost.aGrade !== null && (
        <div className="col-span-2">
          <dt className="eyebrow">Average cost per piece</dt>
          <dd className="mt-1 text-sm tabular-nums">
            A-grade {money(details.averageCost.aGrade, currency)} · B-grade{" "}
            {money(details.averageCost.bGrade ?? "0.00", currency)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Each warehouse's stock of the SKU; on phones, set aside and B-grade go under the name. */
function StockTable({ details, currency }: { details: VariantDetails; currency: string }) {
  const count = (n: number) => formatCount(n, currency);
  const rows = [
    ...details.warehouses.map((w) => ({ ...w, key: shelfKey(w), total: false })),
    ...(details.warehouses.length > 1
      ? [{ key: "all", name: "All warehouses", total: true, ...details.stock }]
      : []),
  ];
  const wide = "hidden text-right sm:table-cell";
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Warehouse</TableHead>
          <TableHead className="text-right">Available</TableHead>
          <TableHead className={wide}>Set aside</TableHead>
          <TableHead className={wide}>B-grade</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key} className={cn(row.total && "hover:bg-transparent")}>
            <TableCell
              className={cn("max-w-[12rem] whitespace-normal", row.total && "font-medium")}
            >
              <span className="block truncate">{row.name}</span>
              <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                {count(row.reserved)} set aside · {count(row.bGrade)} B-grade
              </span>
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-medium",
                !row.total && row.available <= 0 && "text-destructive",
              )}
            >
              {count(row.available)}
            </TableCell>
            <TableCell className={cn(wide, row.total && "font-medium")}>
              {count(row.reserved)}
            </TableCell>
            <TableCell className={cn(wide, row.total && "font-medium")}>
              {count(row.bGrade)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The SKU's barcode, its own prices and whether it is offered for sale. */
function EditSkuForm({
  details,
  currency,
  onDone,
  onCancel,
}: {
  details: VariantDetails;
  currency: string;
  onDone: (notice: string) => void;
  onCancel: () => void;
}) {
  const [isActive, setIsActive] = useState(details.isActive);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) =>
    problems[name] ??
    error?.fieldErrors?.[name]?.[0] ??
    // A barcode another SKU already uses comes back as a conflict.
    (name === "barcode" && error?.code === "CONFLICT" ? error.message : undefined);
  const hasFieldErrors = ["barcode", "wholesalePrice", "retailPrice"].some((f) => fieldError(f));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const wholesale = readAmount(text("wholesalePrice"));
    const retail = readAmount(text("retailPrice"));
    const found: Record<string, string> = {};
    if (wholesale === "invalid") found.wholesalePrice = AMOUNT_HINT;
    if (retail === "invalid") found.retailPrice = AMOUNT_HINT;
    setProblems(found);
    if (wholesale === "invalid" || retail === "invalid") return;
    startTransition(async () => {
      const result = await updateVariantAction(details.id, {
        barcode: text("barcode") || null,
        wholesalePrice: wholesale,
        retailPrice: retail,
        isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone(`${details.sku} was saved.`);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <Field
        id="sku-barcode"
        label="Barcode"
        hint="Scan or type it. Leave it empty for none."
        error={fieldError("barcode")}
      >
        <Input
          id="sku-barcode"
          name="barcode"
          defaultValue={details.barcode ?? ""}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(fieldError("barcode"))}
          aria-describedby={fieldError("barcode") ? "sku-barcode-error" : "sku-barcode-hint"}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="sku-wholesale"
          label={`Own wholesale price (${currency})`}
          hint={`Empty: the style's ${money(details.style.wholesalePrice, currency)}.`}
          error={fieldError("wholesalePrice")}
        >
          <Input
            id="sku-wholesale"
            name="wholesalePrice"
            inputMode="decimal"
            defaultValue={details.ownWholesalePrice ?? ""}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("wholesalePrice"))}
            aria-describedby={
              fieldError("wholesalePrice") ? "sku-wholesale-error" : "sku-wholesale-hint"
            }
          />
        </Field>
        <Field
          id="sku-retail"
          label={`Own retail price (${currency})`}
          hint={`Empty: the style's ${money(details.style.retailPrice, currency)}.`}
          error={fieldError("retailPrice")}
        >
          <Input
            id="sku-retail"
            name="retailPrice"
            inputMode="decimal"
            defaultValue={details.ownRetailPrice ?? ""}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("retailPrice"))}
            aria-describedby={fieldError("retailPrice") ? "sku-retail-error" : "sku-retail-hint"}
          />
        </Field>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="mt-0.5 size-4 cursor-pointer accent-primary"
        />
        <span>
          <span className="font-medium">Offered for sale</span>
          <span className="block text-muted-foreground">
            Untick to stop selling this colour and size. Its stock and history stay.
          </span>
        </span>
      </label>
      {error && error.code !== "INTERNAL" && !hasFieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Saving" : "Save"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the SKU"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}

/**
 * Corrects one SKU's stock to what was counted on the shelf, through the same
 * stock count the Stock count tab saves (with the shelf figure shown here as
 * what was expected, so a sale in between is caught rather than undone).
 */
function CorrectStockForm({
  details,
  warehouseId,
  currency,
  onDone,
  onStale,
  onCancel,
}: {
  details: VariantDetails;
  warehouseId?: string | null;
  currency: string;
  onDone: (notice: string) => void;
  /** The shelf changed meanwhile: load the SKU again. */
  onStale: () => void;
  onCancel: () => void;
}) {
  const start = details.warehouses.find((w) => warehouseId && w.id === warehouseId);
  const [shelfId, setShelfId] = useState(shelfKey(start ?? details.warehouses[0]!));
  const [grade, setGrade] = useState<StockGrade>("A_GRADE");
  const [counted, setCounted] = useState("");
  const [problem, setProblem] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  const shelf = details.warehouses.find((w) => shelfKey(w) === shelfId) ?? details.warehouses[0]!;
  const there = onShelf(shelf, grade);
  const typed = readPieces(counted);
  const difference = typed.kind === "pieces" ? typed.value - there : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    if (typed.kind !== "pieces") {
      setProblem("Enter the pieces counted, 0 or more.");
      return;
    }
    setProblem(undefined);
    startTransition(async () => {
      const result = await recordStockCountAction({
        mode: "COUNT",
        warehouseId: shelf.id ?? undefined,
        grade,
        note: note || undefined,
        lines: [{ variantId: details.id, counted: typed.value, expected: there }],
      });
      if (!result.ok) {
        setError(result.error);
        if (result.error.code === "CONFLICT") onStale();
        return;
      }
      onDone(
        `${details.sku} now has ${pieces(typed.value, currency)} ${GRADE_LABELS[grade]} at ${shelf.name} (${signed(typed.value - there, currency)}).`,
      );
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="correct-warehouse">Warehouse</Label>
        <WarehousePicker
          id="correct-warehouse"
          shelves={details.warehouses}
          value={shelfId}
          onChange={setShelfId}
        />
      </div>
      <div className="grid gap-2">
        <span id="correct-grade-label" className="text-sm leading-none font-medium">
          Grade
        </span>
        <GradeToggle
          shelf={shelf}
          value={grade}
          onChange={setGrade}
          currency={currency}
          labelledBy="correct-grade-label"
        />
      </div>
      <Field
        id="correct-counted"
        label="Pieces counted on the shelf"
        hint={`The stock says ${pieces(there, currency)}.`}
        error={problem}
      >
        <Input
          id="correct-counted"
          inputMode="numeric"
          autoComplete="off"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          aria-invalid={Boolean(problem)}
          aria-describedby={problem ? "correct-counted-error" : "correct-counted-hint"}
          className="sm:max-w-40"
          autoFocus
        />
      </Field>
      <Field id="correct-note" label="Note (optional)">
        <Input id="correct-note" name="note" maxLength={500} placeholder="Like: October count" />
      </Field>
      {difference !== null && (
        <p className="text-sm" role="status">
          {difference === 0
            ? "That matches the stock: nothing to change."
            : difference > 0
              ? `${pieces(difference, currency)} more than the stock: they are added.`
              : `${pieces(-difference, currency)} missing: they leave the stock and are booked as a loss.`}
        </p>
      )}
      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || difference === 0}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Saving" : "Save the count"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the count"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}

/**
 * One SKU (a matrix cell): its prices, barcode and stock in each warehouse. For
 * people with inventory.manage (the permission each change checks) it also edits
 * the SKU, corrects its stock and moves pieces to bad stock.
 */
export function SkuDialog({
  variantId,
  warehouseId,
  currency,
  onClose,
}: {
  variantId: string;
  /** The warehouse the matrix shows, if one is chosen. */
  warehouseId?: string | null;
  currency: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<VariantDetails>();
  const [loadError, setLoadError] = useState<ActionError>();
  const [view, setView] = useState<View>("details");
  const [notice, setNotice] = useState<string>();
  const [loading, startLoading] = useTransition();

  const load = useCallback(() => {
    startLoading(async () => {
      const result = await getVariantDetailsAction(variantId);
      if (result.ok) {
        setDetails(result.data);
        setLoadError(undefined);
      } else {
        setLoadError(result.error);
      }
    });
  }, [variantId]);

  useEffect(load, [load]);

  const done = (message: string) => {
    setNotice(message);
    setView("details");
    load();
  };
  const back = () => setView("details");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {!details ? (
          loadError ? (
            <DialogHeader>
              <DialogTitle>This SKU could not load</DialogTitle>
              <DialogDescription>{loadError.message}</DialogDescription>
            </DialogHeader>
          ) : (
            <div className="grid gap-4" aria-busy>
              <DialogHeader>
                <DialogTitle className="sr-only">Loading the SKU</DialogTitle>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-48" />
              </DialogHeader>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          )
        ) : (
          <>
            <DialogHeader>
              <p className="eyebrow flex flex-wrap items-center gap-2">
                <span>{details.sku}</span>
                {!details.isActive && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Not offered
                  </Badge>
                )}
              </p>
              <DialogTitle className="flex items-center gap-2">
                <Swatch hex={details.color.hexCode} className="size-4" />
                {view === "details" ? `${details.color.name} / ${details.size.name}` : TITLES[view]}
              </DialogTitle>
              <DialogDescription>
                {view === "details"
                  ? `${details.style.name} · ${details.barcode ? `Barcode ${details.barcode}` : "No barcode"}`
                  : `${details.style.name}, ${details.color.name} / ${details.size.name}`}
              </DialogDescription>
            </DialogHeader>

            {view === "details" && (
              <div
                className={cn("grid gap-6 transition-opacity", loading && "opacity-60")}
                aria-busy={loading}
              >
                {notice && <FormAlert tone="success">{notice}</FormAlert>}
                <Prices details={details} currency={currency} />
                <StockTable details={details} currency={currency} />
                {details.canManage && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button type="button" variant="outline" onClick={() => setView("edit")}>
                      <PencilIcon aria-hidden />
                      Edit SKU
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setView("correct")}>
                      <ClipboardCheckIcon aria-hidden />
                      Correct stock
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setView("bad")}>
                      <Trash2Icon aria-hidden />
                      Bad stock
                    </Button>
                  </div>
                )}
              </div>
            )}
            {view === "edit" && (
              <EditSkuForm details={details} currency={currency} onDone={done} onCancel={back} />
            )}
            {view === "correct" && (
              <CorrectStockForm
                details={details}
                warehouseId={warehouseId}
                currency={currency}
                onDone={done}
                onStale={load}
                onCancel={back}
              />
            )}
            {view === "bad" && (
              <BadStockForm
                details={details}
                warehouseId={warehouseId}
                currency={currency}
                onCancel={back}
                onDone={(moved) =>
                  done(
                    `${pieces(moved.quantity, currency)} of ${moved.sku} moved to bad stock${
                      moved.lossValue ? `, a loss of ${money(moved.lossValue, currency)}` : ""
                    }.`,
                  )
                }
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
