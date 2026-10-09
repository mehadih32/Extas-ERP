import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { SalesNoAccess } from "@/components/sales/no-access";
import { QuotationForm } from "@/components/sales/quotation-form";
import { BackLink } from "@/components/settings/back-link";
import { getQuotationFormAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New quotation" };

/** A new quotation: for sales.quotation.manage, the permission createQuotationAction checks. */
export default async function NewQuotationPage() {
  await requireCompanyPage();
  const result = await getQuotationFormAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <SalesNoAccess title="Making quotations is not part of your role">
          Your administrator can give your role the permission to manage quotations.
        </SalesNoAccess>
      );
    }
    return (
      <SectionError title="New quotation" heading="The form could not load" error={result.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/sales/quotations">All quotations</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New quotation</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          It is saved as a draft. Mark it as sent once the buyer has it; once they accept, it
          becomes a proforma invoice that asks for the advance.
        </p>
      </div>
      <QuotationForm form={result.data} />
    </div>
  );
}
