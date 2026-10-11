import type { Metadata } from "next";

import { AssetForm } from "@/components/accounts/asset-form";
import { assetHref } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getAssetFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Record an asset purchase" };

/**
 * Recording a fixed asset (accounts.manage, as createFixedAsset checks): paid
 * now (only for people who pay money out), on credit from a supplier, or owned
 * before the books started.
 */
export default async function NewAssetPage() {
  const ctx = await requireCompanyPage();
  const result = await getAssetFormAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Recording assets is not part of your role">
          Only Accounts and the owner add fixed assets.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="Record an asset purchase"
        heading="The form could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href={assetHref.register}>Fixed asset register</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Record an asset purchase</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          For things the business keeps and uses for years: a laptop, an AC, a machine, furniture.
          Its cost goes to Fixed assets, not to this month&apos;s expenses, and it loses value a
          little each month through depreciation.
        </p>
      </div>
      <AssetForm data={result.data} currency={ctx.company.currency} />
    </div>
  );
}
