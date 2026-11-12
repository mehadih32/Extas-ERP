import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { NewCampaignForm } from "@/components/parties/campaigns";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { campaignBuyersAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New campaign" };

/** Writing a campaign and picking the buyers it goes to (sales.campaigns.manage). */
export default async function NewCampaignPage() {
  await requireCompanyPage();
  const result = await campaignBuyersAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <PartiesNoAccess title="Campaigns are not part of your role">
          Your administrator can give your role the permission to run campaigns.
        </PartiesNoAccess>
      );
    }
    return (
      <SectionError title="New campaign" heading="The buyers could not load" error={result.error} />
    );
  }

  return (
    <section aria-labelledby="new-campaign-heading" className="grid gap-6">
      <div>
        <h2 id="new-campaign-heading" className="font-serif text-2xl text-primary">
          New campaign
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Write the message once, pick the buyers, then send it to each from the list. Dormant means
          no business for {result.data.dormantMonths} months.
        </p>
      </div>
      <NewCampaignForm picker={result.data} />
    </section>
  );
}
