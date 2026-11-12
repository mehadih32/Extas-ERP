import type { Metadata } from "next";

import { B2bScreen } from "@/components/business/b2b-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { b2bPageAction } from "@/server/actions/business.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "B2B customer acquisition" };

/** Business > B2B: what finding new wholesale buyers costs, by month. */
export default async function B2bPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const query = await searchParams;
  const result = await b2bPageAction({
    month: typeof query.month === "string" ? query.month : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Business > B2B is not part of your role">
          Your administrator can give your role the permission to see the financials.
        </NoAccess>
      );
    }
    return <SectionError title="B2B" heading="The B2B page could not load" error={result.error} />;
  }
  return <B2bScreen page={result.data} />;
}
