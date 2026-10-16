import { PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { ORDER_STATUS_LABELS, ORDER_STATUSES } from "@/components/materials/labels";
import { EmptyState } from "@/components/products/bits";
import { SOURCE_SHORT } from "@/components/production/booking-bits";
import { BookingList, type BookingListQuery } from "@/components/production/booking-list";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  BOOKING_SOURCES,
  CATEGORY_LABELS,
  GARMENT_CATEGORIES,
} from "@/modules/production/booking-presets";
import { listBookingsAction } from "@/server/actions/booking.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Bookings" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;

const pick = <T extends string>(list: readonly T[], value: string | undefined) =>
  list.find((v) => v === value);

/**
 * Fabric and trims bookings, newest first (any booking permission, like GET
 * /api/production/bookings): supplier POs to a mill or trims house and ready
 * stock bought on the open market, by source, garment family and status.
 * Amounts follow the material-cost rule; making a booking needs
 * production.bookings.supplier or production.bookings.market.
 */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const query: BookingListQuery = {
    search: one(params.search)?.slice(0, 100),
    source: pick(BOOKING_SOURCES, one(params.source)),
    category: pick(GARMENT_CATEGORIES, one(params.category)),
    status: pick(ORDER_STATUSES, one(params.status)),
    batchId: one(params.batch),
  };
  const filters = Object.fromEntries(
    Object.entries(query).filter((e): e is [string, string] => Boolean(e[1])),
  ) as BookingListQuery;
  const result = await listBookingsAction(filters);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Bookings" heading="The bookings could not load" error={result.error} />
    );
  }
  const { items, nextCursor, can } = result.data;
  const filtered = Object.keys(filters).length > 0;
  const sourceHref = (source?: string) => {
    const next = new URLSearchParams(
      Object.entries({ ...filters, source }).filter((e): e is [string, string] => Boolean(e[1])),
    );
    if (filters.batchId) {
      next.delete("batchId");
      next.set("batch", filters.batchId);
    }
    const text = next.toString();
    return text ? `/production/bookings?${text}` : "/production/bookings";
  };

  return (
    <section aria-labelledby="bookings-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="bookings-heading" className="font-serif text-2xl text-primary">
            Bookings
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Fabric, yarn and trims booked from a mill or trims house, or bought ready off the
            market, with their specification, collar and cuff matrix and terms, printed for the
            supplier.
          </p>
        </div>
        {can.create && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={productionHref.newBooking()}>
              <PlusIcon aria-hidden />
              New booking
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-3">
        <nav aria-label="Booking source" className="flex flex-wrap gap-1.5">
          {[undefined, ...BOOKING_SOURCES].map((s) => (
            <Link
              key={s ?? "all"}
              href={sourceHref(s)}
              aria-current={query.source === s ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                query.source === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {s ? SOURCE_SHORT[s] : "All"}
            </Link>
          ))}
        </nav>
        <form
          action="/production/bookings"
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
          role="search"
        >
          {query.source && <input type="hidden" name="source" value={query.source} />}
          {query.batchId && <input type="hidden" name="batch" value={query.batchId} />}
          <label htmlFor="booking-search" className="sr-only">
            Find a booking
          </label>
          <Input
            id="booking-search"
            name="search"
            defaultValue={query.search ?? ""}
            placeholder="Booking no., supplier, title or style"
            autoComplete="off"
            className="min-w-0"
          />
          <label htmlFor="booking-category" className="sr-only">
            Garment
          </label>
          <NativeSelect id="booking-category" name="category" defaultValue={query.category ?? ""}>
            <option value="">All garments</option>
            {GARMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
          <label htmlFor="booking-status" className="sr-only">
            Status
          </label>
          <NativeSelect id="booking-status" name="status" defaultValue={query.status ?? ""}>
            <option value="">Any status</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline">
            <SearchIcon aria-hidden />
            Find
          </Button>
        </form>
        {query.batchId && (
          <p className="text-sm text-muted-foreground">
            Showing one batch&apos;s bookings.{" "}
            <Link
              href="/production/bookings"
              className="text-primary underline-offset-4 hover:underline"
            >
              Show all bookings
            </Link>
          </p>
        )}
      </div>

      {items.length === 0 ? (
        filtered ? (
          <EmptyState title="No bookings match">
            Try a booking number, the supplier or part of the title, or show all.
          </EmptyState>
        ) : (
          <EmptyState
            title="No bookings yet"
            action={
              can.create ? (
                <Button asChild>
                  <Link href={productionHref.newBooking()}>Make the first booking</Link>
                </Button>
              ) : undefined
            }
          >
            A booking tells the mill or the market seller exactly what to send: the fabric with its
            GSM, DIA or width, the collars and cuffs by size and colour, and the terms.
          </EmptyState>
        )
      ) : (
        <BookingList
          key={JSON.stringify(filters)}
          initial={{ items, nextCursor }}
          query={filters}
          currency={ctx.company.currency}
        />
      )}
    </section>
  );
}
