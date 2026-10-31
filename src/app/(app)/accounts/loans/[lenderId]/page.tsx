import type { InstallmentStatus } from "@prisma/client";
import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LoanBadge } from "@/components/accounts/badges";
import { LENDER_KIND_LABELS, loansHref } from "@/components/accounts/labels";
import { LoanActions } from "@/components/accounts/loan-actions";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { Amount, PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
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
import { formatDay } from "@/lib/display";
import { getLenderProfileAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Lender profile" };

const SCOPE = "lender";
const isZero = (fixed: string) => !/[1-9]/.test(fixed);

const INSTALLMENT_LABELS: Record<InstallmentStatus, string> = {
  SCHEDULED: "To pay",
  OVERDUE: "Late",
  PAID: "Paid",
  SKIPPED: "Skipped",
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * A bank's, NGO's or person's profile (accounts.view): the totals across every
 * loan or term with them, then each one, running or closed, with what was taken,
 * paid (principal and interest apart), left, the next date, and every payment.
 * Closed loans stay here for good. Accounts pay from here.
 */
export default async function LenderPage({ params }: { params: Promise<{ lenderId: string }> }) {
  const ctx = await requireCompanyPage();
  const { lenderId } = await params;
  const result = await getLenderProfileAction(lenderId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError
        title="Lender profile"
        heading="The profile could not load"
        error={result.error}
      />
    );
  }
  const p = result.data;
  const currency = ctx.company.currency;
  const m = (fixed: string) => money(fixed, currency);
  const person = p.kind === "PERSON";

  return (
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-6">
        <BackLink href={loansHref.page}>Loans & capital</BackLink>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">{LENDER_KIND_LABELS[p.kind]}</p>
            <h2 className="font-serif text-2xl break-words text-primary">{p.name}</h2>
            {p.contact && <p className="mt-1 text-sm text-muted-foreground">{p.contact}</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
            {p.can.manage && (
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href={`${loansHref.add}?lender=${encodeURIComponent(p.id)}`}>
                  <PlusIcon aria-hidden />
                  {person ? "Add a new term" : "Add another loan"}
                </Link>
              </Button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Taken in all"
            value={m(p.totals.taken)}
            scope={SCOPE}
            hint={`${p.totals.running} running · ${p.totals.closed} closed`}
          />
          <Stat label="Owed now" value={m(p.totals.owedNow)} scope={SCOPE} />
          <Stat
            label="Paid back"
            value={m(p.totals.principalPaid)}
            scope={SCOPE}
            hint="Of the money itself"
          />
          <Stat
            label={person ? "Profit paid" : "Interest paid"}
            value={m(p.totals.interestPaid)}
            scope={SCOPE}
            hint={
              isZero(p.totals.interestPaidBefore) ? (
                "A cost in Profit and loss"
              ) : (
                <>
                  Before the ERP also:{" "}
                  <Amount scope={SCOPE}>{m(p.totals.interestPaidBefore)}</Amount>
                </>
              )
            }
          />
        </dl>

        <ul className="grid gap-4" aria-label={person ? "Terms" : "Loans"}>
          {p.loans.map((l) => (
            <li key={l.id} className="grid gap-4 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {m(l.taken)} taken on {formatDay(l.takenOn)}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {[
                      l.isTerm
                        ? `Profit ${l.profitPerPeriod ? m(l.profitPerPeriod) : ""} every ${l.periodMonths} month(s)`
                        : null,
                      l.interestRate ? `${l.interestRate}% interest (a note)` : null,
                      l.keepInCapital ? "Kept in my capital" : null,
                      l.autoPay ? "Pays by itself" : null,
                      l.defaulted ? "Marked as not being paid" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <LoanBadge state={l.state} renewals={l.renewals} />
              </div>

              <dl className="grid gap-x-8 gap-y-1 text-sm md:grid-cols-2">
                <Detail label="Owed now">
                  <Amount scope={SCOPE}>{m(l.owedNow)}</Amount>
                </Detail>
                {!isZero(l.repaidBefore) && (
                  <Detail label="Repaid before the ERP">
                    <Amount scope={SCOPE}>{m(l.repaidBefore)}</Amount>
                  </Detail>
                )}
                {!isZero(l.interestPaidBefore) && (
                  <Detail
                    label={l.isTerm ? "Profit paid before the ERP" : "Interest paid before the ERP"}
                  >
                    <Amount scope={SCOPE}>{m(l.interestPaidBefore)}</Amount>
                  </Detail>
                )}
                <Detail label={`Paid (${l.paid.count})`}>
                  <Amount scope={SCOPE}>{m(l.paid.amount)}</Amount>
                </Detail>
                <Detail label={l.isTerm ? "Of it, profit" : "Of it, interest"}>
                  <Amount scope={SCOPE}>{m(l.paid.interest)}</Amount>
                </Detail>
                {!l.isTerm && (
                  <Detail label={`Left to pay (${l.left.count})`}>
                    <Amount scope={SCOPE}>{m(l.left.amount)}</Amount>
                  </Detail>
                )}
                {l.next && (
                  <Detail label={l.next.overdue ? "Late since" : "Next due"}>
                    <span className={l.next.overdue ? "text-destructive" : undefined}>
                      {formatDay(l.next.dueDate)} ·{" "}
                      <Amount scope={SCOPE}>{m(l.next.amount)}</Amount>
                    </span>
                  </Detail>
                )}
                {!l.isTerm && l.endsOn && (
                  <Detail label="Last installment">{formatDay(l.endsOn)}</Detail>
                )}
              </dl>
              {l.notes && <p className="text-sm break-words text-muted-foreground">{l.notes}</p>}

              {p.can.pay && l.state !== "CLOSED" && (
                <LoanActions
                  loan={l}
                  lenderName={p.name}
                  accounts={p.accounts}
                  currency={currency}
                  today={p.today}
                />
              )}

              {l.installments.length > 0 && (
                <details className="group rounded-md border">
                  <summary className="cursor-pointer px-3 py-2 text-sm">
                    <span className="font-medium">Every payment</span>{" "}
                    <span className="text-muted-foreground">
                      ({l.paid.count} paid, {l.installments.length - l.paid.count} to go)
                    </span>
                  </summary>
                  <div className="overflow-x-auto border-t">
                    <Table aria-label="Payments">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Due</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">
                            {l.isTerm ? "Money back" : "Principal"}
                          </TableHead>
                          <TableHead className="text-right">
                            {l.isTerm ? "Profit" : "Interest"}
                          </TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Paid from</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {l.installments.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="whitespace-nowrap">
                              {formatDay(i.dueDate)}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Amount scope={SCOPE}>{m(i.amount)}</Amount>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Amount scope={SCOPE}>{m(i.principal)}</Amount>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Amount scope={SCOPE}>{m(i.interest)}</Amount>
                            </TableCell>
                            <TableCell
                              className={`whitespace-nowrap ${i.status === "OVERDUE" ? "text-destructive" : ""}`}
                            >
                              {INSTALLMENT_LABELS[i.status]}
                              {i.paidOn ? ` ${formatDay(i.paidOn)}` : ""}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{i.paidFrom ?? ""}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>
    </PrivacyProvider>
  );
}
