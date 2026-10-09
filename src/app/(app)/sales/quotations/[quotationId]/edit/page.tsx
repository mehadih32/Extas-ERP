import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { QuotationForm } from "@/components/sales/quotation-form";
import { BackLink } from "@/components/settings/back-link";
import { getQuotationFormAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Edit quotation" };

/**
 * A draft or sent quotation's details: for sales.quotation.manage, the
 * permission updateQuotationAction checks. One that can no longer change
 * (accepted, rejected or made into a proforma) goes back to its page.
 */
export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ quotationId: string }>;
}) {
  await requireCompanyPage();
  const { quotationId } = await params;
  const result = await getQuotationFormAction(quotationId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT") redirect(salesHref.quotation(quotationId));
    if (result.error.code === "FORBIDDEN") {
      return (
        <SalesNoAccess title="Changing quotations is not part of your role">
          Your administrator can give your role the permission to manage quotations.
        </SalesNoAccess>
      );
    }
    return (
      <SectionError title="Edit quotation" heading="The form could not load" error={result.error} />
    );
  }
  const q = result.data.quotation!;

  return (
    <div className="grid gap-6">
      <BackLink href={salesHref.quotation(q.id)}>{q.number}</BackLink>
      <div>
        <p className="eyebrow">{q.number}</p>
        <h2 className="mt-2 font-serif text-2xl text-primary">Edit quotation</h2>
      </div>
      <QuotationForm form={result.data} />
    </div>
  );
}
