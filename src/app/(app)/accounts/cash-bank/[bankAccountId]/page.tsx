import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OffBadge } from "@/components/accounts/badges";
import { BankActions } from "@/components/accounts/bank-actions";
import { accountsHref, isNegative, signedMoney } from "@/components/accounts/labels";
import { LedgerLines, LedgerSummary } from "@/components/accounts/ledger-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { dayParam } from "@/components/parties/route";
import { StatementRange } from "@/components/parties/statement-range";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
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
import { formatCount, formatDayRange, formatMonth } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { BankScreen } from "@/modules/accounts/screens.service";
import { getBankScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Bank account" };

function Months({ screen, currency }: { screen: BankScreen; currency: string }) {
  if (screen.months.length < 2) return null;
  return (
    <Panel title="Month by month" id="months-heading">
      <p className="mt-1 text-sm text-muted-foreground">
        The average is of the balance at the end of each day, the figure banks look at.
      </p>
      <ol className="mt-4 grid grid-cols-1 divide-y md:hidden" aria-label="Months">
        {screen.months.map((m) => (
          <li key={m.month} className="grid gap-1 py-3 text-sm tabular-nums first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{formatMonth(m.month)}</span>
              <span>{signedMoney(m.closingBalance, currency)}</span>
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">
              In {money(m.deposits, currency)} · out {money(m.withdrawals, currency)} · average{" "}
              {signedMoney(m.averageBalance, currency)}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-4 hidden md:block">
        <Table aria-label="Months">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Deposits</TableHead>
              <TableHead className="text-right">Withdrawals</TableHead>
              <TableHead className="text-right">Average</TableHead>
              <TableHead className="text-right">Closing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {screen.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="whitespace-nowrap">{formatMonth(m.month)}</TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {money(m.deposits, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {money(m.withdrawals, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {signedMoney(m.averageBalance, currency)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap tabular-nums",
                    isNegative(m.closingBalance) && "text-destructive",
                  )}
                >
                  {signedMoney(m.closingBalance, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}

/**
 * One bank account (accounts.view, like GET /api/accounts/bank-accounts/:id and
 * its statement): its details and balance, then its statement for the days
 * chosen, as the books record it, with a month-by-month summary.
 */
export default async function BankAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ bankAccountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ bankAccountId }, query] = await Promise.all([params, searchParams]);
  const range = { from: dayParam(query.from), to: dayParam(query.to) };
  const result = await getBankScreenAction(bankAccountId, range);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    if (result.error.code !== "VALIDATION") {
      return (
        <SectionError
          title="Bank account"
          heading="The account could not load"
          error={result.error}
        />
      );
    }
  }
  const currency = ctx.company.currency;
  const today = localDay(new Date(), ctx.company.timezone);
  const screen = result.ok ? result.data : null;
  const b = screen?.bank;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/accounts/cash-bank">Cash & bank</BackLink>
        {screen && b && (
          <>
            <RecordHeader
              eyebrow={`Bank account · ledger ${b.ledgerAccount.code}`}
              title={`${b.bankName} ${b.accountNumber}`}
              badges={
                <>
                  {!b.isActive && <OffBadge>Closed</OffBadge>}
                  <span
                    className={cn(
                      "font-serif text-lg tabular-nums",
                      isNegative(b.balance) ? "text-destructive" : "text-primary",
                    )}
                  >
                    {signedMoney(b.balance, currency)}
                  </span>
                  <span className="text-sm text-muted-foreground">today</span>
                </>
              }
            />
            <BankActions key={b.id} screen={screen} currency={currency} today={today} />
          </>
        )}
      </div>

      {screen && b && (
        <Panel title="Details" id="details-heading">
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Account name">{b.accountName}</Fact>
            <Fact label="Bank and branch">
              {b.bankName}
              {b.branch ? `, ${b.branch}` : ""}
            </Fact>
            <Fact label="Routing number">{b.routingNumber ?? "Not recorded"}</Fact>
            <Fact label="SWIFT code">{b.swiftCode ?? "Not recorded"}</Fact>
          </dl>
          {screen.can.openEntries && (
            <p className="mt-4 text-sm">
              <Link
                href={accountsHref.account(b.ledgerAccount.id)}
                className="text-primary underline-offset-4 hover:underline"
              >
                Open its ledger in the chart of accounts
              </Link>
            </p>
          )}
        </Panel>
      )}

      <section aria-labelledby="statement-heading" className="grid gap-4">
        <div>
          <h3 id="statement-heading" className="font-serif text-2xl text-primary">
            Statement
          </h3>
          {screen && (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDayRange(screen.period.from, screen.period.to)}
            </p>
          )}
        </div>
        <StatementRange from={range.from ?? null} to={range.to ?? null} today={today}>
          {screen ? (
            <>
              <LedgerSummary
                figures={[
                  {
                    label: "Opening balance",
                    value: signedMoney(screen.summary.openingBalance, currency),
                  },
                  {
                    label: "Deposits",
                    value: money(screen.summary.totalDeposits, currency),
                    hint: `${formatCount(screen.summary.depositCount, currency)} in`,
                  },
                  {
                    label: "Withdrawals",
                    value: money(screen.summary.totalWithdrawals, currency),
                    hint: `${formatCount(screen.summary.withdrawalCount, currency)} out`,
                  },
                  {
                    label: "Closing balance",
                    value: signedMoney(screen.summary.closingBalance, currency),
                    alert: isNegative(screen.summary.closingBalance),
                    hint: `Average ${signedMoney(screen.summary.averageBalance, currency)}`,
                  },
                ]}
              />
              <Months screen={screen} currency={currency} />
              <LedgerLines
                lines={screen.transactions.map((t, index) => ({
                  key: `${t.entryId}-${index}`,
                  entryId: t.entryId,
                  day: t.day,
                  number: t.voucherNumber,
                  details: t.particulars,
                  note: t.reference,
                  left: t.deposit,
                  right: t.withdrawal,
                  balance: t.balance,
                }))}
                hiddenCount={screen.hiddenCount}
                columns={["Deposit", "Withdrawal"]}
                currency={currency}
                canOpen={screen.can.openEntries}
              />
            </>
          ) : (
            !result.ok && <FormAlert>{result.error.message}</FormAlert>
          )}
        </StatementRange>
      </section>
    </div>
  );
}
