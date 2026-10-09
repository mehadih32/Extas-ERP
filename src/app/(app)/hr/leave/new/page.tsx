import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { hrHref } from "@/components/hr/labels";
import { LeaveForm } from "@/components/hr/leave-form";
import { HrNoAccess } from "@/components/hr/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getLeaveFormAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Record leave" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/** HR records leave for an employee (hr.manage), approved as it is recorded unless left waiting. */
export default async function NewLeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("hr.manage")) {
    return (
      <HrNoAccess title="Recording leave is not part of your role">
        HR managers record and decide leave. Ask for your own from My HR.
      </HrNoAccess>
    );
  }
  const employee = one((await searchParams).employee);
  const result = await getLeaveFormAction({ employeeId: employee });
  if (!result.ok) {
    return (
      <SectionError title="Record leave" heading="The form could not load" error={result.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href={hrHref.leave}>All leave</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Record leave</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Only working days count: weekly days off and holidays inside the dates are skipped.
        </p>
      </div>
      <LeaveForm form={result.data} />
    </div>
  );
}
