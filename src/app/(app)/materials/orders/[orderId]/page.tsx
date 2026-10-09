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
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { getOrderScreenAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Purchase order" };

const linkClass = "text-primary underline-offset-4 hover:underline";
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
        <OrderActions key={o.id} screen={screen} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Materials" id="lines-heading">
            <ul className="mt-4 grid divide-y">
              {o.lines.map((l) => {
                const q = (text: string) => quantity(text, l.unit, currency);
                const pending = /[1-9]/.test(l.pending);
                return (
                  <li key={l.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={materialsHref.material(l.material.id)}
                        className={`min-w-0 text-sm font-medium break-words ${linkClass}`}
                      >
                        {l.material.code} · {l.material.name}
                      </Link>
                      {seeCosts && l.amount && (
                        <span className="text-sm whitespace-nowrap tabular-nums">
                          {money(l.amount, currency)}
                        </span>
                      )}
                    </div>
                    <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                      {q(l.quantity)} ordered
                      {seeCosts && l.unitPrice
                        ? ` at ${perUnit(l.unitPrice, l.unit, currency)}`
                        : ""}
                    </p>
                    <p className="text-sm tabular-nums">
                      {q(l.received)} in
                      {pending && !ended ? (
                        <span className="text-muted-foreground"> · {q(l.pending)} to come</span>
                      ) : pending ? (
                        <span className="text-muted-foreground"> · {q(l.pending)} not coming</span>
                      ) : null}
                    </p>
                    {l.description && (
                      <p className="text-[0.8125rem] break-words text-muted-foreground">
                        {l.description}
                      </p>
                    )}
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
          </Panel>

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
              <Fact label="For the project">
                {o.project ? (
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
