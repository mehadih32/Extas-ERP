"use client";

import type { DepreciationMethod } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { dayOrNow, readPositive } from "@/components/production/cost-dialogs";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { AssetForm as AssetFormData } from "@/modules/accounts/asset-screens.service";
import type { PartyOption } from "@/modules/accounts/screens.service";
import { createFixedAssetAction, updateFixedAssetAction } from "@/server/actions/accounts.actions";

import { FormFooter, usePageForm } from "./form-bits";
import { assetHref, DEPRECIATION_METHOD_LABELS } from "./labels";
import { AccountsPartyPicker, PaidFromFields } from "./money-fields";

type How = "PAID" | "CREDIT" | "OPENING";

const METHODS: DepreciationMethod[] = ["STRAIGHT_LINE", "REDUCING_BALANCE"];

/** A rate typed as "20" or "12.5" (% a year); null when left empty. */
function readRate(form: FormData, problems: Record<string, string>): number | null | undefined {
  const text = textOf(form, "depreciationRate");
  if (!text) return null;
  const rate = Number(text);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text) || rate > 100) {
    problems.depreciationRate = "Enter a rate from 0 to 100, like 20 or 12.5.";
    return undefined;
  }
  return rate;
}

/** An amount that may be left empty (0) but not mistyped. */
function readOptional(
  form: FormData,
  name: string,
  problems: Record<string, string>,
): number | undefined {
  const amount = readAmount(textOf(form, name));
  if (amount === "invalid") {
    problems[name] = AMOUNT_HINT;
    return undefined;
  }
  return amount ?? 0;
}

/** How fast it loses value: the rate, the method and what it is worth at the end. */
function DepreciationFields({
  data,
  currency,
  fieldError,
  disabled,
}: {
  data: AssetFormData;
  currency: string;
  fieldError: (name: string) => string | undefined;
  disabled: boolean;
}) {
  const a = data.asset;
  return (
    <fieldset className="grid gap-4" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">Depreciation</legend>
      <div className="grid items-start gap-5 sm:grid-cols-3">
        <Field
          id="asset-rate"
          label="Rate (% a year)"
          hint="Leave empty for land and anything that keeps its value."
          error={fieldError("depreciationRate")}
        >
          <Input
            id="asset-rate"
            name="depreciationRate"
            inputMode="decimal"
            placeholder="20"
            defaultValue={a?.depreciationRate ?? ""}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("depreciationRate"))}
            aria-describedby={
              fieldError("depreciationRate") ? "asset-rate-error" : "asset-rate-hint"
            }
          />
        </Field>
        <Field id="asset-method" label="How it loses value">
          <NativeSelect
            id="asset-method"
            name="depreciationMethod"
            defaultValue={a?.depreciationMethod ?? "STRAIGHT_LINE"}
            containerClassName="sm:w-full"
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {DEPRECIATION_METHOD_LABELS[method]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="asset-salvage"
          label={`Worth at the end (${currency})`}
          hint="Optional. Its value never goes below this."
          error={fieldError("salvageValue")}
        >
          <Input
            id="asset-salvage"
            name="salvageValue"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={a && /[1-9]/.test(a.salvageValue) ? a.salvageValue : ""}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("salvageValue"))}
            aria-describedby={
              fieldError("salvageValue") ? "asset-salvage-error" : "asset-salvage-hint"
            }
          />
        </Field>
      </div>
    </fieldset>
  );
}

/**
 * Recording an asset the business bought (a laptop, an AC, a machine): what it
 * is, when and for how much, how it was bought (paid now, on credit from a
 * supplier, or owned before the books started) and how fast it loses value.
 * With `data.asset`, changes an asset's details instead; what it cost and how
 * it was bought stay as they are.
 */
