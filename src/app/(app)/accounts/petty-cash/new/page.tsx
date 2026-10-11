import type { Metadata } from "next";

import { AccountsNoAccess } from "@/components/accounts/no-access";
import { PettyCashForm } from "@/components/accounts/petty-cash-form";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getPettyCashFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New petty cash box" };

/**
 * Opening a petty cash box (accounts.manage, as createPettyCashBox checks):
 * its name, its holder, its usual amount and, for people who pay money out,
 * the first top-up.
 */
export default async function NewPettyCashBoxPage() {
  const ctx = await requireCompanyPage();
  const result = await getPettyCashFormAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Petty cash boxes are set up by Accounts">
          Only Accounts and the owner open petty cash boxes.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="New petty cash box"
        heading="The form could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/accounts/cash-bank">Cash & bank</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New petty cash box</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Cash one person keeps for small daily costs: tea, rickshaw fares, courier fees. They
          record each cost from the box straight into the books, and you top it up when it runs low.
        </p>
      </div>
      <PettyCashForm data={result.data} currency={ctx.company.currency} />
    </div>
  );
}
