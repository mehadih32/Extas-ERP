"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import {
  quantity as quantityText,
  readPrice,
  readQuantity,
  UNIT_LABELS,
  UNIT_ONE,
} from "@/components/materials/labels";
import { SupplierPicker } from "@/components/materials/pickers";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { BatchOrdersForm as FormData } from "@/modules/production/material-screens.service";
import { createBatchOrdersAction } from "@/server/actions/production.actions";

import { productionHref } from "./labels";
import { MaterialThumb } from "./material-thumb";

type Party = { id: string; code: string; name: string };
type Material = FormData["groups"][number]["rows"][number];
type Line = { row: Material; include: boolean; quantity: string; price: string };
type Group = {
  key: string;
  supplier: Party | null;
  expectedDate: string;
  supplierRef: string;
  lines: Line[];
};

const isZero = (text: string) => !/[1-9]/.test(text);

/**
 * "Make purchase orders" for a master batch (buyers): the materials its styles
 * need, grouped by their usual supplier, each starting at what is still to
 * order. One order is made per supplier; each line is shared out over the
 * styles, colours and sizes that need it. A price left empty is agreed when the
 * goods arrive.
 */
export function BatchOrdersForm({ form: data, currency }: { form: FormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const [groups, setGroups] = useState<Group[]>(
    data.groups.map((g) => ({
      key: g.key,
      supplier: g.supplier,
      expectedDate: "",
      supplierRef: "",
      lines: g.rows.map((row) => ({
        row,
        include: !isZero(row.toOrder),
        quantity: isZero(row.toOrder) ? "" : row.toOrder,
        price: "",
      })),
    })),
  );

  function changeGroup(key: string, next: Partial<Group>) {
    setGroups((all) => all.map((g) => (g.key === key ? { ...g, ...next } : g)));
  }
  function changeLine(key: string, materialId: string, next: Partial<Line>) {
    setGroups((all) =>
      all.map((g) =>
        g.key === key
          ? {
              ...g,
              lines: g.lines.map((l) => (l.row.material.id === materialId ? { ...l, ...next } : l)),
            }
          : g,
      ),
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    // One order per supplier: groups given the same supplier are put together.
    const bySupplier = new Map<
      string,
      {
        supplierId: string;
        expectedDate: string | null;
        supplierRef: string | null;
        lines: Array<{ materialId: string; quantity: number; unitPrice: number | null }>;
      }
    >();
    for (const g of groups) {
      const chosen = g.lines.filter((l) => l.include);
      if (chosen.length === 0) continue;
      if (!g.supplier) {
        found[`${g.key}.supplier`] = "Choose who to order these from.";
        continue;
      }
      if (g.expectedDate && g.expectedDate < data.today) {
        found[`${g.key}.expectedDate`] = "Choose today or a later day.";
      }
      const order = bySupplier.get(g.supplier.id) ?? {
        supplierId: g.supplier.id,
        expectedDate: g.expectedDate || null,
        supplierRef: g.supplierRef.trim() || null,
        lines: [],
      };
      // A group put together with an earlier one fills in what that one left empty.
      order.expectedDate ||= g.expectedDate || null;
      order.supplierRef ||= g.supplierRef.trim() || null;
      for (const l of chosen) {
        const id = l.row.material.id;
        const q = readQuantity(l.quantity, l.row.material.unit);
        const p = l.price.trim() ? readPrice(l.price) : null;
        if (typeof q === "string") found[`${g.key}.${id}.quantity`] = q;
        if (typeof p === "string") found[`${g.key}.${id}.price`] = p;
        order.lines.push({
          materialId: id,
          quantity: typeof q === "number" ? q : 0,
          unitPrice: typeof p === "number" ? p : null,
        });
      }
      bySupplier.set(g.supplier.id, order);
    }
    if (bySupplier.size === 0 && Object.keys(found).length === 0) {
      found.orders = "Tick at least one material to order.";
    }
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      const result = await createBatchOrdersAction(data.batch.id, {
        orders: [...bySupplier.values()],
      });
      if (!result.ok) return form.setError(result.error);
      const numbers = result.data.orders.map((o) => o.number).join(", ");
      router.push(`${productionHref.batch(data.batch.id)}?ordered=${encodeURIComponent(numbers)}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <p className="text-sm leading-relaxed text-muted-foreground">
        For {data.styles.map((s) => s.code).join(", ")}. Each quantity starts at what is still to
        order. Leave a price empty to agree it when the goods arrive; it is entered on receive.
      </p>
      {fieldError("orders") && <FormAlert>{fieldError("orders")}</FormAlert>}
      {groups.map((g) => {
        const err = (name: string) => fieldError(`${g.key}.${name}`);
        const ticked = g.lines.filter((l) => l.include).length;
        return (
          <fieldset
            key={g.key}
            className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5"
            aria-label={g.supplier ? `Order to ${g.supplier.name}` : "Materials without a supplier"}
          >
            <legend className="sr-only">
              {g.supplier ? `Order to ${g.supplier.name}` : "Materials without a supplier"}
            </legend>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-serif text-lg text-primary">
                {g.supplier ? g.supplier.name : "No usual supplier"}
              </h3>
              <span className="text-[0.8125rem] text-muted-foreground">
                {ticked === 0 ? "Nothing ticked" : `${ticked} to order`}
              </span>
            </div>
            <Field
              id={`${g.key}-supplier`}
              label="Supplier"
              error={err("supplier")}
              hint={g.supplier ? undefined : "These materials have no usual supplier yet."}
            >
              <SupplierPicker
                id={`${g.key}-supplier`}
                value={g.supplier}
                onChange={(supplier) => changeGroup(g.key, { supplier })}
                invalid={Boolean(err("supplier"))}
                describedBy={err("supplier") ? `${g.key}-supplier-error` : undefined}
              />
            </Field>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                id={`${g.key}-expected`}
                label="Expected by (optional)"
                error={err("expectedDate")}
              >
                <Input
                  id={`${g.key}-expected`}
                  type="date"
                  min={data.today}
                  value={g.expectedDate}
                  onChange={(e) => changeGroup(g.key, { expectedDate: e.target.value })}
                  aria-invalid={Boolean(err("expectedDate"))}
                />
              </Field>
              <Field id={`${g.key}-ref`} label="Their reference (optional)">
                <Input
                  id={`${g.key}-ref`}
                  value={g.supplierRef}
                  onChange={(e) => changeGroup(g.key, { supplierRef: e.target.value })}
                  maxLength={60}
                  autoComplete="off"
                />
              </Field>
            </div>
            <ul className="grid divide-y rounded-md border" aria-label="Materials">
              {g.lines.map((l) => {
                const m = l.row.material;
                const lerr = (name: string) => err(`${m.id}.${name}`);
                const unit = UNIT_LABELS[m.unit];
                const q = (text: string) => quantityText(text, m.unit, currency);
                return (
                  <li key={m.id} className="grid min-w-0 gap-3 p-3 sm:p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Checkbox
                        id={`${g.key}-${m.id}-include`}
                        checked={l.include}
                        onCheckedChange={(v) => changeLine(g.key, m.id, { include: v === true })}
                        className="mt-0.5"
                        aria-label={`Order ${m.code} ${m.name}`}
                      />
                      <MaterialThumb imageId={l.row.imageId} alt={m.name} />
                      <label htmlFor={`${g.key}-${m.id}-include`} className="grid min-w-0 gap-0.5">
                        <span className="text-sm font-medium break-words">
                          {m.code} · {m.name}
                        </span>
                        <span className="text-[0.8125rem] break-words text-muted-foreground">
                          {[l.row.placements.join(", "), `for ${l.row.styles.join(", ")}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
                          {q(l.row.needed)} needed · {q(l.row.ordered)} ordered ·{" "}
                          {isZero(l.row.toOrder) ? "all ordered" : `${q(l.row.toOrder)} to order`}
                        </span>
                      </label>
                    </div>
                    {l.include && (
                      <div className="grid items-start gap-3 sm:grid-cols-2 sm:pl-7">
                        <Field
                          id={`${g.key}-${m.id}-quantity`}
                          label={`Quantity (${unit})`}
                          error={lerr("quantity")}
                        >
                          <Input
                            id={`${g.key}-${m.id}-quantity`}
                            inputMode="decimal"
                            value={l.quantity}
                            onChange={(e) => changeLine(g.key, m.id, { quantity: e.target.value })}
                            autoComplete="off"
                            aria-invalid={Boolean(lerr("quantity"))}
                          />
                        </Field>
                        <Field
                          id={`${g.key}-${m.id}-price`}
                          label={`Price per ${UNIT_ONE[m.unit]} (${currency}, optional)`}
                          error={lerr("price")}
                        >
                          <Input
                            id={`${g.key}-${m.id}-price`}
                            inputMode="decimal"
                            value={l.price}
                            onChange={(e) => changeLine(g.key, m.id, { price: e.target.value })}
                            autoComplete="off"
                            placeholder="At receive"
                            aria-invalid={Boolean(lerr("price"))}
                          />
                        </Field>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
      <FormFooter
        form={form}
        cancelHref={productionHref.batch(data.batch.id)}
        submitLabel="Make the purchase orders"
        pendingLabel="Making the orders"
        errorTitle="We could not make the orders"
      />
    </form>
  );
}
