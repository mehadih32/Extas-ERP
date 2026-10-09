import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { ChooseProject } from "@/components/production/choose-project";
import { IntakeForm } from "@/components/production/intake-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getIntakeFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Receive goods" };

/**
 * Receiving a factory delivery (Move to Stock): for production.stock_intake,
 * the permission createIntakeAction checks. It starts from a project, chosen
 * here when the link did not name one.
 */
export default async function NewDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
  const query = await searchParams;
  const projectId = typeof query.project === "string" ? query.project : undefined;

  const heading = (
    <div>
      <h2 className="font-serif text-2xl text-primary">Receive goods</h2>
      <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Count a factory&apos;s delivery in, colour by colour and size by size. It is kept as a draft
        until it is confirmed into stock.
      </p>
    </div>
  );

  if (!projectId) {
    return (
      <div className="grid gap-6">
        <BackLink href="/production/deliveries">All deliveries</BackLink>
        {heading}
        <ChooseProject />
      </div>
    );
  }

  const result = await getIntakeFormAction({ projectId });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT") {
      return (
        <div className="grid gap-6">
          <BackLink href={productionHref.project(projectId)}>The project</BackLink>
          {heading}
          <FormAlert tone="note">
            {result.error.message}{" "}
            <Link
              href="/production/deliveries/new"
              className="font-medium underline underline-offset-4"
            >
              Choose another project
            </Link>
          </FormAlert>
        </div>
      );
    }
    return (
      <SectionError title="Receive goods" heading="The form could not load" error={result.error} />
    );
  }
  const project = result.data.project!;

  return (
    <div className="grid gap-6">
      <BackLink
        href={
          ctx.can("production.view") ? productionHref.project(project.id) : "/production/deliveries"
        }
      >
        {ctx.can("production.view") ? project.code : "All deliveries"}
      </BackLink>
      <div>
        <p className="eyebrow">
          {project.code} · {project.name}
        </p>
        <h2 className="mt-2 font-serif text-2xl text-primary">Receive goods</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Count the delivery in, colour by colour and size by size. It is kept as a draft until it
          is confirmed into stock.
        </p>
      </div>
      <IntakeForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
