import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { BatchOrdersForm } from "@/components/production/batch-orders-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getBatchOrdersFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Make purchase orders" };

/** Purchase orders for a batch's materials: for materials.purchase, as createBatchOrdersAction. */
export default async function BatchOrdersPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.purchase")) {
    return (
      <ProductionNoAccess title="Buying materials is not part of your role">
        Buyers make purchase orders (materials.purchase). Your administrator can give your role that
        permission.
      </ProductionNoAccess>
    );
  }
  const { batchId } = await params;
  const result = await getBatchOrdersFormAction(batchId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError
        title="Orders"
        heading="The batch's materials could not load"
        error={result.error}
      />
    );
  }
  const b = result.data.batch;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.batch(b.id)}>
        {b.code} · {b.name}
      </BackLink>
      <div>
        <p className="eyebrow">{b.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Make purchase orders</h2>
      </div>
      <BatchOrdersForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
