import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isNegative,
  KIND_LABELS,
  moneyAccountHref,
  signedMoney,
} from "@/components/accounts/labels";
import { MoneyActions } from "@/components/accounts/money-actions";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { Stat } from "@/components/accounts/stat";
import { visibleAccountsTabs } from "@/components/accounts/tabs";
import { SectionError } from "@/components/dashboard/section-error";
import { money } from "@/components/sales/labels";
import { formatCount, formatDay } from "@/lib/display";
import { getAccountsOverviewScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Accounts" };

const linkClass = "text-sm text-primary underline-offset-4 hover:underline";

function Section({
  id,
  title,
  link,
  children,
}: {
  id: string;
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h3 id={id} className="font-serif text-xl text-primary">
          {title}
        </h3>
        {link && (
          <Link href={link.href} className={linkClass}>
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * The Accounts Overview (accounts.view, like GET /api/accounts/overview): money
 * in hand, in the bank and in wallets, what buyers owe and what is owed to
 * suppliers, profit so far, what the business holds, and what waits for
 * Accounts. People who reach Accounts for one tab only start there instead.
 */
export default async function AccountsOverviewPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("accounts.view")) {
    const first = visibleAccountsTabs(ctx.permissions)[0];
    if (first && first.href !== "/accounts") redirect(first.href);
    return <AccountsNoAccess />;
  }
  const result = await getAccountsOverviewScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError title="Accounts" heading="The overview could not load" error={result.error} />
    );
  }
  const o = result.data;
  const currency = ctx.company.currency;
  const m = (fixed: string) => signedMoney(fixed, currency);
  const active = o.cash.accounts.filter((a) => a.isActive);
  const claims = o.pendingClaims.count;
  const salaries = o.payroll.awaitingPayment;

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="grid gap-4">
        <div>
          <h2 className="font-serif text-2xl text-primary">Overview</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            The company&apos;s money as the books show it on {formatDay(o.asOf)}, and what is
            waiting for Accounts.
          </p>
        </div>
        <MoneyActions
          accounts={active}
          currency={currency}
          today={o.asOf}
          can={{ transfer: o.can.transfer, paySupplier: o.can.paySupplier }}
        />
      </div>

      <Section
        id="money-heading"
        title="Money in hand"
        link={{ href: "/accounts/cash-bank", label: "Cash & bank" }}
      >
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Cash, bank and wallets"
            value={m(o.cash.total)}
            alert={isNegative(o.cash.total)}
            hint={`${active.length} ${active.length === 1 ? "account" : "accounts"}`}
          />
          {o.cash.accounts.map((a) => (
            <Stat
              key={a.id}
              label={KIND_LABELS[a.kind]}
              value={m(a.balance)}
              hint={a.isActive ? a.name : `${a.name} (archived)`}
              href={moneyAccountHref(a)}
              alert={isNegative(a.balance)}
            />
          ))}
        </dl>
      </Section>

      <Section id="owed-heading" title="Owed and owing">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Buyers owe us"
            value={m(o.receivables)}
            hint="Invoices not yet paid"
            href={ctx.can("parties.view") ? "/parties/dues" : undefined}
          />
          <Stat
            label="We owe suppliers"
            value={m(o.payables)}
            hint="Bills and Due expenses not yet paid"
            href={o.can.paySupplier ? "/accounts/supplier-payments" : undefined}
          />
          <Stat
            label="Buyer advances"
            value={m(o.customerAdvances)}
            hint="Received before the goods went out"
          />
        </dl>
      </Section>

      <Section
        id="profit-heading"
        title="Profit"
        link={{ href: "/accounts/reports/profit-and-loss", label: "Profit & loss" }}
      >
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Sales today" value={money(o.todaySales, currency)} />
          <Stat
            label="Profit this month"
            value={m(o.netProfit.thisMonth)}
            alert={isNegative(o.netProfit.thisMonth)}
            hint="Sales less every cost so far"
          />
          <Stat
            label="Profit this financial year"
            value={m(o.netProfit.thisFinancialYear)}
            alert={isNegative(o.netProfit.thisFinancialYear)}
            hint={`Since ${formatDay(o.netProfit.financialYearFrom)}`}
          />
        </dl>
      </Section>

      <Section id="waiting-heading" title="Waiting for Accounts">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Expense claims"
            value={claims === 0 ? "None" : money(o.pendingClaims.amount, currency)}
            hint={
              claims === 0
                ? "Nothing to pay back"
                : `${formatCount(claims, currency)} ${claims === 1 ? "claim" : "claims"} to approve`
            }
            href="/accounts/expenses?status=PENDING"
            alert={claims > 0}
          />
          <Stat
            label="Salaries to pay"
            value={salaries.employees === 0 ? "None" : money(salaries.amount, currency)}
            hint={
              salaries.employees === 0
                ? o.payroll.draftsAwaitingApproval > 0
                  ? "A payroll is waiting for approval"
                  : "Nothing approved and unpaid"
                : `${formatCount(salaries.employees, currency)} ${
                    salaries.employees === 1 ? "employee" : "employees"
                  }, approved`
            }
          />
          <Stat
            label="Loan installments"
            value={
              o.installments.overdue.count > 0
                ? money(o.installments.overdue.amount, currency)
                : o.installments.dueNext7Days.count > 0
                  ? money(o.installments.dueNext7Days.amount, currency)
                  : "None"
            }
            hint={
              o.installments.overdue.count > 0
                ? `${o.installments.overdue.count} overdue`
                : o.installments.dueNext7Days.count > 0
                  ? `${o.installments.dueNext7Days.count} due in the next 7 days`
                  : "Nothing due this week"
            }
            alert={o.installments.overdue.count > 0}
          />
        </dl>
      </Section>

      <Section
        id="holds-heading"
        title="What the business holds"
        link={{ href: "/accounts/reports/balance-sheet", label: "Balance sheet" }}
      >
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Finished stock" value={m(o.stockValue)} hint="Pieces on hand at cost" />
          <Stat
            label="Raw materials"
            value={m(o.rawMaterialsValue)}
            hint="Fabric and trims at cost"
          />
          <Stat
            label="In production"
            value={m(o.workInProgress)}
            hint="Spent on projects, not yet in stock"
          />
          <Stat label="Fixed assets" value={m(o.fixedAssets)} hint="After depreciation" />
          <Stat
            label="Advances to employees"
            value={m(o.payroll.employeeAdvances)}
            hint="Still to be settled"
          />
          <Stat
            label="Loans and investors"
            value={m(o.liabilities.total)}
            hint={`Loans ${money(o.liabilities.loans, currency)} · investors ${money(
              o.liabilities.investors,
              currency,
            )}`}
          />
        </dl>
      </Section>
    </div>
  );
}
