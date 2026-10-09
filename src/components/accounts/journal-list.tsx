"use client";

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
import type { JournalRow } from "@/modules/accounts/screens.service";
import { listJournalRowsAction } from "@/server/actions/accounts.actions";

import { OffBadge } from "./badges";
import { accountsHref, SOURCE_LABELS } from "./labels";
import { journalListQuery, type JournalListView } from "./list-view";

const accountsText = (e: JournalRow) =>
  e.accounts.join(", ") + (e.moreAccounts > 0 ? ` and ${e.moreAccounts} more` : "");

function Badges({ entry }: { entry: JournalRow }) {
  if (entry.isReversed) return <OffBadge>Reversed</OffBadge>;
  if (entry.reversalOf) return <OffBadge>Reversal</OffBadge>;
  return null;
}

/**
 * Journal entries, newest first: cards on phones, a table on computers, each
 * opening the entry and its lines, with "Show more" for the next page.
 */
export function JournalList({
  initial,
  view,
  currency,
}: {
  initial: { items: JournalRow[]; nextCursor?: string };
  view: JournalListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listJournalRowsAction(journalListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Journal entries">
        {list.items.map((e) => (
          <RowCard
            key={e.id}
            href={accountsHref.entry(e.id)}
            eyebrow={`${e.number} · ${formatDay(e.day)}`}
            badges={<Badges entry={e} />}
            title={e.description ?? SOURCE_LABELS[e.sourceType]}
            details={accountsText(e)}
            footer={
              <>
                <span className="text-muted-foreground">{SOURCE_LABELS[e.sourceType]}</span>
                <span className="font-medium">{money(e.total, currency)}</span>
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Journal entries">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Voucher</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Made by</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="py-3">
                  <RowLink href={accountsHref.entry(e.id)}>{e.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(e.day)}</span>
                    <Badges entry={e} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-md truncate">{e.description}</div>
                  <div className="max-w-md truncate text-[0.8125rem] text-muted-foreground">
                    {accountsText(e)}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {SOURCE_LABELS[e.sourceType]}
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                  {money(e.total, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="entries" />
    </div>
  );
}
