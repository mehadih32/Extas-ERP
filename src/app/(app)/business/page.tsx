import { redirect } from "next/navigation";

import { canSeeFinancials } from "@/modules/dashboard/access";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * Business opens on the Overview, or on the first page the role may open:
 * Retail stores, then Returns (those who check returns), then Shop stock
 * (those who buy for the shops).
 */
export default async function BusinessPage() {
  const ctx = await requireCompanyPage();
  if (canSeeFinancials(ctx)) redirect("/business/overview");
  if (ctx.can("retail.view") || ctx.can("retail.manage")) redirect("/business/stores");
  if (ctx.can("retail.returns")) redirect("/business/returns");
  redirect("/business/shop-stock");
}
