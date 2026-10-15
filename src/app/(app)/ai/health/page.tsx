import type { Metadata } from "next";

import { HealthScreen } from "@/components/ai/health-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getServerHealthAction } from "@/server/actions/orders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Server Health" };

/** Server Health (the platform owner only): the checks, the Bengali report and the safe fixes. */
export default async function ServerHealthPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.user.isSuperAdmin) {
    return (
      <AiNoAccess title="Only the platform owner sees Server Health">
        Server Health looks at the whole server, so only the platform owner opens it.
      </AiNoAccess>
    );
  }
  const result = await getServerHealthAction();
  if (!result.ok) {
    return (
      <SectionError
        title="Server Health"
        heading="Server Health could not load"
        error={result.error}
      />
    );
  }
  return <HealthScreen health={result.data} />;
}
