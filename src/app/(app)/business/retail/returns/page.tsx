import type { Metadata } from "next";

import { AiTimeZone } from "@/components/ai/when";
import { ReturnsScreen } from "@/components/business/returns-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { returnsPageAction } from "@/server/actions/retail.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Returns" };

/** Business > Returns: the stores' returned parcels, on Hold, in Return stock and checked. */
export default async function ReturnsPage() {
  const ctx = await requireCompanyPage();
  const result = await returnsPageAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="The stores' returns are not part of your role">
          Your administrator can give your role the permission to check the stores&apos; returns.
        </NoAccess>
      );
    }
    return (
      <SectionError title="Returns" heading="The returns could not load" error={result.error} />
    );
  }
  return (
    <AiTimeZone timeZone={ctx.company.timezone}>
      <ReturnsScreen page={result.data} />
    </AiTimeZone>
  );
}
