"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field } from "@/components/forms/field";
import { PartyPicker } from "@/components/production/pickers";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { CURRENCIES } from "@/components/settings/company/company-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import { FABRIC_UNIT_LABELS } from "@/modules/costing/costing-labels";
import type { FabricPrices } from "@/modules/costing/costing.service";
import { addFabricQuoteAction, removeFabricQuoteAction } from "@/server/actions/costing.actions";

import { CostingDialog } from "./costing-dialog";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** "New costing" on the list. */
export function NewCostingButton({ companyCurrency }: { companyCurrency: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        New costing
      </Button>
      {open && <CostingDialog companyCurrency={companyCurrency} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Supplier fabric quotes: the price per kg (per yard for wovens) each mill
 * quoted, newest first. Costing sheets pick from them, beside past booking prices.
 */
export function QuotesPanel({
  quotes,
  canManage,
  companyCurrency,
  today,
}: {
  quotes: FabricPrices["quotes"];
  canManage: boolean;
  companyCurrency: string;
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FabricPrices["quotes"][number] | null>(null);
  const [supplier, setSupplier] = useState<{ id: string; code: string; name: string } | null>(null);

  return (
    <Panel
      title="Supplier fabric quotes"
      id="fabric-quotes-heading"
      action={
        canManage ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add a supplier quote
          </Button>
        ) : null
      }
    >
      <p className="mt-1 text-sm text-muted-foreground">
        The price each mill quoted per kg (per yard for wovens). Costing sheets show them side by
        side with what was paid on past bookings.
      </p>
      {quotes.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No quote saved yet.</p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {quotes.map((q) => (
            <li key={q.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium break-words">
                  {q.supplier}: {q.currency} {fmt(q.price)} per {FABRIC_UNIT_LABELS[q.unit]}
                </p>
                <p className="break-words text-muted-foreground">{q.fabric}</p>
                <p className="text-[0.75rem] text-muted-foreground">
                  Quoted {formatDay(q.quotedOn)}
                  {q.validUntil
                    ? q.expired
                      ? `, ended ${formatDay(q.validUntil)}`
                      : `, good until ${formatDay(q.validUntil)}`
                    : ""}
                  {q.note ? ` · ${q.note}` : ""}
                </p>
              </div>
              {canManage && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Take off ${q.supplier}'s quote`}
                  onClick={() => setRemoving(q)}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <FormDialog
          title="Add a supplier quote"
          description="The fabric as the mill quoted it, and its price per kg (per yard for wovens)."
          submitLabel="Save the quote"
          pendingLabel="Saving"
          errorTitle="We could not save the quote"
          onClose={() => {
            setAdding(false);
            setSupplier(null);
          }}
          onSubmit={async (form) => {
            const input: Record<string, string> = {};
            form.forEach((value, key) => {
              if (typeof value === "string") input[key] = value;
            });
            const result = await addFabricQuoteAction(input);
            if (!result.ok) return result.error;
            setAdding(false);
            setSupplier(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="quote-supplier"
                label="Supplier"
                error={fieldError("supplierId")}
                className="sm:col-span-2"
              >
                <input type="hidden" name="supplierId" value={supplier?.id ?? ""} />
                <PartyPicker
                  id="quote-supplier"
                  kind="SUPPLIER"
                  value={supplier}
                  onChange={setSupplier}
                />
              </Field>
              <Field
                id="quote-fabric"
                label="Fabric"
                hint="e.g. 100% cotton single jersey 160 GSM, 30s"
                error={fieldError("fabric")}
                className="sm:col-span-2"
              >
                <Input id="quote-fabric" name="fabric" required />
              </Field>
              <Field id="quote-price" label="Price" error={fieldError("price")}>
                <Input id="quote-price" name="price" inputMode="decimal" required />
              </Field>
              <Field id="quote-unit" label="Per" error={fieldError("unit")}>
                <NativeSelect id="quote-unit" name="unit" defaultValue="KG">
                  <option value="KG">kg</option>
                  <option value="YARD">yard</option>
                </NativeSelect>
              </Field>
              <Field id="quote-currency" label="Currency" error={fieldError("currency")}>
                <NativeSelect id="quote-currency" name="currency" defaultValue={companyCurrency}>
                  {CURRENCIES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="quote-on" label="Quoted on" error={fieldError("quotedOn")}>
                <Input id="quote-on" name="quotedOn" type="date" defaultValue={today} required />
              </Field>
              <Field id="quote-until" label="Good until" error={fieldError("validUntil")}>
                <Input id="quote-until" name="validUntil" type="date" />
              </Field>
              <Field id="quote-note" label="Note" error={fieldError("note")}>
                <Input id="quote-note" name="note" placeholder="e.g. 3 weeks to deliver" />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
      {removing && (
        <ConfirmDialog
          title={`Take off ${removing.supplier}'s quote?`}
          description="Sheets that used it keep their fabric price."
          confirmLabel="Take off"
          pendingLabel="Taking off"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const result = await removeFabricQuoteAction(removing.id);
            if (!result.ok) return result.error;
            setRemoving(null);
          }}
        />
      )}
    </Panel>
  );
}
