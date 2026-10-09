import type { Metadata } from "next";

import { AccountsNoAccess } from "@/components/accounts/no-access";
import { VoucherForm } from "@/components/accounts/voucher-form";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getVoucherFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New journal voucher" };

/** Writing a journal voucher by hand: accounts.manage, as createJournalVoucherAction checks. */
export default async function NewVoucherPage() {
  const ctx = await requireCompanyPage();
  const result = await getVoucherFormAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Journal vouchers are not part of your role">
          Only Accounts and the owner write journal vouchers.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="New journal voucher"
        heading="The form could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/accounts/journal">Journal</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New journal voucher</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          For corrections and anything no other screen records. Sales, payments, bills and expenses
          are better recorded on their own screens, which make the entry for you.
        </p>
      </div>
      <VoucherForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
