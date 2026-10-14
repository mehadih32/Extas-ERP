"use client";

import { ScrollTextIcon } from "lucide-react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
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
 * goods arrive. The batch's fabric is not ordered here: it is shown apart, with
 * "Book fabric" to book it with a booking (the server refuses fabric here too).
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

  const fabricLeft = data.fabric.filter((m) => !isZero(m.toOrder));
  const fabricCard = data.fabric.length > 0 && (
    <section
      aria-labelledby="fabric-booking-heading"
      className="grid min-w-0 gap-3 rounded-lg border border-primary/25 bg-secondary/40 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="fabric-booking-heading" className="font-serif text-lg text-primary">
            Fabric is booked with a booking
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {fabricLeft.length > 0
              ? "Book the batch's fabric with its GSM, DIA or width, colours and terms. It counts as ordered for the styles as soon as the booking is made."
              : "All the batch's fabric is booked or ordered."}
          </p>
        </div>
        {data.canBook && (
          <Button
            asChild
            size="sm"
            variant={fabricLeft.length > 0 ? "default" : "outline"}
            className="w-full sm:w-auto"
          >
            <Link href={productionHref.newBooking(data.batch.id)}>
              <ScrollTextIcon aria-hidden />
              Book fabric
            </Link>
          </Button>
        )}
      </div>
      <ul className="grid gap-1 text-[0.8125rem] text-muted-foreground" aria-label="Fabric">
        {data.fabric.map((m) => (
          <li key={m.material.id} className="break-words tabular-nums">
            <span className="font-medium text-foreground">
              {m.material.code} · {m.material.name}
            </span>{" "}
            ·{" "}
            {isZero(m.toOrder)
              ? "all booked"
              : `${quantityText(m.toOrder, m.material.unit, currency)} to book`}
          </li>
        ))}
      </ul>
    </section>
  );

  if (groups.length === 0) {
    return (
      <div className="grid max-w-3xl gap-6">
        {fabricCard}
        <p className="text-sm text-muted-foreground">
          The batch needs no trims or accessories yet. Give its styles their materials per piece to
          order them here.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <p className="text-sm leading-relaxed text-muted-foreground">
        For {data.styles.map((s) => s.code).join(", ")}. Each quantity starts at what is still to
        order. Leave a price empty to agree it when the goods arrive; it is entered on receive.
      </p>
      {fabricCard}
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
