"use client";

import type { BuyerType, PartyGrade, PartyKind, SupplierCategory } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { PartyForm as PartyFormData } from "@/modules/parties/screens.service";
import { createPartyAction, updatePartyAction } from "@/server/actions/parties.actions";

import {
  BUYER_TYPE_LABELS,
  GRADE_LABELS,
  GRADES,
  KIND_LABELS,
  partyHref,
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_HINTS,
  SUPPLIER_CATEGORY_LABELS,
} from "./labels";
import type { PartyListName } from "./labels";

const FIELDS = [
  "kind",
  "buyerType",
  "supplierCategories",
  "code",
  "name",
  "contactPerson",
  "phone",
  "whatsapp",
  "email",
  "address",
  "city",
  "country",
  "taxId",
  "grade",
  "creditLimit",
  "paymentTermsDays",
  "notes",
] as const;
type FieldName = (typeof FIELDS)[number];

const PHONE = /^[+0-9 ()-]*$/;

/** Whether a field's new value differs from the saved one ("50000.00" and 50000 are the same). */
function differs(saved: unknown, value: unknown): boolean {
  if (typeof value === "number" && typeof saved === "string") return Number(saved) !== value;
  if (Array.isArray(value)) return JSON.stringify(saved ?? []) !== JSON.stringify(value);
  return (saved ?? null) !== (value ?? null);
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-5 border-t pt-6 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 font-serif text-lg text-primary">{title}</legend>
      <div className="clear-left grid gap-5">{children}</div>
    </fieldset>
  );
}

/**
 * A buyer's or supplier's details: who they are, how to reach them, and the
 * terms they buy on. For new accounts and for editing; both need parties.manage,
 * as the party actions check. Walk-in customers keeps everything but its name
 * and notes (parties/rules.ts), and turning a buyer into a supplier (or back)
 * is offered only with nothing owed either way.
 */
