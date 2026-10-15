import type { Metadata } from "next";

import { AiNoAccess } from "@/components/ai/no-access";
import { OrdersList } from "@/components/ai/orders-list";
import { SectionError } from "@/components/dashboard/section-error";
import { listOrderRunsAction } from "@/server/actions/orders.actions";

export const metadata: Metadata = { title: "AI Orders" };

/** Orders (ai.view or ai.manage): the new orders given to Mehedi 2.0 and what each waits for. */
export default async function AiOrdersPage() {
  const result = await listOrderRunsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Orders" heading="The orders could not load" error={result.error} />;
  }
  return (
    <OrdersList
      rows={result.data.rows}
      dryRunsLeft={result.data.dryRunsLeft}
      canManage={result.data.canManage}
      buyers={result.data.buyers}
    />
  );
}
