import { HandCoinsIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { AdvanceList } from "@/components/hr/advance-list";
import { HrFilters } from "@/components/hr/hr-filters";
import { hrHref } from "@/components/hr/labels";
import {
  advanceListQuery,
  advanceViewFrom,
  hrListSearch,
  isHrFiltered,
} from "@/components/hr/list-view";
import { HrNoAccess } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { getAdvanceListAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Advances" };

/**
 * Salary advances, latest first (hr.manage, hr.payroll, accounts.view or
 * accounts.payments.record): open, settled or void, or one employee's.
 * Accounts pays them out (accounts.payments.record) and brings forward ones
 * owed from before the ERP (accounts.manage).
 */
export default async function AdvancesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = advanceViewFrom(await searchParams);
  const result = await getAdvanceListAction(advanceListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <HrNoAccess title="Advances are not part of your role">
          Salary advances show to HR managers, payroll and Accounts.
        </HrNoAccess>
      );
    }
    return (
      <SectionError title="Advances" heading="The advances could not load" error={result.error} />
    );
  }
  const { items, nextCursor, outstanding, employee, can } = result.data;
  const currency = ctx.company.currency;
  const named = employee
    ? { text: `Advances to ${employee.name}`, clear: "Everyone's advances" }
    : null;
  const canGive = can.give || can.bringForward;
  const newHref = hrHref.newAdvance(employee?.id);

  return (
    <section aria-labelledby="advances-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="advances-heading" className="font-serif text-2xl text-primary">
            Advances
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {outstanding.count > 0
              ? `${money(outstanding.amount, currency)} still owed on ${outstanding.count} open ${
                  outstanding.count === 1 ? "advance" : "advances"
                }${employee ? "" : " in all"}. Payroll takes them back from salaries.`
              : "Money paid to employees before payday, taken back from their salaries."}
          </p>
        </div>
        {canGive && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={newHref}>
              <HandCoinsIcon aria-hidden />
              {can.give ? "Give an advance" : "Bring an advance forward"}
            </Link>
          </Button>
        )}
      </div>

      <HrFilters view={view} named={named}>
        {items.length === 0 ? (
          isHrFiltered(view) ? (
            <EmptyState title="No advances match">Clear the filters to see them all.</EmptyState>
          ) : (
            <EmptyState title="No advances yet">
              An advance is taken back from the employee&apos;s salary, spent on a company expense,
              or returned in cash.
            </EmptyState>
          )
        ) : (
          <AdvanceList
            key={hrListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={currency}
          />
        )}
      </HrFilters>
    </section>
  );
}
