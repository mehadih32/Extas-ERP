import type { Metadata } from "next";

import { Stat } from "@/components/accounts/stat";
import { AdvanceBadge } from "@/components/hr/badges";
import { recoveryText, SETTLEMENT_LABELS } from "@/components/hr/labels";
import { MyHrProblem } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { isZero, money } from "@/components/sales/labels";
import { formatDay, formatMonth } from "@/lib/display";
import { getMyAdvancesScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My advances" };

const smallText = "block text-[0.8125rem] text-muted-foreground";

/**
 * The employee's own salary advances (portal.self): what is still owed, how
 * it is taken back, and each amount already repaid.
 */
export default async function MyAdvancesPage() {
  const ctx = await requireCompanyPage();
  const result = await getMyAdvancesScreenAction();
  if (!result.ok) {
    return (
      <MyHrProblem
        error={result.error}
        title="My advances"
        heading="Your advances could not load"
      />
    );
  }
  const { outstanding, items } = result.data;
  const currency = ctx.company.currency;

  return (
    <section aria-labelledby="my-advances-heading" className="grid gap-6">
      <div>
        <h2 id="my-advances-heading" className="font-serif text-2xl text-primary">
          Salary advances
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Money paid to you ahead of your salary, and how it is taken back.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No advances">
          An advance HR or Accounts gives you shows here with how it is taken back.
        </EmptyState>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Still owed"
              value={isZero(outstanding) ? "Nothing" : money(outstanding, currency)}
            />
          </dl>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Advances">
            {items.map((a) => {
              const repaid = a.settlements.filter((s) => !s.reversedAt);
              return (
                <li key={a.id} className="min-w-0 rounded-lg border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="eyebrow block">
                        {a.number} · {formatDay(a.givenOn)}
                      </span>
                      <span className="mt-2 block font-serif text-xl text-primary">
                        {money(a.amount, currency)}
                      </span>
                    </span>
                    <AdvanceBadge status={a.status} />
                  </div>
                  {a.purpose && <p className="mt-2 text-sm text-muted-foreground">{a.purpose}</p>}
                  {a.status === "OPEN" && (
                    <p className="mt-3 text-sm">
                      <span className="font-medium">{money(a.outstanding, currency)}</span> still
                      owed.{" "}
                      <span className="text-muted-foreground">{recoveryText(a, currency)}.</span>
                    </p>
                  )}
                  {repaid.length > 0 && (
                    <ul className="mt-4 grid divide-y border-t pt-3" aria-label="Paid back">
                      {repaid.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 text-sm">
                            {s.payroll
                              ? `From the ${formatMonth(s.payroll.month)} salary`
                              : SETTLEMENT_LABELS[s.kind]}
                            <span className={smallText}>{formatDay(s.settledOn)}</span>
                          </span>
                          <span className="text-sm whitespace-nowrap tabular-nums">
                            {money(s.amount, currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
