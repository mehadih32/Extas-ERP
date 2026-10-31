import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LENDER_KIND_LABELS, loansHref } from "@/components/accounts/labels";
import { DueSoonList } from "@/components/accounts/loan-actions";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { Amount, PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import { getLoansPageAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Loans & capital" };

const SCOPE = "loans";
const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * Loans & capital (accounts.view): the money working in the business (the
 * owner's capital, loans kept in it for ever, and what is still owed on the
 * others), what falls due in the next month, and every bank, NGO and person who
 * lent money, each opening their profile.
 */
export default async function LoansPage() {
  const ctx = await requireCompanyPage();
  const result = await getLoansPageAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Loans & capital"
        heading="The page could not load"
        error={result.error}
      />
    );
  }
  const r = result.data;
  const currency = ctx.company.currency;
  const m = (fixed: string) => money(fixed, currency);
  const c = r.capital;

  return (
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-serif text-2xl text-primary">Loans & capital</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              The money working in the business, and every bank, NGO and person who lent it: what
              was taken, what is paid, and what falls due next.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
            {r.can.manage && (
              <Button asChild className="w-full sm:w-auto">
                <Link href={loansHref.add}>
                  <PlusIcon aria-hidden />
                  Add a loan
                </Link>
              </Button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="My own capital"
            value={m(c.own)}
            scope={SCOPE}
            hint="What the owners put in"
          />
          <Stat
            label="Loans kept in capital"
            value={m(c.kept)}
            scope={SCOPE}
            hint={
              <>
                Still owed to the bank: <Amount scope={SCOPE}>{m(c.keptStillOwed)}</Amount>
              </>
            }
          />
          <Stat
            label="Other loans owed"
            value={m(c.otherLoans)}
            scope={SCOPE}
            hint="Goes down as they are repaid"
          />
          <Stat
            label="Money working in the business"
            value={m(c.working)}
            scope={SCOPE}
            hint="All three together"
          />
        </dl>

        <section aria-labelledby="due-soon" className="grid gap-3">
          <h3 id="due-soon" className="font-serif text-lg text-primary">
            Due in the next month
          </h3>
          {r.dueSoon.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing falls due in the next month.</p>
          ) : (
            <DueSoonList page={r} currency={currency} />
          )}
        </section>

        <section aria-labelledby="lenders" className="grid gap-3">
          <h3 id="lenders" className="font-serif text-lg text-primary">
            Banks, NGOs and people
          </h3>
          {r.lenders.length === 0 ? (
            <EmptyState
              title="No loans yet"
              action={
                r.can.manage ? (
                  <Button asChild>
                    <Link href={loansHref.add}>Add a loan</Link>
                  </Button>
                ) : undefined
              }
            >
              Add each bank loan, NGO loan or money a person lent, and its installments or profit
              dates show here.
            </EmptyState>
          ) : (
            <ul
              className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
              aria-label="Lenders"
            >
              {r.lenders.map((l) => (
                <li key={l.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={loansHref.lender(l.id)}
                      className={`font-medium break-words ${linkClass}`}
                    >
                      {l.name}
                    </Link>
                    <span className="shrink-0 text-[0.8125rem] text-muted-foreground">
                      {LENDER_KIND_LABELS[l.kind]}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                    {l.running} running · {l.closed} closed
                  </p>
                  <dl className="mt-3 grid gap-1 border-t pt-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Owed now</dt>
                      <dd className="font-medium tabular-nums">
                        <Amount scope={SCOPE}>{m(l.owedNow)}</Amount>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Paid so far</dt>
                      <dd className="tabular-nums">
                        <Amount scope={SCOPE}>{m(l.paidSoFar)}</Amount>
                      </dd>
                    </div>
                    {l.next && (
                      <div className="flex justify-between gap-3">
                        <dt
                          className={l.next.overdue ? "text-destructive" : "text-muted-foreground"}
                        >
                          {l.next.overdue ? "Late since" : "Next"} {formatDay(l.next.dueDate)}
                        </dt>
                        <dd className="tabular-nums">
                          <Amount scope={SCOPE}>{m(l.next.amount)}</Amount>
                        </dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>

        {r.others.length > 0 && (
          <section aria-labelledby="other-loans" className="grid gap-3">
            <h3 id="other-loans" className="font-serif text-lg text-primary">
              Older loans and investors
            </h3>
            <p className="text-sm text-muted-foreground">
              Added before this page. They count in the figures above.
            </p>
            <ul
              className="grid divide-y rounded-lg border bg-card text-sm"
              aria-label="Older loans"
            >
              {r.others.map((o) => (
                <li key={o.id} className="flex justify-between gap-3 p-3">
                  <span className="min-w-0 break-words">{o.name}</span>
                  <span className="shrink-0 tabular-nums">
                    <Amount scope={SCOPE}>{m(o.owedNow)}</Amount>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PrivacyProvider>
  );
}
