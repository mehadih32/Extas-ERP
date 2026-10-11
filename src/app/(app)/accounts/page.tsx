import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ExecutiveCards } from "@/components/accounts/executive-cards";
import { signedMoney } from "@/components/accounts/labels";
import { MoneyActions } from "@/components/accounts/money-actions";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { Amount, PrivacyProvider, PrivacyToggle, ScopeEye } from "@/components/accounts/privacy";
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
  scope,
  link,
  children,
}: {
  id: string;
  title: string;
  /** Its amounts hide behind the eye; its own small eye shows them. */
  scope: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <h3 id={id} className="font-serif text-xl text-primary">
            {title}
          </h3>
          <ScopeEye scope={scope} label={title} />
        </div>
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
/**
 * The Accounts Overview (accounts.view, like GET /api/accounts/overview): the
 * five executive cards (cash and bank, market due, market payable, inventory
 * and work in progress, net profit for ?period=today|month|year|lifetime),
 * what waits for Accounts, and what else the business holds and owes. Every
 * amount shows *** until the eye shows it. People who reach Accounts for one
 * tab only start there instead.
 */
export default async function AccountsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("accounts.view")) {
    const first = visibleAccountsTabs(ctx.permissions)[0];
    if (first && first.href !== "/accounts") redirect(first.href);
    return <AccountsNoAccess />;
  }
  const { period } = await searchParams;
  const result = await getAccountsOverviewScreenAction(
    typeof period === "string" ? period.toUpperCase() : undefined,
  );
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
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-8">
        <div className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-serif text-2xl text-primary">Overview</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                The company&apos;s money as the books show it on {formatDay(o.asOf)}, and what is
                waiting for Accounts. Amounts stay hidden until you show them.
              </p>
            </div>
            <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
          </div>
          <MoneyActions
            accounts={active}
            currency={currency}
            today={o.asOf}
            can={{ transfer: o.can.transfer, paySupplier: o.can.paySupplier }}
          />
        </div>

        <ExecutiveCards cards={o.cards} accounts={o.cash.accounts} currency={currency} />

        <Section id="waiting-heading" title="Waiting for Accounts" scope="waiting">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Expense claims"
              value={claims === 0 ? "None" : money(o.pendingClaims.amount, currency)}
              scope={claims === 0 ? undefined : "waiting"}
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
              scope={salaries.employees === 0 ? undefined : "waiting"}
              hint={
                salaries.employees === 0
                  ? o.payroll.draftsAwaitingApproval > 0
                    ? "A payroll is waiting for approval"
                    : "Nothing approved and unpaid"
                  : `${formatCount(salaries.employees, currency)} ${
                      salaries.employees === 1 ? "employee" : "employees"
                    }, approved`
              }
              href="/hr/payroll"
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
              scope={
                o.installments.overdue.count > 0 || o.installments.dueNext7Days.count > 0
                  ? "waiting"
                  : undefined
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
          title="What else the business holds and owes"
          scope="holds"
          link={{ href: "/accounts/reports/balance-sheet", label: "Balance sheet" }}
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Fixed assets"
              value={m(o.fixedAssets)}
              scope="holds"
              hint="After depreciation"
            />
            <Stat
              label="Advances to employees"
              value={m(o.payroll.employeeAdvances)}
              scope="holds"
              hint="Still to be settled"
              href="/hr/advances?status=OPEN"
            />
            <Stat
              label="Buyer advances"
              value={m(o.customerAdvances)}
              scope="holds"
              hint="Received before the goods went out"
            />
            <Stat
              label="Loans and investors"
              value={m(o.liabilities.total)}
              scope="holds"
              alert={false}
              hint={
                <>
                  Loans <Amount scope="holds">{money(o.liabilities.loans, currency)}</Amount> ·
                  investors{" "}
                  <Amount scope="holds">{money(o.liabilities.investors, currency)}</Amount>
                </>
              }
            />
          </dl>
        </Section>
      </div>
    </PrivacyProvider>
  );
}
