import { METHOD_LABELS, money } from "@/components/sales/labels";
import { formatDay } from "@/lib/display";
import type { Payslip } from "@/modules/hr/screens.service";

import { payDetails } from "./labels";

/**
 * A payslip as it prints: the company's letterhead, the employee, the month's
 * attendance, earnings and deductions, and the take-home pay in figures and
 * words. A draft payroll's payslip says it is not final.
 */
export function PayslipView({ slip }: { slip: Payslip }) {
  const c = slip.company;
  const e = slip.employee;
  const a = slip.attendance;
  const currency = c.currency;
  const details = payDetails(e);
  const row = "flex items-baseline justify-between gap-4 py-1.5";

  return (
    <article
      aria-label={`Payslip for ${slip.label}`}
      className="mx-auto w-full max-w-3xl rounded-lg border bg-card p-5 sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0"
    >
      <header className="flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-serif text-2xl leading-tight text-primary">{c.legalName ?? c.name}</p>
          {c.address && (
            <p className="text-[0.8125rem] whitespace-pre-line text-muted-foreground">
              {c.address}
            </p>
          )}
          {(c.phone || c.email) && (
            <p className="text-[0.8125rem] text-muted-foreground">
              {[c.phone, c.email].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="sm:text-right">
          <p className="eyebrow">Payslip</p>
          <p className="font-serif text-xl text-primary">{slip.label}</p>
        </div>
      </header>

      {slip.status === "DRAFT" && (
        <p className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Draft: this payroll is not approved yet, so these figures may change.
        </p>
      )}

      <section aria-label="Employee" className="mt-5 grid gap-4 sm:grid-cols-2">
        <dl className="grid gap-1 text-sm">
          <dt className="sr-only">Employee</dt>
          <dd className="font-medium">
            {e.name} <span className="font-normal text-muted-foreground">({e.code})</span>
          </dd>
          {(e.designation || e.department) && (
            <dd className="text-muted-foreground">
              {[e.designation, e.department].filter(Boolean).join(" · ")}
            </dd>
          )}
          <dd className="text-muted-foreground">
            Joined {formatDay(e.joinDate)}
            {e.exitDate ? ` · last day ${formatDay(e.exitDate)}` : ""}
          </dd>
        </dl>
        <dl className="grid gap-1 text-sm sm:text-right">
          <dt className="sr-only">Paid by</dt>
          <dd>Paid by {METHOD_LABELS[e.salaryMethod]}</dd>
          {details && <dd className="text-muted-foreground">{details}</dd>}
          <dd className="text-muted-foreground">
            Monthly salary {money(slip.monthlySalary, currency)}
          </dd>
        </dl>
      </section>

      <section aria-label="Attendance" className="mt-5 rounded-md bg-muted/50 p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ["Working days", a.workingDays],
              ["Present", a.presentDays],
              ["Paid leave", a.paidLeaveDays],
              ["Unpaid leave", a.unpaidLeaveDays],
              ["Absent", a.absentDays],
              ["Late", a.lateDays],
              ["Unpaid days", a.unpaidDays],
              ["Overtime", `${a.overtimeHours} h`],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="earnings-heading">
          <h3 id="earnings-heading" className="eyebrow border-b pb-2">
            Earnings
          </h3>
          <dl className="divide-y text-sm tabular-nums">
            {slip.earnings.map((x) => (
              <div key={x.label} className={row}>
                <dt>{x.label}</dt>
                <dd className="whitespace-nowrap">{money(x.amount, currency)}</dd>
              </div>
            ))}
            <div className={`${row} font-medium`}>
              <dt>Total earnings</dt>
              <dd className="whitespace-nowrap">{money(slip.totalEarnings, currency)}</dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby="deductions-heading">
          <h3 id="deductions-heading" className="eyebrow border-b pb-2">
            Deductions
          </h3>
          <dl className="divide-y text-sm tabular-nums">
            {slip.deductions.length === 0 && (
              <div className={row}>
                <dt className="text-muted-foreground">None</dt>
                <dd />
              </div>
            )}
            {slip.deductions.map((x) => (
              <div key={x.label} className={row}>
                <dt>{x.label}</dt>
                <dd className="whitespace-nowrap">{money(x.amount, currency)}</dd>
              </div>
            ))}
            <div className={`${row} font-medium`}>
              <dt>Total deductions</dt>
              <dd className="whitespace-nowrap">{money(slip.totalDeductions, currency)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section
        aria-label="Take-home pay"
        className="mt-6 flex flex-col gap-1 border-t pt-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <p className="eyebrow">Take-home pay</p>
          <p className="text-[0.8125rem] text-muted-foreground">{slip.netPayInWords}</p>
        </div>
        <p className="font-serif text-2xl text-primary tabular-nums">
          {money(slip.netPay, currency)}
        </p>
      </section>

      <p className="mt-4 text-[0.8125rem] text-muted-foreground">
        {slip.payment.status === "PAID"
          ? `Paid on ${formatDay(slip.paidOn!)} by ${METHOD_LABELS[slip.payment.method]} (${slip.payment.number}).`
          : slip.payment.status === "UNPAID"
            ? "Not paid yet."
            : "Not approved yet."}
        {slip.note ? ` ${slip.note}` : ""}
      </p>
      {c.footer && (
        <p className="mt-6 border-t pt-3 text-center text-[0.75rem] text-muted-foreground">
          {c.footer}
        </p>
      )}
    </article>
  );
}