export function AssetForm({ data, currency }: { data: AssetFormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const editing = data.asset;
  const disposed = editing?.status === "DISPOSED";
  const [how, setHow] = useState<How>(
    data.can.payNow && data.accounts.length > 0 ? "PAID" : "CREDIT",
  );
  const [supplier, setSupplier] = useState<PartyOption | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const name = textOf(values, "name");
    if (name.length < 2) found.name = "Write what it is, like “Dell laptop”.";
    const details = {
      name,
      category: textOf(values, "category") || null,
      location: textOf(values, "location") || null,
      notes: textOf(values, "notes") || null,
    };
    const depreciation = disposed
      ? {}
      : {
          depreciationRate: readRate(values, found),
          depreciationMethod: (textOf(values, "depreciationMethod") ||
            "STRAIGHT_LINE") as DepreciationMethod,
          salvageValue: readOptional(values, "salvageValue", found),
        };

    if (editing) {
      form.setProblems(found);
      form.setError(undefined);
      if (Object.keys(found).length > 0) return;
      form.startTransition(async () => {
        const result = await updateFixedAssetAction(editing.id, {
          ...details,
          ...depreciation,
          ...(disposed ? {} : { status: textOf(values, "status") || "IN_USE" }),
        });
        if (!result.ok) return form.setError(result.error);
        router.push(`${assetHref.asset(editing.id)}?updated=1`);
      });
      return;
    }

    const cost = readPositive(values, "purchaseCost");
    if (typeof cost !== "number") {
      found.purchaseCost =
        (cost as ActionError).fieldErrors?.purchaseCost?.[0] ?? "Enter the cost.";
    }
    const purchaseDate = textOf(values, "purchaseDate");
    if (!purchaseDate) found.purchaseDate = "Enter the day it was bought.";
    let acquisition: Record<string, unknown> = {};
    if (how === "PAID") {
      if (!textOf(values, "accountId")) found.accountId = "Choose where the money came from.";
      acquisition = {
        kind: "PAID",
        accountId: textOf(values, "accountId"),
        method: textOf(values, "method") || "CASH",
        reference: textOf(values, "reference") || undefined,
      };
    } else if (how === "CREDIT") {
      if (!supplier) found.supplierId = "Choose the supplier you owe.";
      acquisition = {
        kind: "CREDIT",
        supplierId: supplier?.id,
        supplierRef: textOf(values, "supplierRef") || undefined,
      };
    } else {
      acquisition = {
        kind: "OPENING",
        accumulatedDepreciation: readOptional(values, "accumulatedDepreciation", found),
        asOf: dayOrNow(values, "asOf", data.today),
      };
    }
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0 || typeof cost !== "number") return;
    form.startTransition(async () => {
      const result = await createFixedAssetAction({
        ...details,
        ...depreciation,
        purchaseDate,
        purchaseCost: cost,
        acquisition,
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${assetHref.asset(result.data.id)}?created=1`);
    });
  }

  const options = [
    ...(data.can.payNow && data.accounts.length > 0
      ? [
          {
            value: "PAID" as const,
            label: "Paid now",
            hint: "From cash, a bank account or a wallet.",
          },
        ]
      : []),
    {
      value: "CREDIT" as const,
      label: "On credit from a supplier",
      hint: "It is added to what we owe them, and paid later with their other dues.",
    },
    {
      value: "OPENING" as const,
      label: "Owned before we started these books",
      hint: "Brings its cost and the depreciation taken so far into the books.",
    },
  ];

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="asset-name"
          label="What it is"
          error={fieldError("name")}
          className="sm:col-span-2"
        >
          <Input
            id="asset-name"
            name="name"
            maxLength={160}
            placeholder="Dell laptop for the office"
            defaultValue={editing?.name ?? ""}
            autoComplete="off"
            autoFocus={!editing}
            aria-invalid={Boolean(fieldError("name"))}
            aria-describedby={fieldError("name") ? "asset-name-error" : undefined}
          />
        </Field>
        <Field id="asset-category" label="Category (optional)" hint="Pick one or type your own.">
          <Input
            id="asset-category"
            name="category"
            list="asset-categories"
            maxLength={80}
            defaultValue={editing?.category ?? ""}
            autoComplete="off"
            aria-describedby="asset-category-hint"
          />
          <datalist id="asset-categories">
            {data.categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field id="asset-location" label="Where it is (optional)">
          <Input
            id="asset-location"
            name="location"
            maxLength={160}
            placeholder="Head office, factory floor…"
            defaultValue={editing?.location ?? ""}
            autoComplete="off"
          />
        </Field>
        {!editing && (
          <>
            <Field id="asset-date" label="Bought on" error={fieldError("purchaseDate")}>
              <Input
                id="asset-date"
                name="purchaseDate"
                type="date"
                defaultValue={data.today}
                max={data.today}
                aria-invalid={Boolean(fieldError("purchaseDate"))}
              />
            </Field>
            <Field id="asset-cost" label={`Cost (${currency})`} error={fieldError("purchaseCost")}>
              <Input
                id="asset-cost"
                name="purchaseCost"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("purchaseCost"))}
                aria-describedby={fieldError("purchaseCost") ? "asset-cost-error" : undefined}
              />
            </Field>
          </>
        )}
        {editing && !disposed && (
          <Field id="asset-status" label="Status">
            <NativeSelect
              id="asset-status"
              name="status"
              defaultValue={editing.status}
              containerClassName="sm:w-full"
            >
              <option value="IN_USE">In use</option>
              <option value="UNDER_REPAIR">Under repair</option>
            </NativeSelect>
          </Field>
        )}
      </div>

      {!editing && (
        <div className="grid gap-4">
          <ChoiceList<How>
            name="how"
            legend="How it was bought"
            defaultValue={how}
            onChange={setHow}
            options={options}
          />
          {how === "PAID" && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <PaidFromFields
                idPrefix="asset-paid"
                accounts={data.accounts}
                currency={currency}
                fieldError={fieldError}
              />
            </div>
          )}
          {how === "CREDIT" && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field
                id="supplierId"
                label="Owed to"
                error={fieldError("supplierId")}
                className="sm:col-span-2"
              >
                <AccountsPartyPicker
                  id="supplierId"
                  kind="SUPPLIER"
                  purpose="DUE"
                  value={supplier}
                  onChange={setSupplier}
                  invalid={Boolean(fieldError("supplierId"))}
                  describedBy={fieldError("supplierId") ? "supplierId-error" : undefined}
                />
              </Field>
              <Field id="asset-ref" label="Their bill number (optional)">
                <Input id="asset-ref" name="supplierRef" maxLength={80} autoComplete="off" />
              </Field>
            </div>
          )}
          {how === "OPENING" && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field
                id="asset-taken"
                label={`Depreciation taken so far (${currency})`}
                hint="Optional. How much of its cost was already written off."
                error={fieldError("accumulatedDepreciation")}
              >
                <Input
                  id="asset-taken"
                  name="accumulatedDepreciation"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  aria-describedby="asset-taken-hint"
                />
              </Field>
              <Field
                id="asset-asof"
                label="Day the books started"
                hint="Depreciation is counted from this day."
                error={fieldError("asOf")}
              >
                <Input
                  id="asset-asof"
                  name="asOf"
                  type="date"
                  defaultValue={data.today}
                  max={data.today}
                  aria-describedby="asset-asof-hint"
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {disposed ? (
        <FormAlert tone="note">
          It was sold or scrapped, so only its name, category, place and notes can change.
        </FormAlert>
      ) : (
        <DepreciationFields
          data={data}
          currency={currency}
          fieldError={fieldError}
          disabled={false}
        />
      )}

      <Field id="asset-notes" label="Notes (optional)">
        <Textarea
          id="asset-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={editing?.notes ?? ""}
        />
      </Field>

      <FormFooter
        form={form}
        cancelHref={editing ? assetHref.asset(editing.id) : assetHref.register}
        submitLabel={editing ? "Save the changes" : "Record the purchase"}
        pendingLabel="Saving"
        errorTitle={editing ? "We could not save the changes" : "We could not record the purchase"}
      />
    </form>
  );
}
