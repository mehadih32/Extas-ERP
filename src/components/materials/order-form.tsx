"use client";

import type { MeasurementUnit } from "@prisma/client";
import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OrderForm as OrderFormData } from "@/modules/materials/screens.service";
import {
  createPurchaseOrderAction,
  updatePurchaseOrderAction,
} from "@/server/actions/materials.actions";

import { materialsHref, readPrice, readQuantity, UNIT_LABELS, UNIT_ONE } from "./labels";
import { MaterialPicker, MaterialsProjectPicker, SupplierPicker } from "./pickers";
import { useMaterialsForm } from "./use-form";

type Party = { id: string; code: string; name: string };
type Line = {
  key: string;
  material: { id: string; code: string; name: string; unit: MeasurementUnit };
  quantity: string;
  unitPrice: string;
  description: string;
};

// Lines added in the browser get keys from this counter; the first ones are
// keyed by position, so the server and the browser agree.
let nextKey = 0;
const newKey = () => `line-${++nextKey}`;

/** "1250.5 × 45.375" to two decimals, or 0 while either is unreadable. */
function lineAmount(line: Line): number {
  const q = readQuantity(line.quantity, line.material.unit);
  const p = readPrice(line.unitPrice);
  return typeof q === "number" && typeof p === "number" ? Math.round(q * p * 100) / 100 : 0;
}

/**
 * A purchase order (buyers): the supplier, the project it is for when there is
 * one, when the goods should be in, and the materials with quantities and
 * prices. Its lines change only while nothing has arrived on it.
 */
