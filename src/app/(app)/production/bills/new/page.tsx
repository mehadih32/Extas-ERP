import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { BillForm } from "@/components/production/bill-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getBillFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Enter a supplier bill" };

/**
 * A new supplier bill: for production.manage or accounts.payments.record, the
 * permissions createBillAction checks (paying it now is Accounts' alone).
 */
export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage") && !ctx.can("accounts.payments.record")) {
    return (
      <ProductionNoAccess title="Entering bills is not part of your role">
        Production Managers and Accounts enter supplier bills.
      </ProductionNoAccess>
    );
  }
  const query = await searchParams;
  const projectId = typeof query.project === "string" ? query.project : undefined;
  const result = await getBillFormAction({ projectId });
  if (!result.ok) {
    return (
      <SectionError title="Enter a bill" heading="The form could not load" error={result.error} />
    );
  }
  const project = result.data.project;

  return (
    <div className="grid gap-6">
      <BackLink href={project ? productionHref.project(project.id) : "/production/bills"}>
        {project ? project.code : "All bills"}
      </BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Enter a supplier bill</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          A bill for one project, or split across several. Each project carries its share in its
          cost.
        </p>
      </div>
      <BillForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
