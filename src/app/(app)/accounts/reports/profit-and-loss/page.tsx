import type { Metadata } from "next";

import { isNegative, PERIOD_LABELS, signedMoney } from "@/components/accounts/labels";
import { LedgerSummary } from "@/components/accounts/ledger-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { ReportBlock, ReportResult } from "@/components/accounts/report-bits";
import { ReportPeriod } from "@/components/accounts/report-controls";
import { periodQuery, periodViewFrom } from "@/components/accounts/report-view";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
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
import { formatDayRange, formatMonth } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getProfitAndLossAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Profit and loss" };

type Report = Extract<Awaited<ReturnType<typeof getProfitAndLossAction>>, { ok: true }>["data"];
type Month = NonNullable<Report["months"]>[number];

const margin = (pct: string | null) => (pct === null ? null : `${pct}% of sales`);

const MONTH_ROWS: Array<{ key: keyof Omit<Month, "month">; label: string; strong?: boolean }> = [
  { key: "revenue", label: "Sales" },
  { key: "costOfSales", label: "Cost of sales" },
  { key: "grossProfit", label: "Gross profit", strong: true },
  { key: "otherIncome", label: "Other income" },
  { key: "expenses", label: "Expenses" },
  { key: "netProfit", label: "Net profit", strong: true },
];

/** The month-by-month figures: a card per month on phones, a table from tablets up. */
function Months({ months, currency }: { months: Month[]; currency: string }) {
  return (
    <Panel title="Month by month" id="months-heading">
      <ol className="mt-4 grid grid-cols-1 divide-y md:hidden" aria-label="Months">
        {months.map((m) => (
          <li key={m.month} className="grid gap-1 py-3 text-sm tabular-nums first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{formatMonth(m.month)}</span>
              <span className={cn("font-medium", isNegative(m.netProfit) && "text-destructive")}>
                {signedMoney(m.netProfit, currency)}
              </span>
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">
              Sales {money(m.revenue, currency)} · gross {signedMoney(m.grossProfit, currency)} ·
              expenses {money(m.expenses, currency)}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-4 hidden md:block">
        <Table aria-label="Months">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Month</TableHead>
              {MONTH_ROWS.map((r) => (
                <TableHead key={r.key} className="text-right">
                  {r.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="whitespace-nowrap">{formatMonth(m.month)}</TableCell>
                {MONTH_ROWS.map((r) => (
                  <TableCell
                    key={r.key}
                    className={cn(
                      "text-right whitespace-nowrap tabular-nums",
                      r.strong && "font-medium",
                      isNegative(m[r.key]) && "text-destructive",
                    )}
                  >
                    {signedMoney(m[r.key], currency)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}

/**
 * Profit and loss for a period (accounts.view, like GET
 * /api/accounts/reports/profit-and-loss): this month unless another period or
 * days are chosen, optionally month by month. Each account opens its ledger.
 */
export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = periodViewFrom(await searchParams);
  const result = await getProfitAndLossAction(periodQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    if (result.error.code !== "VALIDATION") {
      return (
        <SectionError
          title="Profit and loss"
          heading="The report could not load"
          error={result.error}
        />
      );
    }
  }
  const currency = ctx.company.currency;
  const today = localDay(new Date(), ctx.company.timezone);
  const r = result.ok ? result.data : null;
  // Months still to come in a financial year would only add rows of zeros.
  const months = (r?.months ?? []).filter((m) => m.month <= today.slice(0, 7));

  return (
    <section aria-labelledby="pl-heading" className="grid gap-6">
      <BackLink href="/accounts/reports">Financial reports</BackLink>
      <div>
        <h2 id="pl-heading" className="font-serif text-2xl text-primary">
          Profit and loss
        </h2>
        {r && (
          <p className="mt-1 text-sm text-muted-foreground">
            {r.period.period === "CUSTOM" ? "" : `${PERIOD_LABELS[r.period.period]}: `}
            {formatDayRange(r.period.from, r.period.to)}
          </p>
        )}
      </div>

      <ReportPeriod view={view} resolved={r?.period ?? null} today={today} monthToggle>
        {r ? (
          <>
            <LedgerSummary
              figures={[
                { label: "Sales", value: money(r.revenue.total, currency) },
                {
                  label: "Gross profit",
                  value: signedMoney(r.grossProfit, currency),
                  alert: isNegative(r.grossProfit),
                  hint: margin(r.grossMarginPct) ?? undefined,
                },
                { label: "Expenses", value: money(r.expenses.total, currency) },
                {
                  label: "Net profit",
                  value: signedMoney(r.netProfit, currency),
                  alert: isNegative(r.netProfit),
                  hint: margin(r.netMarginPct) ?? undefined,
                },
              ]}
            />
            {months.length > 0 && <Months months={months} currency={currency} />}
            <Panel title="Statement" id="statement-heading">
              <div className="mt-4 grid max-w-3xl gap-6">
                <ReportBlock
                  title="Sales"
                  lines={r.revenue.lines}
                  total={r.revenue.total}
                  totalLabel="Total sales"
                  currency={currency}
                />
                <ReportBlock
                  title="Cost of sales"
                  lines={r.costOfSales.lines}
                  total={r.costOfSales.total}
                  currency={currency}
                />
                <ReportResult
                  label="Gross profit"
                  amount={r.grossProfit}
                  hint={margin(r.grossMarginPct)}
                  currency={currency}
                />
                {r.otherIncome.lines.length > 0 && (
                  <ReportBlock
                    title="Other income"
                    lines={r.otherIncome.lines}
                    total={r.otherIncome.total}
                    currency={currency}
                  />
                )}
                {r.expenses.groups.map((g) =>
                  g.lines.length > 0 ? (
                    <ReportBlock
                      key={g.key}
                      title={g.label}
                      lines={g.lines}
                      total={g.total}
                      currency={currency}
                    />
                  ) : null,
                )}
                {r.expenses.groups.every((g) => g.lines.length === 0) && (
                  <ReportBlock title="Expenses" lines={[]} currency={currency} />
                )}
                <ReportResult
                  label="Net profit"
                  amount={r.netProfit}
                  hint={margin(r.netMarginPct)}
                  currency={currency}
                  strong
                />
              </div>
            </Panel>
          </>
        ) : (
          !result.ok && <FormAlert>{result.error.message}</FormAlert>
        )}
      </ReportPeriod>
    </section>
  );
}
