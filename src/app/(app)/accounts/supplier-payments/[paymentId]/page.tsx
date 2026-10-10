import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OffBadge } from "@/components/accounts/badges";
import { accountsHref, isNegative } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { PaymentActions } from "@/components/accounts/payment-actions";
import { SectionError } from "@/components/dashboard/section-error";
import { productionHref } from "@/components/production/labels";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { METHOD_LABELS, money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getSupplierPaymentScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Supplier payment" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One payment to a supplier (accounts.view or accounts.payments.record, like
 * GET /api/accounts/supplier-payments/:id): how much, from where, what it was
 * for, and what the supplier is owed now.
 */
export default async function SupplierPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ paymentId }, query] = await Promise.all([params, searchParams]);
  const result = await getSupplierPaymentScreenAction(paymentId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError title="Payment" heading="The payment could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { payment: p, supplierNow, can } = screen;
  const currency = ctx.company.currency;
  const notice =
    query.created === "1"
      ? `${p.number} was recorded. It settles ${p.supplier.name}'s oldest bills first.`
      : undefined;
  const payable = supplierNow.payable;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/accounts/supplier-payments">All payments</BackLink>
        <RecordHeader
          eyebrow={`Payment ${p.number} · ${formatDay(p.paidOn)}`}
          title={p.supplier.name}
          badges={
            <>
              {p.isVoid && <OffBadge>Void</OffBadge>}
              <span
                className={cn(
                  "font-serif text-lg tabular-nums",
                  p.isVoid ? "text-muted-foreground line-through" : "text-primary",
                )}
              >
                {money(p.amount, currency)}
              </span>
            </>
          }
        />
        <PaymentActions key={p.id} screen={screen} currency={currency} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="How it was paid" id="paid-heading">
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label="From">
              {can.openLedger ? (
                <Link href={accountsHref.account(p.account.id)} className={linkClass}>
                  {p.account.name}
                </Link>
              ) : (
                p.account.name
              )}
            </Fact>
            <Fact label="How">{METHOD_LABELS[p.method]}</Fact>
            <Fact label="Reference">{p.reference ?? "None"}</Fact>
            <Fact label="For">
              {p.bill ? (
                can.openBill ? (
                  <Link href={productionHref.bill(p.bill.id)} className={linkClass}>
                    Bill {p.bill.number}
                  </Link>
                ) : (
                  `Bill ${p.bill.number}`
                )
              ) : p.project ? (
                <>
                  {can.openProject ? (
                    <Link href={productionHref.project(p.project.id)} className={linkClass}>
                      {p.project.code}
                    </Link>
                  ) : (
                    p.project.code
                  )}{" "}
                  · {p.project.name} (its bills first)
                </>
              ) : (
                "Their account (oldest bills first)"
              )}
            </Fact>
            {p.journalEntry && (
              <Fact label="Journal entry">
                {can.openEntry ? (
                  <Link href={accountsHref.entry(p.journalEntry.id)} className={linkClass}>
                    {p.journalEntry.number}
                  </Link>
                ) : (
                  p.journalEntry.number
                )}
              </Fact>
            )}
            {p.notes && (
              <Fact label="Notes" className="sm:col-span-2">
                <span className="whitespace-pre-line">{p.notes}</span>
              </Fact>
            )}
          </dl>
        </Panel>

        <Panel
          title="The supplier now"
          id="supplier-heading"
          action={
            can.openParty ? (
              <Link
                href={productionHref.supplier(p.supplier.id)}
                className={`text-sm ${linkClass}`}
              >
                Account
              </Link>
            ) : undefined
          }
        >
          <p className="mt-4 text-sm">
            {isNegative(payable)
              ? `They hold an advance of ${money(payable, currency)}.`
              : /[1-9]/.test(payable)
                ? `You owe them ${money(payable, currency)}.`
                : "Nothing is owed either way."}
          </p>
          {supplierNow.openBills.length > 0 && (
            <ul className="mt-4 grid divide-y" aria-label="Open bills">
              {supplierNow.openBills.map((b) => (
                <li
                  key={b.id}
                  className="flex items-baseline justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 truncate">
                    {can.openBill ? (
                      <Link href={productionHref.bill(b.id)} className={linkClass}>
                        {b.number}
                      </Link>
                    ) : (
                      b.number
                    )}{" "}
                    · {formatDay(b.billOn)}
                  </span>
                  <span className="whitespace-nowrap text-destructive tabular-nums">
                    {money(b.due, currency)} due
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
