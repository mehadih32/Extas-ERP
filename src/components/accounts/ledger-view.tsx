import Link from "next/link";

import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";

import { OffBadge } from "./badges";
import { accountsHref, columnAmount, isNegative, signedMoney } from "./labels";

/*
 * A ledger or a bank statement on screen: the figures for the days chosen,
 * then each line with its running balance (cards on phones, a table from
 * tablets up), each opening its journal entry for people who see the journal.
 */

export type LedgerFigure = { label: string; value: string; hint?: string; alert?: boolean };

export function LedgerSummary({
  figures,
  footer,
}: {
  figures: LedgerFigure[];
  footer?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="summary-heading" className="rounded-lg border bg-card p-5 sm:p-6">
      <h3 id="summary-heading" className="sr-only">
        Summary
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="eyebrow">{f.label}</dt>
            <dd
              className={cn(
                "mt-1 font-serif text-lg leading-tight break-words lining-nums tabular-nums sm:text-xl",
                f.alert && "text-destructive",
              )}
            >
              {f.value}
            </dd>
            {f.hint && <dd className="mt-1 text-[0.8125rem] text-muted-foreground">{f.hint}</dd>}
          </div>
        ))}
      </dl>
      {footer && <p className="mt-5 border-t pt-4 text-sm">{footer}</p>}
    </section>
  );
}

export type LedgerLine = {
  key: string;
  entryId: string;
  day: string;
  number: string;
  details: string;
  note?: string | null;
  /** The left money column (debit, deposit) and the right one (credit, withdrawal). */
  left: string;
  right: string;
  balance: string;
  flag?: "Reversed" | "Reversal" | null;
};

export function LedgerLines({
  lines,
  hiddenCount,
  columns,
  currency,
  canOpen,
}: {
  lines: LedgerLine[];
  hiddenCount: number;
  /** The money columns' names: ["Debit", "Credit"] or ["Deposit", "Withdrawal"]. */
  columns: [string, string];
  currency: string;
  /** Whether the voucher numbers open their journal entries. */
  canOpen: boolean;
}) {
  if (lines.length === 0) {
    return (
      <EmptyState title="Nothing in this period">Choose other days, or everything.</EmptyState>
    );
  }
  const voucher = (line: LedgerLine) =>
    canOpen ? (
      <Link
        href={accountsHref.entry(line.entryId)}
        className="rounded-sm text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/25"
      >
        {line.number}
      </Link>
    ) : (
      line.number
    );
  return (
    <section aria-labelledby="lines-heading" className="grid grid-cols-1 gap-4">
      <h3 id="lines-heading" className="font-serif text-xl text-primary">
        Transactions
      </h3>
      {hiddenCount > 0 && (
        <FormAlert tone="note">
          The latest {formatCount(lines.length, currency)} transactions are shown. Choose fewer days
          to see the {formatCount(hiddenCount, currency)} before them.
        </FormAlert>
      )}
      <ol className="grid grid-cols-1 gap-3 md:hidden" aria-label="Transactions">
        {lines.map((line) => (
          <li key={line.key} className="min-w-0 rounded-lg border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] text-muted-foreground">
              <span>{formatDay(line.day)}</span>
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                {line.flag && <OffBadge>{line.flag}</OffBadge>}
                {voucher(line)}
              </span>
            </div>
            <p className="mt-1 text-sm break-words">{line.details}</p>
            {line.note && (
              <p className="text-[0.8125rem] break-words text-muted-foreground">{line.note}</p>
            )}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3 text-sm tabular-nums">
              <span>
                {columnAmount(line.left, currency)
                  ? `${columns[0]} ${columnAmount(line.left, currency)}`
                  : `${columns[1]} ${columnAmount(line.right, currency)}`}
              </span>
              <span className={cn("font-medium", isNegative(line.balance) && "text-destructive")}>
                {signedMoney(line.balance, currency)}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="hidden md:block">
        <Table aria-label="Transactions">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Voucher</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right">{columns[0]}</TableHead>
              <TableHead className="text-right">{columns[1]}</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.key}>
                <TableCell className="whitespace-nowrap">{formatDay(line.day)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {voucher(line)}
                  {line.flag && (
                    <span className="mt-1 block">
                      <OffBadge>{line.flag}</OffBadge>
                    </span>
                  )}
                </TableCell>
                <TableCell className="min-w-56">
                  {line.details}
                  {line.note && (
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {line.note}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {columnAmount(line.left, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {columnAmount(line.right, currency)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap tabular-nums",
                    isNegative(line.balance) && "text-destructive",
                  )}
                >
                  {signedMoney(line.balance, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
