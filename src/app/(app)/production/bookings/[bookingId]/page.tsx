import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { materialsHref, perUnit, quantity } from "@/components/materials/labels";
import { BookingActions } from "@/components/production/booking-actions";
import { BookingApproval } from "@/components/production/booking-approval";
import { BookingBadges } from "@/components/production/booking-bits";
import { productionHref } from "@/components/production/labels";
import { MaterialThumb } from "@/components/production/material-thumb";
import { ProductionNoAccess } from "@/components/production/no-access";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { pdfOrientationFor } from "@/modules/documents/book-frame";
import { specsText } from "@/modules/production/booking-math";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  COLLAR_STYLE_LABELS,
  ROLE_LABELS,
  SOURCE_LABELS,
} from "@/modules/production/booking-presets";
import type { Booking } from "@/modules/production/booking.service";
import { splitTerm, termLines } from "@/modules/production/booking-terms";
import { getBookingAction } from "@/server/actions/booking.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Booking" };

const linkClass = "text-primary underline-offset-4 hover:underline";

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const count = (n: number) => n.toLocaleString("en");

type Line = Booking["lines"][number];

/** A line's shares by style and colour: "PL-01 · Navy: 120 kg". */
function shareText(l: Line, currency: string) {
  const groups = new Map<string, { label: string; total: number }>();
  for (const s of l.shares) {
    const label = `${s.project.code}${s.colorName ? ` · ${s.colorName}` : ""}`;
    const group = groups.get(label) ?? { label, total: 0 };
    // Three decimals at most, so adding in thousandths stays exact.
    group.total = Math.round((group.total + Number(s.quantity)) * 1000) / 1000;
    groups.set(label, group);
  }
  return [...groups.values()].map(
    (g) => `${g.label}: ${quantity(String(g.total), l.material.unit, currency)}`,
  );
}

function LineRow({
  l,
  booking,
  currency,
  seeCosts,
  openMaterial,
}: {
  l: Line;
  booking: Booking;
  currency: string;
  seeCosts: boolean;
  openMaterial: boolean;
}) {
  const q = (text: string) => quantity(text, l.material.unit, currency);
  const ended = booking.status === "CLOSED" || booking.status === "CANCELLED";
  const pending = /[1-9]/.test(l.pending);
  const spec = specsText(l.specs, booking.category);
  return (
    <li className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
      <MaterialThumb imageId={l.imageId} alt={l.material.name} />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-medium break-words">
            {openMaterial ? (
              <Link href={materialsHref.material(l.material.id)} className={linkClass}>
                {l.material.code} · {l.material.name}
              </Link>
            ) : (
              `${l.material.code} · ${l.material.name}`
            )}
          </p>
          {seeCosts && l.amount && !l.priceLater && (
            <span className="text-sm whitespace-nowrap tabular-nums">
              {money(l.amount, currency)}
            </span>
          )}
        </div>
        <p className="text-[0.8125rem] break-words text-muted-foreground">
          {[ROLE_LABELS[l.role], l.specs.colour, spec || null].filter(Boolean).join(" · ")}
        </p>
        <p className="text-sm tabular-nums">
          {q(l.quantity)} booked
          {l.priceLater
            ? " · price at receive"
            : seeCosts && l.unitPrice
              ? ` at ${perUnit(l.unitPrice, l.material.unit, currency)}`
              : ""}
        </p>
        {l.specs.pieces && l.specs.perDozen ? (
          <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
            For {count(l.specs.pieces)} pieces at {l.specs.perDozen} a dozen +{" "}
            {l.specs.lossPercent ?? 0}% loss
          </p>
        ) : null}
        <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
          {q(l.receivedQty)} in
          {pending ? ` · ${q(l.pending)} ${ended ? "not coming" : "to come"}` : ""}
        </p>
        {l.description && (
          <p className="text-[0.8125rem] break-words text-muted-foreground">{l.description}</p>
        )}
      </div>
    </li>
  );
}

/**
 * One booking (any booking permission, like GET
 * /api/production/bookings/:id): its fabric and trims with their
 * specification, the collar and cuff matrix, the style-wise breakdown on a
 * batch and the terms, with printing, changing, attaching, receiving, closing
 * and cancelling as this person may. Prices follow the material-cost rule.
 */
