import { UserPlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { DirectoryStatsRow } from "@/components/hr/directory-stats";
import { EmployeeList } from "@/components/hr/employee-list";
import { HrFilters } from "@/components/hr/hr-filters";
import { hrHref } from "@/components/hr/labels";
import {
  employeeListQuery,
  employeeViewFrom,
  hrListSearch,
  isHrFiltered,
} from "@/components/hr/list-view";
import { HrNoAccess } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getEmployeeListAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Employees" };

/**
 * The employee directory (hr.view, hr.manage or hr.payroll): four counts at
 * the top (everyone, in today, on leave, new joiners), one search over name,
 * code, phone, WhatsApp, email, post and department, quick filters, and the
 * people by code as profile cards or a list, each with WhatsApp and call
 * buttons and a ⋮ menu. Salaries show to people who see salaries; adding
 * people is for HR (hr.manage).
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = employeeViewFrom(await searchParams);
  const result = await getEmployeeListAction(employeeListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Employees" heading="The employees could not load" error={result.error} />
    );
  }
  const { items, nextCursor, departments, seeSalaries, can, stats, today } = result.data;

  return (
    <section aria-labelledby="employees-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="employees-heading" className="font-serif text-2xl text-primary">
            Employees
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Everyone on the payroll: their post, contact and time here, with their 360° profile,
            attendance, leave and pay one tap away.
          </p>
        </div>
        {can.add && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={hrHref.newEmployee}>
              <UserPlusIcon aria-hidden />
              Add an employee
            </Link>
          </Button>
        )}
      </div>

      <DirectoryStatsRow stats={stats} currency={ctx.company.currency} />

      <HrFilters view={view} departments={departments}>
        {items.length === 0 ? (
          isHrFiltered(view) ? (
            <EmptyState title="No employees match">Clear the filters to see everyone.</EmptyState>
          ) : (
            <EmptyState
              title="No employees yet"
              action={
                can.add ? (
                  <Button asChild>
                    <Link href={hrHref.newEmployee}>Add the first employee</Link>
                  </Button>
                ) : undefined
              }
            >
              Each employee&apos;s salary, attendance and leave make up their monthly payroll.
            </EmptyState>
          )
        ) : (
          <EmployeeList
            key={hrListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
            seeSalaries={seeSalaries}
            can={can}
            today={today}
            timeZone={ctx.company.timezone}
          />
        )}
      </HrFilters>
    </section>
  );
}
