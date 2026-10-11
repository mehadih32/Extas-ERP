import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OffBadge } from "@/components/accounts/badges";
import { ReconcileChecklist, StatementCompare } from "@/components/accounts/bank-reconcile";
import { accountsHref, isNegative, signedMoney } from "@/components/accounts/labels";
import { LedgerSummary } from "@/components/accounts/ledger-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { HeaderWithEye, PrivacyProvider } from "@/components/accounts/privacy";
import { SectionError } from "@/components/dashboard/section-error";
import { RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import { getReconcileScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Reconcile a bank account" };

/**
 * A bank account's reconcile checklist (accounts.view; ticking needs
 * accounts.manage): the balance in the books, the cleared balance the bank's
 * statement should show, what has not cleared yet, and the lines to tick.
 * "?show=ticked" lists the ticked lines instead, latest first.
 */
export default async function ReconcilePage({
  params,
  searchParams,
}: {
  params: Promise<{ bankAccountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ bankAccountId }, query] = await Promise.all([params, searchParams]);
  const result = await getReconcileScreenAction(bankAccountId, {
    show: typeof query.show === "string" ? query.show : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Reconcile"
        heading="The bank account could not load"
        error={result.error}
      />
    );
  }
  const screen = result.data;
  const { bank: b, summary: s } = screen;
  const currency = ctx.company.currency;
  const waiting = (n: number) => `${formatCount(n, currency)} waiting`;
  const tabs = [
    {
      show: "open",
      label: "Not cleared yet",
      count: s.openCount,
      href: accountsHref.reconcile(b.id),
    },
    {
      show: "ticked",
      label: "Ticked",
      count: s.tickedCount,
      href: accountsHref.reconcile(b.id, "ticked"),
    },
  ];

  return (
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-8">
        <div className="grid gap-6">
          <BackLink href={accountsHref.bank(b.id)}>
            {b.bankName} {b.accountNumber}
          </BackLink>
          <HeaderWithEye>
            <RecordHeader
              eyebrow={`Bank reconcile · ${b.bankName}`}
              title={`${b.bankName} ${b.accountNumber}`}
              badges={b.isActive ? undefined : <OffBadge>Closed</OffBadge>}
            >
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Tick each line that is also on the bank&apos;s own statement. What is left are
                deposits the bank has not credited yet and cheques or transfers it has not paid yet.
              </p>
            </RecordHeader>
          </HeaderWithEye>
        </div>

        <LedgerSummary
          figures={[
            {
              label: "Balance in the books",
              value: signedMoney(s.books, currency),
              alert: isNegative(s.books),
              hint: "Everything recorded",
            },
            {
              label: "Cleared balance",
              value: signedMoney(s.cleared, currency),
              alert: isNegative(s.cleared),
              hint: "What the bank's statement should show",
            },
            {
              label: "Deposits not cleared",
              value: money(s.depositsOpen, currency),
              hint: waiting(s.depositCount),
            },
            {
              label: "Withdrawals not cleared",
              value: money(s.withdrawalsOpen, currency),
              hint: waiting(s.withdrawalCount),
            },
          ]}
        />

        <StatementCompare cleared={s.cleared} currency={currency} />

        <section aria-labelledby="lines-heading" className="grid gap-4">
          <h3 id="lines-heading" className="sr-only">
            Lines
          </h3>
          <nav aria-label="Lines to show" className="grid grid-cols-2 gap-2 sm:flex">
            {tabs.map((t) => (
              <Button
                key={t.show}
                asChild
                variant={screen.show === t.show ? "default" : "outline"}
                className="w-full sm:w-auto"
              >
                <Link
                  href={t.href}
                  scroll={false}
                  aria-current={screen.show === t.show ? "page" : undefined}
                >
                  {t.label} ({formatCount(t.count, currency)})
                </Link>
              </Button>
            ))}
          </nav>
          <ReconcileChecklist key={screen.show} screen={screen} currency={currency} />
        </section>
      </div>
    </PrivacyProvider>
  );
}
