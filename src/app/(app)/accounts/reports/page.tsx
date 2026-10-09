import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccountsNoAccess } from "@/components/accounts/no-access";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Financial reports" };

const REPORTS = [
  {
    href: "/accounts/reports/profit-and-loss",
    title: "Profit and loss",
    text: "Sales, the cost of what was sold, running costs and the profit left, for any period or month by month.",
  },
  {
    href: "/accounts/reports/balance-sheet",
    title: "Balance sheet",
    text: "What the business owns, what it owes and the owners' share, at the end of any day.",
  },
  {
    href: "/accounts/reports/trial-balance",
    title: "Trial balance",
    text: "Every account's balance on its debit or credit side, for your accountant.",
  },
  {
    href: "/accounts/reports/books-check",
    title: "Books check",
    text: "Checks that the journal balances and that stock, assets, loans and payroll agree with the books.",
  },
];

/**
 * The financial reports (accounts.view, as each report's Server Action checks;
 * the Reports tab is shown only with it). People outside Accounts never see
 * profit, margins or balances here.
 */
export default async function ReportsPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("accounts.view")) return <AccountsNoAccess />;

  return (
    <section aria-labelledby="reports-heading" className="grid gap-6">
      <div>
        <h2 id="reports-heading" className="font-serif text-2xl text-primary">
          Financial reports
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Made straight from the books, so they are always up to date.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="group flex h-full items-start justify-between gap-4 rounded-lg border bg-card p-5 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
            >
              <span>
                <span className="block font-serif text-xl text-primary">{r.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                  {r.text}
                </span>
              </span>
              <ChevronRightIcon
                className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
