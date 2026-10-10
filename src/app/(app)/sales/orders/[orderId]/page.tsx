import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { PrintDocumentButton } from "@/components/documents/print-button";
import { UseTemplateButton } from "@/components/reports/use-template";
import { FormAlert } from "@/components/forms/field";
import { VerifiedBadge } from "@/components/parties/badges";
import { BackLink } from "@/components/settings/back-link";
import { InvoiceBadge, OrderBadge, OverrideBadge } from "@/components/sales/badges";
import { ColorName, Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { buyerName, CHANNEL_LABELS, money, salesHref } from "@/components/sales/labels";
import { MoneyRecords } from "@/components/sales/money-records";
import { SalesNoAccess } from "@/components/sales/no-access";
import { OrderActions } from "@/components/sales/order-actions";
import { localDay } from "@/lib/dates";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { TemplateChoice } from "@/modules/reports/screens.service";
import type { OrderScreen } from "@/modules/sales/screens.service";
import { getOrderScreenAction } from "@/server/actions/sales.actions";
import { templateChoicesAction } from "@/server/actions/templates.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Order" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

function Items({ screen, currency }: { screen: OrderScreen; currency: string }) {
  const { order: o } = screen;
  return (
    <Panel title="Items" id="items-heading">
      <div className="mt-4 grid grid-cols-1 gap-6">
        {o.styles.map((group) => (
          <section key={group.style.id} aria-label={group.style.code} className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
              <p className="min-w-0 text-sm font-medium break-words">
                {group.style.code} · {group.style.name}
              </p>
              <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                {formatCount(group.pieces, currency)} pcs · {money(group.amount, currency)}
              </p>
            </div>
            <ul className="grid grid-cols-1 divide-y">
              {group.lines.map((line) => (
                <li key={line.id} className="flex min-w-0 items-start justify-between gap-4 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="flex flex-wrap items-center gap-x-2">
                      <ColorName name={line.color.name} hexCode={line.color.hexCode} />
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium">{line.size}</span>
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {line.sku}
                      {line.delivered > 0
                        ? ` · ${line.delivered} of ${line.quantity} delivered`
                        : ""}
                    </p>
                    {line.forceOverride && (
                      <p className="text-[0.8125rem] text-amber-700">
                        Sold beyond stock{line.overrideReason ? `: ${line.overrideReason}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <p className="text-muted-foreground">
                      {line.quantity} × {money(line.unitPrice, currency)}
                    </p>
                    <p className="font-medium">{money(line.lineTotal, currency)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Totals
        className="mt-5 border-t pt-4 sm:ml-auto sm:max-w-sm"
        currency={currency}
        lines={[
          { label: "Subtotal", amount: o.subtotal },
          { label: "Discount", amount: o.discount, minus: true, optional: true },
          { label: "Delivery charge", amount: o.shippingCharge, optional: true },
          { label: "Tax / VAT", amount: o.tax, optional: true },
          { label: "Total", amount: o.total, strong: true },
          { label: "Paid", amount: o.paid, tone: "muted" },
          { label: "Due", amount: o.due, strong: true, tone: "due" },
        ]}
      />
    </Panel>
  );
}

function Documents({
  screen,
  currency,
  templates,
}: {
  screen: OrderScreen;
  currency: string;
  /** The company's own invoice and challan designs this person may fill. */
  templates: { invoice: TemplateChoice[]; challan: TemplateChoice[] };
}) {
  const { order: o } = screen;
  const party = buyerName(o.buyer, o.customer.name);
  const rows: Array<{
    key: string;
    title: React.ReactNode;
    detail: React.ReactNode;
    print?: React.ReactNode;
  }> = [];
  if (o.invoice) {
    rows.push({
      key: o.invoice.id,
      title: (
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href={salesHref.invoice(o.invoice.id)}
            className="text-primary underline-offset-4 hover:underline"
          >
            Invoice {o.invoice.number}
          </Link>
          <InvoiceBadge status={o.invoice.status} />
        </span>
      ),
      detail: `${formatDay(o.invoice.issuedOn)}${o.invoice.dueOn ? ` · due ${formatDay(o.invoice.dueOn)}` : ""} · ${money(o.invoice.due, currency)} due`,
      print:
        o.invoice.status === "VOID" ? undefined : (
          <>
            <PrintDocumentButton
              request={{ type: "COMMERCIAL_INVOICE", id: o.invoice.id }}
              label="PDF"
              className="w-auto"
              ready={{
                eyebrow: "Commercial invoice",
                description: `${o.invoice.number} for ${party}.`,
                errorTitle: "We could not make the invoice PDF",
              }}
            />
            <UseTemplateButton
              id={o.invoice.id}
              templates={templates.invoice}
              what={`Invoice ${o.invoice.number}`}
              className="w-auto"
            />
          </>
        ),
    });
  }
  if (o.packingList) {
    rows.push({
      key: o.packingList.id,
      title: `Packing list ${o.packingList.number}`,
      detail: `${o.packingList.pieces} pcs${o.packingList.cartons ? ` · ${o.packingList.cartons} cartons` : ""}`,
      print: (
        <PrintDocumentButton
          request={{ type: "PACKING_LIST", id: o.packingList.id }}
          label="PDF"
          className="w-auto"
          ready={{
            eyebrow: "Packing list",
            description: `${o.packingList.number} for ${o.number}.`,
            errorTitle: "We could not make the packing list PDF",
          }}
        />
      ),
    });
  }
  for (const c of o.challans) {
    rows.push({
      key: c.id,
      title: `Delivery challan ${c.number}`,
      detail: [
        formatDay(c.deliveredOn),
        `${c.pieces} pcs`,
        c.vehicleNo,
        c.receivedBy && `to ${c.receivedBy}`,
      ]
        .filter(Boolean)
        .join(" · "),
      print: (
        <>
          <PrintDocumentButton
            request={{ type: "DELIVERY_CHALLAN", id: c.id }}
            label="PDF"
            className="w-auto"
            ready={{
              eyebrow: "Delivery challan",
              description: `${c.number}: ${c.pieces} pieces for ${party}.`,
              errorTitle: "We could not make the challan PDF",
            }}
          />
          <UseTemplateButton
            id={c.id}
            templates={templates.challan}
            what={`Challan ${c.number}`}
            className="w-auto"
          />
        </>
      ),
    });
  }
  return (
    <Panel title="Documents" id="documents-heading">
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No invoice or delivery papers yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 divide-y">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 text-sm">
                <div className="font-medium">{row.title}</div>
                <p className="text-[0.8125rem] text-muted-foreground">{row.detail}</p>
              </div>
              {row.print && <div className="flex shrink-0 gap-2">{row.print}</div>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One order (sales.view, like GET /api/sales/orders/:id): the lines by style
 * with what was delivered, totals with paid and due, its documents and money,
 * and (for people who see the financials) its cost and margin. What may be done
 * comes with the screen from the same rules the order actions use (screen.can).
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
  const [result, invoiceTemplates, challanTemplates] = await Promise.all([
    getOrderScreenAction(orderId),
    templateChoicesAction("COMMERCIAL_INVOICE"),
    templateChoicesAction("DELIVERY_CHALLAN"),
  ]);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return <SectionError title="Order" heading="The order could not load" error={result.error} />;
  }
  const screen = result.data;
  const { order: o, costs, notes } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `Order ${o.number} was placed${o.invoice ? ` and invoice ${o.invoice.number} issued` : ""}.`
      : one(query.saved) === "1"
        ? "The changes were saved."
        : undefined;
  const customer = [o.customer.name, o.customer.phone].filter(Boolean).join(" · ");

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/sales/orders">All orders</BackLink>
        <RecordHeader
          eyebrow={`Order ${o.number} · ${formatDay(o.orderedOn)} · ${CHANNEL_LABELS[o.channel]}`}
          title={
            <span className="inline-flex items-center gap-2">
              <span className="min-w-0 break-words">{buyerName(o.buyer, o.customer.name)}</span>
              {o.buyer?.isVerified && <VerifiedBadge className="size-6" />}
            </span>
          }
          badges={
            <>
              <OrderBadge status={o.status} />
              {o.hasForceOverride && <OverrideBadge />}
              {o.shipmentOn && (
                <span className="text-sm text-muted-foreground">
                  Ship by {formatDay(o.shipmentOn)}
                </span>
              )}
            </>
          }
        />
        {o.proforma && (
          <FormAlert tone="note">
            Made from proforma invoice{" "}
            <Link
              href={salesHref.proforma(o.proforma.id)}
              className="font-medium underline underline-offset-4"
            >
              {o.proforma.number}
            </Link>
            ; its advance counts towards this order.
          </FormAlert>
        )}
        {notes.cancel && <FormAlert tone="note">{notes.cancel}</FormAlert>}
        <OrderActions
          key={o.id}
          screen={screen}
          currency={currency}
          today={localDay(new Date(), ctx.company.timezone)}
          notice={notice}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Items screen={screen} currency={currency} />
          <MoneyRecords
            payments={o.payments.map((p) => ({ ...p, reference: null }))}
            refunds={o.refunds}
            currency={currency}
            empty="Nothing was paid on it yet."
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Delivery" id="delivery-heading">
            <dl className="mt-4 grid grid-cols-3 gap-4">
              <Fact label="Pieces">{formatCount(o.pieces, currency)}</Fact>
              <Fact label="Delivered">{formatCount(o.delivered, currency)}</Fact>
              <Fact label="Left">{formatCount(o.remaining, currency)}</Fact>
              {o.warehouse && (
                <Fact label="Warehouse" className="col-span-3">
                  {o.warehouse}
                </Fact>
              )}
            </dl>
          </Panel>
          <Documents
            screen={screen}
            currency={currency}
            templates={{
              invoice: invoiceTemplates.ok ? invoiceTemplates.data : [],
              challan: challanTemplates.ok ? challanTemplates.data : [],
            }}
          />
          {costs && (
            <Panel title="Cost and margin" id="costs-heading">
              <dl className="mt-4 grid gap-2 text-sm tabular-nums">
                {(
                  [
                    ["Sales after discount", costs.netSales],
                    ["Cost of the goods", costs.cost],
                  ] as const
                ).map(([label, amount]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>{money(amount, currency)}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-4 border-t pt-2 font-medium">
                  <dt>Margin</dt>
                  <dd
                    className={cn(
                      "font-serif text-lg",
                      costs.margin.startsWith("-") && "text-destructive",
                    )}
                  >
                    {costs.margin.startsWith("-")
                      ? `− ${money(costs.margin.slice(1), currency)}`
                      : money(costs.margin, currency)}
                    {costs.marginPercent !== null && (
                      <span className="ml-1.5 font-sans text-sm text-muted-foreground">
                        {costs.marginPercent}%
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {costs.estimated && (
                <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                  Pieces not delivered yet are costed at today&apos;s average cost.
                </p>
              )}
            </Panel>
          )}
          <Panel
            title={o.buyer ? "Buyer" : "Customer"}
            id="buyer-heading"
            action={
              o.buyer && screen.can.openBuyer ? (
                <Link
                  href={salesHref.buyer(o.buyer.id)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Profile
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              {o.buyer ? (
                <>
                  <Fact label="Account">{`${o.buyer.name} (${o.buyer.code})`}</Fact>
                  {o.buyer.phone && <Fact label="Phone">{o.buyer.phone}</Fact>}
                </>
              ) : (
                <Fact label="Walk-in customer">{customer || "No name given"}</Fact>
              )}
              {o.buyer && customer && <Fact label="Contact on this order">{customer}</Fact>}
              {o.customer.address && (
                <Fact label="Delivery address">
                  <span className="whitespace-pre-line">{o.customer.address}</span>
                </Fact>
              )}
            </dl>
          </Panel>
          {o.notes && (
            <Panel title="Notes" id="notes-heading">
              <p className="mt-4 text-sm leading-relaxed whitespace-pre-line">{o.notes}</p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
