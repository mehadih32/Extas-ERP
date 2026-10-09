import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { CostHeads } from "@/components/production/cost-heads";
import { ProductionNoAccess } from "@/components/production/no-access";
import { getCostHeadsScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Cost heads" };

/**
 * The production cost heads (production.view, like GET /api/production/cost-heads);
 * changing them is offered to production.manage, the permission the cost head
 * actions check.
 */
export default async function CostHeadsPage() {
  await requireCompanyPage();
  const result = await getCostHeadsScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError
        title="Cost heads"
        heading="The cost heads could not load"
        error={result.error}
      />
    );
  }

  return (
    <section aria-labelledby="heads-heading" className="grid gap-6">
      <div>
        <h2 id="heads-heading" className="font-serif text-2xl text-primary">
          Cost heads
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          What production money is spent on. Every bill line and cost is filed under one, and each
          project&apos;s cost sheet adds them up.
        </p>
      </div>
      <CostHeads screen={result.data} />
    </section>
  );
}
