"use client";

import { useRouter } from "next/navigation";

import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PettyCashForm as PettyCashFormData } from "@/modules/accounts/petty-cash.service";
import {
  createPettyCashBoxAction,
  updatePettyCashBoxAction,
} from "@/server/actions/accounts.actions";

import { FormFooter, usePageForm } from "./form-bits";
import { KIND_LABELS, pettyCashHref, signedMoney } from "./labels";

/** An amount that may be left empty (null) but not mistyped. */
function readOptional(form: FormData, name: string, problems: Record<string, string>) {
  const amount = readAmount(textOf(form, name));
  if (amount === "invalid" || (amount !== null && amount <= 0)) {
    problems[name] = AMOUNT_HINT;
    return undefined;
  }
  return amount;
}

/**
 * Opening a petty cash box (Accounts): its name, who keeps it, the amount it is
 * usually topped up to, and the first top-up from cash, a bank or a wallet.
 * With `data.box`, changes the box's details instead.
 */
export function PettyCashForm({ data, currency }: { data: PettyCashFormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const editing = data.box;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const name = textOf(values, "name");
    if (name.length < 2) found.name = "Write a short name, like “Factory”.";
    const holderId = textOf(values, "holderId");
    if (!holderId) found.holderId = "Choose who keeps the box.";
    const float = readOptional(values, "float", found);
    const details = {
      name,
      holderId,
      float: float ?? null,
      notes: textOf(values, "notes") || null,
    };
    const topUpAmount = data.can.topUp ? readOptional(values, "topUpAmount", found) : null;
    const fromAccountId = textOf(values, "topUpFrom");
    if (topUpAmount && !fromAccountId) found.topUpFrom = "Choose where the money comes from.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      if (editing) {
        const result = await updatePettyCashBoxAction(editing.id, details);
        if (!result.ok) return form.setError(result.error);
        router.push(`${pettyCashHref.box(editing.id)}?updated=1`);
        return;
      }
      const result = await createPettyCashBoxAction({
        ...details,
        ...(topUpAmount
          ? {
              topUp: {
                fromAccountId,
                amount: topUpAmount,
                reference: textOf(values, "topUpReference") || undefined,
              },
            }
          : {}),
      });
      if (!result.ok) {
        // The first top-up's problems belong on its own fields.
        const fields = result.error.fieldErrors ?? {};
        const topUpAmount = fields["topUp.amount"];
        const topUpFrom = fields["topUp.fromAccountId"] ?? fields.fromAccountId;
        return form.setError(
          topUpAmount || topUpFrom
            ? {
                ...result.error,
                fieldErrors: {
                  ...fields,
                  ...(topUpAmount ? { topUpAmount } : {}),
                  ...(topUpFrom ? { topUpFrom } : {}),
                },
              }
            : result.error,
        );
      }
      router.push(`${pettyCashHref.box(result.data.id)}?created=1`);
    });
  }

  if (data.holders.length === 0) {
    return (
      <FormAlert tone="note">
        No one can keep a box yet. A box is held by someone whose role records expenses: give a role
        that permission under Team, then come back.
      </FormAlert>
    );
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="box-name"
          label="Box name"
          hint="Where or what it is for. Its account in the books is “Petty cash —” and this name."
          error={fieldError("name")}
        >
          <Input
            id="box-name"
            name="name"
            maxLength={60}
            placeholder="Factory"
            defaultValue={editing?.name ?? ""}
            autoComplete="off"
            autoFocus={!editing}
            aria-invalid={Boolean(fieldError("name"))}
            aria-describedby={fieldError("name") ? "box-name-error" : "box-name-hint"}
          />
        </Field>
        <Field
          id="box-holder"
          label="Held by"
          hint="They keep the cash and record each cost from it."
          error={fieldError("holderId")}
        >
          <NativeSelect
            id="box-holder"
            name="holderId"
            defaultValue={editing?.holderId ?? ""}
            containerClassName="sm:w-full"
            aria-invalid={Boolean(fieldError("holderId"))}
            aria-describedby={fieldError("holderId") ? "box-holder-error" : "box-holder-hint"}
          >
            <option value="" disabled>
              Choose someone
            </option>
            {data.holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="box-float"
          label={`Usual amount (${currency}, optional)`}
          hint="What you top it up to each time. A guide, not a limit."
          error={fieldError("float")}
        >
          <Input
            id="box-float"
            name="float"
            inputMode="decimal"
            placeholder="5000.00"
            defaultValue={editing?.float ?? ""}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("float"))}
            aria-describedby={fieldError("float") ? "box-float-error" : "box-float-hint"}
          />
        </Field>
      </div>

      {data.can.topUp && (
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-medium">First top-up (optional)</legend>
          <div className="grid items-start gap-5 sm:grid-cols-3">
            <Field id="box-topup-from" label="From" error={fieldError("topUpFrom")}>
              <NativeSelect
                id="box-topup-from"
                name="topUpFrom"
                defaultValue={data.accounts[0]?.id}
                containerClassName="sm:w-full"
                aria-invalid={Boolean(fieldError("topUpFrom"))}
              >
                {(["CASH", "BANK", "MOBILE_WALLET"] as const).map((kind) => {
                  const ofKind = data.accounts.filter((a) => a.kind === kind);
                  return ofKind.length === 0 ? null : (
                    <optgroup key={kind} label={KIND_LABELS[kind]}>
                      {ofKind.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {signedMoney(a.balance, currency)}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </NativeSelect>
            </Field>
            <Field
              id="box-topup-amount"
              label={`Amount (${currency})`}
              hint="Leave empty to top it up later."
              error={fieldError("topUpAmount")}
            >
              <Input
                id="box-topup-amount"
                name="topUpAmount"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("topUpAmount"))}
                aria-describedby={
                  fieldError("topUpAmount") ? "box-topup-amount-error" : "box-topup-amount-hint"
                }
              />
            </Field>
            <Field id="box-topup-ref" label="Reference (optional)">
              <Input id="box-topup-ref" name="topUpReference" maxLength={120} autoComplete="off" />
            </Field>
          </div>
        </fieldset>
      )}

      <Field id="box-notes" label="Notes (optional)">
        <Textarea
          id="box-notes"
          name="notes"
          rows={2}
          maxLength={500}
          defaultValue={editing?.notes ?? ""}
        />
      </Field>

      <FormFooter
        form={form}
        cancelHref={editing ? pettyCashHref.box(editing.id) : "/accounts/cash-bank"}
        submitLabel={editing ? "Save the changes" : "Open the box"}
        pendingLabel="Saving"
        errorTitle={editing ? "We could not save the changes" : "We could not open the box"}
      />
    </form>
  );
}
