import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { CampaignRecipients } from "@/components/parties/campaigns";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { getCampaignAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Campaign" };

const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email", SMS: "SMS" };

/**
 * One campaign: each buyer with "Open WhatsApp" / "Open email" (the message
 * opens on this phone or computer for the person to send) and the "Sent" and
 * "Replied" ticks.
 */
export default async function CampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  await requireCompanyPage();
  const { campaignId } = await params;
  const result = await getCampaignAction(campaignId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <PartiesNoAccess title="Campaigns are not part of your role">
          Your administrator can give your role the permission to run campaigns.
        </PartiesNoAccess>
      );
    }
    return (
      <SectionError title="Campaign" heading="The campaign could not load" error={result.error} />
    );
  }
  const campaign = result.data;
  const open = campaign.status !== "CANCELLED";

  return (
    <section aria-labelledby="campaign-heading" className="grid gap-6">
      <div>
        <Link
          href="/parties/campaigns"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Campaigns
        </Link>
        <h2 id="campaign-heading" className="mt-3 font-serif text-2xl break-words text-primary">
          {campaign.name}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {CHANNEL_LABEL[campaign.channel] ?? campaign.channel}.{" "}
          {open
            ? "Open each buyer's message, press send in the app that opens, then tick “Replied” when they answer."
            : "This campaign was cancelled, so nothing here changes any more."}
        </p>
      </div>
      <CampaignRecipients
        campaignId={campaign.id}
        channel={campaign.channel}
        open={open}
        rows={campaign.recipients.map((r) => ({
          id: r.id,
          status: r.status,
          respondedAt: r.respondedAt,
          message: r.message,
          link: r.link,
          party: {
            id: r.party.id,
            code: r.party.code,
            name: r.party.name,
            contactPerson: r.party.contactPerson,
          },
        }))}
      />
    </section>
  );
}
