"use client";

import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { readAmount, textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import type { getAddLeadForm } from "@/modules/leads/lead.service";
import { CATEGORY_LABELS, NEXT_KIND_LABELS, PAYMENT_LABELS } from "@/modules/leads/labels";
import type { DuplicateMatch } from "@/modules/leads/rules";
import { addLeadAction, checkLeadDuplicatesAction } from "@/server/actions/leads.actions";

type Form = Awaited<ReturnType<typeof getAddLeadForm>>;

const words = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

/**
 * "Add lead": about 30 seconds at a fair. The company, its first contact, where
 * it came from, who follows it up and the next step. While typing, it warns of
 * leads and buyers that look the same (same email, website, phone or name).
 */
export function AddLeadForm({ form }: { form: Form }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [suppressed, setSuppressed] = useState(false);
  const [askAnyway, setAskAnyway] = useState(false);
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];

  function check() {
    const el = ref.current;
    if (!el) return;
    const data = new FormData(el);
    void checkLeadDuplicatesAction({
      name: textOf(data, "name"),
      website: textOf(data, "website") || null,
      country: textOf(data, "country") || null,
      email: textOf(data, "email") || null,
      phone: textOf(data, "phone") || textOf(data, "whatsapp") || null,
    }).then((result) => {
      if (!result.ok) return;
      setMatches(result.data.matches);
      setSuppressed(result.data.suppressed);
    });
  }

  function submit(anyway: boolean) {
    const el = ref.current;
    if (!el) return;
    const data = new FormData(el);
    const amount = (name: string) => {
      const v = readAmount(textOf(data, name));
      return v === "invalid" ? undefined : v;
    };
    const count = (name: string) => {
      const n = Number(textOf(data, name));
      return textOf(data, name) && Number.isInteger(n) && n > 0 ? n : null;
    };
    const contactName = textOf(data, "contactName");
    const input = {
      name: textOf(data, "name"),
      website: textOf(data, "website") || null,
      country: textOf(data, "country") || null,
      city: textOf(data, "city") || null,
      category: textOf(data, "category") || "OTHER",
      products: words(textOf(data, "products")),
      piecesPerStyle: count("piecesPerStyle"),
      targetPrice: amount("targetPrice"),
      expectedValue: amount("expectedValue"),
      paymentTerms: textOf(data, "paymentTerms") || null,
      contact: contactName
        ? {
            name: contactName,
            jobTitle: textOf(data, "jobTitle") || null,
            email: textOf(data, "email") || null,
            phone: textOf(data, "phone") || null,
            whatsapp: textOf(data, "whatsapp") || null,
            isDecisionMaker: data.get("isDecisionMaker") === "on",
          }
        : null,
      sourceId: textOf(data, "sourceId") || null,
      sourceNote: textOf(data, "sourceNote") || null,
      ownerUserId: textOf(data, "ownerUserId") || null,
      nextActionKind: textOf(data, "nextActionKind") || "EMAIL",
      nextActionOn: textOf(data, "nextActionOn") || null,
      nextActionNote: textOf(data, "nextActionNote") || null,
      confirmDuplicate: anyway,
    };
    startTransition(async () => {
      const result = await addLeadAction(input);
      if (result.ok) {
        router.push(`/sales/leads/${result.data.id}`);
        return;
      }
      setError(result.error);
      setAskAnyway(Boolean(result.error.fieldErrors?.confirmDuplicate));
    });
  }

  return (
    <form
      ref={ref}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="grid gap-6"
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-serif text-lg text-primary">The company</legend>
        <Field id="lead-name" label="Company name" error={fieldError("name")}>
          <Input id="lead-name" name="name" required onBlur={check} autoComplete="organization" />
        </Field>
        <Field id="lead-website" label="Website" error={fieldError("website")}>
          <Input id="lead-website" name="website" onBlur={check} placeholder="brand.com" />
        </Field>
        <Field id="lead-country" label="Country" error={fieldError("country")}>
          <Input id="lead-country" name="country" onBlur={check} />
        </Field>
        <Field id="lead-city" label="City" error={fieldError("city")}>
          <Input id="lead-city" name="city" />
        </Field>
        <Field id="lead-category" label="Kind of company">
          <NativeSelect
            id="lead-category"
            name="category"
            defaultValue="BRAND"
            containerClassName="sm:w-full"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="lead-products"
          label="Products they want"
          hint="Separate them with commas: Polo, T-shirt"
          error={fieldError("products")}
        >
          <Input id="lead-products" name="products" />
        </Field>
        <Field id="lead-pieces" label="Pieces per style" error={fieldError("piecesPerStyle")}>
          <Input id="lead-pieces" name="piecesPerStyle" inputMode="numeric" />
        </Field>
        <Field
          id="lead-price"
          label={`Their price per piece (${form.currency})`}
          error={fieldError("targetPrice")}
        >
          <Input id="lead-price" name="targetPrice" inputMode="decimal" />
        </Field>
        <Field
          id="lead-value"
          label={`Expected value (${form.currency})`}
          hint="What a first year with them could be worth"
          error={fieldError("expectedValue")}
        >
          <Input id="lead-value" name="expectedValue" inputMode="decimal" />
        </Field>
        <Field id="lead-payment" label="How they would pay">
          <NativeSelect id="lead-payment" name="paymentTerms" containerClassName="sm:w-full">
            <option value="">Not known yet</option>
            {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-serif text-lg text-primary">First contact</legend>
        <Field id="lead-contact" label="Contact name" error={fieldError("contact.name")}>
          <Input id="lead-contact" name="contactName" autoComplete="name" />
        </Field>
        <Field id="lead-title" label="Job title">
          <Input id="lead-title" name="jobTitle" placeholder="Sourcing manager" />
        </Field>
        <Field id="lead-email" label="Email" error={fieldError("contact.email")}>
          <Input id="lead-email" name="email" type="email" onBlur={check} autoComplete="email" />
        </Field>
        <Field id="lead-phone" label="Phone" error={fieldError("contact.phone")}>
          <Input id="lead-phone" name="phone" type="tel" onBlur={check} />
        </Field>
        <Field id="lead-whatsapp" label="WhatsApp" error={fieldError("contact.whatsapp")}>
          <Input id="lead-whatsapp" name="whatsapp" type="tel" onBlur={check} />
        </Field>
        <label className="flex items-center gap-2 self-end text-sm sm:pb-2">
          <input type="checkbox" name="isDecisionMaker" />
          This person decides
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-serif text-lg text-primary">Source and next step</legend>
        <Field id="lead-source" label="Source" error={fieldError("sourceId")}>
          <NativeSelect id="lead-source" name="sourceId" containerClassName="sm:w-full">
            <option value="">Not set</option>
            {form.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lead-source-note" label="Source note" hint="Met at stand B12, referred by…">
          <Input id="lead-source-note" name="sourceNote" />
        </Field>
        <Field id="lead-owner" label="Followed by" error={fieldError("ownerUserId")}>
          <NativeSelect
            id="lead-owner"
            name="ownerUserId"
            defaultValue={form.me}
            containerClassName="sm:w-full"
          >
            <option value="">Nobody yet</option>
            {form.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lead-next-kind" label="Next step">
          <NativeSelect
            id="lead-next-kind"
            name="nextActionKind"
            defaultValue="EMAIL"
            containerClassName="sm:w-full"
          >
            {Object.entries(NEXT_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lead-next-on" label="Next step on" error={fieldError("nextActionOn")}>
          <Input
            id="lead-next-on"
            name="nextActionOn"
            type="date"
            defaultValue={form.defaultNextOn}
          />
        </Field>
        <Field id="lead-next-note" label="Next step note">
          <Input id="lead-next-note" name="nextActionNote" placeholder="Send the catalogue" />
        </Field>
      </fieldset>

      {(matches.length > 0 || suppressed) && (
        <div
          role="status"
          className="grid gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/30"
        >
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlertIcon className="size-4" aria-hidden />
            Looks like one already there
          </p>
          {suppressed && (
            <p>
              This email or phone is on “Do not contact”: the lead is kept, but nobody contacts
              them.
            </p>
          )}
          <ul className="grid gap-1">
            {matches.map((m) => (
              <li key={`${m.kind}-${m.id}`} className="break-words">
                <Link
                  href={m.kind === "LEAD" ? `/sales/leads/${m.id}` : `/parties/buyers/${m.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {m.kind === "LEAD" ? "Lead" : "Buyer"} {m.label}
                </Link>{" "}
                <span className="text-muted-foreground">({m.why})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && !(error.code === "VALIDATION" && error.fieldErrors && !askAnyway) && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          Save the lead
        </Button>
        {askAnyway && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit(true)}>
            Save anyway
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href="/sales/leads">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
