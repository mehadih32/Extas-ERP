import { redirect } from "next/navigation";

import { SalesNoAccess } from "@/components/sales/no-access";
import { visibleSalesTabs } from "@/components/sales/tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/** Sales opens on the first tab this person may see. */
export default async function SalesPage() {
  const ctx = await requireCompanyPage();
  const first = visibleSalesTabs(ctx.permissions)[0];
  if (!first) return <SalesNoAccess />;
  redirect(first.href);
}
