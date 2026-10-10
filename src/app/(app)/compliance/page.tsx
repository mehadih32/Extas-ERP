import type { Metadata } from "next";
import Link from "next/link";

import { Stat } from "@/components/accounts/stat";
import { ComplianceBadge } from "@/components/compliance/badges";
import { ComplianceFilters } from "@/components/compliance/filters";
import { AddComplianceButton } from "@/components/compliance/forms";
import {
  complianceHref,
  complianceListQuery,
  complianceListSearch,
  complianceViewFrom,
  expiryWords,
  isComplianceFiltered,
} from "@/components/compliance/labels";
import { ComplianceList } from "@/components/compliance/list";
import { ComplianceNoAccess } from "@/components/compliance/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { Panel } from "@/components/sales/detail-bits";
import { formatDay } from "@/lib/display";
import { getComplianceScreenAction } from "@/server/actions/compliance.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Compliance" };

const NUMBER_LABELS = [
  ["tradeLicense", "Trade licence"],
  ["bin", "VAT registration (BIN)"],
  ["tin", "Tax ID (TIN)"],
  ["irc", "Import registration (IRC)"],
  ["erc", "Export registration (ERC)"],
] as const;

/**
 * The licences and registrations (compliance.view; compliance.manage adds and
 * renews them): where the company stands, what needs renewing, which of the
 * trade licence, BIN and TIN are missing, the numbers printed on documents,
 * and the list.
 */
export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const view = complianceViewFrom(await searchParams);
  const result = await getComplianceScreenAction(complianceListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ComplianceNoAccess />;
    return (
      <SectionError title="Compliance" heading="The licences could not load" error={result.error} />
    );
  }
  const { items, summary, can } = result.data;
  const { counts, needsRenewal, missing, numbers } = summary;

  return (
    <section aria-labelledby="compliance-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="compliance-heading" className="font-serif text-2xl text-primary">
            Licences &amp; registrations
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            The app reminds {can.manage ? "you" : "the people who see them"} in the app before each
            one expires, until it is renewed.
          </p>
        </div>
        {can.manage && <AddComplianceButton className="w-full sm:w-auto" />}
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In force" value={String(counts.total)} hint="Licences and registrations" />
        <Stat
          label="Renew soon"
          value={String(counts.expiring)}
          alert={counts.expiring > 0}
          hint="Inside their reminder window"
        />
        <Stat
          label="Expired"
          value={String(counts.expired)}
          alert={counts.expired > 0}
          hint="Not renewed yet"
        />
        <Stat label="No expiry" value={String(counts.noExpiry)} hint="Such as the TIN" />
      </dl>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="order-2 grid min-w-0 gap-5 lg:order-1">
          <ComplianceFilters view={view}>
            {items.length === 0 ? (
              isComplianceFiltered(view) ? (
                <EmptyState title="No records match">
                  Clear the filters to see the records in force.
                </EmptyState>
              ) : (
                <EmptyState title="No licences yet">
                  {can.manage
                    ? "Add the trade licence, BIN and TIN first, with their expiry dates."
                    : "Licences the owner adds show here with their expiry dates."}
                </EmptyState>
              )
            ) : (
              <ComplianceList key={complianceListSearch(view)} items={items} />
            )}
          </ComplianceFilters>
        </div>

        <div className="order-1 grid min-w-0 gap-6 lg:order-2">
          {needsRenewal.length > 0 && (
            <Panel title="Needs renewing" id="renew-heading" className="border-destructive/30">
              <ul className="mt-3 grid divide-y" aria-label="Needs renewing">
                {needsRenewal.map((r) => (
                  <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link
                      href={complianceHref.record(r.id)}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {r.title}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.8125rem]">
                      <ComplianceBadge status={r.status} />
                      <span
                        className={
                          r.status === "EXPIRED" ? "text-destructive" : "text-muted-foreground"
                        }
                      >
                        {expiryWords(r.daysLeft)}
                        {r.expiryDate && ` · ${formatDay(r.expiryDate)}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {missing.length > 0 && (
            <Panel title="Not on file" id="missing-heading">
              <p className="mt-2 text-sm text-muted-foreground">
                Every business should keep these. {can.manage ? "Add them" : "The owner adds them"}{" "}
                so their numbers print on documents.
              </p>
              <ul className="mt-3 grid gap-2" aria-label="Not on file">
                {missing.map((m) => (
                  <li
                    key={m.type}
                    className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-start xl:flex-row xl:items-center"
                  >
                    <span>{m.label}</span>
                    {can.manage && (
                      <AddComplianceButton
                        type={m.type}
                        label="Add"
                        variant="outline"
                        className="w-full sm:w-auto"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Numbers on documents" id="numbers-heading">
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              From the records in force. The BIN and trade licence number print on every document;
              your own templates can use them all.
            </p>
            <dl className="mt-3 grid gap-2.5 text-sm">
              {NUMBER_LABELS.map(([key, label]) => (
                <div key={key} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right break-all tabular-nums">
                    {numbers[key] ?? <span className="text-muted-foreground">Not on file</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </section>
  );
}
