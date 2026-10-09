import type { Metadata } from "next";

import { signedMoney } from "@/components/accounts/labels";
import { LedgerSummary } from "@/components/accounts/ledger-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { ReportBlock, ReportResult } from "@/components/accounts/report-bits";
import { ReportAsOf } from "@/components/accounts/report-controls";
import { asOfFrom } from "@/components/accounts/report-view";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { getBalanceSheetAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Balance sheet" };

/**
 * The balance sheet at the end of a day (accounts.view, like GET
 * /api/accounts/reports/balance-sheet): today unless another day is chosen.
 * Each account opens its ledger.
 */
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const asOf = asOfFrom(await searchParams);
  const result = await getBalanceSheetAction({ asOf });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    if (result.error.code !== "VALIDATION") {
      return (
        <SectionError
          title="Balance sheet"
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
    <section aria-labelledby="bs-heading" className="grid gap-6">
      <BackLink href="/accounts/reports">Financial reports</BackLink>
      <div>
        <h2 id="bs-heading" className="font-serif text-2xl text-primary">
          Balance sheet
        </h2>
        {r && (
          <p className="mt-1 text-sm text-muted-foreground">At the end of {formatDay(r.asOf)}</p>
        )}
      </div>

      <ReportAsOf asOf={asOf} today={today}>
        {r ? (
          <>
            <LedgerSummary
              figures={[
                { label: "Total assets", value: signedMoney(r.assets.total, currency) },
                { label: "Total liabilities", value: signedMoney(r.liabilities.total, currency) },
                { label: "Owner's equity", value: signedMoney(r.equity.total, currency) },
              ]}
            />
            {!r.balanced && (
              <FormAlert>
                Assets differ from liabilities and equity by {signedMoney(r.difference, currency)}.
                The books check shows where.
              </FormAlert>
            )}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Panel title="What the business owns" id="assets-heading" className="min-w-0">
                <div className="mt-4 grid gap-6">
                  <ReportBlock
                    title="Current assets"
                    lines={r.assets.current.lines}
                    total={r.assets.current.total}
                    currency={currency}
                  />
                  <ReportBlock
                    title="Fixed assets"
                    lines={r.assets.fixed.lines}
                    total={r.assets.fixed.netBookValue}
                    totalLabel="Fixed assets after depreciation"
                    currency={currency}
                  >
                    <p className="flex items-baseline justify-between gap-3 py-2 text-sm text-muted-foreground">
                      <span>Less depreciation so far</span>
                      <span className="whitespace-nowrap tabular-nums">
                        {signedMoney(r.assets.fixed.accumulatedDepreciation, currency)}
                      </span>
                    </p>
                  </ReportBlock>
                  <ReportResult
                    label="Total assets"
                    amount={r.assets.total}
                    currency={currency}
                    strong
                  />
                </div>
              </Panel>
              <Panel
                title="What it owes, and the owners' share"
                id="liabilities-heading"
                className="min-w-0"
              >
                <div className="mt-4 grid gap-6">
                  <ReportBlock
                    title="Current liabilities"
                    lines={r.liabilities.current.lines}
                    total={r.liabilities.current.total}
                    currency={currency}
                  />
                  <ReportBlock
                    title="Loans and investors"
                    lines={r.liabilities.loansAndInvestors.lines}
                    total={r.liabilities.loansAndInvestors.total}
                    currency={currency}
                  />
                  <ReportResult
                    label="Total liabilities"
                    amount={r.liabilities.total}
                    currency={currency}
                  />
                  <ReportBlock
                    title="Owner's equity"
                    lines={r.equity.lines}
                    total={r.equity.total}
                    totalLabel="Total owner's equity"
                    currency={currency}
                  />
                  <ReportResult
                    label="Liabilities and equity"
                    amount={r.totalLiabilitiesAndEquity}
                    currency={currency}
                    strong
                  />
                </div>
              </Panel>
            </div>
          </>
        ) : (
          !result.ok && <FormAlert>{result.error.message}</FormAlert>
        )}
      </ReportAsOf>
    </section>
  );
}
