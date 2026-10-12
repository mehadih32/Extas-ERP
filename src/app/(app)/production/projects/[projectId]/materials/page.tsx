import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { productionHref } from "@/components/production/labels";
import { MaterialNeedsForm } from "@/components/production/material-needs-form";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getNeedsFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Materials per piece" };

/**
 * A style's materials per piece and tech pack notes: for production.manage, the
 * permission setMaterialNeedsAction checks.
 */
export default async function MaterialNeedsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Changing materials per piece is not part of your role">
        Production Managers set what each piece takes. Your administrator can give your role that
        permission.
      </ProductionNoAccess>
    );
  }
  const { projectId } = await params;
  const result = await getNeedsFormAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Materials" heading="The materials could not load" error={result.error} />
    );
  }
  const p = result.data.project;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.project(p.id)}>
        {p.code} · {p.name}
      </BackLink>
      <div>
        <p className="eyebrow">
          {p.code}
          {p.batch ? ` · ${p.batch.code}` : ""}
        </p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Materials per piece</h2>
      </div>
      <MaterialNeedsForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