export function PartyForm({
  form: data,
  list,
  currency,
}: {
  form: PartyFormData;
  /** The list it was opened from, which a new account starts as. */
  list: PartyListName;
  currency: string;
}) {
  const router = useRouter();
  const party = data.party;
  const [kind, setKind] = useState<PartyKind>(
    party?.kind ?? (list === "suppliers" ? "SUPPLIER" : "BUYER"),
  );
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, startTransition] = useTransition();
  const editable = (name: FieldName) => !data.editable || data.editable.includes(name);
  const fieldError = (name: FieldName) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = FIELDS.some((f) => fieldError(f));
  const described = (name: FieldName, hint = false) =>
    fieldError(name) ? `${name}-error` : hint ? `${name}-hint` : undefined;
  const sells = kind !== "SUPPLIER";
  const supplies = kind !== "BUYER";
  const noun = kind === "SUPPLIER" ? "supplier" : kind === "BUYER" ? "buyer" : "account";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const found: Partial<Record<FieldName, string>> = {};
    const name = textOf(form, "name");
    if (name.length < 2) found.name = "Enter the name, at least 2 letters.";
    for (const field of ["phone", "whatsapp"] as const) {
      if (editable(field) && !PHONE.test(textOf(form, field))) {
        found[field] = "Use digits, spaces, +, - or brackets.";
      }
    }
    const email = textOf(form, "email");
    if (editable("email") && email && !EMAIL.test(email))
      found.email = "Enter an email like name@example.com.";
    const creditLimit =
      sells && editable("creditLimit") ? readAmount(textOf(form, "creditLimit")) : null;
    if (creditLimit === "invalid") found.creditLimit = AMOUNT_HINT;
    const termsText = textOf(form, "paymentTermsDays");
    const terms = termsText === "" ? null : Number(termsText);
    if (
      editable("paymentTermsDays") &&
      terms !== null &&
      !(Number.isInteger(terms) && terms >= 0 && terms <= 365)
    ) {
      found.paymentTermsDays = "Enter whole days, from 0 to 365.";
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const all = {
      kind,
      buyerType: sells ? ((textOf(form, "buyerType") || "WHOLESALE") as BuyerType) : null,
      supplierCategories: supplies
        ? SUPPLIER_CATEGORIES.filter((c) => form.getAll("supplierCategories").includes(c))
        : ([] as SupplierCategory[]),
      name,
      contactPerson: textOf(form, "contactPerson") || null,
      phone: textOf(form, "phone") || null,
      whatsapp: textOf(form, "whatsapp") || null,
      email: email || null,
      address: textOf(form, "address") || null,
      city: textOf(form, "city") || null,
      country: textOf(form, "country") || null,
      taxId: textOf(form, "taxId") || null,
      creditLimit: sells ? (creditLimit as number | null) : null,
      paymentTermsDays: terms,
      notes: textOf(form, "notes") || null,
    };
    // Editing sends only what changed, so the activity log names just that.
    const input = party
      ? Object.fromEntries(
          Object.entries(all).filter(
            ([key, value]) =>
              editable(key as FieldName) && differs(party[key as keyof typeof party], value),
          ),
        )
      : {
          ...all,
          code: textOf(form, "code") || undefined,
          grade: (textOf(form, "grade") || null) as PartyGrade | null,
        };
    if (party && Object.keys(input).length === 0) {
      router.push(partyHref(party));
      return;
    }
    startTransition(async () => {
      const result = party
        ? await updatePartyAction(party.id, input)
        : await createPartyAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const saved = result.data.party;
      router.push(partyHref(saved, `?${party ? "saved" : "created"}=1`));
    });
  }

  const cancelHref = party ? partyHref(party) : `/parties/${list}`;

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-8" noValidate>
      {editable("kind") && (
        <Section title="Who they are">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="kind"
              label="Account type"
              hint={
                party && data.kinds.length < 3
                  ? "Settle the balance first to switch between buyer and supplier."
                  : "Both: you sell to them and buy from them, in one account."
              }
              error={fieldError("kind")}
            >
              <NativeSelect
                id="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as PartyKind)}
                containerClassName="sm:w-full"
                className="md:h-10"
                aria-describedby={described("kind", true)}
              >
                {data.kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {sells && (
              <Field id="buyerType" label="Buyer type" error={fieldError("buyerType")}>
                <NativeSelect
                  id="buyerType"
                  name="buyerType"
                  defaultValue={party?.buyerType ?? "WHOLESALE"}
                  containerClassName="sm:w-full"
                  className="md:h-10"
                  aria-describedby={described("buyerType")}
                >
                  {(["WHOLESALE", "B2B_CORPORATE", "RETAIL"] as const).map((t) => (
                    <option key={t} value={t}>
                      {BUYER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          {supplies && (
            <fieldset
              className="grid gap-3"
              aria-describedby={
                fieldError("supplierCategories")
                  ? "supplierCategories-error"
                  : "supplierCategories-hint"
              }
            >
              <legend className="text-sm font-medium">What they supply (optional)</legend>
              <p
                id="supplierCategories-hint"
                className="-mt-1 text-[0.8125rem] text-muted-foreground"
              >
                Tick all that apply: a factory can be both CM and FOB.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SUPPLIER_CATEGORIES.map((c) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 text-sm has-[:checked]:border-primary/50"
                  >
                    <input
                      type="checkbox"
                      name="supplierCategories"
                      value={c}
                      defaultChecked={party?.supplierCategories.includes(c) ?? false}
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{SUPPLIER_CATEGORY_LABELS[c]}</span>
                      <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                        {SUPPLIER_CATEGORY_HINTS[c]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {fieldError("supplierCategories") && (
                <p id="supplierCategories-error" className="text-sm text-destructive">
                  {fieldError("supplierCategories")}
                </p>
              )}
            </fieldset>
          )}
        </Section>
      )}

      <Section title={editable("kind") ? "Name" : "Details"}>
        <div
          className={
            party ? "grid gap-5" : "grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]"
          }
        >
          <Field
            id="name"
            label="Name"
            hint="The business or person, as on their documents."
            error={fieldError("name")}
          >
            <Input
              id="name"
              name="name"
              defaultValue={party?.name}
              autoComplete="off"
              aria-invalid={Boolean(fieldError("name"))}
              aria-describedby={described("name", true)}
              required
              autoFocus={!party}
            />
          </Field>
          {!party && (
            <Field
              id="code"
              label="Code (optional)"
              hint={`Given by itself when empty, like ${kind === "SUPPLIER" ? "SUP" : kind === "BOTH" ? "BS" : "BUY"}-0007.`}
              error={fieldError("code")}
            >
              <Input
                id="code"
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="uppercase"
                aria-invalid={Boolean(fieldError("code"))}
                aria-describedby={described("code", true)}
              />
            </Field>
          )}
        </div>
        {!party && (
          <Field
            id="grade"
            label="Grade (optional)"
            hint="A+ for your best accounts, C for the ones to watch."
            error={fieldError("grade")}
          >
            <NativeSelect
              id="grade"
              name="grade"
              defaultValue=""
              containerClassName="sm:w-48"
              className="md:h-10"
              aria-describedby={described("grade", true)}
            >
              <option value="">No grade</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  Grade {GRADE_LABELS[g]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </Section>

      {editable("phone") && (
        <Section title="Contact">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="contactPerson"
              label="Contact person (optional)"
              error={fieldError("contactPerson")}
            >
              <Input
                id="contactPerson"
                name="contactPerson"
                defaultValue={party?.contactPerson ?? ""}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("contactPerson"))}
                aria-describedby={described("contactPerson")}
              />
            </Field>
            <Field id="email" label="Email (optional)" error={fieldError("email")}>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                defaultValue={party?.email ?? ""}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(fieldError("email"))}
                aria-describedby={described("email")}
              />
            </Field>
            <Field id="phone" label="Phone (optional)" error={fieldError("phone")}>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={party?.phone ?? ""}
                placeholder="01XXXXXXXXX"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("phone"))}
                aria-describedby={described("phone")}
              />
            </Field>
            <Field
              id="whatsapp"
              label="WhatsApp (optional)"
              hint="If it is not the phone number."
              error={fieldError("whatsapp")}
            >
              <Input
                id="whatsapp"
                name="whatsapp"
                type="tel"
                inputMode="tel"
                defaultValue={party?.whatsapp ?? ""}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("whatsapp"))}
                aria-describedby={described("whatsapp", true)}
              />
            </Field>
          </div>
          <Field id="address" label="Address (optional)" error={fieldError("address")}>
            <Textarea
              id="address"
              name="address"
              rows={2}
              defaultValue={party?.address ?? ""}
              aria-invalid={Boolean(fieldError("address"))}
              aria-describedby={described("address")}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="city" label="City (optional)" error={fieldError("city")}>
              <Input
                id="city"
                name="city"
                defaultValue={party?.city ?? ""}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("city"))}
                aria-describedby={described("city")}
              />
            </Field>
            <Field id="country" label="Country" error={fieldError("country")}>
              <Input
                id="country"
                name="country"
                defaultValue={party?.country ?? "Bangladesh"}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("country"))}
                aria-describedby={described("country")}
              />
            </Field>
          </div>
        </Section>
      )}

      {editable("paymentTermsDays") && (
        <Section title="Terms">
          <div className="grid gap-5 sm:grid-cols-3">
            {sells && (
              <Field
                id="creditLimit"
                label={`Credit limit (${currency})`}
                hint="Empty for no limit. New orders above it are refused."
                error={fieldError("creditLimit")}
              >
                <Input
                  id="creditLimit"
                  name="creditLimit"
                  inputMode="decimal"
                  defaultValue={party?.creditLimit ?? ""}
                  placeholder="No limit"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("creditLimit"))}
                  aria-describedby={described("creditLimit", true)}
                />
              </Field>
            )}
            <Field
              id="paymentTermsDays"
              label="Payment terms (days)"
              hint="0 for payment on delivery."
              error={fieldError("paymentTermsDays")}
            >
              <Input
                id="paymentTermsDays"
                name="paymentTermsDays"
                inputMode="numeric"
                defaultValue={party?.paymentTermsDays ?? ""}
                placeholder="Not set"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("paymentTermsDays"))}
                aria-describedby={described("paymentTermsDays", true)}
              />
            </Field>
            <Field
              id="taxId"
              label="Tax ID (optional)"
              hint="BIN or TIN, for invoices."
              error={fieldError("taxId")}
            >
              <Input
                id="taxId"
                name="taxId"
                defaultValue={party?.taxId ?? ""}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(fieldError("taxId"))}
                aria-describedby={described("taxId", true)}
              />
            </Field>
          </div>
        </Section>
      )}

      <Section title="Notes">
        <Field
          id="notes"
          label="Notes (optional)"
          hint="Only your team sees these."
          error={fieldError("notes")}
        >
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={party?.notes ?? ""}
            aria-invalid={Boolean(fieldError("notes"))}
            aria-describedby={described("notes", true)}
          />
        </Field>
      </Section>

      {error && error.code !== "INTERNAL" && !hasFieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {party ? (pending ? "Saving" : "Save changes") : pending ? "Adding" : `Add the ${noun}`}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title={party ? "We could not save the details" : `We could not add the ${noun}`}
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
