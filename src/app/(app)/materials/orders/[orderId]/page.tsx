import { FileDownIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge, OrderBadge } from "@/components/materials/badges";
import { materialsHref, perUnit, quantity } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { OrderActions } from "@/components/materials/order-actions";
import { BillBadge } from "@/components/production/badges";
import { productionHref } from "@/components/production/labels";
import { MaterialThumb } from "@/components/production/material-thumb";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import type { OrderScreen } from "@/modules/materials/screens.service";
import { getOrderScreenAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Purchase order" };

const linkClass = "text-primary underline-offset-4 hover:underline";

type Share = OrderScreen["order"]["lines"][number]["shares"][number];

/** A line's shares by style and colour, with the sizes inside each when it is split by size. */
function styleColours(shares: Share[]) {
  const groups = new Map<
    string,
    {
      key: string;
      project: Share["project"];
      colorName: string | null;
      total: string;
      sizes: Array<{ sizeName: string; quantity: string }>;
    }
  >();
  for (const sh of shares) {
    const key = `${sh.project.id}|${sh.colorName ?? ""}`;
    const group = groups.get(key) ?? {
      key,
      project: sh.project,
      colorName: sh.colorName,
      total: "0",
      sizes: [],
    };
    // Three decimals at most, so adding in thousandths stays exact.
    group.total = String(Math.round((Number(group.total) + Number(sh.quantity)) * 1000) / 1000);
    if (sh.sizeName) group.sizes.push({ sizeName: sh.sizeName, quantity: sh.quantity });
    groups.set(key, group);
  }
  return [...groups.values()];
}
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One purchase order (materials.view, like GET /api/materials/purchase-orders/:id):
 * each material with what has arrived and what is still to come, the bills
 * the goods came on, and receiving, changing, closing or cancelling it as this
 * person may. Prices show to people who see material prices.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const result = await getOrderScreenAction(orderId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <MaterialsNoAccess />;
    return <SectionError title="Order" heading="The order could not load" error={result.error} />;
  }
  const screen = result.data;
  const { order: o, seeCosts, can } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `${o.number} was raised. Send it to ${o.supplier.name}.`
      : one(query.saved) === "1"
        ? `${o.number} was saved.`
        : undefined;
  const ended = o.status === "CLOSED" || o.status === "CANCELLED";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={materialsHref.orders}>All orders</BackLink>
        <RecordHeader
          eyebrow={`Purchase order ${o.number} · ${formatDay(o.orderedOn)}`}
          title={o.supplier.name}
          badges={
            <>
              <OrderBadge status={o.status} />
              {o.isOverdue && <FlagBadge>Late</FlagBadge>}
              {o.expectedOn && !ended && (
                <span className="text-sm text-muted-foreground">
                  Expected {formatDay(o.expectedOn)}
                </span>
              )}
            </>
          }
        />
        {ended && o.closedReason && (
          <FormAlert tone="note">
            {o.status === "CANCELLED" ? "Cancelled" : "Closed"}
            {o.closedOn ? ` on ${formatDay(o.closedOn)}` : ""}: {o.closedReason}
          </FormAlert>
        )}
        {!ended && o.awaitingApproval && o.bookingId && (
          <FormAlert tone="note">
            This booking is a draft waiting for approval: its goods are received once it is approved
            on{" "}
            <Link href={productionHref.booking(o.bookingId)} className={linkClass}>
              the booking
            </Link>
            .
          </FormAlert>
        )}
        <OrderActions key={o.id} screen={screen} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Materials"
            id="lines-heading"
            action={
              <Button asChild variant="outline" size="sm">
                <a href={`/api/materials/purchase-orders/${encodeURIComponent(o.id)}/pdf`} download>
                  <FileDownIcon aria-hidden />
                  Print order (PDF)
                </a>
              </Button>
            }
          >
            <ul className="mt-4 grid divide-y">
              {o.lines.map((l) => {
                const q = (text: string) => quantity(text, l.unit, currency);
                const pending = /[1-9]/.test(l.pending);
                return (
                  <li key={l.id} className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
                    <MaterialThumb imageId={l.imageId} alt={l.material.name} />
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={materialsHref.material(l.material.id)}
                          className={`min-w-0 text-sm font-medium break-words ${linkClass}`}
                        >
                          {l.material.code} · {l.material.name}
                        </Link>
                        {seeCosts && l.amount && !l.priceLater && (
                          <span className="text-sm whitespace-nowrap tabular-nums">
                            {money(l.amount, currency)}
                          </span>
                        )}
                      </div>
                      <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                        {q(l.quantity)} ordered
                        {l.priceLater
                          ? " · price at receive"
                          : seeCosts && l.unitPrice
                            ? ` at ${perUnit(l.unitPrice, l.unit, currency)}`
                            : ""}
                      </p>
                      <p className="text-sm tabular-nums">
                        {q(l.received)} in
                        {pending && !ended ? (
                          <span className="text-muted-foreground"> · {q(l.pending)} to come</span>
                        ) : pending ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {q(l.pending)} not coming
                          </span>
                        ) : null}
                      </p>
                      {l.description && (
                        <p className="text-[0.8125rem] break-words text-muted-foreground">
                          {l.description}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {seeCosts && o.total && (
              <Totals
                className="mt-4 border-t pt-4"
                currency={currency}
                lines={[{ label: "Order total", amount: o.total, strong: true }]}
              />
            )}
            {o.pricesLater > 0 && (
              <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                {o.pricesLater === 1 ? "One line is" : `${o.pricesLater} lines are`} priced at
                receive: the agreed price is entered when the goods arrive
                {seeCosts && o.total ? ", and the total counts it from then" : ""}.
              </p>
            )}
          </Panel>

          {o.lines.some((l) => l.shares.length > 0) && (
            <Panel title="By style" id="shares-heading">
              <p className="mt-1 text-sm text-muted-foreground">
                What each line is for. The printed order carries this breakdown and the colour and
                size matrix for collars and cuffs.
              </p>
              <ul className="mt-4 grid gap-4">
                {o.lines
                  .filter((l) => l.shares.length > 0)
                  .map((l) => (
                    <li key={l.id} className="grid gap-1.5">
                      <p className="text-sm font-medium">
                        {l.material.code} · {l.material.name}
                      </p>
                      <ul className="grid gap-0.5 text-[0.8125rem] text-muted-foreground tabular-nums sm:grid-cols-2">
                        {styleColours(l.shares).map((g) => (
                          <li key={g.key} className="min-w-0 break-words">
                            {g.project.href ? (
                              <Link href={g.project.href} className={linkClass}>
                                {g.project.code}
                              </Link>
                            ) : (
                              g.project.code
                            )}
                            {g.colorName ? ` · ${g.colorName}` : ""}:{" "}
                            {quantity(g.total, l.unit, currency)}
                            {g.sizes.length > 0 &&
                              ` (${g.sizes.map((z) => `${z.sizeName} ${z.quantity}`).join(" · ")})`}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </Panel>
          )}

          <Panel title="Goods received" id="bills-heading">
            {o.bills.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Nothing has arrived on it yet.</p>
            ) : (
              <ul className="mt-4 grid divide-y">
                {o.bills.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {b.href ? (
                          <Link href={b.href} className={linkClass}>
                            {b.number}
                          </Link>
                        ) : (
                          b.number
                        )}
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {formatDay(b.billOn)}
                        {b.supplierRef ? ` · their no. ${b.supplierRef}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <BillBadge status={b.status} />
                      {seeCosts && b.total && (
                        <span className="text-sm whitespace-nowrap tabular-nums">
                          {money(b.total, currency)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Supplier"
            id="supplier-heading"
            action={
              can.openParty ? (
                <Link
                  href={materialsHref.supplier(o.supplier.id)}
                  className={`text-sm ${linkClass}`}
                >
                  Account
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Supplier">{`${o.supplier.name} (${o.supplier.code})`}</Fact>
              {o.supplier.phone && <Fact label="Phone">{o.supplier.phone}</Fact>}
              {o.supplierRef && <Fact label="Their reference">{o.supplierRef}</Fact>}
            </dl>
          </Panel>
          <Panel title="Details" id="details-heading">
            <dl className="mt-4 grid gap-4">
              {o.bookingId && (
                <Fact label="Booking">
                  <Link href={productionHref.booking(o.bookingId)} className={linkClass}>
                    Open the booking
                  </Link>
                  <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                    Its specification, collar and cuff matrix, terms and PDF.
                  </span>
                </Fact>
              )}
              {o.batch && (
                <Fact label="For the master batch">
                  {o.batch.href ? (
                    <Link href={o.batch.href} className={linkClass}>
                      {o.batch.code} · {o.batch.name}
                    </Link>
                  ) : (
                    `${o.batch.code} · ${o.batch.name}`
                  )}
                </Fact>
              )}
              <Fact label="For the project">
                {o.batch && !o.project ? (
                  "Shared by its styles"
                ) : o.project ? (
                  o.project.href ? (
                    <Link href={o.project.href} className={linkClass}>
                      {o.project.code} · {o.project.name}
                    </Link>
                  ) : (
                    `${o.project.code} · ${o.project.name}`
                  )
                ) : (
                  "General stock"
                )}
              </Fact>
              <Fact label="Ordered on">{formatDay(o.orderedOn)}</Fact>
              <Fact label="Expected by">{o.expectedOn ? formatDay(o.expectedOn) : "Not set"}</Fact>
              {o.createdBy && <Fact label="Raised by">{o.createdBy}</Fact>}
              {o.notes && (
                <Fact label="Notes">
                  <span className="whitespace-pre-line">{o.notes}</span>
                </Fact>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
