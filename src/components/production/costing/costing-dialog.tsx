"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { PartyPicker } from "@/components/production/pickers";
import { productionHref } from "@/components/production/labels";
import { FormDialog } from "@/components/sales/dialogs";
import { CURRENCIES } from "@/components/settings/company/company-options";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import { TRADE_PAYMENT_LABELS, TRADE_PAYMENTS } from "@/modules/costing/costing-labels";
import type { CostingScreen } from "@/modules/costing/costing.service";
import { createCostingAction, updateCostingAction } from "@/server/actions/costing.actions";

/*
 * "New costing" and "Change the details": the order's buyer, factory,
 * currency, the owner's profit % for this order (no default), the percent
 * lines that come off the price, how the buyer pays, and the times the Order
 * check card measures the ship date against.
 */

type Party = { id: string; code: string; name: string };

/** "As the buyer pays": the buyer's own way of paying is copied onto the sheet. */
const FROM_BUYER = "FROM_BUYER";

function inputOf(form: FormData) {
  const fields: Record<string, unknown> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") fields[key] = value;
  });
  fields.risks = String(fields.risks ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  if (fields.tradePayment === FROM_BUYER) delete fields.tradePayment;
  return fields;
}

/** A problem with one risk line ("risks.2") shows under the Risks box. */
function foldRiskErrors(error: ActionError): ActionError {
  if (!error.fieldErrors) return error;
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    const name = key.startsWith("risks.") ? "risks" : key;
    fieldErrors[name] = [...(fieldErrors[name] ?? []), ...(messages ?? [])];
  }
  return { ...error, fieldErrors };
}

