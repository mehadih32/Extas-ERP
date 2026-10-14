"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BookingForm } from "@/modules/production/booking.service";
import { updateBookingPaperworkAction } from "@/server/actions/booking.actions";

import { buildPaperwork, type Draft, startDraft } from "./booking-draft";
import { TermsEditor } from "./booking-terms-editor";
import { productionHref } from "./labels";

/**
 * The paperwork of a booking goods have arrived on (buyers): the delivery day,
 * the references, where to deliver, the payment terms, the terms and their
 * language and the notes. Its items, supplier and matrix stay as they are.
 */
export function BookingPaperworkForm({ form: data }: { form: BookingForm }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const [draft, setDraft] = useState<Draft>(() => startDraft(data));
  const booking = data.booking!;
  const update = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { input, problems } = buildPaperwork(draft, booking.orderDate);
    form.setProblems(problems);
    form.setError(undefined);
    if (Object.keys(problems).length > 0) return;
    form.startTransition(async () => {
      const result = await updateBookingPaperworkAction(booking.id, input);
      if (!result.ok) return form.setError(result.error);
      router.push(`${productionHref.booking(booking.id)}?saved=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="paper-expected" label="Deliver by (optional)" error={fieldError("expectedDate")}>
          <Input
            id="paper-expected"
            type="date"
            min={booking.orderDate}
            value={draft.expectedDate}
            onChange={(e) => update({ expectedDate: e.target.value })}
            aria-invalid={Boolean(fieldError("expectedDate"))}
          />
        </Field>
        <Field
          id="paper-ref"
          label="Supplier's reference (optional)"
          error={fieldError("supplierRef")}
        >
          <Input
            id="paper-ref"
            value={draft.supplierRef}
            onChange={(e) => update({ supplierRef: e.target.value })}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <Field id="paper-title" label="Title (optional)" error={fieldError("title")}>
          <Input
            id="paper-title"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            maxLength={160}
            autoComplete="off"
          />
        </Field>
        <Field id="paper-style" label="Style reference (optional)" error={fieldError("styleRef")}>
          <Input
            id="paper-style"
            value={draft.styleRef}
            onChange={(e) => update({ styleRef: e.target.value })}
            maxLength={80}
            autoComplete="off"
          />
        </Field>
        <Field
          id="paper-payment"
          label="Payment terms (optional)"
          error={fieldError("paymentTerms")}
        >
          <Input
            id="paper-payment"
            value={draft.paymentTerms}
            onChange={(e) => update({ paymentTerms: e.target.value })}
            maxLength={300}
            autoComplete="off"
          />
        </Field>
        <Field id="paper-place" label="Deliver to (optional)" error={fieldError("deliveryPlace")}>
          <Textarea
            id="paper-place"
            value={draft.deliveryPlace}
            onChange={(e) => update({ deliveryPlace: e.target.value })}
            maxLength={300}
            className="min-h-11"
          />
        </Field>
      </div>
      <TermsEditor
        source={draft.source}
        category={draft.category}
        collar={draft.collar.on}
        language={draft.termsLanguage}
        terms={draft.terms}
        onChange={({ language, terms }) => update({ termsLanguage: language, terms })}
        error={fieldError("terms")}
      />
      <Field id="paper-notes" label="Notes (optional)" error={fieldError("notes")}>
        <Textarea
          id="paper-notes"
          value={draft.notes}
          onChange={(e) => update({ notes: e.target.value })}
          maxLength={2000}
        />
      </Field>
      <FormFooter
        form={form}
        cancelHref={productionHref.booking(booking.id)}
        submitLabel="Save the paperwork"
        errorTitle="We could not save the booking"
      />
    </form>
  );
}
