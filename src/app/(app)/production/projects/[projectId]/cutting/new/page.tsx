import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { CmSettledNotice } from "@/components/production/cm-settled-notice";
import { CuttingReportForm } from "@/components/production/cutting-report-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getCuttingScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New cutting report" };

/**
 * A day's cutting report for a style (production.manage, as createCuttingReportAction):
 * pieces by colour and size, typed in or read by AI from a photo of the sheet.
 */
export default async function NewCuttingReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Recording cutting is not part of your role">
        Production Managers record cutting (production.manage). Your administrator can give your
        role that permission.
      </ProductionNoAccess>
    );
  }
  const { projectId } = await params;
  const result = await getCuttingScreenAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return <SectionError title="Cutting" heading="The style could not load" error={result.error} />;
  }
  const screen = result.data;
  const p = screen.project;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.cutting(p.id)}>{p.code} · Cutting and embroidery</BackLink>
      <div>
        <p className="eyebrow">{p.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">New cutting report</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The pieces cut today, by colour and size. Saving checks them against the fabric, the
          collars and cuffs ordered and the accessories issued, and alerts Production and the store
          if anything runs short.
        </p>
      </div>
      {screen.can.cut ? (
        <CuttingReportForm screen={screen} currency={ctx.company.currency} />
      ) : screen.cmSettlement ? (
        <CmSettledNotice
          settlement={screen.cmSettlement}
          from="this style's cutting"
          what="no cutting report can be added"
        />
      ) : (
        <EmptyState title="Cutting is closed">
          {p.code} is {p.status.toLowerCase()}; no more cutting is recorded for it.
        </EmptyState>
      )}
    </div>
  );
}
