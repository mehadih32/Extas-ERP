import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { IntakeForm } from "@/components/production/intake-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getIntakeFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Correct a delivery" };

/** A draft delivery's pieces: for production.stock_intake, the permission updateIntakeAction checks. */
export default async function EditDeliveryPage({
  params,
}: {
  params: Promise<{ intakeId: string }>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.stock_intake")) {
    return (
      <ProductionNoAccess title="Receiving goods is not part of your role">
        The store team receives factory deliveries. Your administrator can give your role that
        permission.
      </ProductionNoAccess>
    );
  }
  const { intakeId } = await params;
  const result = await getIntakeFormAction({ intakeId });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT") {
      return (
        <div className="grid gap-6">
          <BackLink href={productionHref.delivery(intakeId)}>The delivery</BackLink>
          <FormAlert tone="note">{result.error.message} Only a draft can be corrected.</FormAlert>
        </div>
      );
    }
    return (
      <SectionError title="Delivery" heading="The delivery could not load" error={result.error} />
    );
  }
  const { intake, project } = result.data;
  if (!intake || !project) notFound();

  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.delivery(intake.id)}>{intake.number}</BackLink>
      <div>
        <p className="eyebrow">
          {intake.number} · {project.code} · {project.name}
        </p>
        <h2 className="mt-2 font-serif text-2xl text-primary">Correct the delivery</h2>
      </div>
      <IntakeForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
