import { redirect } from "next/navigation";

import { canSeeFinancials } from "@/modules/dashboard/access";
import { requireCompanyPage } from "@/server/pages/guards";

/** Business opens on the Overview, or on Retail stores for a role without the financials. */
export default async function BusinessPage() {
  const ctx = await requireCompanyPage();
  redirect(canSeeFinancials(ctx) ? "/business/overview" : "/business/stores");
}
