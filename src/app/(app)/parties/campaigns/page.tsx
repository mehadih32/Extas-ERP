import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { CampaignList, type CampaignRow } from "@/components/parties/campaigns";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { Button } from "@/components/ui/button";
import { listCampaignsAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Campaigns" };

/**
 * Buyers & suppliers > Campaigns (sales.campaigns.manage): one message to many
 * buyers, sent by a person one buyer at a time. Nothing is sent by the ERP.
 */
export default async function CampaignsPage() {
  await requireCompanyPage();
  const result = await listCampaignsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <PartiesNoAccess title="Campaigns are not part of your role">
          Your administrator can give your role the permission to run campaigns.
        </PartiesNoAccess>
      );
    }
    return (
      <SectionError title="Campaigns" heading="The campaigns could not load" error={result.error} />
    );
  }
  const rows: CampaignRow[] = result.data.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    status: c.status,
    createdAt: c.createdAt,
    recipients: c.recipients,
    sent: c.delivery.SENT + c.delivery.DELIVERED + c.delivery.READ,
    responded: c.responded,
  }));

  return (
    <section aria-labelledby="campaigns-heading" className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id="campaigns-heading" className="font-serif text-2xl text-primary">
            Campaigns
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            One message to many buyers. The ERP fills in each buyer&apos;s name and opens the
            message in WhatsApp or email; you press send there. Nothing is sent by itself.
          </p>
        </div>
        <Button asChild>
          <Link href="/parties/campaigns/new">
            <PlusIcon aria-hidden />
            New campaign
          </Link>
        </Button>
      </div>
      <CampaignList rows={rows} />
    </section>
  );
}