export function CostingDialog({
  costing,
  companyCurrency,
  onClose,
}: {
  /** The sheet to change; leave out for a new one. */
  costing?: CostingScreen;
  companyCurrency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [buyer, setBuyer] = useState<Party | null>(costing?.buyer ?? null);
  const [factory, setFactory] = useState<Party | null>(costing?.factory ?? null);
  const [currency, setCurrency] = useState(costing?.currency ?? companyCurrency);
  const currencies = CURRENCIES.some(([c]) => c === currency)
    ? CURRENCIES
    : ([...CURRENCIES, [currency, currency]] as const);

  return (
    <FormDialog
      title={costing ? "Change the details" : "New costing"}
      description={
        costing
          ? "The profit % is yours to set for this order; nothing is filled in for you."
          : "A costing sheet for one order: add its styles next, then read the Order check card."
      }
      submitLabel={costing ? "Save" : "Make the sheet"}
      pendingLabel="Saving"
      errorTitle="We could not save the costing sheet"
      className="sm:max-w-2xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const input = inputOf(form);
        const result = costing
          ? await updateCostingAction(costing.id, input)
          : await createCostingAction(input);
        if (!result.ok) return foldRiskErrors(result.error);
        if (costing) onClose();
        else router.push(productionHref.costing(result.data.id));
      }}
    >
      {(fieldError) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="costing-title"
            label="Order"
            hint="e.g. Polo shirts, spring 2027"
            error={fieldError("title")}
            className="sm:col-span-2"
          >
            <Input id="costing-title" name="title" defaultValue={costing?.title ?? ""} required />
          </Field>
          <Field id="costing-buyer" label="Buyer" error={fieldError("buyerId")}>
            <input type="hidden" name="buyerId" value={buyer?.id ?? ""} />
            <PartyPicker id="costing-buyer" kind="BUYER" value={buyer} onChange={setBuyer} />
          </Field>
          <Field
            id="costing-factory"
            label="Factory"
            hint="Who makes it, for the Factory check."
            error={fieldError("factoryId")}
          >
            <input type="hidden" name="factoryId" value={factory?.id ?? ""} />
            <PartyPicker
              id="costing-factory"
              kind="SUPPLIER"
              value={factory}
              onChange={setFactory}
            />
          </Field>
          <Field id="costing-currency" label="Currency" error={fieldError("currency")}>
            <NativeSelect
              id="costing-currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {currencies.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {currency !== companyCurrency ? (
            <Field
              id="costing-rate"
              label={`${companyCurrency} for 1 ${currency}`}
              error={fieldError("exchangeRate")}
            >
              <Input
                id="costing-rate"
                name="exchangeRate"
                inputMode="decimal"
                defaultValue={costing?.exchangeRate ?? ""}
              />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field
            id="costing-profit"
            label="Profit % for this order"
            hint="Your call for this order. Leave empty until you decide."
            error={fieldError("profitPercent")}
          >
            <Input
              id="costing-profit"
              name="profitPercent"
              inputMode="decimal"
              defaultValue={costing?.profitPercent ?? ""}
            />
          </Field>
          <Field
            id="costing-payment"
            label="How the buyer pays"
            hint={costing ? undefined : "Taken from the buyer unless you pick one here."}
            error={fieldError("tradePayment")}
          >
            <NativeSelect
              id="costing-payment"
              name="tradePayment"
              defaultValue={costing ? (costing.tradePayment ?? "") : FROM_BUYER}
            >
              {costing ? (
                <option value="">Not set</option>
              ) : (
                <option value={FROM_BUYER}>As the buyer pays</option>
              )}
              {TRADE_PAYMENTS.map((p) => (
                <option key={p} value={p}>
                  {TRADE_PAYMENT_LABELS[p]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="costing-tax" label="Source tax %" error={fieldError("sourceTaxPercent")}>
            <Input
              id="costing-tax"
              name="sourceTaxPercent"
              inputMode="decimal"
              defaultValue={costing?.sourceTaxPercent ?? 0}
            />
          </Field>
          <Field id="costing-bank" label="Bank charges %" error={fieldError("bankChargePercent")}>
            <Input
              id="costing-bank"
              name="bankChargePercent"
              inputMode="decimal"
              defaultValue={costing?.bankChargePercent ?? 0}
            />
          </Field>
          <Field
            id="costing-commission"
            label="Commission %"
            hint="An agent's or buying house's share, if any."
            error={fieldError("commissionPercent")}
          >
            <Input
              id="costing-commission"
              name="commissionPercent"
              inputMode="decimal"
              defaultValue={costing?.commissionPercent ?? 0}
            />
          </Field>
          <Field id="costing-ship" label="Ship date" error={fieldError("shipDate")}>
            <Input
              id="costing-ship"
              name="shipDate"
              type="date"
              defaultValue={costing?.shipDate ?? ""}
            />
          </Field>
          <Field
            id="costing-fabric-days"
            label="Days for the fabric"
            hint="Empty: 30 days."
            error={fieldError("fabricDays")}
          >
            <Input
              id="costing-fabric-days"
              name="fabricDays"
              inputMode="numeric"
              defaultValue={costing?.fabricDays ?? ""}
            />
          </Field>
          <Field
            id="costing-making-days"
            label="Days to make"
            hint="Empty: 25 days."
            error={fieldError("makingDays")}
          >
            <Input
              id="costing-making-days"
              name="makingDays"
              inputMode="numeric"
              defaultValue={costing?.makingDays ?? ""}
            />
          </Field>
          <Field
            id="costing-risks"
            label="Risks"
            hint="One per line, e.g. New print supplier. Eid, a new buyer and an LC are added for you."
            error={fieldError("risks")}
            className="sm:col-span-2"
          >
            <Textarea
              id="costing-risks"
              name="risks"
              rows={3}
              defaultValue={costing?.risks.join("\n") ?? ""}
            />
          </Field>
          <Field
            id="costing-notes"
            label="Notes"
            error={fieldError("notes")}
            className="sm:col-span-2"
          >
            <Textarea
              id="costing-notes"
              name="notes"
              rows={2}
              defaultValue={costing?.notes ?? ""}
            />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}
