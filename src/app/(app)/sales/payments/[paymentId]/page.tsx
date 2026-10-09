import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { PrintDocumentButton } from "@/components/documents/print-button";
import { BackLink } from "@/components/settings/back-link";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { METHOD_LABELS, money, salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { formatDay } from "@/lib/display";
import { getPaymentScreenAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Money receipt" };

/**
 * One money receipt (sales.view, like GET /api/sales/payments/:id/receipt):
 * who paid, how much and how, what it was paid against, and the receipt PDF.
 * A receipt is not changed once recorded; a mistake is put right with a refund.
 */
export default async function PaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const ctx = await requireCompanyPage();
  const { paymentId } = await params;
  const result = await getPaymentScreenAction(paymentId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Money receipt"
        heading="The receipt could not load"
        error={result.error}
      />
    );
  }
  const { payment: p, can } = result.data;
  const currency = ctx.company.currency;
  const who = p.buyer?.name ?? "Walk-in customer";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/sales/payments">All payments</BackLink>
        <RecordHeader
          eyebrow={`Money receipt ${p.number} · ${formatDay(p.paidOn)}`}
          title={money(p.amount, currency)}
          badges={<span className="text-sm text-muted-foreground">From {who}</span>}
        />
        <div>
          <PrintDocumentButton
            request={{ type: "PAYMENT_RECEIPT", id: p.id }}
            label="Receipt PDF"
            ready={{
              eyebrow: "Money receipt",
              description: `${p.number}: ${money(p.amount, currency)} from ${who}.`,
              errorTitle: "We could not make the receipt PDF",
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Payment" id="payment-heading">
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <Fact label="Amount">{money(p.amount, currency)}</Fact>
            <Fact label="Received on">{formatDay(p.paidOn)}</Fact>
            <Fact label="Paid by">{METHOD_LABELS[p.method]}</Fact>
            <Fact label="Into">{p.account}</Fact>
            {p.reference && (
              <Fact label="Reference" className="col-span-2">
                {p.reference}
              </Fact>
            )}
            {p.notes && (
              <Fact label="Notes" className="col-span-2">
                <span className="whitespace-pre-line">{p.notes}</span>
              </Fact>
            )}
          </dl>
        </Panel>
        <Panel
          title="Paid against"
          id="against-heading"
          action={
            can.openBuyer && p.buyer?.id ? (
              <Link
                href={salesHref.buyer(p.buyer.id)}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Buyer profile
              </Link>
            ) : undefined
          }
        >
          <dl className="mt-4 grid gap-4">
            <Fact label={p.buyer?.code ? "Buyer" : "Customer"}>
              {p.buyer?.code ? `${p.buyer.name} (${p.buyer.code})` : who}
              {p.buyer?.phone ? ` · ${p.buyer.phone}` : ""}
            </Fact>
            {p.proforma ? (
              <Fact label={p.isAdvance ? "Advance on proforma" : "Proforma"}>
                <Link
                  href={salesHref.proforma(p.proforma.id)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {p.proforma.number}
                </Link>{" "}
                · advance asked {money(p.proforma.advanceAmount, currency)} of{" "}
                {money(p.proforma.total, currency)}
              </Fact>
            ) : p.order ? (
              <Fact label={p.isAdvance ? "Advance on order" : "Order"}>
                <Link
                  href={salesHref.order(p.order.id)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {p.order.number}
                </Link>{" "}
                · {money(p.order.due, currency)} still due of {money(p.order.total, currency)}
              </Fact>
            ) : (
              <Fact label="On account">Towards what the buyer owes, not one order.</Fact>
            )}
            {p.receivedToDate && (
              <Fact label="Received on it so far">{money(p.receivedToDate, currency)}</Fact>
            )}
            {p.refundedToDate && p.refundedToDate !== "0.00" && (
              <Fact label="Refunded on it">{money(p.refundedToDate, currency)}</Fact>
            )}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
