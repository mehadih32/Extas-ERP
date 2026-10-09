import Link from "next/link";

import { cn } from "@/lib/utils";

import { accountsHref, isNegative, signedMoney } from "./labels";

/*
 * The parts of a financial report on screen: blocks of account lines with
 * their total, and the results between them (gross profit, net profit). Each
 * account opens its ledger. Rows wrap on phones; amounts never do.
 */

export type ReportLine = {
  accountId: string | null;
  code: string | null;
  name: string;
  amount: string;
};

const amountClass = (fixed: string) =>
  cn("whitespace-nowrap tabular-nums", isNegative(fixed) && "text-destructive");

export function ReportLines({ lines, currency }: { lines: ReportLine[]; currency: string }) {
  if (lines.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Nothing in this period.</p>;
  }
  return (
    <ul className="grid divide-y">
      {lines.map((l) => (
        <li
          key={l.accountId ?? l.name}
          className="flex min-w-0 items-baseline justify-between gap-3 py-2 text-sm"
        >
          <span className="min-w-0 break-words">
            {l.accountId ? (
              <Link
                href={accountsHref.account(l.accountId)}
                className="underline-offset-4 hover:text-primary hover:underline"
              >
                {l.code && (
                  <span className="mr-2 text-muted-foreground tabular-nums">{l.code}</span>
                )}
                {l.name}
              </Link>
            ) : (
              l.name
            )}
          </span>
          <span className={amountClass(l.amount)}>{signedMoney(l.amount, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A titled block of lines and its total. */
export function ReportBlock({
  title,
  lines,
  total,
  totalLabel,
  currency,
  children,
}: {
  title: string;
  lines?: ReportLine[];
  total?: string;
  totalLabel?: string;
  currency: string;
  /** Anything shown under the lines, above the total. */
  children?: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <h4 className="eyebrow">{title}</h4>
      {lines && <ReportLines lines={lines} currency={currency} />}
      {children}
      {total !== undefined && (
        <p className="flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-medium">
          <span>{totalLabel ?? `Total ${title.toLowerCase()}`}</span>
          <span className={amountClass(total)}>{signedMoney(total, currency)}</span>
        </p>
      )}
    </div>
  );
}

/** A result between blocks: gross profit, net profit, total assets. */
export function ReportResult({
  label,
  amount,
  currency,
  hint,
  strong = false,
}: {
  label: string;
  amount: string;
  currency: string;
  hint?: string | null;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2.5",
        strong && "bg-primary/5",
      )}
    >
      <span className={cn("text-sm font-medium", strong && "font-serif text-lg text-primary")}>
        {label}
        {hint && (
          <span className="ml-2 font-sans text-[0.8125rem] font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <span
        className={cn(
          amountClass(amount),
          "font-medium",
          strong && "font-serif text-lg",
          strong && !isNegative(amount) && "text-primary",
        )}
      >
        {signedMoney(amount, currency)}
      </span>
    </div>
  );
}
