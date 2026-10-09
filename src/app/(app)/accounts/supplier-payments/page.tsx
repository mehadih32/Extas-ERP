import { BanknoteIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccountsFilters } from "@/components/accounts/accounts-filters";
import { accountsHref } from "@/components/accounts/labels";
import {
  accountsListSearch,
  isAccountsFiltered,
  paymentListQuery,
  paymentViewFrom,
} from "@/components/accounts/list-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { PaymentList } from "@/components/accounts/payment-list";
import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getSupplierPaymentListAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Supplier payments" };

/**
 * Payments made to suppliers, newest first (accounts.view or
 * accounts.payments.record, like GET /api/accounts/supplier-payments). Paying
 * one is offered to accounts.payments.record, the permission paySupplierAction checks.
 */
export default async function SupplierPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = paymentViewFrom(await searchParams);
  const result = await getSupplierPaymentListAction(paymentListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Supplier payments"
        heading="The payments could not load"
        error={result.error}
      />
    );
  }
  const { items, nextCursor, canPay, supplier } = result.data;
  const payHref = accountsHref.pay(supplier?.id);

  return (
    <section aria-labelledby="payments-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="payments-heading" className="font-serif text-2xl text-primary">
            Supplier payments
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Money paid to factories, mills and other suppliers. A payment settles their oldest bills
            first.
          </p>
        </div>
        {canPay && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={payHref}>
              <BanknoteIcon aria-hidden />
              Pay a supplier
            </Link>
          </Button>
        )}
      </div>

      <AccountsFilters view={view} label={supplier?.name}>
        {items.length === 0 ? (
          isAccountsFiltered(view) ? (
            <EmptyState title="No payments to this supplier">
              Choose All suppliers to see every payment.
            </EmptyState>
          ) : (
            <EmptyState
              title="No supplier payments yet"
              action={
                canPay ? (
                  <Button asChild>
                    <Link href={payHref}>Pay a supplier</Link>
                  </Button>
                ) : undefined
              }
            >
              Payments to suppliers show here, with the bills they settled.
            </EmptyState>
          )
        ) : (
          <PaymentList
            key={accountsListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
          />
        )}
      </AccountsFilters>
    </section>
  );
}
