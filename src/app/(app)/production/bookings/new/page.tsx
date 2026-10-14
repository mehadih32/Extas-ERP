import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BookingWizard } from "@/components/production/booking-wizard";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getBookingFormAction } from "@/server/actions/booking.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New booking" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;

/**
 * A new booking (production.bookings.supplier or .market, as createBookingAction): on its own, or
 * for a master batch (?batch=) with the batch's fabric still to order, its
 * garment colours in the collar matrix and its other materials a tap away.
 */
export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.bookings.supplier") && !ctx.can("production.bookings.market")) {
    return (
      <ProductionNoAccess title="Booking fabric is not part of your role">
        Making bookings is in Production &gt; Bookings &gt; Add bookings. Your administrator can
        give you that permission.
      </ProductionNoAccess>
    );
  }
  const batchId = one((await searchParams).batch);
  const result = await getBookingFormAction(batchId ? { batchId } : {});
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT" && batchId) {
      return (
        <div className="grid max-w-3xl gap-6">
          <BackLink href={productionHref.batch(batchId)}>Back to the batch</BackLink>
          <FormAlert tone="note">
            {result.error.message} Or make the booking on its own and attach it later:{" "}
            <Link
              href={productionHref.newBooking()}
              className="font-medium underline underline-offset-4"
            >
              New booking
            </Link>
            .
          </FormAlert>
        </div>
      );
    }
    return (
      <SectionError
        title="New booking"
        heading="The booking form could not load"
        error={result.error}
      />
    );
  }
  const form = result.data;
  return (
    <div className="grid max-w-5xl gap-6">
      <BackLink href={form.batch ? productionHref.batch(form.batch.id) : productionHref.bookings()}>
        {form.batch ? `${form.batch.code} · ${form.batch.name}` : "All bookings"}
      </BackLink>
      <div>
        {form.batch && <p className="eyebrow">{form.batch.code}</p>}
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">
          {form.batch ? "Book the batch's fabric" : "New booking"}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Five short steps: the kind of booking, the fabric, the trims, the collar and cuff matrix,
          and the terms. Nothing is saved until the last step.
        </p>
      </div>
      <BookingWizard form={form} currency={ctx.company.currency} />
    </div>
  );
}
