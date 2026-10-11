import type { AssetStatus } from "@prisma/client";
import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DepreciationDue } from "@/components/accounts/asset-actions";
import { AssetBadge } from "@/components/accounts/badges";
import { ASSET_STATUS_LABELS, assetHref } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { Amount, PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getAssetRegisterAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Fixed assets" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const SCOPE = "register";
const STATUSES: AssetStatus[] = ["IN_USE", "UNDER_REPAIR", "DISPOSED"];

/**
 * The fixed asset register (accounts.view): machines, furniture, computers and
 * the rest, each at cost and at its value after depreciation, with the totals
 * for what is still owned and the depreciation not yet posted. "?status="
 * narrows it to in use, under repair, or sold and scrapped.
 */
export default async function AssetRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const status = STATUSES.find((s) => s === query.status);
  const removed = typeof query.removed === "string" ? query.removed.slice(0, 160) : null;
  const result = await getAssetRegisterAction(status ? { status } : {});
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Fixed assets"
        heading="The register could not load"
        error={result.error}
      />
    );
  }
  const r = result.data;
  const currency = ctx.company.currency;
  const m = (fixed: string) => money(fixed, currency);
  const filters: Array<{ href: string; label: string; current: boolean }> = [
    { href: assetHref.register, label: "All", current: !status },
    ...STATUSES.map((s) => ({
      href: `${assetHref.register}?status=${s}`,
      label: ASSET_STATUS_LABELS[s],
      current: status === s,
    })),
  ];

  return (
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-6">
        <BackLink href="/accounts">Overview</BackLink>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-serif text-2xl text-primary">Fixed asset register</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Machines, furniture, computers and everything else the business owns and uses for
              years, at cost and at what it is worth now, after depreciation.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
            {r.can.record && (
              <Button asChild className="w-full sm:w-auto">
                <Link href={assetHref.record}>
                  <PlusIcon aria-hidden />
                  Record an asset purchase
                </Link>
              </Button>
            )}
          </div>
        </div>
        {removed && <FormAlert tone="success">{removed} was removed from the register.</FormAlert>}

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Assets owned"
            value={formatCount(r.summary.count, currency)}
            hint="In use or under repair"
          />
          <Stat
            label="Cost"
            value={m(r.summary.cost)}
            scope={SCOPE}
            hint="What they were bought for"
          />
          <Stat
            label="Depreciation so far"
            value={m(r.summary.accumulatedDepreciation)}
            scope={SCOPE}
            hint="Value used up, as posted"
          />
          <Stat
            label="Value now"
            value={m(r.summary.bookValue)}
            scope={SCOPE}
            hint="Cost less depreciation"
          />
        </dl>

        <DepreciationDue
          depreciation={r.depreciation}
          canPost={r.can.depreciate}
          currency={currency}
        />

        <nav aria-label="Show" className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              aria-current={f.current ? "page" : undefined}
              className={cn(
                "inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium md:h-9",
                f.current
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>

        {r.assets.length === 0 ? (
          <EmptyState
            title={status ? "Nothing here" : "No fixed assets yet"}
            action={
              r.can.record && !status ? (
                <Button asChild>
                  <Link href={assetHref.record}>Record an asset purchase</Link>
                </Button>
              ) : undefined
            }
          >
            {status
              ? "No asset has this status."
              : "Record a laptop, an AC, a machine or furniture when it is bought, and its value after depreciation shows here."}
          </EmptyState>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Assets">
              {r.assets.map((a) => (
                <li key={a.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={assetHref.asset(a.id)}
                      className={`font-medium break-words ${linkClass}`}
                    >
                      {a.name}
                    </Link>
                    <AssetBadge status={a.status} />
                  </div>
                  <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                    {[a.category, a.location, `Bought ${formatDay(a.boughtOn)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <dl className="mt-3 grid gap-1 border-t pt-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Cost</dt>
                      <dd className="tabular-nums">
                        <Amount scope={SCOPE}>{m(a.cost)}</Amount>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Value now</dt>
                      <dd className="font-medium tabular-nums">
                        <Amount scope={SCOPE}>{m(a.bookValue)}</Amount>
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden lg:block">
              <Table aria-label="Assets">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Asset</TableHead>
                    <TableHead>Bought</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Depreciation so far</TableHead>
                    <TableHead className="text-right">Value now</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.assets.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="py-3">
                        <Link href={assetHref.asset(a.id)} className={`font-medium ${linkClass}`}>
                          {a.name}
                        </Link>
                        <div className="text-[0.8125rem] text-muted-foreground">
                          {[a.category, a.location].filter(Boolean).join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(a.boughtOn)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Amount scope={SCOPE}>{m(a.cost)}</Amount>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Amount scope={SCOPE}>{m(a.accumulatedDepreciation)}</Amount>
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        <Amount scope={SCOPE}>{m(a.bookValue)}</Amount>
                      </TableCell>
                      <TableCell>
                        <AssetBadge status={a.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </PrivacyProvider>
  );
}
