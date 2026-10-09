"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { money } from "@/components/sales/labels";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ReturnForm as ReturnFormData } from "@/modules/materials/screens.service";
import { createSupplierReturnAction } from "@/server/actions/materials.actions";

import { materialsHref, perUnit, quantity, readQuantity, UNIT_LABELS } from "./labels";
import { useMaterialsForm } from "./use-form";

/**
 * Sending goods back to the supplier from one bill (buyers and Accounts): how
 * much of each line goes back, at the bill's price, from which store and why.
 * The supplier's account is credited with their value.
 */
export function ReturnForm({ form: data, currency }: { form: ReturnFormData; currency: string }) {
  const router = useRouter();
  const form = useMaterialsForm();
  const { fieldError } = form;
  const bill = data.bill;
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const credit = bill.lines.reduce((t, l) => {
    const q = readQuantity(amounts[l.id] ?? "", l.unit);
    return typeof q === "number" ? t + Math.round(q * Number(l.unitPrice) * 100) / 100 : t;
  }, 0);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const lines: Array<{ billItemId: string; quantity: number }> = [];
    bill.lines.forEach((l) => {
      const text = (amounts[l.id] ?? "").trim();
      if (!text) return;
      const q = readQuantity(text, l.unit);
      if (typeof q === "string") found[l.id] = q;
      else if (q > Number(l.returnable)) {
        found[l.id] = `At most ${quantity(l.returnable, l.unit, currency)} can go back.`;
      } else lines.push({ billItemId: l.id, quantity: q });
    });
    if (lines.length === 0 && Object.keys(found).length === 0) {
      found.lines = "Enter how much of at least one material goes back.";
    }
    const reason = textOf(values, "reason");
    if (reason.length < 5) found.reason = "Write at least 5 letters.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    const day = textOf(values, "date");
    form.startTransition(async () => {
      const result = await createSupplierReturnAction({
        billId: bill.id,
        warehouseId: textOf(values, "warehouseId") || undefined,
        date: day && day !== data.today ? day : undefined,
        reason,
        lines,
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${materialsHref.supplierReturn(result.data.id)}?created=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 font-serif text-lg text-primary">What goes back</legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Leave a line empty to keep all of it. Goods go back at the bill&apos;s price.
        </p>
        {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
        <ul className="grid grid-cols-1 gap-4">
          {bill.lines.map((l, index) => {
            const error = fieldError(l.id) ?? fieldError(`lines.${index}.quantity`);
            return (
              <li key={l.id} className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">
                    {l.material.code} · {l.material.name}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                    {quantity(l.quantity, l.unit, currency)} bought at{" "}
                    {perUnit(l.unitPrice, l.unit, currency)} ·{" "}
                    {quantity(l.returnable, l.unit, currency)} can go back
                  </p>
                </div>
                <Field
                  id={`return-${l.id}`}
                  label={`Going back (${UNIT_LABELS[l.unit]})`}
                  error={error}
                  className="sm:max-w-xs"
                >
                  <Input
                    id={`return-${l.id}`}
                    inputMode="decimal"
                    value={amounts[l.id] ?? ""}
                    onChange={(e) => setAmounts((all) => ({ ...all, [l.id]: e.target.value }))}
                    placeholder="0"
                    autoComplete="off"
                    autoFocus={index === 0}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `return-${l.id}-error` : undefined}
                  />
                </Field>
              </li>
            );
          })}
        </ul>
        <p className="text-right text-sm tabular-nums">
          <span className="text-muted-foreground">Credited to the supplier </span>
          <span className="font-serif text-lg">{money(credit.toFixed(2), currency)}</span>
        </p>
      </fieldset>

      <div className="grid items-start gap-5 sm:grid-cols-2">
        {data.stores.length > 1 && (
          <Field id="warehouseId" label="Leaves from the store" error={fieldError("warehouseId")}>
            <NativeSelect
              id="warehouseId"
              name="warehouseId"
              defaultValue={bill.storeId}
              containerClassName="sm:w-full"
            >
              {data.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field id="date" label="Sent back on" error={fieldError("date")}>
          <Input id="date" name="date" type="date" defaultValue={data.today} max={data.today} />
        </Field>
      </div>
      <Field
        id="reason"
        label="Why it goes back"
        hint="Like: shade does not match the approved swatch. Kept on the debit note."
        error={fieldError("reason")}
      >
        <Textarea
          id="reason"
          name="reason"
          rows={2}
          maxLength={500}
          aria-invalid={Boolean(fieldError("reason"))}
          aria-describedby={fieldError("reason") ? "reason-error" : "reason-hint"}
        />
      </Field>

      <FormFooter
        form={form}
        cancelHref={materialsHref.purchase(bill.id)}
        submitLabel="Send the goods back"
        errorTitle="We could not save the return"
      />
    </form>
  );
}
