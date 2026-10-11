import Link from "next/link";

import { formatCount, formatDay } from "@/lib/display";

import { SalesReturnBadge } from "./badges";
import { Panel } from "./detail-bits";
import { money, salesHref } from "./labels";

type ReturnLine = {
  id: string;
  number: string;
  returnedOn: string;
  pieces: number;
  amount: string;
  voided: boolean;
};

/** The sales returns (credit notes) on an invoice or order, each opening its page; none, no panel. */
export function ReturnRecords({ returns, currency }: { returns: ReturnLine[]; currency: string }) {
  if (returns.length === 0) return null;
  return (
    <Panel title="Returns" id="returns-heading">
      <ul className="mt-4 grid grid-cols-1 divide-y">
        {returns.map((r) => (
          <li
            key={r.id}
            className="flex min-w-0 items-start justify-between gap-4 py-2.5 first:pt-0"
          >
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Link
                  href={salesHref.salesReturn(r.id)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {r.number}
                </Link>
                {r.voided && <SalesReturnBadge voided />}
              </p>
              <p className="text-[0.8125rem] text-muted-foreground">
                {formatDay(r.returnedOn)} · {formatCount(r.pieces, currency)} pcs
              </p>
            </div>
            <p
              className={`text-sm font-medium whitespace-nowrap tabular-nums ${r.voided ? "text-muted-foreground line-through" : ""}`}
            >
              {money(r.amount, currency)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">
        Credited to the buyer&apos;s account; the pieces are in Damage &amp; QC Rejects.
      </p>
    </Panel>
  );
}
