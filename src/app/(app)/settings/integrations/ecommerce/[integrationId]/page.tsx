import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiTimeZone } from "@/components/ai/when";
import { SectionError } from "@/components/dashboard/section-error";
import { ShopScreen } from "@/components/settings/integrations/shop-screen";
import { NoAccess } from "@/components/settings/no-access";
import { getShopAction } from "@/server/actions/ecommerce.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Online shop" };

/**
 * One online shop (CN-005): its connection, its API key (made, rotated and
 * revoked here), the address to give the shop, "Send test", the webhook log
 * (?status= filters it) and its latest API calls.
 */
export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ integrationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ integrationId }, { status }] = await Promise.all([params, searchParams]);
  const result = await getShopAction(integrationId, {
    status: typeof status === "string" ? status : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Online shops are not part of your role">
          Your administrator can give your role the permission to connect online shops.
        </NoAccess>
      );
    }
    return (
      <SectionError
        title="Online shop"
        heading="The online shop could not load"
        error={result.error}
      />
    );
  }
  return (
    <AiTimeZone timeZone={ctx.company.timezone}>
      <ShopScreen page={result.data} />
    </AiTimeZone>
  );
}
