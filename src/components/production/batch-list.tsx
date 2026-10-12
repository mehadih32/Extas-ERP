"use client";

import { ShowMore, useLoadMore } from "@/components/sales/load-more";
import type { BatchCardData } from "@/modules/production/batch-screens.service";
import { listBatchRowsAction } from "@/server/actions/production.actions";

import { BatchCard } from "./batch-card";

/** The Batches tab's cards, a page at a time. */
export function BatchList({
  initial,
  query,
  currency,
}: {
  initial: { items: BatchCardData[]; nextCursor?: string };
  query: { state?: string; search?: string };
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) => listBatchRowsAction({ ...query, cursor }));
  return (
    <div className="grid grid-cols-1 gap-5">
      <ul
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        aria-label="Master batches"
      >
        {list.items.map((batch) => (
          <BatchCard key={batch.id} batch={batch} currency={currency} />
        ))}
      </ul>
      <ShowMore list={list} noun="batches" />
    </div>
  );
}
