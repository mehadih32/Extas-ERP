import { redirect } from "next/navigation";

import { PartiesNoAccess } from "@/components/parties/no-access";
import { visiblePartiesTabs } from "@/components/parties/tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/** Buyers & suppliers opens on the first tab this person may see. */
export default async function PartiesPage() {
  const ctx = await requireCompanyPage();
  const first = visiblePartiesTabs(ctx.permissions)[0];
  if (!first) return <PartiesNoAccess />;
  redirect(first.href);
}
