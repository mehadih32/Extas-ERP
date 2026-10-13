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
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { BatchReceive } from "@/modules/production/receive.service";
import { type ShortExtra, shortExtra } from "@/modules/production/short-extra";
import { receiveBatchDeliveryAction } from "@/server/actions/production.actions";

import { productionHref } from "./labels";

type Order = NonNullable<BatchReceive["order"]>;
type Row = Order["lines"][number];
type Line = { row: Row; challan: string; actual: string; price: string };

const TONES: Record<ShortExtra["level"], string> = {
  MATCH:
    "border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200",
  EXTRA:
    "border-sky-300/60 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200",
  SHORT_WITHIN:
    "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200",
  SHORT: "border-destructive/30 bg-destructive/5 text-destructive",
  NO_CHALLAN: "border-border bg-muted/60 text-muted-foreground",
};

/** A number typed in a box, or null when it is empty or not a number. */
const typed = (text: string) => {
  const value = text.trim().replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
};

/** The Short/Extra line shown under a delivery line as it is typed. */
function checkText(
  check: ShortExtra,
  unit: Row["material"]["unit"],
  currency: string,
  allowance: number,
) {
  const amount = quantityText(String(Math.abs(check.difference)), unit, currency);
  switch (check.level) {
    case "MATCH":
      return "Final Match: the actual is what the challan says.";
    case "EXTRA":
      return `Extra: ${amount} more than the challan (${check.percent}%).`;
    case "SHORT_WITHIN":
      return `Short: ${amount} (${check.percent}%), inside the ${allowance}% allowance.`;
    case "SHORT":
      return `Short: ${amount} (${check.percent}%), more than the ${allowance}% allowance. It goes into the supplier's fault log on saving.`;
    default:
      return "Enter what the challan says to see Short/Extra.";
  }
}

/**
 * The batch's central receive (buyers): one supplier's delivery on one of the
 * batch's orders. For each line still to come, what the challan says and what
 * was actually weighed or counted; Short/Extra shows as it is typed. A line
 * priced at receive takes its agreed price here. Saving takes the goods into
 * the store as a Due bill; a short beyond the allowance is logged as the
 * supplier's fault with an instant alert.
 */
