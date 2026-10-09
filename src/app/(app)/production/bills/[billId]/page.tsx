import { PaperclipIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BillBadge } from "@/components/production/badges";
import { BillActions } from "@/components/production/bill-actions";
import { PAYMENT_TYPE_LABELS, productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { METHOD_LABELS, money } from "@/components/sales/labels";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { getBillScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Supplier bill" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One supplier bill (production.view with the costs, like GET
 * /api/production/bills/:id): how it is shared across projects, or the raw
 * materials it bought, and what was paid on it.
 */
export default async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ billId }, query] = await Promise.all([params, searchParams]);
  const result = await getBillScreenAction(billId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="Production costs are not part of your role">
          Supplier bills show to Production Managers and Accounts.
        </ProductionNoAccess>
      );
    }
    return <SectionError title="Bill" heading="The bill could not load" error={result.error} />;
  }
  const screen = result.data;
  const { bill: b, can, notes } = screen;
  const currency = ctx.company.currency;
  const notice = one(query.created) === "1" ? `${b.number} was saved.` : undefined;
  const isVoid = b.status === "VOID";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/production/bills">All bills</BackLink>
        <RecordHeader
          eyebrow={`Bill ${b.number} · ${formatDay(b.billOn)}`}
          title={b.supplier.name}
          badges={
            <>
              <BillBadge status={b.status} />
              <span className="text-sm text-muted-foreground">
                {PAYMENT_TYPE_LABELS[b.paymentType]}
                {b.supplierRef ? ` · their no. ${b.supplierRef}` : ""}
              </span>
            </>
          }
        />
        {notes.void && <FormAlert tone="note">{notes.void}</FormAlert>}
        <BillActions
          key={b.id}
          screen={screen}
          currency={currency}
          today={localDay(new Date(), ctx.company.timezone)}
          notice={notice}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {b.items.length > 0 ? (
            <Panel title="Raw materials bought" id="items-heading">
              <ul className="mt-4 grid divide-y">
                {b.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">
                        {item.material.code} · {item.material.name}
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                        {item.quantity} {item.unit} at {money(item.unitPrice, currency)}
                      </p>
                    </div>
                    <p className="text-sm whitespace-nowrap tabular-nums">
                      {money(item.amount, currency)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <Panel title="Shared across" id="shares-heading">
              <ul className="mt-4 grid divide-y">
                {b.shares.map((share) => (
                  <li
                    key={share.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">
                        {share.project ? (
                          <Link
                            href={productionHref.project(share.project.id)}
                            className={linkClass}
                          >
                            {share.project.code} · {share.project.name}
                          </Link>
                        ) : (
                          "No project"
                        )}
                      </p>
                      <p className="text-[0.8125rem] break-words text-muted-foreground">
                        {share.head}
                        {share.description ? ` · ${share.description}` : ""}
                      </p>
                    </div>
                    <p className="text-sm whitespace-nowrap tabular-nums">
                      {money(share.amount, currency)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Payments" id="payments-heading">
            {b.payments.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {b.paymentType === "DUE" ? "Nothing paid on it yet." : "No payments recorded."}
              </p>
            ) : (
              <ul className="mt-4 grid divide-y">
                {b.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{p.number}</p>
                      <p className="text-[0.8125rem] break-words text-muted-foreground">
                        {formatDay(p.paidOn)} · {METHOD_LABELS[p.method]}
                        {p.account ? ` from ${p.account}` : ""}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </p>
                    </div>
                    <p className="text-sm whitespace-nowrap tabular-nums">
                      {money(p.amount, currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Amount" id="amount-heading">
            <Totals
              className="mt-4"
              currency={currency}
              lines={[
                { label: "Bill total", amount: b.total, strong: true },
                { label: "Paid", amount: b.paid },
                ...(isVoid
                  ? []
                  : [{ label: "Still owed", amount: b.due, strong: true, tone: "due" as const }]),
              ]}
            />
          </Panel>
          <Panel
            title="Supplier"
            id="supplier-heading"
            action={
              can.openParty ? (
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
              <Fact label="Supplier">{`${b.supplier.name} (${b.supplier.code})`}</Fact>
              {b.supplier.phone && <Fact label="Phone">{b.supplier.phone}</Fact>}
              {b.warehouse && <Fact label="Into the store">{b.warehouse}</Fact>}
              {b.purchaseOrder && <Fact label="Purchase order">{b.purchaseOrder.number}</Fact>}
              <Fact label="Bill photo">
                {b.attachment ? (
                  <a
                    href={productionHref.file(b.attachment.id)}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex max-w-full items-center gap-1.5 ${linkClass}`}
                  >
                    <PaperclipIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{b.attachment.fileName}</span>
                  </a>
                ) : (
                  "None attached"
                )}
              </Fact>
            </dl>
          </Panel>
          {b.notes && (
            <Panel title="Notes" id="notes-heading">
              <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-line">
                {b.notes}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
