import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BackLink } from "@/components/settings/back-link";
import { InvoiceBadge, SalesReturnBadge } from "@/components/sales/badges";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money, salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { SalesReturnActions } from "@/components/sales/sales-return-actions";
import { formatCount, formatDay } from "@/lib/display";
import { getSalesReturnScreenAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Sales return" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One sales return as its credit note (sales.view, like GET
 * /api/sales/returns/:id): the pieces back at the prices billed, the
 * discount and VAT shares, the credit, the invoice it came from and the
 * buyer's credit now. What may be done comes with the screen (screen.can).
 */
export default async function SalesReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ returnId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ returnId }, query] = await Promise.all([params, searchParams]);
  const result = await getSalesReturnScreenAction(returnId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Sales return"
        heading="The sales return could not load"
        error={result.error}
      />
    );
  }
  const screen = result.data;
  const { salesReturn: r } = screen;
  const currency = ctx.company.currency;
  const buyer = r.buyer?.name ?? "Buyer removed";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/sales/returns">All sales returns</BackLink>
        <RecordHeader
          eyebrow={`Credit note ${r.number} · ${formatDay(r.returnedOn)}`}
          title={buyer}
          badges={
            <>
              <SalesReturnBadge voided={r.voided !== null} />
              <span className="text-sm text-muted-foreground">
                From invoice{" "}
                <Link href={salesHref.invoice(r.invoice.id)} className={linkClass}>
                  {r.invoice.number}
                </Link>{" "}
                · order{" "}
                <Link href={salesHref.order(r.order.id)} className={linkClass}>
                  {r.order.number}
                </Link>
              </span>
            </>
          }
        />
        {query.created === "1" && !r.voided && (
          <FormAlert tone="success">
            Sales return {r.number} was recorded: {money(r.total, currency)} is credited to {buyer}
            &apos;s account and the {formatCount(r.pieces, currency)} pcs are in Damage &amp; QC
            Rejects.
          </FormAlert>
        )}
        {r.voided && (
          <FormAlert tone="note">
            Voided on {formatDay(r.voided.on)}
            {r.voided.reason ? `: ${r.voided.reason}` : ""}. The credit was taken back and the
            pieces left Damage &amp; QC Rejects. It is kept as a record.
          </FormAlert>
        )}
        <SalesReturnActions key={r.id} screen={screen} currency={currency} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Came back" id="lines-heading">
            <p className="mt-1 text-sm text-muted-foreground">
              {formatCount(r.pieces, currency)} pieces, at the prices billed on {r.invoice.number}
            </p>
            <ul className="mt-4 grid grid-cols-1 divide-y">
              {r.lines.map((line) => (
                <li
                  key={line.key}
                  className="flex min-w-0 items-start justify-between gap-4 py-2.5 first:pt-0"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium break-words">
                      {line.style} · {line.color} · {line.size}
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground">{line.sku}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <p className="text-muted-foreground">
                      {line.quantity} × {money(line.unitPrice, currency)}
                    </p>
                    <p className="font-medium">{money(line.amount, currency)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Totals
              className="mt-5 border-t pt-4 sm:ml-auto sm:max-w-sm"
              currency={currency}
              lines={[
                { label: "Goods back", amount: r.goods },
                {
                  label: "Their share of the discount",
                  amount: r.discount,
                  minus: true,
                  optional: true,
                },
                { label: "Their share of the VAT", amount: r.tax, optional: true },
                { label: "Credited to the buyer", amount: r.total, strong: true },
              ]}
            />
          </Panel>
          <Panel title="Why" id="reason-heading">
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Fact label="Reason">{r.reason ?? "Not given"}</Fact>
              <Fact label="Pieces went to">
                Damage &amp; QC Rejects{r.warehouse ? `, ${r.warehouse}` : ""}
              </Fact>
              {r.cost !== null && (
                <Fact label="Their cost (written off)">{money(r.cost, currency)}</Fact>
              )}
              {r.recordedBy && <Fact label="Recorded by">{r.recordedBy}</Fact>}
              {r.notes && (
                <Fact label="Notes" className="sm:col-span-2">
                  <span className="whitespace-pre-line">{r.notes}</span>
                </Fact>
              )}
            </dl>
          </Panel>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Credited to"
            id="buyer-heading"
            action={
              screen.can.openBuyer && r.buyer ? (
                <Link href={salesHref.buyer(r.buyer.id)} className={`text-sm ${linkClass}`}>
                  Profile
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Name">{r.buyer ? `${r.buyer.name} (${r.buyer.code})` : buyer}</Fact>
              {r.buyer?.phone && <Fact label="Phone">{r.buyer.phone}</Fact>}
              {screen.buyerCredit !== null && (
                <Fact label="Unused credit now">{money(screen.buyerCredit, currency)}</Fact>
              )}
              {screen.earlierBalance !== null && (
                <Fact label="Still owed from before">{money(screen.earlierBalance, currency)}</Fact>
              )}
            </dl>
            {screen.notes.credit && (
              <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
                {screen.notes.credit}
              </p>
            )}
            {screen.can.useCredit && (
              <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
                {r.invoice.number} still has {money(r.invoice.due, currency)} due. Use the credit on
                it with &quot;Use credit&quot; on{" "}
                <Link href={salesHref.order(r.order.id)} className={linkClass}>
                  order {r.order.number}
                </Link>
                .
              </p>
            )}
          </Panel>
          <Panel title="Invoice" id="invoice-heading">
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <Fact label="Number">
                <Link href={salesHref.invoice(r.invoice.id)} className={linkClass}>
                  {r.invoice.number}
                </Link>
              </Fact>
              <Fact label="Issued">{formatDay(r.invoice.issuedOn)}</Fact>
              <Fact label="Total">{money(r.invoice.total, currency)}</Fact>
              <Fact label="Due">{money(r.invoice.due, currency)}</Fact>
              <div className="col-span-2">
                <InvoiceBadge status={r.invoice.status} />
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
