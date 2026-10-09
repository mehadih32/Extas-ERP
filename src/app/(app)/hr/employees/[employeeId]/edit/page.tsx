import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmployeeForm } from "@/components/hr/employee-form";
import { hrHref } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getEmployeeFormAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change an employee" };

/** An employee's details, job and pay details (hr.manage); the salary changes from their page. */
export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const ctx = await requireCompanyPage();
  const { employeeId } = await params;
  if (!ctx.can("hr.manage")) {
    return (
      <HrNoAccess title="Changing employees is not part of your role">
        HR managers keep employees&apos; details.
      </HrNoAccess>
    );
  }
  const result = await getEmployeeFormAction(employeeId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError
        title="Change an employee"
        heading="The form could not load"
        error={result.error}
      />
    );
  }
  const e = result.data.employee;
  if (!e) notFound();

  return (
    <div className="grid gap-6">
      <BackLink href={hrHref.employee(e.id)}>{e.name}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Change {e.name}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {e.code}. Changes show on payslips from the next payroll.
        </p>
      </div>
      <EmployeeForm form={result.data} />
    </div>
  );
}
