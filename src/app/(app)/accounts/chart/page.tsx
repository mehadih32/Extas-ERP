import type { Metadata } from "next";
import Link from "next/link";

import { AddAccount } from "@/components/accounts/chart-actions";
import { OffBadge } from "@/components/accounts/badges";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  accountsHref,
  isNegative,
  signedMoney,
  SUBTYPE_LABELS,
} from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { cn } from "@/lib/utils";
import { getChartScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Chart of accounts" };

/**
 * Every account in the books with its balance today, grouped by type
 * (accounts.view, like GET /api/accounts/chart). Each opens its ledger.
 * Adding one is offered with accounts.manage; "?archived=1" also lists
 * archived accounts.
 */
export default async function ChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const includeInactive = query.archived === "1";
  const result = await getChartScreenAction({ includeInactive });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Chart of accounts"
        heading="The accounts could not load"
        error={result.error}
      />
    );
  }
  const { accounts, creatable, can } = result.data;
  const currency = ctx.company.currency;

  return (
    <section aria-labelledby="chart-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="chart-heading" className="font-serif text-2xl text-primary">
            Chart of accounts
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every account in the books and what it holds today. Open one to see its ledger.
          </p>
        </div>
        {can.add && <AddAccount creatable={creatable} open={query.add === "1"} />}
      </div>
      <p className="text-sm">
        <Link
          href={includeInactive ? "/accounts/chart" : "/accounts/chart?archived=1"}
          scroll={false}
          className="text-primary underline-offset-4 hover:underline"
        >
          {includeInactive ? "Hide archived accounts" : "Show archived accounts"}
        </Link>
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {ACCOUNT_TYPES.map((type) => {
          const group = accounts.filter((a) => a.type === type);
          if (group.length === 0) return null;
          const headingId = `type-${type.toLowerCase()}-heading`;
          return (
            <Panel key={type} title={ACCOUNT_TYPE_LABELS[type]} id={headingId} className="min-w-0">
              <ul className="mt-4 grid divide-y" aria-labelledby={headingId}>
                {group.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={accountsHref.account(a.id)}
                      className={cn(
                        "flex min-w-0 items-baseline justify-between gap-3 rounded-sm py-3 outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
                        !a.isActive && "text-muted-foreground",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span className="text-muted-foreground tabular-nums">{a.code}</span>
                          <span className="break-words">{a.name}</span>
                          {!a.isActive && <OffBadge>Archived</OffBadge>}
                          {a.isSystem && <StatusBadge tone="plain">System</StatusBadge>}
                        </span>
                        <span className="block text-[0.8125rem] break-words text-muted-foreground">
                          {SUBTYPE_LABELS[a.subType]}
                          {a.linkedTo ? ` · ${a.linkedTo.name}` : ""}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "text-sm whitespace-nowrap tabular-nums",
                          isNegative(a.balance) && "text-destructive",
                        )}
                      >
                        {signedMoney(a.balance, currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </section>
  );
}
