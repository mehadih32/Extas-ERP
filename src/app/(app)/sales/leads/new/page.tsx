import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { AddLeadForm } from "@/components/leads/add-lead-form";
import { SalesNoAccess } from "@/components/sales/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getAddLeadFormAction } from "@/server/actions/leads.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Add lead" };

/** A new lead: for leads.manage, the permission addLeadAction checks. */
export default async function NewLeadPage() {
  await requireCompanyPage();
  const result = await getAddLeadFormAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <SalesNoAccess title="Adding leads is not part of your role">
          Your administrator can give your role the permission to add and edit leads.
        </SalesNoAccess>
      );
    }
    return <SectionError title="Add lead" heading="The form could not load" error={result.error} />;
  }
  return (
    <div className="grid gap-6">
      <BackLink href="/sales/leads">All leads</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Add lead</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Only the company name is needed; the rest can follow. The ERP warns when it looks like a
          lead or buyer already there.
        </p>
      </div>
      <AddLeadForm form={result.data} />
    </div>
  );
}
