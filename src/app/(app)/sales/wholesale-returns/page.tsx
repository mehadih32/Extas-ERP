import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { SalesNoAccess } from "@/components/sales/no-access";
import { WholesaleReturnList } from "@/components/sales/wholesale-return-list";
import { listWholesaleReturnsAction } from "@/server/actions/wholesale-returns.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Wholesale returns" };

/** Sales > Wholesale returns: receive, approve and QC, with the month's figures by buyer. */
export default async function WholesaleReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const result = await listWholesaleReturnsAction({
    status: one("status"),
    search: one("q"),
    from: one("from"),
    to: one("to"),
    month: one("month"),
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Wholesale returns"
        heading="The wholesale returns could not load"
        error={result.error}
      />
    );
  }
  return <WholesaleReturnList page={result.data} />;
}
