import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BankForm } from "@/components/accounts/bank-form";
import { accountsHref } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getBankFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change a bank account" };

/** A bank account's details: accounts.manage, as updateBankAccountAction checks. */
export default async function EditBankAccountPage({
  params,
}: {
  params: Promise<{ bankAccountId: string }>;
}) {
  const ctx = await requireCompanyPage();
  const { bankAccountId } = await params;
  const result = await getBankFormAction(bankAccountId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Changing bank accounts is not part of your role">
          Accounts and the owner keep the company&apos;s bank details.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError title="Bank account" heading="The form could not load" error={result.error} />
    );
  }
  const bank = result.data.bank!;

  return (
    <div className="grid gap-6">
      <BackLink href={accountsHref.bank(bank.id)}>
        {bank.bankName} {bank.accountNumber}
      </BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Change the details</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Its statement and balance stay as they are.
        </p>
      </div>
      <BankForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
