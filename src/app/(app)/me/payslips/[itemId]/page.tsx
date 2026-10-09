import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hrHref } from "@/components/hr/labels";
import { MyHrProblem } from "@/components/hr/no-access";
import { PayslipView } from "@/components/hr/payslip";
import { PrintButton } from "@/components/hr/print-button";
import { BackLink } from "@/components/settings/back-link";
import { getMyPayslipScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Payslip" };

/** One of the employee's own payslips (portal.self), ready to print. */
export default async function MyPayslipPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requireCompanyPage();
  const { itemId } = await params;
  const result = await getMyPayslipScreenAction(itemId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <MyHrProblem error={result.error} title="Payslip" heading="The payslip could not load" />
    );
  }
  const { slip } = result.data;

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <BackLink href={hrHref.myPayslips}>All payslips</BackLink>
        <PrintButton label="Print the payslip" />
      </div>
      <PayslipView slip={slip} />
    </div>
  );
}
