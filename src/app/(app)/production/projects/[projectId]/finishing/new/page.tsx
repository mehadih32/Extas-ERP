import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { FinishingCountForm } from "@/components/production/finishing-count-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getFinishingScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New finishing count" };

/**
 * A finishing count for a style (production.manage or production.stock_intake, as
 * createFinishingCountAction): pieces graded A, B or C (mending), with rejects apart.
 */
export default async function NewFinishingCountPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage") && !ctx.can("production.stock_intake")) {
    return (
      <ProductionNoAccess title="Counting finishing is not part of your role">
        Production Managers and the store count finishing (production.manage or
        production.stock_intake). Your administrator can give your role that permission.
      </ProductionNoAccess>
    );
  }
  const { projectId } = await params;
  const result = await getFinishingScreenAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Finishing" heading="The style could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const p = screen.project;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.finishing(p.id)}>{p.code} · Finishing and QC</BackLink>
      <div>
        <p className="eyebrow">{p.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">New finishing count</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The pieces checked at finishing, by colour and size: A-grade, B-grade, C-grade (to
          mending) and rejects (sewing faults).
        </p>
      </div>
      {screen.can.count ? (
        <FinishingCountForm screen={screen} currency={ctx.company.currency} />
      ) : (
        <EmptyState title="Counting is closed">
          {screen.packed
            ? `The full packing list ${screen.packed.number} is received, so the counts stay as they are.`
            : `${p.code} is ${p.status.toLowerCase()}; nothing more is counted for it.`}
        </EmptyState>
      )}
    </div>
  );
}
