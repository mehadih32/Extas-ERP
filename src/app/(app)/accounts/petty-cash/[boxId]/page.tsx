import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OffBadge } from "@/components/accounts/badges";
import { accountsHref } from "@/components/accounts/labels";
import { LedgerLines } from "@/components/accounts/ledger-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { PettyCashActions } from "@/components/accounts/petty-cash-actions";
import { PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatCount } from "@/lib/display";
import { getPettyCashScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Petty cash" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const SCOPE = "petty-cash";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * One petty cash box, for its holder and for everyone who sees the books: what
 * is in it, what went in and out, and every top-up and cost (latest last). The
 * holder records costs from it; Accounts tops it up, takes money back, changes
 * it and closes it.
 */
export default async function PettyCashBoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ boxId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ boxId }, query] = await Promise.all([params, searchParams]);
  const result = await getPettyCashScreenAction(boxId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="This petty cash box is not yours">
          Only the person who keeps a petty cash box, and Accounts, see it.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError title="Petty cash" heading="The box could not load" error={result.error} />
    );
  }
  const s = result.data;
  const b = s.box;
  const currency = ctx.company.currency;
  const m = (fixed: string) => money(fixed, currency);
  const notice =
    query.created === "1"
      ? `${b.name} is open. ${b.holder.name} can now record costs from it.`
      : query.updated === "1"
        ? "The changes were saved."
        : undefined;
  const books = s.can.openEntries;

  return (
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-6">
        {books ? (
          <BackLink href="/accounts/cash-bank">Cash & bank</BackLink>
        ) : (
          <BackLink href="/accounts/expenses">Expenses</BackLink>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <RecordHeader
            eyebrow={`Petty cash · Held by ${b.holder.name}`}
            title={b.name}
            badges={b.isActive ? undefined : <OffBadge>Closed</OffBadge>}
          />
          <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
        </div>

        <PettyCashActions screen={s} currency={currency} notice={notice} />

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="In the box"
            value={m(b.balance)}
            scope={SCOPE}
            hint={
              b.shortOfFloat ? (
                <>
                  {m(b.shortOfFloat)} short of its usual {m(b.float!)}
                </>
              ) : b.float ? (
                `Usual amount ${m(b.float)}`
              ) : (
                "Top-ups less costs"
              )
            }
          />
          <Stat
            label="Put in"
            value={m(b.putIn)}
            scope={SCOPE}
            hint="Top-ups less money taken back"
          />
          <Stat label="Spent" value={m(b.spent)} scope={SCOPE} hint="Costs recorded from it" />
        </dl>

        <section aria-labelledby="box-details" className="grid gap-3">
          <h3 id="box-details" className="font-serif text-xl text-primary">
            Details
          </h3>
          <dl className="grid gap-3 rounded-lg border bg-card p-4">
            <Detail label="Held by">
              {b.holder.name}
              <span className="text-muted-foreground"> · {b.holder.email}</span>
            </Detail>
            <Detail label="In the books">
              {books ? (
                <Link href={accountsHref.account(b.ledgerAccountId)} className={linkClass}>
                  Its ledger, with every day
                </Link>
              ) : (
                "Every cost goes into the books when you record it."
              )}
            </Detail>
            {b.notes && <Detail label="Notes">{b.notes}</Detail>}
          </dl>
        </section>

        {s.lines.length === 0 ? (
          <EmptyState title="Nothing in the box yet">
            {s.can.topUp
              ? "Top it up to put the first money in."
              : "Accounts puts the first money in from Cash & bank."}
          </EmptyState>
        ) : (
          <LedgerLines
            lines={s.lines.map((l, index) => ({
              key: `${l.entryId}-${index}`,
              entryId: l.entryId,
              day: l.day,
              number: l.number,
              details: l.description ?? "",
              note: l.memo,
              left: l.debit,
              right: l.credit,
              balance: l.balance,
              flag: l.isReversed ? "Reversed" : l.isReversal ? "Reversal" : null,
            }))}
            hiddenCount={s.hiddenCount}
            hiddenNote={`The latest ${formatCount(s.lines.length, currency)} are shown${
              books ? "; its ledger has every one" : ""
            }.`}
            columns={["In", "Out"]}
            currency={currency}
            canOpen={books}
          />
        )}
      </div>
    </PrivacyProvider>
  );
}
