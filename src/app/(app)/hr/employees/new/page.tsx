import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { EmployeeForm } from "@/components/hr/employee-form";
import { hrHref } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getEmployeeFormAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Add an employee" };

/** A new employee (hr.manage): their details, job and monthly salary from the day they join. */
export default async function NewEmployeePage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("hr.manage")) {
    return (
      <HrNoAccess title="Adding employees is not part of your role">
        HR managers add employees and set their salaries.
      </HrNoAccess>
    );
  }
  const result = await getEmployeeFormAction();
  if (!result.ok) {
    return (
      <SectionError
        title="Add an employee"
        heading="The form could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href={hrHref.employees}>All employees</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Add an employee</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Their salary counts from the day they join. Give them a login afterwards so they can check
          in, ask for leave and see their payslips.
        </p>
      </div>
      <EmployeeForm form={result.data} />
    </div>
  );
}