export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const result = await getBookingAction(bookingId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Booking" heading="The booking could not load" error={result.error} />
    );
  }
  const b = result.data;
  const orientation = await pdfOrientationFor(ctx);
  const currency = ctx.company.currency;
  const seeCosts = b.totalAmount !== null;
  const openMaterial = ctx.can("materials.view");
  const ended = b.status === "CLOSED" || b.status === "CANCELLED";
  const fabric = b.lines.filter((l) => l.role === "FABRIC");
  const trims = b.lines.filter((l) => l.role !== "FABRIC");
  const shared = b.lines.filter((l) => l.shares.length > 0);
  const priceLater = b.lines.filter((l) => l.priceLater).length;
  const stock = one(query.created) === "1" ? one(query.stock) : undefined;
  const notice =
    stock === "1"
      ? `${b.number} was saved and its goods are in the main store. The bill is Due to ${b.supplier.name}, and Accounts pays it.`
      : one(query.created) === "1"
        ? b.stage === "DRAFT"
          ? `${b.number} was saved as a draft. Once it is approved, print the PDF and send it to ${b.supplier.name}.`
          : `${b.number} was saved. Print the PDF and send it to ${b.supplier.name}.`
        : one(query.saved) === "1"
          ? b.stage === "DRAFT" && b.revision > 0
            ? `${b.number} was saved as draft ${b.docNo}: approve it, then send it to ${b.supplier.name}.`
            : `${b.number} was saved. Print the PDF again for ${b.supplier.name}.`
          : undefined;
  const terms = termLines(b.terms).map(splitTerm);
  const c = b.collar;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={productionHref.bookings()}>All bookings</BackLink>
        <RecordHeader
          eyebrow={`Booking ${b.revision > 0 ? b.docNo : b.number} · ${formatDay(b.orderDate)}`}
          title={b.title || b.supplier.name}
          badges={
            <>
              <BookingBadges
                status={b.status}
                stage={b.stage}
                revision={b.revision}
                source={b.source}
                late={b.isOverdue}
              />
              {b.expectedDate && !ended && (
                <span className="text-sm text-muted-foreground">
                  Deliver by {formatDay(b.expectedDate)}
                </span>
              )}
            </>
          }
        />
        {ended && b.closedReason && (
          <FormAlert tone="note">
            {b.status === "CANCELLED" ? "Cancelled" : "Closed"}: {b.closedReason}
          </FormAlert>
        )}
        {stock === "0" && b.can.receive && (
          <FormAlert>
            {b.number} was saved, but its goods could not go into stock. Add them with “Receive the
            goods”.
          </FormAlert>
        )}
        <BookingActions key={b.id} booking={b} notice={notice} orientation={orientation} />
        <BookingApproval key={`${b.id}-${b.stage}-${b.revision}`} booking={b} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {fabric.length > 0 && (
            <Panel title={b.category === "SWEATER" ? "Yarn" : "Fabric"} id="fabric-heading">
              <ul className="mt-4 grid divide-y">
                {fabric.map((l) => (
                  <LineRow
                    key={l.id}
                    l={l}
                    booking={b}
                    currency={currency}
                    seeCosts={seeCosts}
                    openMaterial={openMaterial}
                  />
                ))}
              </ul>
            </Panel>
          )}
          {trims.length > 0 && (
            <Panel title="Trims & accessories" id="trims-heading">
              <ul className="mt-4 grid divide-y">
                {trims.map((l) => (
                  <LineRow
                    key={l.id}
                    l={l}
                    booking={b}
                    currency={currency}
                    seeCosts={seeCosts}
                    openMaterial={openMaterial}
                  />
                ))}
              </ul>
            </Panel>
          )}
          {seeCosts && b.totalAmount && (
            <div className="rounded-lg border bg-card p-5 sm:p-6">
              <Totals
                currency={currency}
                lines={[{ label: "Booking total", amount: b.totalAmount, strong: true }]}
              />
              {priceLater > 0 && (
                <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                  {priceLater === 1 ? "One item is" : `${priceLater} items are`} priced at receive:
                  the agreed price is entered when the goods arrive.
                </p>
              )}
            </div>
          )}

          {c && (
            <Panel title="Collar & cuff matrix" id="collar-heading">
              <p className="mt-1 text-sm text-muted-foreground">
                {COLLAR_STYLE_LABELS[c.style]} · {count(c.totalPieces)} garment pieces +{" "}
                {c.extraPercent}% ={" "}
                <strong className="text-foreground">{count(c.totalSets)} sets</strong>
              </p>
              {/* Phones: a card a colour, each size group on its own line. */}
              <ul className="mt-4 grid gap-3 tabular-nums sm:hidden" aria-label="Sets by colour">
                {c.colours.map((row, i) => (
                  <li key={row.id} className="rounded-md border px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 text-sm font-medium break-words">
                        {row.garmentColour}
                        {(row.collarColour !== row.garmentColour || row.tippingColour) && (
                          <span className="block text-[0.75rem] font-normal text-muted-foreground">
                            Collar {row.collarColour}
                            {row.tippingColour ? ` · tipping ${row.tippingColour}` : ""}
                          </span>
                        )}
                      </p>
                      <p className="shrink-0 text-sm font-semibold">
                        {count(c.byColour[i] ?? 0)} sets
                      </p>
                    </div>
                    <dl className="mt-2 grid gap-1 text-[0.8125rem]">
                      {c.sizes.map((s, j) => (
                        <div key={s.id} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">
                            {s.label}{" "}
                            <span className="text-[0.75rem]">
                              ({s.collarLength}×{s.collarWidth}
                              {s.cuffLength && s.cuffWidth
                                ? ` · ${s.cuffLength}×${s.cuffWidth}`
                                : ""}
                              )
                            </span>
                          </dt>
                          <dd>
                            {row.sets[j] ? `${count(row.sets[j]!)} sets` : "–"}
                            {row.pieces[j] ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {count(row.pieces[j]!)} pcs
                              </span>
                            ) : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
                <li className="flex justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold text-primary">{count(c.totalSets)} sets</span>
                </li>
              </ul>
              <div className="mt-4 hidden overflow-x-auto rounded-md border sm:block">
                <table className="w-full min-w-[26rem] text-sm tabular-nums">
                  <caption className="sr-only">Sets by garment colour and size group</caption>
                  <thead className="bg-muted/50 text-[0.8125rem] text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Colour
                      </th>
                      {c.sizes.map((s) => (
                        <th key={s.id} scope="col" className="px-3 py-2 text-right font-medium">
                          {s.label}
                          <span className="block text-xs font-normal">
                            {s.collarLength}×{s.collarWidth}
                            {s.cuffLength && s.cuffWidth ? ` · ${s.cuffLength}×${s.cuffWidth}` : ""}
                          </span>
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Sets
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {c.colours.map((row, i) => (
                      <tr key={row.id}>
                        <th scope="row" className="px-3 py-2 text-left font-medium">
                          {row.garmentColour}
                          {(row.collarColour !== row.garmentColour || row.tippingColour) && (
                            <span className="block text-[0.75rem] font-normal text-muted-foreground">
                              Collar {row.collarColour}
                              {row.tippingColour ? ` · tipping ${row.tippingColour}` : ""}
                            </span>
                          )}
                        </th>
                        {row.sets.map((n, j) => (
                          <td key={c.sizes[j]!.id} className="px-3 py-2 text-right">
                            {n ? count(n) : "–"}
                            {row.pieces[j] ? (
                              <span className="block text-xs text-muted-foreground">
                                {count(row.pieces[j]!)} pcs
                              </span>
                            ) : null}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-medium">
                          {count(c.byColour[i] ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-muted/30">
                    <tr>
                      <th scope="row" className="px-3 py-2 text-left">
                        Total
                      </th>
                      {c.bySize.map((n, j) => (
                        <td key={c.sizes[j]!.id} className="px-3 py-2 text-right font-medium">
                          {count(n)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold text-primary">
                        {count(c.totalSets)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                Measurements in cm: collar length × width, then the cuff.
              </p>
              {c.notes && <p className="mt-3 text-sm break-words whitespace-pre-line">{c.notes}</p>}
            </Panel>
          )}

          {shared.length > 0 && (
            <Panel title="By style" id="shares-heading">
              <p className="mt-1 text-sm text-muted-foreground">
                What each item is for on {b.batch?.code}: it counts as ordered for these styles and
                colours.
              </p>
              <ul className="mt-4 grid gap-4">
                {shared.map((l) => (
                  <li key={l.id} className="grid gap-1.5">
                    <p className="text-sm font-medium">
                      {l.material.code} · {l.material.name}
                    </p>
                    <ul className="grid gap-0.5 text-[0.8125rem] text-muted-foreground tabular-nums sm:grid-cols-2">
                      {shareText(l, currency).map((text) => (
                        <li key={text} className="min-w-0 break-words">
                          {text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            title={
              b.termsLanguage === "BN" ? "শর্তাবলি · Terms & conditions" : "Terms & conditions"
            }
            id="terms-heading"
          >
            <ol
              className="mt-4 grid gap-2.5 text-sm leading-relaxed"
              lang={b.termsLanguage === "BN" ? "bn" : "en"}
            >
              {terms.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-6 shrink-0 text-right text-muted-foreground tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="min-w-0 break-words">
                    {t.heading && <strong>{t.heading}: </strong>}
                    {t.text}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title={b.source === "MARKET_PURCHASE" ? "Seller" : "Supplier"}
            id="supplier-heading"
            action={
              ctx.can("parties.view") ? (
                <Link
                  href={productionHref.supplier(b.supplier.id)}
                  className={`text-sm ${linkClass}`}
                >
                  Account
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Name">
                {b.supplier.name}
                {b.supplier.code ? ` (${b.supplier.code})` : ""}
              </Fact>
              {b.supplier.contactPerson && <Fact label="Contact">{b.supplier.contactPerson}</Fact>}
              {b.supplier.phone && <Fact label="Phone">{b.supplier.phone}</Fact>}
              {(b.supplier.address || b.supplier.city) && (
                <Fact label="Address">
                  {[b.supplier.address, b.supplier.city].filter(Boolean).join(", ")}
                </Fact>
              )}
              {b.supplierRef && <Fact label="Their reference">{b.supplierRef}</Fact>}
            </dl>
          </Panel>
          <Panel title="Details" id="details-heading">
            <dl className="mt-4 grid gap-4">
              <Fact label="Source">{SOURCE_LABELS[b.source]}</Fact>
              <Fact label="Garment">
                {CATEGORY_LABELS[b.category]}
                <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                  {CATEGORY_HINTS[b.category]}
                </span>
              </Fact>
              <Fact label="Master batch">
                {b.batch ? (
                  <Link href={productionHref.batch(b.batch.id)} className={linkClass}>
                    {b.batch.code} · {b.batch.name}
                  </Link>
                ) : (
                  "Not on a batch"
                )}
              </Fact>
              {b.styleRef && <Fact label="Styles">{b.styleRef}</Fact>}
              {b.garmentPieces && <Fact label="Garment pieces">{count(b.garmentPieces)}</Fact>}
              <div className="grid grid-cols-2 gap-4">
                <Fact label="Booked on">{formatDay(b.orderDate)}</Fact>
                <Fact label="Deliver by">
                  {b.expectedDate ? formatDay(b.expectedDate) : "Not set"}
                </Fact>
              </div>
              {b.deliveryPlace && (
                <Fact label="Deliver to">
                  <span className="whitespace-pre-line">{b.deliveryPlace}</span>
                </Fact>
              )}
              {b.paymentTerms && <Fact label="Payment terms">{b.paymentTerms}</Fact>}
              {b.createdBy && <Fact label="Booked by">{b.createdBy.name}</Fact>}
              {openMaterial && (
                <Fact label="Purchase order">
                  <Link href={materialsHref.order(b.orderId)} className={linkClass}>
                    {b.number}
                  </Link>
                  <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                    The booking is also on the purchase orders, where its goods and bills show.
                  </span>
                </Fact>
              )}
              {b.notes && (
                <Fact label="Notes">
                  <span className="whitespace-pre-line">{b.notes}</span>
                </Fact>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
