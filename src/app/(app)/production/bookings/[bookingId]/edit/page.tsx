import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BookingPaperworkForm } from "@/components/production/booking-paperwork-form";
import { BookingWizard } from "@/components/production/booking-wizard";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getBookingFormAction } from "@/server/actions/booking.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change booking" };

/**
 * Changing a booking (the permission for its kind): the whole wizard while nothing has
 * arrived on it (as updateBookingAction), only its paperwork once goods have
 * (as updateBookingPaperworkAction), and nothing once it is closed.
 */
export default async function EditBookingPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.bookings.supplier") && !ctx.can("production.bookings.market")) {
    return (
      <ProductionNoAccess title="Changing bookings is not part of your role">
        Changing bookings is in Production &gt; Bookings &gt; Add bookings. Your administrator can
        give you that permission.
      </ProductionNoAccess>
    );
  }
  const { bookingId } = await params;
  const result = await getBookingFormAction({ bookingId });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Booking" heading="The booking could not load" error={result.error} />
    );
  }
  const form = result.data;
  const booking = form.booking!;
  return (
    <div className="grid max-w-5xl gap-6">
      <BackLink href={productionHref.booking(booking.id)}>{booking.number}</BackLink>
      <div>
        <p className="eyebrow">{booking.number}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">
          {booking.canChangeItems ? "Change the booking" : "Change the paperwork"}
        </h2>
        {!booking.canChangeItems && booking.canChangePaperwork && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Goods have arrived on it, so its items stay as they are. The dates, references and terms
            can still change.
          </p>
        )}
      </div>
      {booking.canChangeItems ? (
        <BookingWizard form={form} currency={ctx.company.currency} />
      ) : booking.canChangePaperwork ? (
        <BookingPaperworkForm form={form} />
      ) : (
        <FormAlert tone="note">
          {booking.number} is no longer open, so it cannot change. Print it as it is from its page.
        </FormAlert>
      )}
    </div>
  );
}
