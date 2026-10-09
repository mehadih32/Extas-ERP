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
import { cn } from "@/lib/utils";
import type { MaterialRow } from "@/modules/materials/screens.service";
import { listMaterialRowsAction } from "@/server/actions/materials.actions";

import { FlagBadge } from "./badges";
import { KIND_LABELS, materialsHref, quantity } from "./labels";
import { stockListQuery, type StockListView } from "./list-view";

const isZero = (text: string) => !/[1-9]/.test(text);

function Flags({ m }: { m: MaterialRow }) {
  if (!m.isActive) return <FlagBadge tone="closed">Archived</FlagBadge>;
  if (m.isLow) return <FlagBadge>Running low</FlagBadge>;
  return null;
}

/**
 * Raw materials with what is on hand (in every store, or the one filtered on):
 * cards on phones, a table on computers, each opening its stock card, with
 * "Show more" for the next page. Values show to people who see costs.
 */
export function MaterialList({
  initial,
  view,
  currency,
  seeCosts,
}: {
  initial: { items: MaterialRow[]; nextCursor?: string };
  view: StockListView;
  currency: string;
  seeCosts: boolean;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listMaterialRowsAction(stockListQuery(view, cursor)),
  );
  const where = view.store ? "In this store" : "On hand";
  const details = (m: MaterialRow) =>
    [KIND_LABELS[m.kind], m.color, m.supplier?.name].filter(Boolean).join(" · ");

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Materials">
        {list.items.map((m) => (
          <RowCard
            key={m.id}
            href={materialsHref.material(m.id)}
            eyebrow={m.code}
            badges={<Flags m={m} />}
            title={m.name}
            details={details(m)}
            footer={
              <>
                <span className={cn("font-medium", m.isLow && "text-destructive")}>
                  {quantity(m.quantity, m.unit, currency)}
                </span>
                <span className="text-muted-foreground">
                  {!isZero(m.incoming)
                    ? `${quantity(m.incoming, m.unit, currency)} on order`
                    : seeCosts && m.stockValue
                      ? money(m.stockValue, currency)
                      : null}
                </span>
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Materials">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Material</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">{where}</TableHead>
              <TableHead className="text-right">On order</TableHead>
              {seeCosts && <TableHead className="text-right">Average cost</TableHead>}
              {seeCosts && <TableHead className="text-right">Value</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="py-3">
                  <RowLink href={materialsHref.material(m.id)}>{m.code}</RowLink>
                  <div className="max-w-72 truncate">{m.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    {m.color && <span>{m.color}</span>}
                    <Flags m={m} />
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {KIND_LABELS[m.kind]}
                  {m.supplier && (
                    <div className="max-w-48 truncate text-[0.8125rem]">{m.supplier.name}</div>
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap tabular-nums",
                    m.isLow && "text-destructive",
                  )}
                >
                  {quantity(m.quantity, m.unit, currency)}
                  {m.reorderLevel && (
                    <div className="text-[0.8125rem] font-normal text-muted-foreground">
                      Reorder at {quantity(m.reorderLevel, m.unit, currency)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                  {isZero(m.incoming) ? "–" : quantity(m.incoming, m.unit, currency)}
                </TableCell>
                {seeCosts && (
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {m.avgCost && !isZero(m.avgCost) ? money(m.avgCost, currency) : "–"}
                  </TableCell>
                )}
                {seeCosts && (
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {m.stockValue ? money(m.stockValue, currency) : "–"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="materials" />
    </div>
  );
}
