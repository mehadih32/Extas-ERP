import { SparklesIcon } from "lucide-react";
import Link from "next/link";

import { money } from "@/components/sales/labels";
import type { AiRecordCost } from "@/modules/ai/costs.service";

/*
 * The small AI box on a tech pack's and an order's page: whether AI is on, and
 * (for the people who see the AI Center) what AI work on this record has cost
 * so far.
 */
export function AiRecordBox({ box }: { box: AiRecordCost }) {
  return (
    <aside
      aria-label="AI on this record"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2 text-[0.8125rem]"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <SparklesIcon aria-hidden className="size-3.5 text-primary" />
        AI {box.on ? "on" : "off"}
      </span>
      {box.cost !== null && (
        <span className="text-muted-foreground">
          AI cost so far:{" "}
          <span className="text-foreground tabular-nums">{money(box.cost, box.currency)}</span>
          {box.calls > 0 && ` (${box.calls} ${box.calls === 1 ? "call" : "calls"})`}
        </span>
      )}
      {box.cost !== null && (
        <Link href="/ai/costs" className="underline underline-offset-4">
          Budget & Costs
        </Link>
      )}
    </aside>
  );
}
