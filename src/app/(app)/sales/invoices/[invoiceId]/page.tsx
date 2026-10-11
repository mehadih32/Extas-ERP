import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BackLink } from "@/components/settings/back-link";
import { InvoiceBadge, RefundBadge, RevisedBadge } from "@/components/sales/badges";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { InvoiceActions } from "@/components/sales/invoice-actions";
import { invoiceTotalLines } from "@/components/sales/invoice-totals";
import { METHOD_LABELS, money, salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { localDay } from "@/lib/dates";
import { formatCount, formatDay } from "@/lib/display";
import { getInvoiceScreenAction } from "@/server/actions/sales.actions";
import { templateChoicesAction } from "@/server/actions/templates.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Invoice" };

/**
 * One commercial invoice (sales.view, like GET /api/sales/invoices/:id): what
 * was billed line by line, totals with paid and due, the packing list printed
 * as its page 2, and the payments and refunds on its order. What may be done
 * comes with the screen (screen.can).
 */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const ctx = await requireCompanyPage();
  const { invoiceId } = await params;
  const [result, templates] = await Promise.all([
    getInvoiceScreenAction(invoiceId),
    templateChoicesAction("COMMERCIAL_INVOICE"),
  ]);
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
              <RevisedBadge revision={inv.revision} />
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
        {inv.status !== "VOID" && inv.revisedOn && (
          <FormAlert tone="note">
            Edited after it was issued, last on {formatDay(inv.revisedOn)}. It keeps its number, and
            its PDF says &quot;(Revised)&quot;.
          </FormAlert>
        )}
        <InvoiceActions
          key={inv.id}
          screen={screen}
          currency={currency}
          today={localDay(new Date(), ctx.company.timezone)}
          templates={templates.ok ? templates.data : []}
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
              lines={invoiceTotalLines(inv)}
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
          <Panel title="Packing list" id="packing-heading">
            {inv.packingList ? (
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <Fact label="Number">{inv.packingList.number}</Fact>
                <Fact label="Pieces">{formatCount(inv.packingList.pieces, currency)}</Fact>
                <Fact label="Total cartons">
                  {inv.packingList.cartons !== null
                    ? formatCount(inv.packingList.cartons, currency)
                    : "Not counted"}
                </Fact>
                <Fact label="Packed by">{inv.packingList.packedBy ?? "Not named"}</Fact>
                <p className="col-span-2 text-[0.8125rem] text-muted-foreground">
                  Printed as page 2 of the invoice PDF, as a size matrix.
                </p>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                None made, so the invoice PDF is one page. Make it from the order.
              </p>
            )}
          </Panel>
          <Panel title="Payments" id="payments-heading">
            {inv.payments.length === 0 && inv.refunds.length === 0 && inv.credits.length === 0 ? (
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
                {inv.credits.map((c) => (
                  <li
                    key={c.key}
                    className="flex min-w-0 items-start justify-between gap-4 py-2.5 first:pt-0"
                  >
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">Credit used</p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {[
                          formatDay(c.usedOn),
                          c.paymentNumber ? `from ${c.paymentNumber}` : "advance balance",
                        ].join(" · ")}
                      </p>
                    </div>
                    <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                      {money(c.amount, currency)}
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
