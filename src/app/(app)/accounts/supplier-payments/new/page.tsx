import type { Metadata } from "next";

import { AccountsNoAccess } from "@/components/accounts/no-access";
import { PayForm } from "@/components/accounts/pay-form";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getPayFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Pay a supplier" };

/**
 * Paying a supplier on account: accounts.payments.record, as paySupplierAction
 * checks (only Accounts and the owner pay money out). "?supplier=" starts it on
 * one supplier, from their profile or a bill.
 */
export default async function PaySupplierPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const supplierId = typeof query.supplier === "string" ? query.supplier : undefined;
  const result = await getPayFormAction(supplierId);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Paying suppliers is not part of your role">
          Only Accounts and the owner pay money out.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError title="Pay a supplier" heading="The form could not load" error={result.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/accounts/supplier-payments">Supplier payments</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Pay a supplier</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          A payment voucher is made. It settles the supplier&apos;s oldest bills first; anything
          over stays with them as an advance.
        </p>
      </div>
      <PayForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
