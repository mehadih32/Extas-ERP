import type { Metadata } from "next";

import { loansHref } from "@/components/accounts/labels";
import { LoanForm } from "@/components/accounts/loan-form";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getLoanFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Add a loan" };

/**
 * Adding a loan (accounts.manage): a bank, an NGO or a person, money received
 * now or a loan running before the ERP. "?lender=" starts with that lender.
 */
export default async function NewLoanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const result = await getLoanFormAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Adding loans is not part of your role">
          Only Accounts and the owner add loans.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError title="Add a loan" heading="The form could not load" error={result.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href={loansHref.page}>Loans & capital</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Add a loan</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Money from a bank, an NGO or a person. The money itself is owed back; only the interest or
          profit is a cost in Profit and loss.
        </p>
      </div>
      <LoanForm
        data={result.data}
        currency={ctx.company.currency}
        lenderId={typeof query.lender === "string" ? query.lender : undefined}
      />
    </div>
  );
}
