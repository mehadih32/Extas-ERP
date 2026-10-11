import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AssetForm } from "@/components/accounts/asset-form";
import { assetHref } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getAssetFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change a fixed asset" };

/** Changing an asset's name, category, place, status and depreciation (accounts.manage). */
export default async function EditAssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const ctx = await requireCompanyPage();
  const { assetId } = await params;
  const result = await getAssetFormAction(assetId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Changing assets is not part of your role">
          Only Accounts and the owner change fixed assets.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="Change a fixed asset"
        heading="The form could not load"
        error={result.error}
      />
    );
  }
  const asset = result.data.asset!;

  return (
    <div className="grid gap-6">
      <BackLink href={assetHref.asset(asset.id)}>{asset.name}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Change {asset.name}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          What it cost and how it was bought stay as recorded. A new depreciation rate counts from
          the next month posted.
        </p>
      </div>
      <AssetForm data={result.data} currency={ctx.company.currency} />
    </div>
  );
}