export function BatchReceiveForm({ data, currency }: { data: BatchReceive; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const order = data.order!;
  const [storeId, setStoreId] = useState(data.defaultStoreId);
  const [billDate, setBillDate] = useState(data.today);
  const [supplierRef, setSupplierRef] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(
    order.lines.map((row) => ({ row, challan: "", actual: "", price: row.unitPrice })),
  );

  const change = (lineId: string, next: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.row.id === lineId ? { ...l, ...next } : l)));
  const allowanceOf = (row: Row) =>
    row.material.kind === "FABRIC" ? data.allowance.FABRIC : data.allowance.OTHER;
  const checks = lines.map((l) => {
    const actual = typed(l.actual);
    return actual === null ? null : shortExtra(typed(l.challan), actual, l.row.material.kind);
  });
  const shorts = checks.filter((c) => c?.level === "SHORT").length;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const out: Array<{
      lineId: string;
      challanQuantity: number | null;
      quantity: number;
      unitPrice?: number;
    }> = [];
    // Every line goes, so the server's line numbers match these; an empty one is 0 came.
    lines.forEach((l, i) => {
      const m = l.row.material;
      const actual = l.actual.trim()
        ? readQuantity(l.actual, m.unit, { allowZero: true })
        : l.challan.trim()
          ? "Enter what actually came (0 if none of it)."
          : 0;
      const challan = l.challan.trim()
        ? readQuantity(l.challan, m.unit, { allowZero: true })
        : null;
      if (typeof actual === "string") found[`lines.${i}.quantity`] = actual;
      if (typeof challan === "string") found[`lines.${i}.challanQuantity`] = challan;
      let price: number | string | undefined;
      if (l.row.priceLater && typeof actual === "number" && actual > 0) {
        price = readPrice(l.price);
        if (typeof price === "string") found[`lines.${i}.unitPrice`] = "Enter the agreed price.";
      } else if (l.price.trim() && l.price.trim() !== l.row.unitPrice) {
        price = readPrice(l.price);
        if (typeof price === "string") found[`lines.${i}.unitPrice`] = price;
      }
      out.push({
        lineId: l.row.id,
        challanQuantity: typeof challan === "number" ? challan : null,
        quantity: typeof actual === "number" ? actual : 0,
        ...(typeof price === "number" ? { unitPrice: price } : {}),
      });
    });
    if (!out.some((o) => o.quantity > 0) && Object.keys(found).length === 0) {
      found.lines = "Enter what actually came on at least one line.";
    }
    if (billDate > data.today) found.billDate = "Choose today or an earlier day.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      const result = await receiveBatchDeliveryAction(data.batch.id, {
        orderId: order.id,
        warehouseId: storeId || undefined,
        billDate,
        supplierRef: supplierRef.trim() || null,
        notes: notes.trim() || null,
        lines: out,
      });
      if (!result.ok) return form.setError(result.error);
      const query = new URLSearchParams({ received: result.data.bill.number });
      if (result.data.shorts.length > 0) query.set("faults", String(result.data.shorts.length));
      router.push(`${productionHref.batch(data.batch.id)}?${query}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id="supplierRef"
          label="Challan no. (optional)"
          hint="The number on the supplier's challan."
        >
          <Input
            id="supplierRef"
            value={supplierRef}
            onChange={(e) => setSupplierRef(e.target.value)}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <Field id="billDate" label="Received on" error={fieldError("billDate")}>
          <Input
            id="billDate"
            type="date"
            max={data.today}
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            aria-invalid={Boolean(fieldError("billDate"))}
          />
        </Field>
        {data.stores.length > 1 && (
          <Field id="store" label="Into the store">
            <NativeSelect id="store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {data.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>

      <section aria-labelledby="lines-heading" className="grid gap-3">
        <div>
          <h3 id="lines-heading" className="font-serif text-lg text-primary">
            Challan vs Actual
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Weigh or count each line and enter the actual. A short of more than{" "}
            {data.allowance.FABRIC}% on fabric or {data.allowance.OTHER}% on the rest goes into the
            supplier&apos;s fault log to deduct. Leave a line empty if none of it came.
          </p>
        </div>
        {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
        {shorts > 0 && (
          <div
            role="alert"
            className={cn("rounded-md border px-3 py-2.5 text-sm font-medium", TONES.SHORT)}
          >
            {shorts === 1 ? "1 line is" : `${shorts} lines are`} short beyond the allowance. Saving
            logs {shorts === 1 ? "it" : "them"} as {order.supplier.name}&apos;s fault and alerts the
            Production Managers.
          </div>
        )}
        <ul className="grid divide-y rounded-lg border bg-card" aria-label="Delivery lines">
          {lines.map((l, i) => {
            const m = l.row.material;
            const unit = UNIT_LABELS[m.unit];
            const q = (text: string) => quantityText(text, m.unit, currency);
            const err = (name: string) => fieldError(`lines.${i}.${name}`);
            const check = checks[i];
            const counted = ["PCS", "ROLL", "CONE", "SET", "DOZEN", "GROSS"].includes(m.unit);
            return (
              <li key={l.row.id} className="grid min-w-0 gap-3 p-3 sm:p-4">
                <div className="grid min-w-0 gap-0.5">
                  <p className="text-sm font-medium break-words">
                    {m.code} · {m.name}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                    {q(l.row.ordered)} ordered · {q(l.row.received)} received ·{" "}
                    <span className="font-medium text-foreground">{q(l.row.toCome)} to come</span>
                    {l.row.priceLater ? " · priced at receive" : ""}
                  </p>
                </div>
                <div className="grid items-start gap-3 sm:grid-cols-3">
                  <Field
                    id={`line-${i}-challan`}
                    label={`Challan says (${unit})`}
                    error={err("challanQuantity")}
                  >
                    <Input
                      id={`line-${i}-challan`}
                      inputMode="decimal"
                      value={l.challan}
                      onChange={(e) => change(l.row.id, { challan: e.target.value })}
                      autoComplete="off"
                      aria-invalid={Boolean(err("challanQuantity"))}
                    />
                  </Field>
                  <Field
                    id={`line-${i}-actual`}
                    label={counted ? `Actual count (${unit})` : `Actual weight (${unit})`}
                    error={err("quantity")}
                  >
                    <Input
                      id={`line-${i}-actual`}
                      inputMode="decimal"
                      value={l.actual}
                      onChange={(e) => change(l.row.id, { actual: e.target.value })}
                      autoComplete="off"
                      aria-invalid={Boolean(err("quantity"))}
                    />
                  </Field>
                  <Field
                    id={`line-${i}-price`}
                    label={`${l.row.priceLater ? "Agreed price" : "Price"} per ${UNIT_ONE[m.unit]} (${currency})`}
                    error={err("unitPrice")}
                    hint={l.row.priceLater ? "Agreed now, on receive." : undefined}
                  >
                    <Input
                      id={`line-${i}-price`}
                      inputMode="decimal"
                      value={l.price}
                      onChange={(e) => change(l.row.id, { price: e.target.value })}
                      autoComplete="off"
                      aria-invalid={Boolean(err("unitPrice"))}
                    />
                  </Field>
                </div>
                {check && (
                  <p
                    className={cn(
                      "rounded-md border px-3 py-2 text-[0.8125rem]",
                      TONES[check.level],
                    )}
                    aria-live="polite"
                  >
                    {checkText(check, m.unit, currency, allowanceOf(l.row))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <Field id="notes" label="Notes (optional)">
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
        />
      </Field>

      <FormFooter
        form={form}
        cancelHref={productionHref.batch(data.batch.id)}
        submitLabel="Receive into the store"
        pendingLabel="Receiving"
        errorTitle="We could not receive the delivery"
      />
    </form>
  );
}
