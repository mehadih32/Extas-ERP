import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { hrHref } from "@/components/hr/labels";
import { SalariesNoAccess } from "@/components/hr/no-access";
import { PayslipView } from "@/components/hr/payslip";
import { PrintButton } from "@/components/hr/print-button";
import { BackLink } from "@/components/settings/back-link";
import { getPayslipScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Payslip" };

/** One employee's payslip for a month (hr.manage, hr.payroll or accounts.view), ready to print. */
export default async function PayslipPage({
  params,
}: {
  params: Promise<{ runId: string; itemId: string }>;
}) {
  await requireCompanyPage();
  const { runId, itemId } = await params;
  const result = await getPayslipScreenAction(runId, itemId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalariesNoAccess />;
    return (
      <SectionError title="Payslip" heading="The payslip could not load" error={result.error} />
    );
  }
  const { slip, can } = result.data;

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <BackLink href={hrHref.payrollRun(runId)}>{slip.label}</BackLink>
        <div className="flex flex-col gap-2 sm:flex-row">
          {can.openEmployee && (
            <Link
              href={hrHref.employee(slip.employee.id)}
              className="self-center text-sm text-primary underline-offset-4 hover:underline"
            >
              {slip.employee.name}
            </Link>
          )}
          <PrintButton label="Print the payslip" />
        </div>
      </div>
      <PayslipView slip={slip} />
    </div>
  );
}
