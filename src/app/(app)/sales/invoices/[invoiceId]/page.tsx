import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BackLink } from "@/components/settings/back-link";
import { InvoiceBadge, RefundBadge } from "@/components/sales/badges";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { InvoiceActions } from "@/components/sales/invoice-actions";
import { METHOD_LABELS, money, salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { localDay } from "@/lib/dates";
import { formatCount, formatDay } from "@/lib/display";
import { getInvoiceScreenAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Invoice" };

/**
 * One commercial invoice (sales.view, like GET /api/sales/invoices/:id): what
 * was billed line by line, totals with paid and due, and the payments and
 * refunds on its order. What may be done comes with the screen (screen.can).
 */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const ctx = await requireCompanyPage();
  const { invoiceId } = await params;
  const result = await getInvoiceScreenAction(invoiceId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError title="Invoice" heading="The invoice could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { invoice: inv } = screen;
  const currency = ctx.company.currency;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/sales/invoices">All invoices</BackLink>
        <RecordHeader
          eyebrow={`Invoice ${inv.number} · ${formatDay(inv.issuedOn)}`}
          title={inv.buyer.name}
          badges={
            <>
              <InvoiceBadge status={inv.status} isOverdue={inv.isOverdue} />
              <span className="text-sm text-muted-foreground">
                For order{" "}
                <Link
                  href={salesHref.order(inv.order.id)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {inv.order.number}
                </Link>
                {inv.dueOn ? ` · due ${formatDay(inv.dueOn)}` : ""}
              </span>
            </>
          }
        />
        {inv.status === "VOID" && (
          <FormAlert tone="note">
            This invoice was voided; the buyer does not owe it. It is kept as a record.
          </FormAlert>
        )}
        <InvoiceActions
          key={inv.id}
          screen={screen}
          currency={currency}
          today={localDay(new Date(), ctx.company.timezone)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Billed" id="items-heading">
            <p className="mt-1 text-sm text-muted-foreground">
              {formatCount(inv.pieces, currency)} pieces
            </p>
            <ul className="mt-4 grid grid-cols-1 divide-y">
              {inv.items.map((item) => (
                <li
                  key={item.key}
                  className="flex min-w-0 items-start justify-between gap-4 py-2.5 first:pt-0"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium break-words">
                      {item.style} · {item.color} · {item.size}
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground">{item.sku}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <p className="text-muted-foreground">
                      {item.quantity} × {money(item.unitPrice, currency)}
                    </p>
                    <p className="font-medium">{money(item.lineTotal, currency)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Totals
              className="mt-5 border-t pt-4 sm:ml-auto sm:max-w-sm"
              currency={currency}
              lines={[
                { label: "Subtotal", amount: inv.subtotal },
                { label: "Discount", amount: inv.discount, minus: true, optional: true },
                { label: "Delivery charge", amount: inv.shippingCharge, optional: true },
                { label: "Tax / VAT", amount: inv.tax, optional: true },
                { label: "Total", amount: inv.total, strong: true },
                { label: "Paid", amount: inv.paid, tone: "muted" },
                { label: "Due", amount: inv.due, strong: true, tone: "due" },
              ]}
            />
          </Panel>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Billed to"
            id="buyer-heading"
            action={
              screen.can.openBuyer && inv.buyer.id ? (
                <Link
                  href={salesHref.buyer(inv.buyer.id)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Profile
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Name">
                {inv.buyer.code ? `${inv.buyer.name} (${inv.buyer.code})` : inv.buyer.name}
              </Fact>
              {(inv.buyer.contactPerson || inv.buyer.phone) && (
                <Fact label="Contact">
                  {[inv.buyer.contactPerson, inv.buyer.phone].filter(Boolean).join(" · ")}
                </Fact>
              )}
              {inv.buyer.address && (
                <Fact label="Address">
                  <span className="whitespace-pre-line">{inv.buyer.address}</span>
                </Fact>
              )}
              {inv.buyer.taxId && <Fact label="BIN / tax ID">{inv.buyer.taxId}</Fact>}
            </dl>
          </Panel>
          <Panel title="Payments" id="payments-heading">
            {inv.payments.length === 0 && inv.refunds.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Nothing was paid on it yet.</p>
            ) : (
              <ul className="mt-4 grid grid-cols-1 divide-y">
                {inv.payments.map((p) => (
                  <li
                    key={p.number}
                    className="flex min-w-0 items-start justify-between gap-4 py-2.5 first:pt-0"
                  >
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{p.number}</p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {[formatDay(p.paidOn), METHOD_LABELS[p.method], p.reference]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                      {money(p.amount, currency)}
                    </p>
                  </li>
                ))}
                {inv.refunds.map((r) => (
                  <li
                    key={r.number}
                    className="flex min-w-0 items-start justify-between gap-4 py-2.5 first:pt-0"
                  >
                    <div className="min-w-0 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {r.number}
                        <RefundBadge kind={r.kind} />
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {formatDay(r.refundedOn)}
                      </p>
                    </div>
                    <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                      − {money(r.amount, currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
