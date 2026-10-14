"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

/*
 * Booking Server Actions (Production > Bookings). Each returns { ok: true, data }
 * or { ok: false, error }.
 *   production.view, materials.view   see bookings (prices as the material-cost rule)
 *   materials.purchase                make, change, cancel and close them
 *   materials.purchase, production.manage   attach them to a batch and take them off
 * Changes refresh the screens and hand back the booking's id and number only.
 */

const see = () => requireAnyPermission("production.view", "materials.view", "materials.purchase");
const buy = () => requirePermission("materials.purchase");
const attach = () => requireAnyPermission("materials.purchase", "production.manage");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const ref = (b: { id: string; number: string }) => ({ id: b.id, number: b.number });

export const listBookingsAction = async (query: unknown = {}) =>
  runAction(async () => bookings.listBookings(await see(), query));

export const getBookingAction = async (bookingId: string) =>
  runAction(async () => bookings.getBooking(await see(), bookingId));

export const getBookingFormAction = async (from: { bookingId?: string; batchId?: string } = {}) =>
  runAction(async () => bookings.getBookingForm(await buy(), from));

export const getBatchBookingsAction = async (batchId: string) =>
  runAction(async () => bookings.getBatchBookings(await see(), batchId));

export const listAttachableBatchesAction = async () =>
  runAction(async () => bookings.listAttachableBatches(await attach()));

/** Also says how the goods went in when a market purchase was added to stock as it was saved. */
export const createBookingAction = async (input: unknown) =>
  change(async () => {
    const booking = await bookings.createBooking(await buy(), input, await getRequestMeta());
    const into = booking.intoStock;
    /** null: not asked; true: in the store on a Due bill; false: saved, waiting to be received. */
    const stocked: boolean | null = into ? "bill" in into : null;
    return { ...ref(booking), stocked };
  });

export const updateBookingAction = async (bookingId: string, input: unknown) =>
  change(async () =>
    ref(await bookings.updateBooking(await buy(), bookingId, input, await getRequestMeta())),
  );

export const updateBookingPaperworkAction = async (bookingId: string, input: unknown) =>
  change(async () =>
    ref(
      await bookings.updateBookingPaperwork(await buy(), bookingId, input, await getRequestMeta()),
    ),
  );

export const cancelBookingAction = async (bookingId: string, input: unknown) =>
  change(async () =>
    ref(await bookings.cancelBooking(await buy(), bookingId, input, await getRequestMeta())),
  );

export const closeBookingAction = async (bookingId: string, input: unknown) =>
  change(async () =>
    ref(await bookings.closeBooking(await buy(), bookingId, input, await getRequestMeta())),
  );

export const attachBookingAction = async (bookingId: string, input: unknown) =>
  change(async () => {
    const done = await bookings.attachBooking(
      await attach(),
      bookingId,
      input,
      await getRequestMeta(),
    );
    return { ...ref(done.booking), unmatched: done.unmatched };
  });

export const detachBookingAction = async (bookingId: string) =>
  change(async () =>
    ref(await bookings.detachBooking(await attach(), bookingId, await getRequestMeta())),
  );
