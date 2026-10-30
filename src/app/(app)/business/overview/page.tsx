import type { Metadata } from "next";

import { AiTimeZone } from "@/components/ai/when";
import { OverviewScreen } from "@/components/business/overview-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { overviewPageAction } from "@/server/actions/retail.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Business overview" };

/** Business > Overview: the buying house and the retail stores together. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : undefined);
  const result = await overviewPageAction({
    period: one(query.period),
    from: one(query.from),
    to: one(query.to),
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="The business overview is not part of your role">
          Your administrator can give your role the permission to see the financials.
        </NoAccess>
      );
    }
    return (
      <SectionError title="Overview" heading="The overview could not load" error={result.error} />
    );
  }
  return (
    <AiTimeZone timeZone={ctx.company.timezone}>
      <OverviewScreen page={result.data} />
    </AiTimeZone>
  );
}
