import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { AdvanceForm } from "@/components/hr/advance-form";
import { hrHref } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getAdvanceFormAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Give an advance" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * Paying an employee an advance (accounts.payments.record), or bringing one
 * forward from before the ERP (accounts.manage). Only Accounts moves money.
 */
export default async function NewAdvancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("accounts.payments.record") && !ctx.can("accounts.manage")) {
    return (
      <HrNoAccess title="Paying advances is not part of your role">
        Only Accounts pays money out. HR and payroll can see advances and how they are taken back.
      </HrNoAccess>
    );
  }
  const result = await getAdvanceFormAction({ employeeId: one((await searchParams).employee) });
  if (!result.ok) {
    return (
      <SectionError
        title="Give an advance"
        heading="The form could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href={hrHref.advances}>All advances</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">
          {result.data.can.give ? "Give an advance" : "Bring an advance forward"}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Money paid to an employee before payday, taken back from their salary.
        </p>
      </div>
      <AdvanceForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
