"use client";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

/*
 * What a proforma invoice prints besides the quotation's items: the buyer's
 * purchase order number, the last day the offer holds and the bank account the
 * buyer pays into. Asked for when the proforma is made ("Make a proforma
 * invoice") and changed later with "Edit the details" while it is open.
 */

export type BankChoice = { id: string; label: string };

export type ProformaDetailsValues = {
  buyerPoNumber: string | null;
  validUntil: string | null;
  bankId: string | null;
};

/** The three fields, named buyerPoNumber, validUntil and bankAccountId. */
export function ProformaDetailsFields({
  values,
  banks,
  issuedOn,
  fieldError,
}: {
  values: ProformaDetailsValues;
  banks: BankChoice[];
  /** The proforma's date: the offer cannot end before it. */
  issuedOn: string;
  fieldError: (name: string) => string | undefined;
}) {
  return (
    <>
      <Field
        id="pi-buyer-po"
        label="Buyer PO no. (optional)"
        hint="The buyer's purchase order number, printed on the proforma."
        error={fieldError("buyerPoNumber")}
      >
        <Input
          id="pi-buyer-po"
          name="buyerPoNumber"
          maxLength={80}
          defaultValue={values.buyerPoNumber ?? ""}
          autoComplete="off"
          aria-describedby={fieldError("buyerPoNumber") ? "pi-buyer-po-error" : "pi-buyer-po-hint"}
        />
      </Field>
      <Field
        id="pi-valid-until"
        label="Valid until (optional)"
        hint="The last day the prices and terms hold. Leave empty for no end date."
        error={fieldError("validUntil")}
      >
        <Input
          id="pi-valid-until"
          name="validUntil"
          type="date"
          min={issuedOn}
          defaultValue={values.validUntil ?? ""}
          className="sm:w-48"
          aria-describedby={
            fieldError("validUntil") ? "pi-valid-until-error" : "pi-valid-until-hint"
          }
        />
      </Field>
      <Field
        id="pi-bank"
        label="Bank details"
        hint={
          banks.length > 0
            ? "The account the buyer pays into, printed on the proforma."
            : "No bank account yet. Accounts adds one under Cash & bank."
        }
        error={fieldError("bankAccountId")}
      >
        <NativeSelect
          id="pi-bank"
          name="bankAccountId"
          defaultValue={values.bankId ?? ""}
          containerClassName="sm:w-full"
          aria-describedby={fieldError("bankAccountId") ? "pi-bank-error" : "pi-bank-hint"}
        >
          <option value="">Do not print bank details</option>
          {banks.map((bank) => (
            <option key={bank.id} value={bank.id}>
              {bank.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}

/** The fields as sent to the server, or the problems found first (by field name). */
export function readProformaDetails(
  form: FormData,
  issuedOn: string,
):
  | {
      ok: true;
      input: {
        buyerPoNumber: string | null;
        validUntil: string | null;
        bankAccountId: string | null;
      };
    }
  | { ok: false; problems: Record<string, string> } {
  const validUntil = textOf(form, "validUntil");
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    return { ok: false, problems: { validUntil: "Choose a day." } };
  }
  if (validUntil && validUntil < issuedOn) {
    return { ok: false, problems: { validUntil: "Choose a day on or after the proforma's date." } };
  }
  return {
    ok: true,
    input: {
      buyerPoNumber: textOf(form, "buyerPoNumber") || null,
      validUntil: validUntil || null,
      bankAccountId: textOf(form, "bankAccountId") || null,
    },
  };
}
