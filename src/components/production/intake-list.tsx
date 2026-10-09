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
import { formatCount, formatDay } from "@/lib/display";
import type { IntakeRow } from "@/modules/production/screens.service";
import { listIntakeRowsAction } from "@/server/actions/production.actions";

import { DeliveryBadge } from "./badges";
import { pieces, productionHref } from "./labels";
import { deliveryListQuery, type DeliveryListView } from "./list-view";

const projectName = (row: IntakeRow) =>
  row.project ? `${row.project.code} · ${row.project.name}` : "No project";

const dayOf = (row: IntakeRow) =>
  row.confirmedOn ? `In stock ${formatDay(row.confirmedOn)}` : `Made ${formatDay(row.madeOn)}`;

/**
 * The factory deliveries found: cards on phones, a table on computers, each
 * opening the delivery, with "Show more" for the next page. The cost each
 * carried into stock shows only to people who see production costs.
 */
export function IntakeList({
  initial,
  view,
  currency,
}: {
  initial: { items: IntakeRow[]; nextCursor?: string };
  view: DeliveryListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listIntakeRowsAction(deliveryListQuery(view, cursor)),
  );
  const showCosts = list.items.some((d) => d.totalCost !== null);

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Deliveries">
        {list.items.map((d) => (
          <RowCard
            key={d.id}
            href={productionHref.delivery(d.id)}
            eyebrow={`${d.number} · ${dayOf(d)}`}
            badges={<DeliveryBadge status={d.status} />}
            title={projectName(d)}
            details={[
              d.warehouse,
              d.bGradePieces > 0 ? `${formatCount(d.bGradePieces, currency)} B-grade` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            footer={
              <>
                <span className="font-medium">{pieces(d.pieces, currency)}</span>
                {d.totalCost && d.status === "CONFIRMED" && (
                  <span className="text-muted-foreground">{money(d.totalCost, currency)}</span>
                )}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Deliveries">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Delivery</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Pieces</TableHead>
              <TableHead className="text-right">B-grade</TableHead>
              {showCosts && <TableHead className="text-right">Cost</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="py-3">
                  <RowLink href={productionHref.delivery(d.id)}>{d.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{dayOf(d)}</span>
                    <DeliveryBadge status={d.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-72 truncate">{projectName(d)}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {d.warehouse ?? "Not chosen"}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {formatCount(d.pieces, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                  {d.bGradePieces > 0 ? formatCount(d.bGradePieces, currency) : "None"}
                </TableCell>
                {showCosts && (
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {d.totalCost && d.status === "CONFIRMED" ? money(d.totalCost, currency) : null}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="deliveries" />
    </div>
  );
}
