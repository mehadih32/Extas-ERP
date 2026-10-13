import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { BatchForm } from "@/components/production/batch-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getBatchFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Edit master batch" };

/** A batch's details: for production.manage, the permission updateBatchAction checks. */
export default async function EditBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Changing batches is not part of your role">
        Production Managers change batches. Your administrator can give your role that permission.
      </ProductionNoAccess>
    );
  }
  const { batchId } = await params;
  const result = await getBatchFormAction(batchId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return <SectionError title="Batch" heading="The batch could not load" error={result.error} />;
  }
  const batch = result.data.batch;
  if (!batch) notFound();
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.batch(batch.id)}>{batch.code}</BackLink>
      <div>
        <p className="eyebrow">{batch.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Edit {batch.name}</h2>
      </div>
      <BatchForm form={result.data} />
    </div>
  );
}
