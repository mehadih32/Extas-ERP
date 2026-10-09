import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { GradeBadge, StatusBadge } from "@/components/parties/badges";
import { KIND_LABELS, money, partyHref } from "@/components/parties/labels";
import { PartiesNoAccess } from "@/components/parties/no-access";
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
import type { DuesRow } from "@/modules/parties/screens.service";
import { getDuesScreenAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Dues" };

function DuesList({
  id,
  title,
  rows,
  empty,
  tone,
  currency,
}: {
  id: string;
  title: string;
  rows: DuesRow[];
  empty: string;
  tone: "owed" | "owing";
  currency: string;
}) {
  const amountClass = tone === "owed" ? "text-primary" : "text-destructive";
  return (
    <section aria-labelledby={id} className="grid grid-cols-1 content-start gap-4">
      <h3 id={id} className="font-serif text-xl text-primary">
        {title}
      </h3>
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:hidden" aria-label={title}>
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={partyHref(row, "/statement")}
                  className="block rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="eyebrow truncate">
                      {row.code} · {KIND_LABELS[row.kind]}
                    </p>
                    <div className="-my-1 flex shrink-0 gap-1.5">
                      <StatusBadge status={row.status} />
                      {row.grade && <GradeBadge grade={row.grade} />}
                    </div>
                  </div>
                  <p className="mt-2 truncate font-serif text-lg text-primary">{row.name}</p>
                  <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
                    <span className="text-muted-foreground">
                      {row.lastTransactionOn
                        ? `Last business ${formatDay(row.lastTransactionOn)}`
                        : "No business yet"}
                    </span>
                    <span className={cn("font-medium whitespace-nowrap tabular-nums", amountClass)}>
                      {money(row.amount, currency)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table aria-label={title}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Last business</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="py-3">
                      <Link
                        href={partyHref(row)}
                        className="rounded-sm font-medium text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                      >
                        {row.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                        <span>
                          {row.code} · {KIND_LABELS[row.kind]}
                        </span>
                        <StatusBadge status={row.status} />
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.grade ? (
                        <GradeBadge grade={row.grade} />
                      ) : (
                        <span className="text-muted-foreground">
                          <span aria-hidden>–</span>
                          <span className="sr-only">No grade</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {row.lastTransactionOn ? formatDay(row.lastTransactionOn) : "None yet"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className={cn("font-medium", amountClass)}>
                        {money(row.amount, currency)}
                      </span>
                      <Link
                        href={partyHref(row, "/statement")}
                        className="block rounded-sm text-[0.8125rem] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/25"
                      >
                        Statement<span className="sr-only"> of {row.name}</span>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * What the market owes the company and what it owes its suppliers today
 * (parties.ledger.view, like GET /api/parties/receivables-payables), with every
 * account that has a balance, largest first. Each opens its statement.
 */
export default async function DuesPage() {
  const ctx = await requireCompanyPage();
  const result = await getDuesScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <PartiesNoAccess title="Dues are not part of your role">
          Your administrator can give your role the permission to see ledgers and statements.
        </PartiesNoAccess>
      );
    }
    return <SectionError title="Dues" heading="The dues could not load" error={result.error} />;
  }
  const dues = result.data;
  const currency = ctx.company.currency;
  const accounts = (n: number) => `${formatCount(n, currency)} ${n === 1 ? "account" : "accounts"}`;

  return (
    <section aria-labelledby="dues-heading" className="grid gap-8">
      <div>
        <h2 id="dues-heading" className="font-serif text-2xl text-primary">
          Dues
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          What buyers owe you and what you owe suppliers today, largest first. Open one for its
          statement.
        </p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <dt className="eyebrow">Owed to you</dt>
          <dd className="mt-2 font-serif text-[1.75rem] leading-tight text-primary lining-nums tabular-nums">
            {money(dues.totalReceivable, currency)}
          </dd>
          <dd className="mt-1 text-sm text-muted-foreground">
            {accounts(dues.receivables.length)}
          </dd>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <dt className="eyebrow">You owe</dt>
          <dd className="mt-2 font-serif text-[1.75rem] leading-tight text-destructive lining-nums tabular-nums">
            {money(dues.totalPayable, currency)}
          </dd>
          <dd className="mt-1 text-sm text-muted-foreground">{accounts(dues.payables.length)}</dd>
        </div>
      </dl>
      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2 xl:gap-8">
        <DuesList
          id="owed-heading"
          title="Owed to you"
          rows={dues.receivables}
          empty="Nobody owes you anything"
          tone="owed"
          currency={currency}
        />
        <DuesList
          id="owing-heading"
          title="You owe"
          rows={dues.payables}
          empty="You owe nobody anything"
          tone="owing"
          currency={currency}
        />
      </div>
    </section>
  );
}
