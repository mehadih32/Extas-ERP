import type { Metadata } from "next";

import { BankForm } from "@/components/accounts/bank-form";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getBankFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Add a bank account" };

/** A new bank account, with its balance brought forward: accounts.manage, as createBankAccountAction checks. */
export default async function NewBankAccountPage() {
  const ctx = await requireCompanyPage();
  const result = await getBankFormAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Adding bank accounts is not part of your role">
          Accounts and the owner add the company&apos;s bank accounts.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="Add a bank account"
        heading="The form could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/accounts/cash-bank">Cash & bank</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Add a bank account</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Deposits, cheques and transfers through it land on its own statement.
        </p>
      </div>
      <BankForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
