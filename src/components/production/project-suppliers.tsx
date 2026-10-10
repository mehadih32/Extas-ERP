import Link from "next/link";

import { categoryText } from "@/components/parties/labels";
import { productionHref } from "@/components/production/labels";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ProjectSupplierRow } from "@/modules/production/settlement.service";

const isZero = (fixed: string) => !/[1-9]/.test(fixed);

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * Each supplier's bills for a project, what is paid and what the project still
 * owes them. Once the project is completed its balances are settled: zero, with
 * whatever was still due left on each supplier's own ledger. Accessories
 * suppliers run on a continuous ledger and are not settled by project.
 */
export function ProjectSuppliers({
  rows,
  completed,
  currency,
  canOpenParty,
}: {
  rows: ProjectSupplierRow[];
  completed: boolean;
  currency: string;
  canOpenParty: boolean;
}) {
  return (
    <Panel title="Suppliers" id="suppliers-heading">
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">
        {completed
          ? "Settled when the project was completed. Anything still due stays on each supplier's ledger."
          : "Their bills for this project, what is paid and what is still due."}
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No supplier bills on this project yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 divide-y" aria-label="Suppliers">
          {rows.map((r) => {
            const categories = categoryText(r.supplier.categories);
            return (
              <li key={r.supplier.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium break-words">
                    {canOpenParty ? (
                      <Link href={productionHref.supplier(r.supplier.id)} className={linkClass}>
                        {r.supplier.name}
                      </Link>
                    ) : (
                      r.supplier.name
                    )}
                  </p>
                  <p
                    className={cn(
                      "text-sm font-medium whitespace-nowrap tabular-nums",
                      !isZero(r.balance) && "text-destructive",
                    )}
                  >
                    {r.settlement
                      ? "Settled"
                      : isZero(r.balance)
                        ? "Paid"
                        : `${money(r.balance, currency)} due`}
                  </p>
                </div>
                <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                  {categories && `${categories} · `}Billed {money(r.billed, currency)} · paid{" "}
                  {money(r.paid, currency)}
                </p>
                {r.settlement ? (
                  <p className="text-[0.8125rem] text-muted-foreground">
                    Balance zero since {formatDay(r.settlement.settledOn)}
                    {isZero(r.settlement.carried)
                      ? "; paid in full."
                      : `; ${money(r.settlement.carried, currency)} left on their ledger.`}
                  </p>
                ) : (
                  r.runningLedger && (
                    <p className="text-[0.8125rem] text-muted-foreground">
                      Accessories: on their running ledger, not settled by project.
                    </p>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
