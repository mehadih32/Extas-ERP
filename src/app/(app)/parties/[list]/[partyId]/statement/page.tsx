import type { PartyKind } from "@prisma/client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { PrintDocumentButton } from "@/components/documents/print-button";
import { FormAlert } from "@/components/forms/field";
import { amountCell, drCr, money, partyHref } from "@/components/parties/labels";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { dayParam, listName } from "@/components/parties/route";
import { StatementRange } from "@/components/parties/statement-range";
import { EmptyState } from "@/components/products/bits";
import { BackLink } from "@/components/settings/back-link";
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
import type { StatementScreen } from "@/modules/parties/screens.service";
import { getStatementScreenAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Statement" };

/** What raises and lowers the balance, as the printed statement explains it. */
const HINTS: Record<PartyKind, { debit: string; credit: string }> = {
  BUYER: { debit: "Invoices and charges", credit: "Payments and returns" },
  SUPPLIER: { debit: "Payments and returns", credit: "Bills" },
  BOTH: { debit: "Billed to them, paid to them", credit: "Received, billed by them" },
};

function period(screen: StatementScreen): string {
  if (screen.from && screen.to) return `${formatDay(screen.from)} – ${formatDay(screen.to)}`;
  if (screen.from) return `${formatDay(screen.from)} – ${formatDay(screen.today)}`;
  if (screen.to) return `Up to ${formatDay(screen.to)}`;
  return "Whole account";
}

function position(screen: StatementScreen, company: string, currency: string): string {
  const closing = screen.summary.closingBalance;
  const name = screen.party.name;
  if (!/[1-9]/.test(closing)) return "Settled: nothing is owed either way.";
  return closing.startsWith("-")
    ? `${company} owes ${name} ${money(closing, currency)}.`
    : `${name} owes ${company} ${money(closing, currency)}.`;
}

function Summary({
  screen,
  company,
  currency,
}: {
  screen: StatementScreen;
  company: string;
  currency: string;
}) {
  const { summary } = screen;
  const hints = HINTS[screen.party.kind];
  const figures: Array<{ label: string; value: string; hint: string }> = [
    {
      label: "Opening balance",
      value: drCr(summary.openingBalance, currency),
      hint: screen.from ? `On ${formatDay(screen.from)}` : "Start of the account",
    },
    { label: "Total debit", value: money(summary.totalDebit, currency), hint: hints.debit },
    { label: "Total credit", value: money(summary.totalCredit, currency), hint: hints.credit },
    {
      label: "Closing balance",
      value: drCr(summary.closingBalance, currency),
      hint: `On ${formatDay(screen.to ?? screen.today)}`,
    },
  ];
  return (
    <section aria-labelledby="summary-heading" className="rounded-lg border bg-card p-5 sm:p-6">
      <h3 id="summary-heading" className="sr-only">
        Summary
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="eyebrow">{f.label}</dt>
            <dd className="mt-1 font-serif text-lg leading-tight lining-nums tabular-nums sm:text-xl">
              {f.value}
            </dd>
            <dd className="mt-1 text-[0.8125rem] text-muted-foreground">{f.hint}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 border-t pt-4 text-sm">
        {position(screen, company, currency)}{" "}
        <span className="text-muted-foreground">
          {formatCount(summary.transactionCount, currency)}{" "}
          {summary.transactionCount === 1 ? "transaction" : "transactions"} in this period. Dr is
          owed to you, Cr is owed to them.
        </span>
      </p>
    </section>
  );
}

function Lines({ screen, currency }: { screen: StatementScreen; currency: string }) {
  if (screen.lines.length === 0) {
    return (
      <EmptyState title="No transactions in this period">
        Choose other days, or the whole account.
      </EmptyState>
    );
  }
  return (
    <section aria-labelledby="lines-heading" className="grid grid-cols-1 gap-4">
      <h3 id="lines-heading" className="font-serif text-xl text-primary">
        Transactions
      </h3>
      {screen.hiddenCount > 0 && (
        <FormAlert tone="note">
          The latest {formatCount(screen.lines.length, currency)} transactions are shown. The{" "}
          {formatCount(screen.hiddenCount, currency)} before them are in the PDF, or choose fewer
          days.
        </FormAlert>
      )}
      <ol className="grid grid-cols-1 gap-3 md:hidden" aria-label="Transactions">
        {screen.lines.map((line) => (
          <li key={line.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] text-muted-foreground">
              <span>{formatDay(line.day)}</span>
              <span className="truncate">{line.number}</span>
            </div>
            <p className="mt-1 text-sm">{line.details}</p>
            {line.memo && <p className="text-[0.8125rem] text-muted-foreground">{line.memo}</p>}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3 text-sm tabular-nums">
              <span>
                {amountCell(line.debit, currency)
                  ? `Debit ${amountCell(line.debit, currency)}`
                  : `Credit ${amountCell(line.credit, currency)}`}
              </span>
              <span className="font-medium">{drCr(line.balance, currency)}</span>
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
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {screen.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="whitespace-nowrap">{formatDay(line.day)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {line.number}
                </TableCell>
                <TableCell className="min-w-56">
                  {line.details}
                  {line.memo && (
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {line.memo}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {amountCell(line.debit, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {amountCell(line.credit, currency)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap",
                    line.balance.startsWith("-") &&
                      /[1-9]/.test(line.balance) &&
                      "text-destructive",
                  )}
                >
                  {drCr(line.balance, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/**
 * A buyer's or supplier's statement (parties.ledger.view, like GET
 * /api/parties/:id/statement): the summary, then every transaction with the
 * running balance, for the whole account or the days chosen. The same
 * statement prints as a PDF on the letterhead for whoever may see it.
 */
export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ list: string; partyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ list, partyId }, query] = await Promise.all([params, searchParams]);
  if (!listName(list)) notFound();
  const range = { from: dayParam(query.from), to: dayParam(query.to) };
  const result = await getStatementScreenAction(partyId, range);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <PartiesNoAccess title="Statements are not part of your role">
          Your administrator can give your role the permission to see ledgers and statements.
        </PartiesNoAccess>
      );
    }
    if (result.error.code !== "VALIDATION") {
      return (
        <SectionError
          title="Statement"
          heading="The statement could not load"
          error={result.error}
        />
      );
    }
  }
  const currency = ctx.company.currency;
  const screen = result.ok ? result.data : null;

  return (
    <div className="grid gap-6">
      <BackLink
        href={partyHref({ id: partyId, kind: list === "suppliers" ? "SUPPLIER" : "BUYER" })}
      >
        {screen ? screen.party.name : "Back to the profile"}
      </BackLink>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {screen && <p className="eyebrow">{screen.party.code}</p>}
          <h2 className="mt-2 font-serif text-2xl text-primary">Statement of account</h2>
          {screen && (
            <p className="mt-1 text-sm text-muted-foreground">
              {screen.party.name} · {period(screen)}
            </p>
          )}
        </div>
        {screen?.can.print && (
          <PrintDocumentButton
            request={{
              type: "LEDGER_STATEMENT",
              partyId,
              from: screen.from ?? undefined,
              to: screen.to ?? undefined,
            }}
            label="Statement (PDF)"
            ready={{
              eyebrow: "Statement ready",
              description:
                "The summary on the first page and every transaction after it, on the company letterhead, ready to send.",
              errorTitle: "We could not make the statement",
            }}
          />
        )}
      </div>
      <StatementRange
        from={range.from ?? null}
        to={range.to ?? null}
        today={screen?.today ?? new Date().toISOString().slice(0, 10)}
      >
        {screen ? (
          <>
            <Summary screen={screen} company={ctx.company.name} currency={currency} />
            <Lines screen={screen} currency={currency} />
          </>
        ) : (
          !result.ok && <FormAlert>{result.error.message}</FormAlert>
        )}
      </StatementRange>
    </div>
  );
}
