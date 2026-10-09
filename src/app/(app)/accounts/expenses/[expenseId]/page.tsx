import { PaperclipIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExpenseBadge } from "@/components/accounts/badges";
import { ExpenseActions } from "@/components/accounts/expense-actions";
import { accountsHref, EXPENSE_CATEGORY_LABELS } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { getExpenseScreenAction } from "@/server/actions/expenses.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Expense" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const owed = (fixed: string) => /[1-9]/.test(fixed);

/**
 * One expense or claim (like GET /api/expenses/:id): what it was for, how it
 * was paid, who recorded it, its receipt, and what this person may do with it.
 * People who see only their own expenses cannot open anyone else's.
 */
export default async function ExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ expenseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ expenseId }, query] = await Promise.all([params, searchParams]);
  const result = await getExpenseScreenAction(expenseId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Expenses are not part of your role">
          {result.error.message}
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError title="Expense" heading="The expense could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { expense: e, can } = screen;
  const currency = ctx.company.currency;
  const notice =
    query.created === "1"
      ? e.status === "PENDING"
        ? `${e.number} was sent to Accounts.`
        : `${e.number} was recorded.`
      : query.saved === "1"
        ? `${e.number} was saved.`
        : undefined;
  const fromAdvance = owed(e.fromAdvance);

  let how: string;
  if (e.paymentType === "DUE") {
    how = e.status === "PENDING" ? "To be owed to the supplier" : "Owed to the supplier";
  } else if (e.status === "PENDING") {
    how = "Paid by the claimant, waiting to be paid back";
  } else if (e.status === "REJECTED") {
    how = "Not paid";
  } else {
    how = e.paidFrom ? `Paid from ${e.paidFrom.name}` : "Settled from an advance";
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/accounts/expenses">All expenses</BackLink>
        <RecordHeader
          eyebrow={`${e.number} · ${formatDay(e.spentOn)}`}
          title={e.head.name}
          badges={
            <>
              <ExpenseBadge status={e.status} />
              <span className="font-serif text-lg text-primary tabular-nums">
                {money(e.amount, currency)}
              </span>
            </>
          }
        />
        {e.voidReason && (
          <FormAlert tone="note">
            {e.status === "VOID" ? "Voided" : "Closed without payment"}
            {e.voidedOn ? ` on ${formatDay(e.voidedOn)}` : ""}: {e.voidReason}
          </FormAlert>
        )}
        <ExpenseActions key={e.id} screen={screen} currency={currency} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="What it was for" id="for-heading">
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Fact label="Head">
                {e.head.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {EXPENSE_CATEGORY_LABELS[e.head.category] ?? e.head.category}
                </span>
              </Fact>
              {e.employee && (
                <Fact label="Employee">{`${e.employee.name} (${e.employee.code})`}</Fact>
              )}
              {e.purpose && <Fact label="Purpose">{e.purpose}</Fact>}
              {(e.fromLocation || e.toLocation) && (
                <Fact label="Route">
                  {[e.fromLocation, e.toLocation].filter(Boolean).join(" to ")}
                </Fact>
              )}
              {e.description && (
                <Fact label="Details" className="sm:col-span-2">
                  <span className="whitespace-pre-line">{e.description}</span>
                </Fact>
              )}
              <Fact label="Receipt">
                {e.receipt ? (
                  <a
                    href={accountsHref.file(e.receipt.id)}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex max-w-full items-center gap-1.5 ${linkClass}`}
                  >
                    <PaperclipIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{e.receipt.fileName}</span>
                  </a>
                ) : (
                  "None attached"
                )}
              </Fact>
              <Fact label="Recorded by">
                {e.createdBy ?? "Unknown"} on {formatDay(e.recordedOn)}
              </Fact>
            </dl>
          </Panel>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Payment" id="payment-heading">
            <p className="mt-4 text-sm">{how}</p>
            {fromAdvance && (
              <Totals
                className="mt-4"
                currency={currency}
                lines={[
                  { label: "Amount", amount: e.amount, strong: true },
                  { label: "From the employee's advance", amount: e.fromAdvance },
                ]}
              />
            )}
            <dl className="mt-4 grid gap-4">
              {e.supplier && (
                <Fact label="Supplier">
                  {can.openParty ? (
                    <Link href={productionHref.supplier(e.supplier.id)} className={linkClass}>
                      {e.supplier.name}
                    </Link>
                  ) : (
                    e.supplier.name
                  )}
                </Fact>
              )}
              {e.advances.length > 0 && (
                <Fact label="Advances used">
                  {e.advances
                    .map(
                      (a) =>
                        `${a.number} ${money(a.amount, currency)}${a.undone ? " (undone)" : ""}`,
                    )
                    .join(", ")}
                </Fact>
              )}
              {e.journalEntry && (
                <Fact label="Journal entry">
                  {can.openEntry ? (
                    <Link href={accountsHref.entry(e.journalEntry.id)} className={linkClass}>
                      {e.journalEntry.number}
                    </Link>
                  ) : (
                    e.journalEntry.number
                  )}
                </Fact>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
