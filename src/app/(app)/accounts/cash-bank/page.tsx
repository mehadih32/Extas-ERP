import { LandmarkIcon, SmartphoneIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { OffBadge } from "@/components/accounts/badges";
import { accountsHref, isNegative, KIND_LABELS, signedMoney } from "@/components/accounts/labels";
import { MoneyActions } from "@/components/accounts/money-actions";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { localDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getCashBankScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Cash & bank" };

const cardClass =
  "flex h-full min-w-0 items-start gap-3 rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25";

function Balance({ amount, currency }: { amount: string; currency: string }) {
  return (
    <p
      className={cn(
        "mt-2 font-serif text-xl leading-tight lining-nums tabular-nums",
        isNegative(amount) ? "text-destructive" : "text-primary",
      )}
    >
      {signedMoney(amount, currency)}
    </p>
  );
}

/**
 * Cash & bank (accounts.view, like GET /api/accounts/cash-accounts and
 * /api/accounts/bank-accounts): every bank account with its balance and
 * statement, cash in hand and the wallets. Moving money between them needs
 * accounts.payments.record; adding a bank account needs accounts.manage.
 */
export default async function CashBankPage() {
  const ctx = await requireCompanyPage();
  const result = await getCashBankScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Cash & bank"
        heading="The accounts could not load"
        error={result.error}
      />
    );
  }
  const screen = result.data;
  const currency = ctx.company.currency;
  const today = localDay(new Date(), ctx.company.timezone);

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="grid gap-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h2 className="font-serif text-2xl text-primary">Cash & bank</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Where the company&apos;s money sits. Open a bank account for its statement, or cash
              and wallets for every movement.
            </p>
          </div>
          <div className="sm:text-right">
            <p className="eyebrow">All together</p>
            <p
              className={cn(
                "mt-1 font-serif text-2xl leading-tight tabular-nums",
                isNegative(screen.total) ? "text-destructive" : "text-primary",
              )}
            >
              {signedMoney(screen.total, currency)}
            </p>
          </div>
        </div>
        <MoneyActions
          accounts={screen.moneyAccounts}
          currency={currency}
          today={today}
          can={{ transfer: screen.can.transfer, addBank: screen.can.addBank }}
        />
      </div>

      <section aria-labelledby="banks-heading" className="grid gap-3">
        <h3 id="banks-heading" className="font-serif text-xl text-primary">
          Bank accounts
        </h3>
        {screen.banks.length === 0 ? (
          <EmptyState
            title="No bank accounts yet"
            action={
              screen.can.addBank ? (
                <Button asChild>
                  <Link href="/accounts/cash-bank/new">Add a bank account</Link>
                </Button>
              ) : undefined
            }
          >
            Add each account the company banks with, so deposits, cheques and transfers land on its
            own statement.
          </EmptyState>
        ) : (
          <ul
            className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            aria-label="Bank accounts"
          >
            {screen.banks.map((b) => (
              <li key={b.id} className="min-w-0">
                <Link
                  href={accountsHref.bank(b.id)}
                  className={cn(cardClass, !b.isActive && "opacity-75")}
                >
                  <LandmarkIcon
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="grid min-w-0 flex-1 grid-cols-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium">{b.bankName}</p>
                      {!b.isActive && <OffBadge>Closed</OffBadge>}
                    </div>
                    <p className="truncate text-[0.8125rem] text-muted-foreground">
                      {b.accountNumber}
                      {b.branch ? ` · ${b.branch}` : ""}
                    </p>
                    <Balance amount={b.balance} currency={currency} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cash-heading" className="grid gap-3">
        <h3 id="cash-heading" className="font-serif text-xl text-primary">
          Cash and wallets
        </h3>
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Cash and wallets"
        >
          {screen.accounts.map((a) => {
            const Icon =
              a.kind === "MOBILE_WALLET"
                ? SmartphoneIcon
                : a.kind === "BANK"
                  ? LandmarkIcon
                  : WalletIcon;
            return (
              <li key={a.id} className="min-w-0">
                <Link href={accountsHref.account(a.id)} className={cardClass}>
                  <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="grid min-w-0 flex-1 grid-cols-1">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="truncate text-[0.8125rem] text-muted-foreground">
                      {KIND_LABELS[a.kind]} · {a.code}
                    </p>
                    <Balance amount={a.balance} currency={currency} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {screen.can.addAccount && (
          <p className="text-sm text-muted-foreground">
            Another cash box or bKash account?{" "}
            <Link
              href="/accounts/chart?add=1"
              className="text-primary underline-offset-4 hover:underline"
            >
              Add it to the chart of accounts
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}
