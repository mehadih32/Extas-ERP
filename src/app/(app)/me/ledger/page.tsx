import type { Metadata } from "next";
import Link from "next/link";

import { Stat } from "@/components/accounts/stat";
import { FlagBadge } from "@/components/hr/badges";
import { hrHref } from "@/components/hr/labels";
import { MyHrProblem } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { isZero, METHOD_LABELS, money } from "@/components/sales/labels";
import { formatDay } from "@/lib/display";
import type { MyLedgerScreen } from "@/modules/hr/screens.service";
import { getMyLedgerScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My money" };

const smallText = "text-[0.8125rem] text-muted-foreground";
const linkClass = "text-primary underline-offset-4 hover:underline";

type Part = MyLedgerScreen["months"][number]["parts"][number];

/** Where money sent to the wallet stands, for the employee. */
const PAYOUT_TEXT: Record<NonNullable<Part["payout"]>, string> = {
  QUEUED: "being sent to your wallet",
  SENT: "sent to your wallet",
  FAILED: "the wallet transfer failed; Accounts sends it again",
  CANCELLED: "the wallet transfer was stopped",
};

/**
 * The employee's own money ledger (portal.self): each approved month's salary
 * worked out line by line,
 *   Basic + approved overtime + claims paid back - (absence + advance EMI) = take-home
 * with every part paid so far and what is still to come, and beside it what
 * they still owe on advances and the claims to be paid back on their own.
 */
export default async function MyLedgerPage() {
  const ctx = await requireCompanyPage();
  const result = await getMyLedgerScreenAction();
  if (!result.ok) {
    return (
      <MyHrProblem error={result.error} title="My money" heading="Your money could not load" />
    );
  }
  const { summary, months } = result.data;
  const currency = ctx.company.currency;
  const amount = (value: string) => (isZero(value) ? "Nothing" : money(value, currency));

  return (
    <section aria-labelledby="my-money-heading" className="grid gap-6">
      <div>
        <h2 id="my-money-heading" className="font-serif text-2xl text-primary">
          My money
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Your salary month by month: basic salary + approved overtime + claims paid back − (absence
          + advance EMI) = take-home, with every part paid and what is still to come.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Salary still to come"
          value={amount(summary.salaryOwed)}
          hint="Approved, not paid yet"
        />
        <Stat
          label="I owe on advances"
          value={amount(summary.advancesOwed)}
          hint={
            summary.advances > 0 ? (
              <Link href={hrHref.myAdvances} className={linkClass}>
                {summary.advances} open {summary.advances === 1 ? "advance" : "advances"}
              </Link>
            ) : (
              "Taken back from salary"
            )
          }
        />
        <Stat
          label="Claims to be paid back"
          value={amount(summary.claimsOwed)}
          hint={
            <Link href={hrHref.myClaims} className={linkClass}>
              My claims
            </Link>
          }
        />
      </dl>

      {months.length === 0 ? (
        <EmptyState title="No salaries yet">
          Your first month shows here once its payroll is approved.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Months">
          {months.map((m) => {
            const paidInFull = isZero(m.balance);
            return (
              <li key={m.itemId} className="min-w-0 rounded-lg border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="eyebrow block">Salary</span>
                    <Link
                      href={hrHref.myPayslip(m.itemId)}
                      className="mt-1 block font-serif text-xl text-primary underline-offset-4 hover:underline"
                    >
                      {m.label}
                    </Link>
                  </span>
                  {isZero(m.netPay) ? (
                    <FlagBadge>Nothing to pay</FlagBadge>
                  ) : paidInFull ? (
                    <FlagBadge tone="done">Paid</FlagBadge>
                  ) : isZero(m.paid) ? (
                    <FlagBadge tone="warn">To be paid</FlagBadge>
                  ) : (
                    <FlagBadge tone="warn">Part paid</FlagBadge>
                  )}
                </div>

                <dl
                  className="mt-3 grid border-t pt-2 text-sm"
                  aria-label={`${m.label} worked out`}
                >
                  {m.lines.map((l) => (
                    <div key={l.label} className="flex items-baseline justify-between gap-4 py-1">
                      <dt className="min-w-0 text-muted-foreground">{l.label}</dt>
                      <dd
                        className={`whitespace-nowrap tabular-nums ${l.sign === "-" ? "text-destructive" : ""}`}
                      >
                        {l.sign === "-" ? "− " : "+ "}
                        {money(l.amount, currency)}
                      </dd>
                    </div>
                  ))}
                  <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-2 font-medium">
                    <dt>Take home</dt>
                    <dd className="whitespace-nowrap tabular-nums">{money(m.netPay, currency)}</dd>
                  </div>
                </dl>

                {m.parts.length > 0 && (
                  <ul className="mt-3 grid gap-1.5 border-t pt-3" aria-label={`${m.label} paid`}>
                    {m.parts.map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          Paid {formatDay(p.on)} by {METHOD_LABELS[p.method]}
                          <span className={`block ${smallText}`}>
                            {p.number}
                            {p.payout ? ` · ${PAYOUT_TEXT[p.payout]}` : ""}
                          </span>
                        </span>
                        <span className="whitespace-nowrap tabular-nums">
                          {money(p.amount, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-sm">
                  {paidInFull ? (
                    <span className="text-muted-foreground">Paid in full.</span>
                  ) : (
                    <>
                      <span className="font-medium">{money(m.balance, currency)}</span>{" "}
                      <span className="text-muted-foreground">still to come.</span>
                    </>
                  )}
                </p>
                {m.note && <p className={`mt-1 ${smallText}`}>{m.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
