import type { Metadata } from "next";
import Link from "next/link";

import { accountsHref, columnAmount } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { ReportAsOf } from "@/components/accounts/report-controls";
import { asOfFrom } from "@/components/accounts/report-view";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { getTrialBalanceAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Trial balance" };

const linkClass = "underline-offset-4 hover:text-primary hover:underline";
const owed = (fixed: string) => /[1-9]/.test(fixed);

/**
 * The trial balance at the end of a day (accounts.view, like GET
 * /api/accounts/reports/trial-balance): every account with a balance, on its
 * debit or credit side, and the two totals, which match when the books do.
 */
export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const asOf = asOfFrom(await searchParams);
  const result = await getTrialBalanceAction({ asOf });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    if (result.error.code !== "VALIDATION") {
      return (
        <SectionError
          title="Trial balance"
          heading="The report could not load"
          error={result.error}
        />
      );
    }
  }
  const currency = ctx.company.currency;
  const today = localDay(new Date(), ctx.company.timezone);
  const r = result.ok ? result.data : null;

  return (
    <section aria-labelledby="tb-heading" className="grid gap-6">
      <BackLink href="/accounts/reports">Financial reports</BackLink>
      <div>
        <h2 id="tb-heading" className="font-serif text-2xl text-primary">
          Trial balance
        </h2>
        {r && (
          <p className="mt-1 text-sm text-muted-foreground">At the end of {formatDay(r.asOf)}</p>
        )}
      </div>

      <ReportAsOf asOf={asOf} today={today}>
        {r ? (
          r.lines.length === 0 ? (
            <EmptyState title="Nothing in the books yet">
              Balances show here once sales, payments and bills are recorded.
            </EmptyState>
          ) : (
            <>
              <FormAlert tone={r.balanced ? "success" : undefined}>
                {r.balanced
                  ? `Debits and credits both total ${money(r.totals.debit, currency)}.`
                  : `Debits total ${money(r.totals.debit, currency)} but credits ${money(
                      r.totals.credit,
                      currency,
                    )}. The books check shows where.`}
              </FormAlert>
              <Panel title="Balances" id="balances-heading">
                <ul className="mt-4 grid divide-y md:hidden" aria-label="Balances">
                  {r.lines.map((l) => (
                    <li
                      key={l.accountId}
                      className="flex min-w-0 items-baseline justify-between gap-3 py-2.5 text-sm"
                    >
                      <Link
                        href={accountsHref.account(l.accountId)}
                        className={`min-w-0 break-words ${linkClass}`}
                      >
                        <span className="mr-2 text-muted-foreground tabular-nums">{l.code}</span>
                        {l.name}
                      </Link>
                      <span className="whitespace-nowrap tabular-nums">
                        {owed(l.debit) ? "Dr " : "Cr "}
                        {money(owed(l.debit) ? l.debit : l.credit, currency)}
                      </span>
                    </li>
                  ))}
                  <li className="grid gap-1 pt-3 text-sm font-medium tabular-nums">
                    <span className="flex justify-between gap-3">
                      <span>Total debits</span>
                      <span>{money(r.totals.debit, currency)}</span>
                    </span>
                    <span className="flex justify-between gap-3">
                      <span>Total credits</span>
                      <span>{money(r.totals.credit, currency)}</span>
                    </span>
                  </li>
                </ul>
                <div className="mt-4 hidden md:block">
                  <Table aria-label="Balances">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.lines.map((l) => (
                        <TableRow key={l.accountId}>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {l.code}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <Link href={accountsHref.account(l.accountId)} className={linkClass}>
                              {l.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap tabular-nums">
                            {columnAmount(l.debit, currency)}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap tabular-nums">
                            {columnAmount(l.credit, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 hover:bg-transparent">
                        <TableCell colSpan={2} className="font-medium">
                          Total
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                          {money(r.totals.debit, currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                          {money(r.totals.credit, currency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            </>
          )
        ) : (
          !result.ok && <FormAlert>{result.error.message}</FormAlert>
        )}
      </ReportAsOf>
    </section>
  );
}
