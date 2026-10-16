import type { Metadata } from "next";

import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackupsScreen } from "@/components/settings/backups-screen";
import { getBackupOverviewAction } from "@/server/actions/backups.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Backups" };

/** Settings > Backups (the platform owner only): every company's data, kept in Google Drive. */
export default async function BackupsPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.user.isSuperAdmin) {
    return (
      <AiNoAccess title="Only the platform owner sees Backups">
        A backup holds every company&apos;s data, so only the platform owner opens Backups.
      </AiNoAccess>
    );
  }
  const result = await getBackupOverviewAction();
  if (!result.ok) {
    return <SectionError title="Backups" heading="Backups could not load" error={result.error} />;
  }
  return <BackupsScreen overview={result.data} />;
}
