import { CalendarPlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { HrFilters } from "@/components/hr/hr-filters";
import { hrHref } from "@/components/hr/labels";
import { LeaveList } from "@/components/hr/leave-list";
import {
  hrListSearch,
  isHrFiltered,
  leaveListQuery,
  leaveViewFrom,
} from "@/components/hr/list-view";
import { HrNoAccess } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getLeaveListAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Leave" };

/**
 * Leave requests, latest first (hr.view, hr.manage or hr.payroll): waiting,
 * approved, rejected or cancelled; by leave type or one employee's. HR records
 * leave and decides requests (hr.manage); employees ask from My HR.
 */
export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const view = leaveViewFrom(await searchParams);
  const result = await getLeaveListAction(leaveListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return <SectionError title="Leave" heading="The leave could not load" error={result.error} />;
  }
  const { items, nextCursor, leaveTypes, pending, employee, can } = result.data;
  const named = employee ? { text: `Leave of ${employee.name}`, clear: "Everyone's leave" } : null;
  const newHref = hrHref.newLeave(employee?.id);

  return (
    <section aria-labelledby="leave-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="leave-heading" className="font-serif text-2xl text-primary">
            Leave
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {pending > 0
              ? `${pending} ${pending === 1 ? "request is" : "requests are"} waiting for a decision.`
              : "Employees ask for leave from My HR; HR records leave asked for in person."}
          </p>
        </div>
        {can.record && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={newHref}>
              <CalendarPlusIcon aria-hidden />
              Record leave
            </Link>
          </Button>
        )}
      </div>

      <HrFilters view={view} leaveTypes={leaveTypes} named={named}>
        {items.length === 0 ? (
          isHrFiltered(view) ? (
            <EmptyState title="No leave matches">Clear the filters to see all leave.</EmptyState>
          ) : (
            <EmptyState title="No leave yet">
              Leave asked for and taken shows here, with each employee&apos;s allowance.
            </EmptyState>
          )
        ) : (
          <LeaveList key={hrListSearch(view)} initial={{ items, nextCursor }} view={view} />
        )}
      </HrFilters>
    </section>
  );
}
