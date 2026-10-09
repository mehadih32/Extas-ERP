"use client";

import type { MeasurementUnit, PaymentType } from "@prisma/client";
import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter } from "@/components/accounts/form-bits";
import { PaidFromFields } from "@/components/accounts/money-fields";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { PAYMENT_TYPE_HINTS, PAYMENT_TYPE_LABELS } from "@/components/production/labels";
import { textOf } from "@/components/products/form-values";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PurchaseForm as PurchaseFormData } from "@/modules/materials/screens.service";
import { createPurchaseAction, uploadMaterialFileAction } from "@/server/actions/materials.actions";

import { materialsHref, quantity, readPrice, readQuantity, UNIT_LABELS, UNIT_ONE } from "./labels";
import { MaterialPicker, SupplierPicker } from "./pickers";
import { useMaterialsForm } from "./use-form";

type Party = { id: string; code: string; name: string };
type Line = {
  key: string;
  /** The purchase order line the goods arrived on. */
  orderLine: { id: string; ordered: string; pending: string } | null;
  material: { id: string; code: string; name: string; unit: MeasurementUnit };
  quantity: string;
  unitPrice: string;
};

// Lines added in the browser get keys from this counter; the first ones are
// keyed by position, so the server and the browser agree.
let nextKey = 0;
const newKey = () => `item-${++nextKey}`;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function lineAmount(line: Line): number {
  const q = readQuantity(line.quantity, line.material.unit);
  const p = readPrice(line.unitPrice);
  return typeof q === "number" && typeof p === "number" ? Math.round(q * p * 100) / 100 : 0;
}

/**
 * Goods received with the supplier's bill (buyers and Accounts): against a
 * purchase order (its lines still to come, at its prices) or without one. They
 * go into the store at the bill price; the bill is owed to the supplier, or
 * for Accounts paid now from cash, a bank or a wallet.
 */
