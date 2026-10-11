"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { partyHref } from "@/components/parties/labels";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatCount, formatDay, FULL_MONTHS } from "@/lib/display";
import { cn } from "@/lib/utils";
import { type CostPeriod, costPeriodParam } from "@/modules/accounts/cost-periods";
import type { ExpenseBreakdown as Breakdown } from "@/modules/accounts/expense-breakdown.service";

import { Figure, Row } from "./executive-cards";
import { ASSET_STATUS_LABELS, assetHref, costPeriodLabel, employeePayHref } from "./labels";
import { Amount, ScopeEye } from "./privacy";

/** Rows shown before "Show all". */
const FIRST_ROWS = 5;

const linkClass = "text-sm font-medium text-primary underline-offset-4 hover:underline";

const isZero = (fixed: string) => !/[1-9]/.test(fixed);

/** The year and month the panels cover; a change reloads them, keeping the rest of the address. */
function PeriodPicker({
  period,
  years,
  onChange,
}: {
  period: CostPeriod;
  years: number[];
  onChange: (next: CostPeriod) => void;
}) {
  return (
    <div role="group" aria-label="Period" className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
      <div className="min-w-0">
        <label htmlFor="costs-month" className="sr-only">
          Month
        </label>
        <NativeSelect
          id="costs-month"
          value={period.month === null ? "" : String(period.month)}
          onChange={(e) =>
            onChange({ ...period, month: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">Whole year</option>
          {FULL_MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1)}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="min-w-0">
        <label htmlFor="costs-year" className="sr-only">
          Year
        </label>
        <NativeSelect
          id="costs-year"
          value={String(period.year)}
          onChange={(e) => onChange({ ...period, year: Number(e.target.value) })}
        >
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

function Panel({
  scope,
  title,
  total,
  hint,
  footer,
  children,
}: {
  scope: string;
  title: string;
  total: string;
  hint: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col rounded-lg border bg-card px-4 pt-2 pb-4"
    >
      <div className="-mr-2 flex min-h-11 items-center justify-between gap-2">
        <h4 className="eyebrow">{title}</h4>
        <ScopeEye scope={scope} label={title} />
      </div>
      <Figure scope={scope} value={total} />
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">{hint}</p>
      <div className="mt-3 flex-1">{children}</div>
      {footer && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
          {footer}
        </div>
      )}
    </section>
  );
}

/** A panel's list: the first few rows, and the rest behind "Show all". */
function Rows<T>({
  items,
  label,
  empty,
  render,
}: {
  items: readonly T[];
  /** What the list holds, for screen readers ("Employees"). */
  label: string;
  empty: string;
  render: (item: T, index: number) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const shown = all ? items : items.slice(0, FIRST_ROWS);
  return (
    <div className="grid gap-1">
      <ul aria-label={label} className="-mx-2 grid">
        {shown.map(render)}
      </ul>
      {items.length > FIRST_ROWS && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
        >
          {all ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
    </div>
  );
}

/**
 * Below the executive cards: what went on salaries, running costs, assets and
 * suppliers in the month or year chosen (this month at first). Each name opens
 * its own page; every amount hides behind the eye like the cards above.
 */
export function ExpenseBreakdown({ data, currency }: { data: Breakdown; currency: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useOptimistic<CostPeriod>({
    year: data.period.year,
    month: data.period.month,
  });
  const m = (fixed: string) => money(fixed, currency);
  const count = (n: number, one: string, many: string) =>
    `${formatCount(n, currency)} ${n === 1 ? one : many}`;
  const { salaries, adminCosts, assets, vendors, can } = data;
  const label = costPeriodLabel(data.period);
  const range = `from=${data.period.from}&to=${data.period.to}`;

  function choose(next: CostPeriod) {
    startTransition(() => {
      setPeriod(next);
      const query = new URLSearchParams(params.toString());
      query.set("costs", costPeriodParam(next));
      router.replace(`${pathname}?${query.toString()}`, { scroll: false });
    });
  }

  return (
    <section aria-labelledby="costs-heading" className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="costs-heading" className="font-serif text-xl text-primary">
            Expense breakdown
          </h3>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Salaries, running costs, assets bought and suppliers paid in {label}.
          </p>
        </div>
        <PeriodPicker period={period} years={data.period.years} onChange={choose} />
      </div>
      <div
        aria-busy={pending}
        className={cn(
          "grid grid-cols-1 gap-3 transition-opacity lg:grid-cols-2",
          pending && "pointer-events-none opacity-60",
        )}
      >
        <Panel
          scope="salaries"
          title="Salary & payroll"
          total={m(salaries.total)}
          hint={
            salaries.employees.length === 0 && !salaries.unnamed ? (
              "No approved payroll yet"
            ) : (
              <>
                Net pay of {count(salaries.employees.length, "employee", "employees")}
                {!isZero(salaries.unpaid) && (
                  <>
                    {" · "}
                    <Amount scope="salaries">{m(salaries.unpaid)}</Amount> not paid yet
                  </>
                )}
                {!isZero(salaries.otherPay) && (
                  <>
                    {" · "}
                    <Amount scope="salaries">{m(salaries.otherPay)}</Amount> other pay
                  </>
                )}
              </>
            )
          }
          footer={
            <Link href={`/hr/payroll?year=${data.period.year}`} className={linkClass}>
              Payroll
            </Link>
          }
        >
          <Rows
            items={salaries.employees}
            label="Employees"
            empty={`Nothing approved for ${label}. A payroll shows here once it is approved.`}
            render={(e) => (
              <Row
                key={e.id}
                href={employeePayHref(e.id, data.period.year)}
                title={e.name}
                sub={[
                  e.designation,
                  !isZero(e.unpaid) ? "not paid yet" : null,
                  !isZero(e.otherPay) ? "with other pay" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                amount={m(e.total)}
                scope="salaries"
              />
            )}
          />
          {salaries.unnamed && (
            <ul className="-mx-2 grid">
              <Row
                title="Not in anyone's name"
                sub="Salary-group expenses"
                amount={m(salaries.unnamed)}
                scope="salaries"
              />
            </ul>
          )}
        </Panel>

        <Panel
          scope="admin-costs"
          title="Administrative costs"
          total={m(adminCosts.total)}
          hint={
            adminCosts.count === 0
              ? "No running costs recorded"
              : `${count(adminCosts.count, "expense", "expenses")} under ${count(adminCosts.heads.length, "head", "heads")}`
          }
          footer={
            <Link href="/accounts/expenses" className={linkClass}>
              All expenses
            </Link>
          }
        >
          <Rows
            items={adminCosts.heads}
            label="Expense heads"
            empty={`No rent, utilities or other running costs recorded for ${label}.`}
            render={(h) => (
              <Row
                key={h.id}
                href={`/accounts/expenses?status=POSTED&head=${encodeURIComponent(h.id)}&${range}`}
                title={h.name}
                sub={count(h.count, "expense", "expenses")}
                amount={m(h.amount)}
                scope="admin-costs"
              />
            )}
          />
        </Panel>

        <Panel
          scope="asset-purchases"
          title="Asset purchases"
          total={m(assets.total)}
          hint={
            assets.assets.length === 0
              ? "Nothing bought"
              : `${count(assets.assets.length, "asset", "assets")} bought, at cost`
          }
          footer={
            <>
              {can.recordAsset && (
                <Link href={assetHref.record} className={linkClass}>
                  Record an asset purchase
                </Link>
              )}
              <Link href={assetHref.register} className={linkClass}>
                Fixed asset register
              </Link>
            </>
          }
        >
          <Rows
            items={assets.assets}
            label="Assets bought"
            empty={`No laptops, machines or other assets bought in ${label}.`}
            render={(a) => (
              <Row
                key={a.id}
                href={assetHref.asset(a.id)}
                title={a.name}
                sub={[
                  a.category,
                  formatDay(a.boughtOn),
                  a.status === "IN_USE" ? null : ASSET_STATUS_LABELS[a.status],
                ]
                  .filter(Boolean)
                  .join(" · ")}
                amount={m(a.cost)}
                scope="asset-purchases"
              />
            )}
          />
        </Panel>

        <Panel
          scope="vendors"
          title="Vendor summary"
          total={m(vendors.total)}
          hint={
            vendors.suppliers.length === 0
              ? "No supplier paid"
              : `Paid to ${count(vendors.suppliers.length, "supplier", "suppliers")}, most first`
          }
          footer={
            <Link href="/accounts/supplier-payments" className={linkClass}>
              Supplier payments
            </Link>
          }
        >
          <Rows
            items={vendors.suppliers}
            label="Suppliers by money paid"
            empty={`No supplier, factory or CMT paid in ${label}.`}
            render={(s, i) => (
              <Row
                key={s.id}
                href={
                  can.openParty
                    ? partyHref(s)
                    : `/accounts/supplier-payments?supplier=${encodeURIComponent(s.id)}`
                }
                title={`${i + 1}. ${s.name}`}
                sub={count(s.payments, "payment", "payments")}
                amount={m(s.amount)}
                scope="vendors"
              />
            )}
          />
        </Panel>
      </div>
    </section>
  );
}
