import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import {
  SummaryFigures,
  SummaryPdfButton,
  SummaryPenalties,
  SummarySpent,
  SummaryStock,
  SummaryStyles,
} from "@/components/production/batch-summary";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { getBatchSummaryAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Batch summary" };

/**
 * A master batch's money story on one page (production.manage or accounts.view; like GET
 * /api/production/batches/:id/summary): total cost, cost a good piece, penalties and
 * deductions, and stock, with its PDF.
 */
export default async function BatchSummaryPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const ctx = await requireCompanyPage();
  const { batchId } = await params;
  const result = await getBatchSummaryAction(batchId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="The batch summary is not part of your role">
          It carries the batch&apos;s costs: Production Managers and Accounts see it. Your
          administrator can give your role that permission.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError
        title="Batch summary"
        heading="The batch summary could not load"
        error={result.error}
      />
    );
  }
  const s = result.data;
  const currency = ctx.company.currency;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.batch(s.batch.id)}>
        {s.batch.code} · {s.batch.name}
      </BackLink>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{s.batch.code}</p>
          <h2 className="mt-2 font-serif text-2xl break-words text-primary">Batch summary</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {s.batch.name}
            {s.batch.factory ? ` at ${s.batch.factory.name}` : ""}, started{" "}
            {formatDay(s.batch.startedOn)}
            {s.batch.targetOn ? `, all done by ${formatDay(s.batch.targetOn)}` : ""}.
          </p>
        </div>
        <SummaryPdfButton batchId={s.batch.id} />
      </div>
      <SummaryFigures s={s} currency={currency} />
      <SummaryStyles s={s} currency={currency} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SummarySpent s={s} currency={currency} />
        <div className="grid min-w-0 content-start gap-6">
          <SummaryPenalties s={s} currency={currency} />
          <SummaryStock s={s} currency={currency} />
        </div>
      </div>
    </div>
  );
}
