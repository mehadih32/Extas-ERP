import type { Metadata } from "next";

import { FlagBadge } from "@/components/hr/badges";
import { hrHref } from "@/components/hr/labels";
import { MyHrProblem } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { RowCard } from "@/components/sales/load-more";
import { money } from "@/components/sales/labels";
import { getMyPayslipsScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My payslips" };

/**
 * The employee's own payslips, newest first (portal.self): each approved
 * month's take-home pay and whether it is paid. A draft payroll is not shown
 * until it is approved.
 */
export default async function MyPayslipsPage() {
  const ctx = await requireCompanyPage();
  const result = await getMyPayslipsScreenAction();
  if (!result.ok) {
    return (
      <MyHrProblem
        error={result.error}
        title="My payslips"
        heading="Your payslips could not load"
      />
    );
  }
  const { payslips } = result.data;
  const currency = ctx.company.currency;

  return (
    <section aria-labelledby="my-payslips-heading" className="grid gap-6">
      <div>
        <h2 id="my-payslips-heading" className="font-serif text-2xl text-primary">
          Payslips
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Each month&apos;s pay once its payroll is approved. Open one to see the details or print
          it.
        </p>
      </div>
      {payslips.length === 0 ? (
        <EmptyState title="No payslips yet">
          Your first payslip shows here once that month&apos;s payroll is approved.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Payslips">
          {payslips.map((s) => (
            <RowCard
              key={s.itemId}
              href={hrHref.myPayslip(s.itemId)}
              eyebrow="Payslip"
              badges={
                s.paid ? (
                  <FlagBadge tone="done">Paid</FlagBadge>
                ) : (
                  <FlagBadge tone="warn">To be paid</FlagBadge>
                )
              }
              title={s.label}
              footer={
                <>
                  <span className="text-muted-foreground">Take home</span>
                  <span className="font-medium">{money(s.netPay, currency)}</span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
