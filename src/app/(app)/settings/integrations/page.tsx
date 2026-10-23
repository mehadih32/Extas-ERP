import type { Metadata } from "next";

import { AiTimeZone } from "@/components/ai/when";
import { SectionError } from "@/components/dashboard/section-error";
import { ShopsScreen } from "@/components/settings/integrations/shops-screen";
import { NoAccess } from "@/components/settings/no-access";
import { listShopsAction } from "@/server/actions/ecommerce.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Integrations" };

/**
 * Settings > Integrations > E-commerce (CN-005): the company's online shops and
 * "Add online shop" (integrations.ecommerce.manage, the same check as the actions).
 */
export default async function IntegrationsPage() {
  const ctx = await requireCompanyPage();
  const result = await listShopsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Online shops are not part of your role">
          Your administrator can give your role the permission to connect online shops.
        </NoAccess>
      );
    }
    return (
      <SectionError
        title="Integrations"
        heading="The online shops could not load"
        error={result.error}
      />
    );
  }
  return (
    <AiTimeZone timeZone={ctx.company.timezone}>
      <ShopsScreen list={result.data} />
    </AiTimeZone>
  );
}