export function OrderForm({ form: data, currency }: { form: OrderFormData; currency: string }) {
  const router = useRouter();
  const form = useMaterialsForm();
  const { fieldError } = form;
  const order = data.order;
  const [supplier, setSupplier] = useState<Party | null>(data.supplier);
  const [project, setProject] = useState<Party | null>(data.project);
  const [lines, setLines] = useState<Line[]>(
    data.lines.map((l, i) => ({ key: `line-start-${i}`, ...l })),
  );
  const locked = Boolean(data.linesLocked);
  const total = lines.reduce((t, l) => t + lineAmount(l), 0);

  function change(key: string, next: Partial<Line>) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    if (!supplier) found.supplierId = "Choose the supplier.";
    if (!locked && lines.length === 0) found.lines = "Add at least one material.";
    const parsed = lines.map((l, i) => {
      const q = readQuantity(l.quantity, l.material.unit);
      const p = readPrice(l.unitPrice);
      if (typeof q === "string") found[`lines.${i}.quantity`] = q;
      if (typeof p === "string") found[`lines.${i}.unitPrice`] = p;
      return {
        materialId: l.material.id,
        quantity: typeof q === "number" ? q : 0,
        unitPrice: typeof p === "number" ? p : 0,
        description: l.description.trim() || undefined,
      };
    });
    const orderDate = textOf(values, "orderDate");
    const expected = textOf(values, "expectedDate");
    if (expected && orderDate && expected < orderDate) {
      found.expectedDate = "Choose a day on or after the order date.";
    }
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    form.startTransition(async () => {
      const result = order
        ? await updatePurchaseOrderAction(order.id, {
            projectId: project?.id ?? null,
            expectedDate: expected || null,
            supplierRef: textOf(values, "supplierRef") || null,
            notes: textOf(values, "notes") || null,
            lines: locked ? undefined : parsed,
          })
        : await createPurchaseOrderAction({
            supplierId: supplier!.id,
            projectId: project?.id ?? null,
            orderDate: orderDate && orderDate !== data.today ? orderDate : undefined,
            expectedDate: expected || null,
            supplierRef: textOf(values, "supplierRef") || null,
            notes: textOf(values, "notes") || null,
            lines: parsed,
          });
      if (!result.ok) return form.setError(result.error);
      router.push(`${materialsHref.order(result.data.id)}?${order ? "saved" : "created"}=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <Field id="supplierId" label="Supplier" error={fieldError("supplierId")}>
        <SupplierPicker
          id="supplierId"
          value={supplier}
          onChange={setSupplier}
          locked={Boolean(order)}
          invalid={Boolean(fieldError("supplierId"))}
          describedBy={fieldError("supplierId") ? "supplierId-error" : undefined}
          autoFocus={!supplier}
        />
      </Field>
      <Field
        id="projectId"
        label="For the project (optional)"
        hint="The materials are bought for this production project."
        error={fieldError("projectId")}
      >
        <MaterialsProjectPicker
          id="projectId"
          value={project}
          onChange={setProject}
          invalid={Boolean(fieldError("projectId"))}
          describedBy={fieldError("projectId") ? "projectId-error" : "projectId-hint"}
        />
      </Field>
      <div className="grid items-start gap-5 sm:grid-cols-3">
        <Field id="orderDate" label="Order date" error={fieldError("orderDate")}>
          <Input
            id="orderDate"
            name="orderDate"
            type="date"
            defaultValue={order?.orderedOn ?? data.today}
            max={data.today}
            disabled={Boolean(order)}
          />
        </Field>
        <Field id="expectedDate" label="Expected by (optional)" error={fieldError("expectedDate")}>
          <Input
            id="expectedDate"
            name="expectedDate"
            type="date"
            defaultValue={order?.expectedOn}
            aria-invalid={Boolean(fieldError("expectedDate"))}
            aria-describedby={fieldError("expectedDate") ? "expectedDate-error" : undefined}
          />
        </Field>
        <Field
          id="supplierRef"
          label="Their reference (optional)"
          hint="Their PI or booking number."
          error={fieldError("supplierRef")}
        >
          <Input
            id="supplierRef"
            name="supplierRef"
            defaultValue={order?.supplierRef}
            maxLength={60}
            autoComplete="off"
            aria-describedby="supplierRef-hint"
          />
        </Field>
      </div>

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 font-serif text-lg text-primary">Materials</legend>
        {data.linesLocked && <FormAlert tone="note">{data.linesLocked}</FormAlert>}
        {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
        {lines.length > 0 && (
          <ul className="grid grid-cols-1 gap-4">
            {lines.map((line, index) => {
              const unit = UNIT_LABELS[line.material.unit];
              const err = (name: string) => fieldError(`lines.${index}.${name}`);
              return (
                <li
                  key={line.key}
                  className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">
                        {line.material.code} · {line.material.name}
                      </p>
                      {err("materialId") && (
                        <p className="text-[0.8125rem] text-destructive">{err("materialId")}</p>
                      )}
                    </div>
                    {!locked && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                        aria-label={`Remove ${line.material.code}`}
                      >
                        <Trash2Icon aria-hidden />
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-3">
                    <Field
                      id={`${line.key}-quantity`}
                      label={`Quantity (${unit})`}
                      error={err("quantity")}
                    >
                      <Input
                        id={`${line.key}-quantity`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => change(line.key, { quantity: e.target.value })}
                        disabled={locked}
                        autoComplete="off"
                        aria-invalid={Boolean(err("quantity"))}
                        aria-describedby={
                          err("quantity") ? `${line.key}-quantity-error` : undefined
                        }
                      />
                    </Field>
                    <Field
                      id={`${line.key}-price`}
                      label={`Price per ${UNIT_ONE[line.material.unit]} (${currency})`}
                      error={err("unitPrice")}
                    >
                      <Input
                        id={`${line.key}-price`}
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(e) => change(line.key, { unitPrice: e.target.value })}
                        disabled={locked}
                        autoComplete="off"
                        aria-invalid={Boolean(err("unitPrice"))}
                        aria-describedby={err("unitPrice") ? `${line.key}-price-error` : undefined}
                      />
                    </Field>
                    <div className="grid gap-2">
                      <span className="text-sm font-medium">Amount</span>
                      <span className="flex h-9 items-center text-sm tabular-nums">
                        {money(lineAmount(line).toFixed(2), currency)}
                      </span>
                    </div>
                  </div>
                  <Field id={`${line.key}-description`} label="Details for the supplier (optional)">
                    <Input
                      id={`${line.key}-description`}
                      value={line.description}
                      onChange={(e) => change(line.key, { description: e.target.value })}
                      disabled={locked}
                      maxLength={500}
                      autoComplete="off"
                      placeholder="Like: dyed navy, 72 inch open width"
                    />
                  </Field>
                </li>
              );
            })}
          </ul>
        )}
        {!locked && (
          <MaterialPicker
            id="add-material"
            label={lines.length === 0 ? "Find a material to order" : "Add another material"}
            currency={currency}
            exclude={lines.map((l) => l.material.id)}
            invalid={Boolean(fieldError("lines"))}
            onPick={(m) =>
              setLines((all) => [
                ...all,
                {
                  key: newKey(),
                  material: { id: m.id, code: m.code, name: m.name, unit: m.unit },
                  quantity: "",
                  unitPrice: m.avgCost ?? "",
                  description: "",
                },
              ])
            }
          />
        )}
        <p className="text-right text-sm tabular-nums">
          <span className="text-muted-foreground">Order total </span>
          <span className="font-serif text-lg">{money(total.toFixed(2), currency)}</span>
        </p>
      </fieldset>

      <Field id="notes" label="Notes (optional)" error={fieldError("notes")}>
        <Textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={order?.notes} />
      </Field>

      <FormFooter
        form={form}
        cancelHref={order ? materialsHref.order(order.id) : materialsHref.orders}
        submitLabel={order ? "Save the changes" : "Raise the order"}
        errorTitle={order ? "We could not save the order" : "We could not raise the order"}
      />
    </form>
  );
}
