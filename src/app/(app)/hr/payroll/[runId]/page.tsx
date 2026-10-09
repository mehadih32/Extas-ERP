import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge, PayrollBadge } from "@/components/hr/badges";
import { hrHref } from "@/components/hr/labels";
import { SalariesNoAccess } from "@/components/hr/no-access";
import { PayrollActions, PayrollLines, SalaryPayments } from "@/components/hr/payroll-actions";
import { Panel, RecordHeader } from "@/components/sales/detail-bits";
import { isZero, money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatCount } from "@/lib/display";
import { getPayrollScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Payroll" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One month's payroll (hr.manage, hr.payroll or accounts.view): every
 * employee's line and payslip, the totals, the salary payments, and preparing,
 * approving, reopening or paying it as hr/rules.ts allows.
 */
export default async function PayrollRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const result = await getPayrollScreenAction(runId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalariesNoAccess />;
    return (
      <SectionError title="Payroll" heading="The payroll could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { run, can, notes } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `${run.label} was prepared for ${formatCount(run.employees, currency)} ${
          run.employees === 1 ? "employee" : "employees"
        }. Check the lines, then approve it.`
      : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={hrHref.payroll}>All payroll</BackLink>
        <RecordHeader
          eyebrow={`Payroll · ${formatCount(run.employees, currency)} ${run.employees === 1 ? "employee" : "employees"}`}
          title={run.label}
          badges={
            <>
              <PayrollBadge status={run.status} />
              {run.journalEntry?.isReversed && <FlagBadge tone="closed">Reversed</FlagBadge>}
            </>
          }
        />
        <PayrollActions key={run.id} screen={screen} currency={currency} notice={notice} />
        {notes.approve && <FormAlert tone="note">{notes.approve}</FormAlert>}
        {notes.reopen && <FormAlert tone="note">{notes.reopen}</FormAlert>}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Gross pay" value={money(run.totals.gross, currency)} />
        <Stat label="Deductions" value={money(run.totals.deductions, currency)} />
        <Stat label="Take home" value={money(run.totals.net, currency)} />
        <Stat
          label="Still to pay"
          value={run.status === "DRAFT" ? "–" : money(run.totals.unpaid, currency)}
          hint={
            run.status === "DRAFT"
              ? "Once approved"
              : isZero(run.totals.unpaid)
                ? "All paid"
                : undefined
          }
          alert={run.status !== "DRAFT" && !isZero(run.totals.unpaid)}
        />
      </dl>

      <section aria-labelledby="lines-heading" className="grid gap-4">
        <h3 id="lines-heading" className="font-serif text-xl text-primary">
          Employees
        </h3>
        <PayrollLines screen={screen} currency={currency} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Salary payments" id="payments-heading">
          <SalaryPayments screen={screen} currency={currency} />
        </Panel>
        <Panel title="In the books" id="books-heading">
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Prepared by</dt>
              <dd>{run.createdBy?.name ?? "–"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Approved by</dt>
              <dd>{run.approvedBy?.name ?? "Not yet"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Journal entry</dt>
              <dd>
                {run.journalEntry ? (
                  can.openJournal ? (
                    <Link href={hrHref.journal(run.journalEntry.id)} className={linkClass}>
                      {run.journalEntry.number}
                    </Link>
                  ) : (
                    run.journalEntry.number
                  )
                ) : (
                  "Posted when approved"
                )}
              </dd>
            </div>
            {run.notes && (
              <div className="grid gap-1 border-t pt-3">
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-line">{run.notes}</dd>
              </div>
            )}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
