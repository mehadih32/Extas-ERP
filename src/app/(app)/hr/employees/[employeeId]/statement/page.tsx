import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FlagBadge } from "@/components/hr/badges";
import { hrHref } from "@/components/hr/labels";
import { SalariesNoAccess } from "@/components/hr/no-access";
import { dayParam } from "@/components/parties/route";
import { EmptyState } from "@/components/products/bits";
import { RecordHeader } from "@/components/sales/detail-bits";
import { isZero, money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import { getStatementScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Employee statement" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * What an employee owes the company and is owed (hr.manage, hr.payroll or
 * accounts.view): every journal line naming them, from advances given and
 * taken back to salaries posted and paid. Entries open in Accounts for people
 * who see the journal.
 */
export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ employeeId }, query] = await Promise.all([params, searchParams]);
  const from = dayParam(query.from);
  const to = dayParam(query.to);
  const result = await getStatementScreenAction(employeeId, { from, to });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalariesNoAccess />;
    return (
      <SectionError title="Statement" heading="The statement could not load" error={result.error} />
    );
  }
  const s = result.data;
  const currency = ctx.company.currency;
  const amount = (fixed: string) => (isZero(fixed) ? "" : money(fixed, currency));

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={hrHref.employee(s.employee.id)}>{s.employee.name}</BackLink>
      <RecordHeader eyebrow={`${s.employee.code} · Statement`} title={s.employee.name} />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Stat
          label="Owes on advances"
          value={money(s.advanceBalance, currency)}
          hint={to ? `On ${formatDay(to)}` : "Now"}
          alert={!isZero(s.advanceBalance)}
        />
        <Stat
          label="Salary still to pay them"
          value={money(s.salaryPayable, currency)}
          hint="Approved, not yet paid"
        />
      </dl>

      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" aria-label="Dates">
        <label className="grid gap-2 text-sm font-medium">
          From
          <Input type="date" name="from" defaultValue={from} className="sm:w-44" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          To
          <Input type="date" name="to" defaultValue={to} className="sm:w-44" />
        </label>
        <Button type="submit" variant="outline" className="w-full sm:w-auto">
          Show
        </Button>
        {(from || to) && (
          <Link href={hrHref.statement(s.employee.id)} className={`text-sm ${linkClass} sm:mb-2.5`}>
            All dates
          </Link>
        )}
      </form>

      {s.lines.length === 0 ? (
        <EmptyState title="Nothing in the books yet">
          Advances, approved salaries and salary payments for {s.employee.name} show here.
        </EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Entries">
            {s.lines.map((l, index) => (
              <li key={`${l.entryId}-${index}`} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="eyebrow">
                    {l.href ? (
                      <Link href={l.href} className={linkClass}>
                        {l.number}
                      </Link>
                    ) : (
                      l.number
                    )}{" "}
                    · {formatDay(l.date)}
                  </p>
                  {(l.isReversed || l.isReversal) && (
                    <FlagBadge tone="closed">{l.isReversal ? "Reversal" : "Reversed"}</FlagBadge>
                  )}
                </div>
                <p className="mt-2 text-sm break-words">{l.description}</p>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">{l.account.name}</p>
                <p className="mt-3 flex justify-between border-t pt-3 text-sm tabular-nums">
                  <span className="text-muted-foreground">
                    {isZero(l.debit) ? "Credit" : "Debit"}
                  </span>
                  <span className="font-medium">
                    {money(isZero(l.debit) ? l.credit : l.debit, currency)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">
            <Table aria-label="Entries">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Entry</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.lines.map((l, index) => (
                  <TableRow key={`${l.entryId}-${index}`}>
                    <TableCell className="py-3 whitespace-nowrap">
                      {l.href ? (
                        <Link href={l.href} className={`font-medium ${linkClass}`}>
                          {l.number}
                        </Link>
                      ) : (
                        <span className="font-medium">{l.number}</span>
                      )}
                      <div className="text-[0.8125rem] text-muted-foreground">
                        {formatDay(l.date)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-96 break-words">{l.description}</div>
                      {(l.isReversed || l.isReversal) && (
                        <FlagBadge tone="closed">
                          {l.isReversal ? "Reversal" : "Reversed"}
                        </FlagBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.account.name}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {amount(l.debit)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {amount(l.credit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
