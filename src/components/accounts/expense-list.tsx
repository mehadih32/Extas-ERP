"use client";

import { PaperclipIcon } from "lucide-react";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { money } from "@/components/sales/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import type { ExpenseRow } from "@/modules/expenses/screens.service";
import { listExpenseRowsAction } from "@/server/actions/expenses.actions";

import { ExpenseBadge } from "./badges";
import { accountsHref } from "./labels";
import { expenseListQuery, type ExpenseListView } from "./list-view";

/** "Paid from Cash in hand", "Owed to Rahim Fabrics", "Claim by Karim". */
function howText(e: ExpenseRow, showClaimant: boolean): string {
  const parts: string[] = [];
  if (e.paymentType === "DUE") parts.push(`Owed to ${e.supplier ?? "a supplier"}`);
  else if (e.paidFrom) parts.push(`Paid from ${e.paidFrom}`);
  else if (e.status === "POSTED") parts.push("Paid from an advance");
  if (e.employee) parts.push(e.employee);
  if (showClaimant && e.createdBy && e.status === "PENDING") parts.push(`by ${e.createdBy}`);
  return parts.join(" · ");
}

/**
 * Expenses and claims: cards on phones, a table on computers, each opening
 * the expense, with "Show more" for the next page.
 */
export function ExpenseList({
  initial,
  view,
  currency,
  seesAll,
}: {
  initial: { items: ExpenseRow[]; nextCursor?: string };
  view: ExpenseListView;
  currency: string;
  /** Whether the list holds other people's expenses (then it names who recorded them). */
  seesAll: boolean;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listExpenseRowsAction(expenseListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Expenses">
        {list.items.map((e) => (
          <RowCard
            key={e.id}
            href={accountsHref.expense(e.id)}
            eyebrow={`${e.number} · ${formatDay(e.spentOn)}`}
            badges={<ExpenseBadge status={e.status} />}
            title={e.head}
            details={[e.details, howText(e, seesAll)].filter(Boolean).join(" · ")}
            footer={
              <>
                <span className="font-medium">{money(e.amount, currency)}</span>
                {e.hasReceipt && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <PaperclipIcon className="size-3.5" aria-hidden />
                    Receipt
                  </span>
                )}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Expenses">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Expense</TableHead>
              <TableHead>For</TableHead>
              <TableHead>How</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="py-3">
                  <RowLink href={accountsHref.expense(e.id)}>{e.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(e.spentOn)}</span>
                    <ExpenseBadge status={e.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex max-w-64 items-center gap-1.5">
                    <span className="truncate">{e.head}</span>
                    {e.hasReceipt && (
                      <PaperclipIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Receipt attached"
                      />
                    )}
                  </div>
                  {e.details && (
                    <div className="max-w-64 truncate text-[0.8125rem] text-muted-foreground">
                      {e.details}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate text-muted-foreground">
                    {howText(e, seesAll)}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                  {money(e.amount, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="expenses" />
    </div>
  );
}
