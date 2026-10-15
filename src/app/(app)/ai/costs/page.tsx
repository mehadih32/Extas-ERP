import type { Metadata } from "next";

import { BudgetForm } from "@/components/ai/budget-form";
import { CostsScreen } from "@/components/ai/costs-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getCostsAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "AI Budget & Costs" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

/**
 * Budget & Costs (ai.view or ai.manage): what the AI spent in a period, by
 * task, model, area, agent, person, record and store, every call with its
 * reason, and a PDF or Excel file of it; the owner (ai.manage) sets the
 * budget and limits here.
 */
export default async function AiCostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const result = await getCostsAction({
    period: one(params.period),
    from: one(params.from),
    to: one(params.to),
    userId: one(params.person),
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return (
      <SectionError
        title="Budget & Costs"
        heading="The AI costs could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <CostsScreen costs={result.data} />
      {result.data.can.manage && (
        <BudgetForm budget={result.data.budget} currency={result.data.currency} />
      )}
    </div>
  );
}
