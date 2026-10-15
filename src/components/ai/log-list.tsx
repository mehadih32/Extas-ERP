"use client";

import { SparklesIcon } from "lucide-react";

import { useWhen } from "@/components/ai/when";
import type { AiLogs } from "@/modules/ai/logs.service";

/*
 * A list of AI log rows: what the AI did (marked AI, with its name) and the
 * changes people made to what it may do.
 */

export function AiLogList({ items, empty }: { items: AiLogs["items"]; empty: string }) {
  const when = useWhen({ year: true });
  if (items.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="mt-3 divide-y">
      {items.map((row) => (
        <li key={row.id} className="grid gap-0.5 py-2.5">
          <span className="text-sm break-words">{row.what}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
            {row.byAi && (
              <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 text-[0.75rem] font-medium text-primary">
                <SparklesIcon aria-hidden className="size-3" />
                AI
              </span>
            )}
            <span>{row.who}</span>
            <span aria-hidden>·</span>
            <time dateTime={new Date(row.at).toISOString()}>{when(row.at)}</time>
          </span>
        </li>
      ))}
    </ul>
  );
}
