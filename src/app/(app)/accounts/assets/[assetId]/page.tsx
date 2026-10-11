import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssetActions } from "@/components/accounts/asset-actions";
import { AssetBadge, OffBadge } from "@/components/accounts/badges";
import {
  accountsHref,
  assetHref,
  DEPRECIATION_METHOD_LABELS,
  isNegative,
} from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { Amount, PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { partyHref } from "@/components/parties/labels";
import { RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { getAssetScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Fixed asset" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const SCOPE = "asset";
const isZero = (fixed: string) => !/[1-9]/.test(fixed);

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * One fixed asset (accounts.view): what it cost, the depreciation so far and
 * its value now, how it was bought, and every entry it made in the books.
 * Accounts can change its details, sell or scrap it, or remove one entered by
 * mistake.
 */
export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ assetId }, query] = await Promise.all([params, searchParams]);
  const result = await getAssetScreenAction(assetId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError title="Fixed asset" heading="The asset could not load" error={result.error} />
    );
  }
  const s = result.data;
  const a = s.asset;
  const currency = ctx.company.currency;
  const m = (fixed: string) => money(fixed, currency);
  const notice =
    query.created === "1"
      ? `${a.name} was added to the register.`
      : query.updated === "1"
        ? "The changes were saved."
        : undefined;
  const depreciates = a.depreciationRate !== null && !isZero(a.depreciationRate);
  const disposed = a.status === "DISPOSED";

  return (
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-6">
        <BackLink href={assetHref.register}>Fixed asset register</BackLink>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <RecordHeader
            eyebrow={`${a.category ?? "Fixed asset"} · Bought ${formatDay(a.boughtOn)}`}
            title={a.name}
            badges={<AssetBadge status={a.status} />}
          />
          <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
        </div>

        <AssetActions screen={s} currency={currency} notice={notice} />

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cost" value={m(a.cost)} scope={SCOPE} hint="What it was bought for" />
          <Stat
            label="Depreciation so far"
            value={m(a.accumulatedDepreciation)}
            scope={SCOPE}
            hint={a.depreciatedUntil ? `Up to ${formatDay(a.depreciatedUntil)}` : "None posted yet"}
          />
          <Stat
            label={disposed ? "Value when it left" : "Value now"}
            value={m(a.bookValue)}
            scope={SCOPE}
            hint="Cost less depreciation"
          />
          <Stat
            label="Depreciation a month"
            value={depreciates && !disposed ? m(a.monthlyDepreciation) : "None"}
            scope={depreciates && !disposed ? SCOPE : undefined}
            hint={
              disposed
                ? "It has left the register"
                : depreciates
                  ? "At the current rate"
                  : "It is not depreciated"
            }
          />
        </dl>

        <section aria-labelledby="asset-details" className="grid gap-3">
          <h3 id="asset-details" className="font-serif text-xl text-primary">
            Details
          </h3>
          <dl className="grid gap-3 rounded-lg border bg-card p-4">
            <Detail label="How it was bought">
              {s.acquired.kind === "PAID" ? (
                <>Paid from {s.acquired.account}</>
              ) : s.acquired.kind === "CREDIT" && s.acquired.supplier ? (
                <>
                  On credit from{" "}
                  {s.can.openSupplier ? (
                    <Link href={partyHref(s.acquired.supplier)} className={linkClass}>
                      {s.acquired.supplier.name}
                    </Link>
                  ) : (
                    s.acquired.supplier.name
                  )}
                </>
              ) : (
                "Owned before these books started"
              )}
            </Detail>
            {a.location && <Detail label="Where it is">{a.location}</Detail>}
            <Detail label="Depreciation">
              {depreciates
                ? `${Number(a.depreciationRate)}% a year: ${DEPRECIATION_METHOD_LABELS[
                    a.depreciationMethod
                  ].toLowerCase()}`
                : "Not depreciated"}
            </Detail>
            {!isZero(a.salvageValue) && (
              <Detail label="Worth at the end">
                <Amount scope={SCOPE}>{m(a.salvageValue)}</Amount>
              </Detail>
            )}
            {a.disposedOn && (
              <Detail label={a.disposalAmount && !isZero(a.disposalAmount) ? "Sold" : "Scrapped"}>
                {formatDay(a.disposedOn)}
                {a.disposalAmount && !isZero(a.disposalAmount) && (
                  <>
                    {" for "}
                    <Amount scope={SCOPE}>{m(a.disposalAmount)}</Amount>
                  </>
                )}
                {a.gainOnDisposal && !isZero(a.gainOnDisposal) && (
                  <>
                    {isNegative(a.gainOnDisposal) ? ", a loss of " : ", a gain of "}
                    <Amount scope={SCOPE}>{m(a.gainOnDisposal.replace(/^-/, ""))}</Amount>
                  </>
                )}
              </Detail>
            )}
            {a.notes && <Detail label="Notes">{a.notes}</Detail>}
          </dl>
        </section>

        <section aria-labelledby="asset-entries" className="grid gap-3">
          <h3 id="asset-entries" className="font-serif text-xl text-primary">
            In the books
          </h3>
          <ul aria-label="Entries" className="grid divide-y rounded-lg border bg-card">
            {s.entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm">
                    <Link href={accountsHref.entry(e.id)} className={`font-medium ${linkClass}`}>
                      {e.number}
                    </Link>{" "}
                    <span className="text-muted-foreground">· {formatDay(e.day)}</span>{" "}
                    {e.isReversed && <OffBadge>Reversed</OffBadge>}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] break-words text-muted-foreground">
                    {e.description}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums">
                  <Amount scope={SCOPE}>{m(e.amount)}</Amount>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PrivacyProvider>
  );
}
