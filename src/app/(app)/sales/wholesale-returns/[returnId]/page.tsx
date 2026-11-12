import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { SalesNoAccess } from "@/components/sales/no-access";
import { WholesaleReturnScreen } from "@/components/sales/wholesale-return-screen";
import { getWholesaleReturnAction } from "@/server/actions/wholesale-returns.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Wholesale return" };

/** One wholesale return: what came back, the refund, the exchange and the QC split. */
export default async function WholesaleReturnPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  await requireCompanyPage();
  const { returnId } = await params;
  const result = await getWholesaleReturnAction(returnId);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Wholesale return"
        heading={
          result.error.code === "NOT_FOUND"
            ? "This return was not found"
            : "The return could not load"
        }
        error={result.error}
      />
    );
  }
  return <WholesaleReturnScreen r={result.data} />;
}
