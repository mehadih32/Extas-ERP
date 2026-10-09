import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccountActions } from "@/components/accounts/account-actions";
import { OffBadge } from "@/components/accounts/badges";
import {
  ACCOUNT_TYPE_LABELS,
  accountsHref,
  isNegative,
  signedMoney,
  SUBTYPE_LABELS,
} from "@/components/accounts/labels";
import { LedgerLines, LedgerSummary } from "@/components/accounts/ledger-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { dayParam } from "@/components/parties/route";
import { StatementRange } from "@/components/parties/statement-range";
import { RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { localDay } from "@/lib/dates";
import { formatCount, formatDay, formatDayRange } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getAccountScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Account" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/** The days a ledger covers, either end left open. */
function periodText(from: string | null, to: string | null): string {
  if (from && to) return formatDayRange(from, to);
  if (from) return `From ${formatDay(from)}`;
  if (to) return `Up to ${formatDay(to)}`;
  return "Everything so far";
}

/**
 * One account's ledger (accounts.view, like GET /api/accounts/chart/:id/ledger):
 * its balance today, then its lines for the days chosen with a running
 * balance, each opening its journal entry. Renaming, archiving and the balance
 * brought forward are offered with accounts.manage.
 */
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const range = { from: dayParam(query.from), to: dayParam(query.to) };
  const result = await getAccountScreenAction(accountId, range);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    if (result.error.code !== "VALIDATION") {
      return (
        <SectionError title="Account" heading="The account could not load" error={result.error} />
      );
    }
  }
  const currency = ctx.company.currency;
  const today = localDay(new Date(), ctx.company.timezone);
  const screen = result.ok ? result.data : null;
  const a = screen?.account;
  const notice = query.created === "1" && a ? `${a.code} ${a.name} was added.` : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/accounts/chart">Chart of accounts</BackLink>
        {screen && a && (
          <>
            <RecordHeader
              eyebrow={`${a.code} · ${ACCOUNT_TYPE_LABELS[a.type]} · ${SUBTYPE_LABELS[a.subType]}`}
              title={a.name}
              badges={
                <>
                  {!a.isActive && <OffBadge>Archived</OffBadge>}
                  <span
                    className={cn(
                      "font-serif text-lg tabular-nums",
                      isNegative(a.balance) ? "text-destructive" : "text-primary",
                    )}
                  >
                    {signedMoney(a.balance, currency)}
                  </span>
                  <span className="text-sm text-muted-foreground">today</span>
                </>
              }
            />
            {a.linkedTo && (
              <p className="text-sm text-muted-foreground">
                Kept by{" "}
                {a.linkedTo.kind === "BANK_ACCOUNT" ? (
                  <Link href={accountsHref.bank(a.linkedTo.id)} className={linkClass}>
                    the bank account {a.linkedTo.name}
                  </Link>
                ) : a.linkedTo.kind === "CAPITAL_SOURCE" ? (
                  `the loan or investor ${a.linkedTo.name}`
                ) : (
                  `the fixed asset ${a.linkedTo.name}`
                )}
                ; it is changed there.
              </p>
            )}
            {a.manualPostingNote && (
              <p className="text-sm text-muted-foreground">
                Journal vouchers do not post here: {a.manualPostingNote}
              </p>
            )}
            <AccountActions key={a.id} screen={screen} currency={currency} notice={notice} />
          </>
        )}
      </div>

      <section aria-labelledby="ledger-heading" className="grid gap-4">
        <div>
          <h3 id="ledger-heading" className="font-serif text-2xl text-primary">
            Ledger
          </h3>
          {screen && (
            <p className="mt-1 text-sm text-muted-foreground">
              {periodText(screen.from, screen.to)}
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
                  { label: "Debits", value: money(screen.summary.totalDebit, currency) },
                  { label: "Credits", value: money(screen.summary.totalCredit, currency) },
                  {
                    label: "Closing balance",
                    value: signedMoney(screen.summary.closingBalance, currency),
                    alert: isNegative(screen.summary.closingBalance),
                    hint: `${formatCount(screen.summary.transactionCount, currency)} ${
                      screen.summary.transactionCount === 1 ? "line" : "lines"
                    }`,
                  },
                ]}
              />
              <LedgerLines
                lines={screen.lines.map((l, index) => ({
                  key: `${l.entryId}-${index}`,
                  entryId: l.entryId,
                  day: l.day,
                  number: l.number,
                  details: l.description ?? l.particulars ?? "",
                  note:
                    [l.description ? l.particulars : null, l.parties, l.memo]
                      .filter(Boolean)
                      .join(" · ") || null,
                  left: l.debit,
                  right: l.credit,
                  balance: l.balance,
                  flag: l.isReversed ? "Reversed" : l.isReversal ? "Reversal" : null,
                }))}
                hiddenCount={screen.hiddenCount}
                columns={["Debit", "Credit"]}
                currency={currency}
                canOpen
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
