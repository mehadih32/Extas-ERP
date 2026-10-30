import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiTimeZone } from "@/components/ai/when";
import { StoreScreen } from "@/components/business/store-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { getStoreAction } from "@/server/actions/retail.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Retail store" };

/** One retail store: its details, its price rules, hand prices, the prices it sees and their history. */
export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ storeId }, { search }] = await Promise.all([params, searchParams]);
  const result = await getStoreAction(storeId, {
    search: typeof search === "string" ? search : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Retail stores are not part of your role">
          Your administrator can give your role the permission to see the retail stores.
        </NoAccess>
      );
    }
    return (
      <SectionError title="Retail store" heading="The store could not load" error={result.error} />
    );
  }
  return (
    <AiTimeZone timeZone={ctx.company.timezone}>
      <StoreScreen page={result.data} />
    </AiTimeZone>
  );
}