export function PurchaseForm({
  form: data,
  currency,
}: {
  form: PurchaseFormData;
  currency: string;
}) {
  const router = useRouter();
  const form = useMaterialsForm();
  const { fieldError } = form;
  const order = data.order;
  const [supplier, setSupplier] = useState<Party | null>(order?.supplier ?? null);
  const [paymentType, setPaymentType] = useState<PaymentType>("DUE");
  const [lines, setLines] = useState<Line[]>(
    (order?.lines ?? []).map((l, i) => ({
      key: `item-start-${i}`,
      orderLine: { id: l.id, ordered: l.ordered, pending: l.pending },
      material: l.material,
      quantity: l.pending,
      unitPrice: l.unitPrice,
    })),
  );
  const [file, setFile] = useState<File | null>(null);
  const canPayNow = data.canPayNow && data.moneyAccounts.length > 0;
  const total = lines.reduce((t, l) => t + lineAmount(l), 0);

  function change(key: string, next: Partial<Line>) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    if (!supplier) found.supplierId = "Choose the supplier who sent the goods.";
    if (lines.length === 0) found.items = "Add the materials that came in.";
    const items = lines.map((l, i) => {
      const q = readQuantity(l.quantity, l.material.unit);
      const p = readPrice(l.unitPrice);
      if (typeof q === "string") found[`items.${i}.quantity`] = q;
      if (typeof p === "string") found[`items.${i}.unitPrice`] = p;
      return {
        ...(l.orderLine ? { purchaseOrderLineId: l.orderLine.id } : { materialId: l.material.id }),
        quantity: typeof q === "number" ? q : 0,
        unitPrice: typeof p === "number" ? p : 0,
      };
    });
    if (file && file.size > MAX_FILE_BYTES) found.file = "Files can be up to 10 MB.";
    const type: PaymentType = canPayNow ? paymentType : "DUE";
    if (type === "CASH_BANK" && !textOf(values, "accountId")) {
      found.accountId = "Choose where the money comes from.";
    }
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    const day = textOf(values, "billDate");
    form.startTransition(async () => {
      let attachmentId: string | undefined;
      if (file) {
        const upload = new FormData();
        upload.set("file", file);
        const stored = await uploadMaterialFileAction(upload);
        if (!stored.ok) return form.setProblems({ file: stored.error.message });
        attachmentId = stored.data.id;
      }
      const result = await createPurchaseAction({
        ...(order ? { purchaseOrderId: order.id } : { supplierId: supplier!.id }),
        warehouseId: textOf(values, "warehouseId") || undefined,
        billDate: day && day !== data.today ? day : undefined,
        supplierRef: textOf(values, "supplierRef") || undefined,
        paymentType: type,
        ...(type === "CASH_BANK"
          ? {
              accountId: textOf(values, "accountId"),
              method: textOf(values, "method") || "CASH",
              reference: textOf(values, "reference") || undefined,
            }
          : {}),
        items,
        notes: textOf(values, "notes") || undefined,
        attachmentId,
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${materialsHref.purchase(result.data.id)}?created=1`);
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
      <div className="grid items-start gap-5 sm:grid-cols-3">
        <Field
          id="supplierRef"
          label="Their bill number (optional)"
          error={fieldError("supplierRef")}
        >
          <Input id="supplierRef" name="supplierRef" maxLength={60} autoComplete="off" />
        </Field>
        <Field id="billDate" label="Received on" error={fieldError("billDate")}>
          <Input
            id="billDate"
            name="billDate"
            type="date"
            defaultValue={data.today}
            max={data.today}
          />
        </Field>
        {data.stores.length > 1 && (
          <Field id="warehouseId" label="Into the store" error={fieldError("warehouseId")}>
            <NativeSelect
              id="warehouseId"
              name="warehouseId"
              defaultValue={data.defaultStoreId}
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
      </div>

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 font-serif text-lg text-primary">What came in</legend>
        {order && (
          <p className="-mt-2 text-sm text-muted-foreground">
            What is still to come on {order.number}. Change the quantities to what actually arrived,
            and remove anything that did not.
          </p>
        )}
        {fieldError("items") && <FormAlert>{fieldError("items")}</FormAlert>}
        {lines.length > 0 && (
          <ul className="grid grid-cols-1 gap-4">
            {lines.map((line, index) => {
              const unit = UNIT_LABELS[line.material.unit];
              const err = (name: string) => fieldError(`items.${index}.${name}`);
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
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {line.orderLine
                          ? `${quantity(line.orderLine.pending, line.material.unit, currency)} still to come of ${quantity(line.orderLine.ordered, line.material.unit, currency)} ordered`
                          : order
                            ? `Not on ${order.number}`
                            : null}
                      </p>
                      {(err("purchaseOrderLineId") || err("materialId")) && (
                        <p className="text-[0.8125rem] text-destructive">
                          {err("purchaseOrderLineId") ?? err("materialId")}
                        </p>
                      )}
                    </div>
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
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-3">
                    <Field
                      id={`${line.key}-quantity`}
                      label={`Came in (${unit})`}
                      error={err("quantity")}
                    >
                      <Input
                        id={`${line.key}-quantity`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => change(line.key, { quantity: e.target.value })}
                        autoComplete="off"
                        aria-invalid={Boolean(err("quantity"))}
                        aria-describedby={
                          err("quantity") ? `${line.key}-quantity-error` : undefined
                        }
                      />
                    </Field>
                    <Field
                      id={`${line.key}-price`}
                      label={`Bill price per ${UNIT_ONE[line.material.unit]} (${currency})`}
                      error={err("unitPrice")}
                    >
                      <Input
                        id={`${line.key}-price`}
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(e) => change(line.key, { unitPrice: e.target.value })}
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
                </li>
              );
            })}
          </ul>
        )}
        <MaterialPicker
          id="add-material"
          label={
            lines.length === 0
              ? "Find a material that came in"
              : order
                ? "Add something not on the order"
                : "Add another material"
          }
          currency={currency}
          exclude={lines.filter((l) => !l.orderLine).map((l) => l.material.id)}
          invalid={Boolean(fieldError("items"))}
          onPick={(m) =>
            setLines((all) => [
              ...all,
              {
                key: newKey(),
                orderLine: null,
                material: { id: m.id, code: m.code, name: m.name, unit: m.unit },
                quantity: "",
                unitPrice: m.avgCost ?? "",
              },
            ])
          }
        />
        <p className="text-right text-sm tabular-nums">
          <span className="text-muted-foreground">Bill total </span>
          <span className="font-serif text-lg">{money(total.toFixed(2), currency)}</span>
        </p>
      </fieldset>

      {canPayNow ? (
        <>
          <ChoiceList<PaymentType>
            name="paymentType"
            legend="How it is paid"
            defaultValue="DUE"
            onChange={setPaymentType}
            options={(["DUE", "CASH_BANK"] as const).map((t) => ({
              value: t,
              label: PAYMENT_TYPE_LABELS[t],
              hint: PAYMENT_TYPE_HINTS[t],
            }))}
          />
          {paymentType === "CASH_BANK" && (
            <div className="grid items-start gap-5 sm:grid-cols-3">
              <PaidFromFields
                idPrefix="paid"
                accounts={data.moneyAccounts}
                currency={currency}
                fieldError={fieldError}
              />
            </div>
          )}
        </>
      ) : (
        <FormAlert tone="note">
          It is owed to the supplier and goes on their account. Accounts pays it.
        </FormAlert>
      )}

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="file"
          label="Photo or PDF of the bill (optional)"
          hint="Kept with the purchase. Up to 10 MB."
          error={fieldError("file")}
        >
          <Input
            id="file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="h-auto py-1.5 file:mr-3"
            aria-invalid={Boolean(fieldError("file"))}
            aria-describedby={fieldError("file") ? "file-error" : "file-hint"}
          />
        </Field>
        <Field id="notes" label="Notes (optional)">
          <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
        </Field>
      </div>

      <FormFooter
        form={form}
        cancelHref={order ? materialsHref.order(order.id) : materialsHref.purchases}
        submitLabel="Receive the goods"
        pendingLabel="Saving"
        errorTitle="We could not save the purchase"
      />
    </form>
  );
}
