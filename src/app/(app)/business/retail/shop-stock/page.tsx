import type { Metadata } from "next";

import { AiTimeZone } from "@/components/ai/when";
import { ShopStockScreen } from "@/components/business/shop-stock-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { shopStockPageAction } from "@/server/actions/retail.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Shop stock" };

/** Business > Shop stock: the shops' reserve and ready stock bought for them. */
export default async function ShopStockPage() {
  const ctx = await requireCompanyPage();
  const result = await shopStockPageAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="The shops' stock is not part of your role">
          Your administrator can give your role the permission to see the retail stores.
        </NoAccess>
      );
    }
    return (
      <SectionError
        title="Shop stock"
        heading="The shops' stock could not load"
        error={result.error}
      />
    );
  }
  return (
    <AiTimeZone timeZone={ctx.company.timezone}>
      <ShopStockScreen page={result.data} />
    </AiTimeZone>
  );
}
