import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import type { AiMonthCost } from "@/modules/ai/costs.service";

/**
 * AI Home's cost card: today's and this month's spending, the month against the
 * budget, with the alert past its percentage.
 */
export function AiMonthCostCard({ month: m }: { month: AiMonthCost }) {
  const alert = m.budget && m.percent !== null && m.percent >= m.alertPercent;
  return (
    <Panel
      title="AI cost"
      id="ai-month-heading"
      action={
        <Link
          href="/ai/costs"
          className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
        >
          Budget & Costs
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      }
    >
      <dl className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Today</dt>
          <dd className="font-serif text-2xl text-primary tabular-nums">
            {money(m.today.spent, m.currency)}
          </dd>
          <dd className="text-[0.75rem] text-muted-foreground">
            {m.today.calls} {m.today.calls === 1 ? "call" : "calls"}
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">This month</dt>
          <dd className="font-serif text-2xl text-primary tabular-nums">
            {money(m.spent, m.currency)}
          </dd>
          <dd className="text-[0.75rem] text-muted-foreground">
            {m.calls} {m.calls === 1 ? "call" : "calls"}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">
        {m.budget
          ? `Budget ${money(m.budget, m.currency)} (${m.percent}% used).`
          : "No monthly budget is set: the AI asks before big work."}
      </p>
      {alert && (
        <div className="mt-3">
          <FormAlert tone={m.percent! >= 100 ? "error" : "note"}>
            The AI has used {m.percent}% of this month&apos;s budget.
          </FormAlert>
        </div>
      )}
    </Panel>
  );
}
