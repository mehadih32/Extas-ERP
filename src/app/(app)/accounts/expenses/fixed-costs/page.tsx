import type { Metadata } from "next";

import { FixedCostsScreen } from "@/components/accounts/fixed-costs-screen";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getFixedCostsAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Monthly fixed costs" };

/**
 * Monthly fixed costs (accounts.view): rent, internet and the like, set once
 * and recorded as an expense by themselves each month (Accounts, with the PIN).
 */
export default async function FixedCostsPage() {
  const ctx = await requireCompanyPage();
  const result = await getFixedCostsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Monthly fixed costs"
        heading="The page could not load"
        error={result.error}
      />
    );
  }

  return (
    <PrivacyProvider>
      <div className="grid gap-6">
        <BackLink href="/accounts/expenses">Expenses</BackLink>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-serif text-2xl text-primary">Monthly fixed costs</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Costs that come every month for the same amount, like the office rent or the internet
              bill. Set each one once; the ERP records it as an expense on its day.
            </p>
          </div>
          <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
        </div>
        <FixedCostsScreen screen={result.data} currency={ctx.company.currency} />
      </div>
    </PrivacyProvider>
  );
}
