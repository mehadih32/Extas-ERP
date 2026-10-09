import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { AdvanceActions, UndoReturn } from "@/components/hr/advance-actions";
import { AdvanceBadge, FlagBadge } from "@/components/hr/badges";
import { hrHref, recoveryText, SETTLEMENT_LABELS } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { METHOD_LABELS, money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay, formatMonth } from "@/lib/display";
import { getAdvanceScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Advance" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One salary advance (hr.manage, hr.payroll, accounts.view or
 * accounts.payments.record): how it was paid, how it is taken back and each
 * time it was, with changing, taking back or voiding it as hr/rules.ts allows.
 */
export default async function AdvancePage({
  params,
  searchParams,
}: {
  params: Promise<{ advanceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ advanceId }, query] = await Promise.all([params, searchParams]);
  const result = await getAdvanceScreenAction(advanceId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Advance" heading="The advance could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { advance: a, can, notes } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? a.isOpening
        ? `${a.number} was brought forward: ${a.employee.name} owes ${money(a.amount, currency)}.`
        : `${a.number} was paid to ${a.employee.name}.`
      : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={hrHref.advances}>All advances</BackLink>
        <RecordHeader
          eyebrow={`Advance ${a.number} · ${formatDay(a.givenOn)}`}
          title={a.employee.name}
          badges={
            <>
              <AdvanceBadge status={a.status} />
              {a.isOpening && <FlagBadge>Brought forward</FlagBadge>}
            </>
          }
        />
        <AdvanceActions key={a.id} screen={screen} currency={currency} notice={notice} />
        {notes.void && <p className="text-[0.8125rem] text-muted-foreground">{notes.void}</p>}
        {a.status === "VOID" && a.voidReason && (
          <FormAlert tone="note">Voided: {a.voidReason}</FormAlert>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Given" value={money(a.amount, currency)} />
        <Stat label="Taken back" value={money(a.recovered, currency)} />
        <Stat
          label="Still owed"
          value={money(a.outstanding, currency)}
          alert={a.status === "OPEN"}
          hint={a.status === "OPEN" ? recoveryText(a, currency) : undefined}
        />
      </dl>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="Taken back" id="settlements-heading">
          {a.settlements.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing yet. Payroll takes it from the salary for {formatMonth(a.recoverFrom)}
              {a.installmentAmount ? " onwards" : ""}.
            </p>
          ) : (
            <ul className="mt-4 grid divide-y" aria-label="Taken back">
              {a.settlements.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 text-sm">
                    <span className="block">
                      {SETTLEMENT_LABELS[s.kind]}
                      {s.reversedAt && <span className="text-muted-foreground"> (undone)</span>}
                    </span>
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {formatDay(s.settledOn)}
                      {s.payroll && (
                        <>
                          {" · "}
                          {can.openPayroll ? (
                            <Link href={hrHref.payrollRun(s.payroll.runId)} className={linkClass}>
                              payroll for {formatMonth(s.payroll.month)}
                            </Link>
                          ) : (
                            `payroll for ${formatMonth(s.payroll.month)}`
                          )}
                        </>
                      )}
                      {s.expense && (
                        <>
                          {" · "}
                          {can.openExpenses ? (
                            <Link href={hrHref.expense(s.expense.id)} className={linkClass}>
                              {s.expense.number}
                            </Link>
                          ) : (
                            s.expense.number
                          )}
                        </>
                      )}
                      {s.journalEntry && can.openJournal && !s.payroll && (
                        <>
                          {" · "}
                          <Link href={hrHref.journal(s.journalEntry.id)} className={linkClass}>
                            {s.journalEntry.number}
                          </Link>
                        </>
                      )}
                      {s.note && s.kind === "CASH_RETURN" ? ` · ${s.note}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`text-sm whitespace-nowrap tabular-nums ${s.reversedAt ? "text-muted-foreground line-through" : ""}`}
                    >
                      {money(s.amount, currency)}
                    </span>
                    {s.canUndo && (
                      <UndoReturn advanceId={a.id} settlement={s} currency={currency} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Details"
          id="details-heading"
          action={
            can.openEmployee ? (
              <Link href={hrHref.employee(a.employee.id)} className={`text-sm ${linkClass}`}>
                {a.employee.name}
              </Link>
            ) : undefined
          }
        >
          <dl className="mt-4 grid gap-4">
            <Fact label="Employee">{`${a.employee.name} (${a.employee.code})`}</Fact>
            {a.purpose && <Fact label="What for">{a.purpose}</Fact>}
            <Fact label={a.isOpening ? "Owed from" : "Paid"}>
              {a.isOpening
                ? "Before Extas ERP (no money moved)"
                : `${METHOD_LABELS[a.method]}${a.paidFrom ? ` from ${a.paidFrom.name}` : ""}`}
              {a.reference && <span className="block text-muted-foreground">{a.reference}</span>}
            </Fact>
            <Fact label="Taken back">{a.status === "OPEN" ? recoveryText(a, currency) : "–"}</Fact>
            {a.journalEntry && (
              <Fact label="Journal entry">
                {can.openJournal ? (
                  <Link href={hrHref.journal(a.journalEntry.id)} className={linkClass}>
                    {a.journalEntry.number}
                  </Link>
                ) : (
                  a.journalEntry.number
                )}
              </Fact>
            )}
            {a.createdBy && <Fact label="Recorded by">{a.createdBy.name}</Fact>}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
